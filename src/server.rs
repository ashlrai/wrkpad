use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use tokio::net::TcpListener;
use tokio::sync::RwLock;

use crate::engine::{EngineError, StateEngine};
use crate::model::{ApplyOutcome, HaspEvent};
use crate::storage::JsonStore;

type HmacSha256 = Hmac<Sha256>;
const SESSION_BINDING_DOMAIN: &[u8] = b"wrkpad.hasp.session.v1\0";

#[derive(Clone)]
struct AppState {
    engine: Arc<RwLock<StateEngine>>,
    store: JsonStore<StateEngine>,
    token: Arc<String>,
    allowed_hosts: Arc<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct Health {
    schema: &'static str,
    status: &'static str,
    hasp: &'static str,
    version: &'static str,
}

pub async fn serve(bind: SocketAddr, token: String, store: JsonStore<StateEngine>) -> Result<()> {
    if !bind.ip().is_loopback() {
        bail!("wrkpad refuses non-loopback bind address {bind}");
    }
    let engine = store.load()?;
    let allowed_hosts = allowed_hosts(bind);
    let state = AppState {
        engine: Arc::new(RwLock::new(engine)),
        store,
        token: Arc::new(token),
        allowed_hosts: Arc::new(allowed_hosts),
    };
    let router = Router::new()
        .route("/v1/health", get(health))
        .route("/v1/state", get(snapshot))
        .route("/v1/events", post(ingest))
        .route("/v1/slots/{agent_key}", delete(forget_slot))
        .layer(DefaultBodyLimit::max(32 * 1024))
        .with_state(state);
    let listener = TcpListener::bind(bind)
        .await
        .with_context(|| format!("failed to bind authenticated HASP listener to {bind}"))?;
    tracing::info!(%bind, "HASP listening on loopback");
    axum::serve(listener, router).await?;
    Ok(())
}

async fn health() -> Response {
    protect_response(
        Json(Health {
            schema: "dev.wrkpad.health/v1",
            status: "ok",
            hasp: "v1",
            version: env!("CARGO_PKG_VERSION"),
        })
        .into_response(),
    )
}

async fn snapshot(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Err(response) = authorize(&state, &headers, false) {
        return response;
    }
    protect_response(Json(state.engine.read().await.snapshot()).into_response())
}

async fn ingest(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut event): Json<HaspEvent>,
) -> Response {
    if let Err(response) = authorize(&state, &headers, true) {
        return response;
    }
    if let Err(message) = privatize_identity(&state.token, &mut event) {
        return json_error(StatusCode::UNPROCESSABLE_ENTITY, &message);
    }
    let mut engine = state.engine.write().await;
    match apply_persisted(&mut engine, event, &state.store) {
        Ok(outcome) => {
            let status = if outcome.duplicate {
                StatusCode::OK
            } else {
                StatusCode::ACCEPTED
            };
            protect_response((status, Json(outcome)).into_response())
        }
        Err(ApplyPersistError::Engine(error)) => engine_error(&error),
        Err(ApplyPersistError::Persistence(error)) => {
            tracing::error!(%error, "failed to persist HASP state");
            json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "state persistence failed",
            )
        }
    }
}

async fn forget_slot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(agent_key): Path<u8>,
) -> Response {
    if let Err(response) = authorize(&state, &headers, false) {
        return response;
    }
    let mut engine = state.engine.write().await;
    let previous = engine.clone();
    match engine.forget_slot(agent_key) {
        Ok(snapshot) => {
            if let Err(error) = state.store.save(&engine) {
                *engine = previous;
                tracing::error!(%error, "failed to persist HASP slot recovery");
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "state persistence failed",
                );
            }
            protect_response(Json(snapshot).into_response())
        }
        Err(error) => engine_error(&error),
    }
}

#[derive(Debug)]
enum ApplyPersistError {
    Engine(EngineError),
    Persistence(anyhow::Error),
}

fn apply_persisted(
    engine: &mut StateEngine,
    event: HaspEvent,
    store: &JsonStore<StateEngine>,
) -> Result<ApplyOutcome, ApplyPersistError> {
    let previous = engine.clone();
    let outcome = engine.apply(event).map_err(ApplyPersistError::Engine)?;
    if let Err(error) = store.save(engine) {
        *engine = previous;
        return Err(ApplyPersistError::Persistence(error));
    }
    Ok(outcome)
}

