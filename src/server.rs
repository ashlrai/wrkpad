use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use tokio::net::TcpListener;
use tokio::sync::RwLock;

use crate::engine::{EngineError, StateEngine};
use crate::model::HaspEvent;
use crate::storage::JsonStore;

type HmacSha256 = Hmac<Sha256>;

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
    match engine.apply(event) {
        Ok(outcome) => {
            if let Err(error) = state.store.save(&engine) {
                tracing::error!(%error, "failed to persist HASP state");
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "state persistence failed",
                );
            }
            let status = if outcome.duplicate {
                StatusCode::OK
            } else {
                StatusCode::ACCEPTED
            };
            protect_response((status, Json(outcome)).into_response())
        }
        Err(error) => engine_error(&error),
    }
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
    mac.update(format!("{:?}\0{}\0", event.provider, event.session_id).as_bytes());
    if let Some(cwd) = &event.cwd {
        mac.update(cwd.as_bytes());
    }
    let binding = hex::encode(mac.finalize().into_bytes());
    event.session_id = format!("hmac-sha256:{binding}");
    event.cwd = None;
    Ok(())
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
    let mut hosts = vec![format!("{}:{port}", bind.ip()), format!("localhost:{port}")];
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
    use super::constant_time_eq;

    #[test]
    fn token_comparison_handles_length_and_content() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"diff"));
        assert!(!constant_time_eq(b"short", b"longer"));
    }
}
