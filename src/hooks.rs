use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Context, Result, bail};
use chrono::Utc;
use serde_json::Value;
use uuid::Uuid;

use crate::model::{EventKind, HaspEvent, Provider};

const EVENT_NAMESPACE: Uuid = Uuid::from_u128(0x517c7f8d_f6b0_4777_921e_f0658249f380);

pub fn normalize(
    provider: Provider,
    declared_event: Option<&str>,
    payload: &Value,
) -> Result<Option<HaspEvent>> {
    let object = payload
        .as_object()
        .context("hook input must be one JSON object")?;
    let source_event = declared_event
        .or_else(|| object.get("hook_event_name").and_then(Value::as_str))
        .or_else(|| object.get("type").and_then(Value::as_str))
        .context("hook input does not identify its event")?;

    let session_id = first_string(
        object,
        &["session_id", "thread_id", "thread-id", "conversation_id"],
    )
    .context("hook input does not contain a session/thread identifier")?;
    if session_id.len() > 256 {
        bail!("hook session identifier exceeds 256 bytes");
    }

    let kind = match source_event {
        "SessionStart" => EventKind::SessionStart,
        "UserPromptSubmit" | "PreToolUse" | "PostToolUse" => EventKind::Working,
        "PermissionRequest" => EventKind::NeedsInput,
        "Notification" => {
            let notification_type = object
                .get("notification_type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if matches!(
                notification_type,
                "permission_prompt" | "elicitation_dialog" | "idle_prompt"
            ) {
                EventKind::NeedsInput
            } else {
                return Ok(None);
            }
        }
        "PostToolUseFailure" | "StopFailure" => EventKind::Error,
        "Stop" | "agent-turn-complete" => EventKind::TurnComplete,
        "SessionEnd" => EventKind::SessionEnd,
        other => bail!("unsupported hook event: {other}"),
    };

    let cwd = object
        .get("cwd")
        .and_then(Value::as_str)
        .filter(|value| value.len() <= 4096)
        .map(|value| {
            value
                .chars()
                .filter(|character| !character.is_control())
                .collect::<String>()
        })
        .filter(|value| !value.is_empty());
    let title = cwd.as_deref().and_then(workspace_label);
    let turn_id = first_string(object, &["turn_id", "turn-id", "prompt_id"]);

    let event_id = turn_id.map_or_else(Uuid::new_v4, |turn| {
        let key = format!("{provider:?}\0{session_id}\0{turn}\0{kind:?}");
        Uuid::new_v5(&EVENT_NAMESPACE, key.as_bytes())
    });
    let mut labels = BTreeMap::new();
    labels.insert("source_event".to_owned(), source_event.to_owned());
    if let Some(turn) = turn_id {
        labels.insert("turn_id".to_owned(), turn.to_owned());
    }
    if source_event == "Stop"
        && object
            .get("background_tasks")
            .and_then(Value::as_array)
            .is_some_and(|tasks| !tasks.is_empty())
    {
        labels.insert("background_work".to_owned(), "true".to_owned());
    }

    Ok(Some(HaspEvent {
        schema: crate::HASP_SCHEMA.to_owned(),
        event_id,
        provider,
        session_id: session_id.to_owned(),
        kind,
        at: Utc::now(),
        title,
        cwd,
        labels,
    }))
}

fn first_string<'a>(object: &'a serde_json::Map<String, Value>, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
}

fn workspace_label(path: &str) -> Option<String> {
    Path::new(path)
        .file_name()
        .map(|name| {
            name.to_string_lossy()
                .chars()
                .filter(|character| !character.is_control())
                .take(120)
                .collect::<String>()
        })
        .filter(|label| !label.is_empty())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::normalize;
    use crate::model::{EventKind, Provider};

    #[test]
    fn claude_prompt_content_is_not_retained() -> anyhow::Result<()> {
        let payload = json!({
            "session_id": "claude-1",
            "hook_event_name": "UserPromptSubmit",
            "cwd": "/work/secret-project",
            "prompt": "credential-like content must disappear",
            "transcript_path": "/private/transcript.jsonl"
        });
        let event = normalize(Provider::Claude, None, &payload)?
            .ok_or_else(|| anyhow::anyhow!("event ignored"))?;
        let encoded = serde_json::to_string(&event)?;
        assert_eq!(event.kind, EventKind::Working);
        assert!(!encoded.contains("credential-like"));
        assert!(!encoded.contains("transcript"));
        Ok(())
    }

    #[test]
    fn codex_permission_request_never_returns_a_decision() -> anyhow::Result<()> {
        let payload = json!({
            "session_id": "codex-1",
            "turn_id": "turn-1",
            "hook_event_name": "PermissionRequest",
            "tool_name": "Bash",
            "tool_input": {"command": "do not retain"}
        });
        let event = normalize(Provider::Codex, None, &payload)?
            .ok_or_else(|| anyhow::anyhow!("event ignored"))?;
        let encoded = serde_json::to_string(&event)?;
        assert_eq!(event.kind, EventKind::NeedsInput);
        assert!(!encoded.contains("command"));
        assert!(!encoded.contains("allow"));
        assert!(!encoded.contains("deny"));
        Ok(())
    }

    #[test]
    fn irrelevant_notifications_exit_without_an_event() -> anyhow::Result<()> {
        let payload = json!({
            "session_id": "claude-1",
            "hook_event_name": "Notification",
            "notification_type": "auth_success",
            "message": "discard me"
        });
        assert!(normalize(Provider::Claude, None, &payload)?.is_none());
        Ok(())
    }

    #[test]
    fn provider_titles_and_terminal_controls_are_discarded() -> anyhow::Result<()> {
        let payload = json!({
            "session_id": "claude-1",
            "hook_event_name": "SessionStart",
            "session_title": "private customer title",
            "cwd": "/work/project\u{001b}[31m"
        });
        let event = normalize(Provider::Claude, None, &payload)?
            .ok_or_else(|| anyhow::anyhow!("event ignored"))?;
        assert_eq!(event.title.as_deref(), Some("project[31m"));
        let encoded = serde_json::to_string(&event)?;
        assert!(!encoded.contains("private customer"));
        assert!(!encoded.contains("\\u001b"));
        Ok(())
    }
}