fn authorize(state: &AppState, headers: &HeaderMap, require_json: bool) -> Result<(), Response> {
    if headers.contains_key(header::ORIGIN) {
        return Err(json_error(
            StatusCode::FORBIDDEN,
            "browser origins are not accepted",
        ));
    }
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !state.allowed_hosts.iter().any(|allowed| allowed == host) {
        return Err(json_error(StatusCode::FORBIDDEN, "unexpected Host header"));
    }
    if require_json {
        let content_type = headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        if !content_type.starts_with("application/json") {
            return Err(json_error(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "application/json required",
            ));
        }
    }
    let supplied = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if !constant_time_eq(supplied.as_bytes(), state.token.as_bytes()) {
        return Err(json_error(
            StatusCode::UNAUTHORIZED,
            "authentication required",
        ));
    }
    Ok(())
}

fn privatize_identity(token: &str, event: &mut HaspEvent) -> Result<(), String> {
    let mut mac = HmacSha256::new_from_slice(token.as_bytes())
        .map_err(|_| "invalid local authentication key".to_owned())?;
    mac.update(SESSION_BINDING_DOMAIN);
    mac.update(provider_binding_tag(event.provider));
    mac.update(b"\0");
    mac.update(event.session_id.as_bytes());
    let binding = hex::encode(mac.finalize().into_bytes());
    event.session_id = format!("hmac-sha256:{binding}");
    event.cwd = None;
    Ok(())
}

const fn provider_binding_tag(provider: crate::model::Provider) -> &'static [u8] {
    match provider {
        crate::model::Provider::Claude => b"claude",
        crate::model::Provider::Codex => b"codex",
        crate::model::Provider::Manual => b"manual",
        crate::model::Provider::Unknown => b"unknown",
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let mut difference = left.len() ^ right.len();
    for index in 0..left.len().max(right.len()) {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        difference |= usize::from(a ^ b);
    }
    difference == 0
}

fn allowed_hosts(bind: SocketAddr) -> Vec<String> {
    let port = bind.port();
    let mut hosts = vec![bind.to_string(), format!("localhost:{port}")];
    if bind.ip() == IpAddr::from([0, 0, 0, 0]) {
        hosts.clear();
    }
    hosts
}

fn engine_error(error: &EngineError) -> Response {
    let status = if matches!(error, EngineError::SlotsFull) {
        StatusCode::CONFLICT
    } else {
        StatusCode::UNPROCESSABLE_ENTITY
    };
    json_error(status, &error.to_string())
}

fn json_error(status: StatusCode, message: &str) -> Response {
    let body = serde_json::json!({
        "schema": "dev.wrkpad.error/v1",
        "error": status.as_u16(),
        "message": message,
    });
    let response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap_or_else(|_| Response::new(Body::empty()));
    protect_response(response)
}

fn protect_response(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    response
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use chrono::{Duration, Utc};
    use serde_json::json;

    use super::{
        allowed_hosts, apply_persisted, constant_time_eq, engine_error, privatize_identity,
    };
    use crate::engine::{EngineError, StateEngine};
    use crate::hooks::normalize;
    use crate::model::{AgentState, EventKind, HaspEvent, Provider};
    use crate::storage::JsonStore;

    #[test]
    fn token_comparison_handles_length_and_content() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"diff"));
        assert!(!constant_time_eq(b"short", b"longer"));
    }

    #[test]
    fn private_session_identity_is_provider_scoped_and_cwd_independent() -> anyhow::Result<()> {
        let mut without_cwd =
            HaspEvent::new(Provider::Claude, "provider-session", EventKind::Working);
        let mut with_cwd = without_cwd.clone();
        with_cwd.cwd = Some("/work/first".to_owned());
        let mut with_changed_cwd = without_cwd.clone();
        with_changed_cwd.cwd = Some("/work/second".to_owned());
        let mut other_provider =
            HaspEvent::new(Provider::Codex, "provider-session", EventKind::Working);

        for event in [
            &mut without_cwd,
            &mut with_cwd,
            &mut with_changed_cwd,
            &mut other_provider,
        ] {
            privatize_identity("private-token", event).map_err(anyhow::Error::msg)?;
            assert!(event.session_id.starts_with("hmac-sha256:"));
            assert_eq!(event.cwd, None);
        }

        assert_eq!(without_cwd.session_id, with_cwd.session_id);
        assert_eq!(without_cwd.session_id, with_changed_cwd.session_id);
        assert_eq!(
            without_cwd.session_id,
            "hmac-sha256:4336c8bdfd94e9bf492989a8e1fe73333797727e383b265c675a9cc638e624de"
        );
        assert_ne!(without_cwd.session_id, other_provider.session_id);
        Ok(())
    }

    #[test]
    fn cwd_changes_keep_lifecycle_events_on_one_private_slot() -> anyhow::Result<()> {
        let mut start = HaspEvent::new(
            Provider::Claude,
            "parent\0subagent\0agent-a",
            EventKind::Working,
        );
        start.cwd = Some("/work/repo".to_owned());
        let mut needs_input = HaspEvent::new(
            Provider::Claude,
            "parent\0subagent\0agent-a",
            EventKind::NeedsInput,
        );

        privatize_identity("private-token", &mut start).map_err(anyhow::Error::msg)?;
        privatize_identity("private-token", &mut needs_input).map_err(anyhow::Error::msg)?;
        assert_eq!(start.session_id, needs_input.session_id);

        let mut engine = StateEngine::default();
        let first = engine.apply(start)?;
        let second = engine.apply(needs_input)?;
        assert_eq!(first.assigned_slot, Some(1));
        assert_eq!(second.assigned_slot, Some(1));
        assert_eq!(
            second.snapshot.slots[0]
                .session
                .as_ref()
                .map(|session| session.state),
            Some(AgentState::NeedsInput)
        );
        assert_eq!(
            second
                .snapshot
                .slots
                .iter()
                .filter(|slot| slot.session.is_some())
                .count(),
            1
        );
        Ok(())
    }

    #[test]
    fn normalized_same_turn_lifecycle_resumes_after_needs_input() -> anyhow::Result<()> {
        let base = Utc::now();
        let mut initial = normalize(
            Provider::Claude,
            None,
            &json!({
                "session_id": "claude-session",
                "turn_id": "turn-1",
                "hook_event_name": "UserPromptSubmit",
                "cwd": "/work/repo",
                "prompt": "discarded"
            }),
        )?
        .ok_or_else(|| anyhow::anyhow!("initial event was ignored"))?;
        let mut needs_input = normalize(
            Provider::Claude,
            None,
            &json!({
                "session_id": "claude-session",
                "turn_id": "turn-1",
                "hook_event_name": "PermissionRequest",
                "tool_input": {"command": "discarded"}
            }),
        )?
        .ok_or_else(|| anyhow::anyhow!("attention event was ignored"))?;
        let mut resumed = normalize(
            Provider::Claude,
            None,
            &json!({
                "session_id": "claude-session",
                "turn_id": "turn-1",
                "hook_event_name": "PostToolUse",
                "tool_response": "discarded"
            }),
        )?
        .ok_or_else(|| anyhow::anyhow!("resume event was ignored"))?;
        initial.at = base + Duration::seconds(1);
        needs_input.at = base + Duration::seconds(2);
        resumed.at = base + Duration::seconds(3);
        assert_ne!(initial.event_id, resumed.event_id);

        for event in [&mut initial, &mut needs_input, &mut resumed] {
            privatize_identity("private-token", event).map_err(anyhow::Error::msg)?;
        }
        assert_eq!(initial.session_id, needs_input.session_id);
        assert_eq!(initial.session_id, resumed.session_id);

        let mut engine = StateEngine::default();
        engine.apply(initial)?;
        let attention = engine.apply(needs_input)?;
        assert_eq!(
            attention.snapshot.slots[0]
                .session
                .as_ref()
                .map(|session| session.state),
            Some(AgentState::NeedsInput)
        );
        let resumed = engine.apply(resumed)?;
        assert_eq!(
            resumed.snapshot.slots[0]
                .session
                .as_ref()
                .map(|session| session.state),
            Some(AgentState::Working)
        );
        Ok(())
    }

    #[test]
    fn out_of_order_engine_errors_map_to_bounded_unprocessable_responses() {
        let response = engine_error(&EngineError::OutOfOrderEvent);
        assert_eq!(
            response.status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[test]
    fn ipv6_loopback_host_uses_brackets() -> anyhow::Result<()> {
        let hosts = allowed_hosts("[::1]:43187".parse()?);
        assert!(hosts.iter().any(|host| host == "[::1]:43187"));
        Ok(())
    }

    #[test]
    fn persistence_failure_rolls_back_memory() -> anyhow::Result<()> {
        let directory = tempdir()?;
        let blocked_parent = directory.path().join("not-a-directory");
        std::fs::write(&blocked_parent, b"file")?;
        let store = JsonStore::new(blocked_parent.join("state.json"));
        let mut engine = StateEngine::default();
        let event = HaspEvent::new(Provider::Manual, "session", EventKind::Working);

        assert!(apply_persisted(&mut engine, event, &store).is_err());
        assert_eq!(engine.snapshot().revision, 0);
        Ok(())
    }
}
