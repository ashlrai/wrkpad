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

    let parent_session_id = first_string(
        object,
        &["session_id", "thread_id", "thread-id", "conversation_id"],
    )
    .context("hook input does not contain a session/thread identifier")?;
    if parent_session_id.len() > 256 {
        bail!("hook session identifier exceeds 256 bytes");
    }
    let session_id = if matches!(source_event, "SubagentStart" | "SubagentStop") {
        let agent_id = first_string(object, &["agent_id", "agent-id"])
            .context("subagent hook input does not contain an agent identifier")?;
        if agent_id.len() > 256 {
            bail!("hook agent identifier exceeds 256 bytes");
        }
        format!("{parent_session_id}\0subagent\0{agent_id}")
    } else {
        parent_session_id.to_owned()
    };

    let has_background_work = source_event == "Stop"
        && ["background_tasks", "session_crons"].iter().any(|key| {
            object
                .get(*key)
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty())
        });
    let kind = match source_event {
        "SessionStart" => EventKind::SessionStart,
        "SubagentStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse"
        | "ElicitationResult" => EventKind::Working,
        "SubagentStop" | "PermissionDenied" => EventKind::Notification,
        "PermissionRequest" | "Elicitation" => EventKind::NeedsInput,
        "Notification" => {
            let notification_type = object
                .get("notification_type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            match notification_type {
                "permission_prompt"
                | "elicitation_dialog"
                | "elicitation_url_dialog"
                | "agent_needs_input" => EventKind::NeedsInput,
                "idle_prompt" | "agent_completed" => EventKind::Notification,
                _ => return Ok(None),
            }
        }
        "PostToolUseFailure" | "StopFailure" => EventKind::Error,
        "Stop" if has_background_work => EventKind::Working,
        "Stop" | "agent-turn-complete" => EventKind::TurnComplete,
        "SessionEnd" => EventKind::SessionEnd,
        _ => bail!("unsupported hook event"),
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
    if has_background_work {
        labels.insert("background_work".to_owned(), "true".to_owned());
    }

    Ok(Some(HaspEvent {
        schema: crate::HASP_SCHEMA.to_owned(),
        event_id,
        provider,
        session_id,
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
    fn claude_notification_states_distinguish_input_from_unread() -> anyhow::Result<()> {
        for notification_type in [
            "permission_prompt",
            "elicitation_dialog",
            "elicitation_url_dialog",
            "agent_needs_input",
        ] {
            let event = normalize(
                Provider::Claude,
                None,
                &json!({
                    "session_id": "claude-1",
                    "hook_event_name": "Notification",
                    "notification_type": notification_type,
                    "message": "discarded"
                }),
            )?
            .ok_or_else(|| anyhow::anyhow!("event ignored"))?;
            assert_eq!(event.kind, EventKind::NeedsInput);
        }
        for notification_type in ["idle_prompt", "agent_completed"] {
            let event = normalize(
                Provider::Claude,
                None,
                &json!({
                    "session_id": "claude-1",
                    "hook_event_name": "Notification",
                    "notification_type": notification_type,
                    "message": "discarded"
                }),
            )?
            .ok_or_else(|| anyhow::anyhow!("event ignored"))?;
            assert_eq!(event.kind, EventKind::Notification);
        }
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

    #[test]
    fn codex_subagents_receive_distinct_status_identities() -> anyhow::Result<()> {
        let first = normalize(
            Provider::Codex,
            None,
            &json!({
                "session_id": "parent",
                "turn_id": "turn-1",
                "agent_id": "agent-a",
                "agent_type": "explore",
                "hook_event_name": "SubagentStart",
                "cwd": "/work/repo"
            }),
        )?
        .ok_or_else(|| anyhow::anyhow!("event ignored"))?;
        let second = normalize(
            Provider::Codex,
            None,
            &json!({
                "session_id": "parent",
                "turn_id": "turn-1",
                "agent_id": "agent-b",
                "agent_type": "review",
                "hook_event_name": "SubagentStart",
                "cwd": "/work/repo"
            }),
        )?
        .ok_or_else(|| anyhow::anyhow!("event ignored"))?;
        assert_ne!(first.session_id, second.session_id);
        assert_eq!(first.kind, EventKind::Working);
        assert!(!serde_json::to_string(&first)?.contains("agent_type"));
        Ok(())
    }

    #[test]
    fn claude_subagent_events_discard_content_and_terminal_routing() -> anyhow::Result<()> {
        let start = normalize(
            Provider::Claude,
            None,
            &json!({
                "session_id": "parent",
                "hook_event_name": "SubagentStart",
                "agent_id": "agent-a",
                "agent_type": "private-reviewer",
                "cwd": "/work/repo",
                "prompt": "private subagent prompt",
                "CMUX_WORKSPACE_ID": "raw-workspace-id",
                "CMUX_SURFACE_ID": "raw-surface-id"
            }),
        )?
        .ok_or_else(|| anyhow::anyhow!("event ignored"))?;
        let stop = normalize(
            Provider::Claude,
            None,
            &json!({
                "session_id": "parent",
                "hook_event_name": "SubagentStop",
                "agent_id": "agent-a",
                "agent_type": "private-reviewer",
                "agent_transcript_path": "/private/subagent.jsonl",
                "last_assistant_message": "private subagent result"
            }),
        )?
        .ok_or_else(|| anyhow::anyhow!("event ignored"))?;

        assert_eq!(start.kind, EventKind::Working);
        assert_eq!(stop.kind, EventKind::Notification);
        assert_eq!(start.session_id, stop.session_id);
        let encoded = serde_json::to_string(&(start, stop))?;
        for private_value in [
            "private-reviewer",
            "private subagent prompt",
            "private subagent result",
            "subagent.jsonl",
            "raw-workspace-id",
            "raw-surface-id",
        ] {
            assert!(!encoded.contains(private_value));
        }
        Ok(())
    }

    #[test]
    fn claude_elicitation_lifecycle_retains_no_request_or_response_content() -> anyhow::Result<()> {
        let requested = normalize(
            Provider::Claude,
            None,
            &json!({
                "session_id": "claude-1",
                "hook_event_name": "Elicitation",
                "mcp_server_name": "private-server",
                "message": "enter a credential",
                "url": "https://secret.example/auth",
                "requested_schema": {"properties": {"password": {"type": "string"}}}
            }),
        )?
        .ok_or_else(|| anyhow::anyhow!("event ignored"))?;
        let resolved = normalize(
            Provider::Claude,
            None,
            &json!({
                "session_id": "claude-1",
                "hook_event_name": "ElicitationResult",
                "mcp_server_name": "private-server",
                "elicitation_id": "private-elicitation-id",
                "action": "accept",
                "content": {"password": "credential-value"}
            }),
        )?
        .ok_or_else(|| anyhow::anyhow!("event ignored"))?;

        assert_eq!(requested.kind, EventKind::NeedsInput);
        assert_eq!(resolved.kind, EventKind::Working);
        let encoded = serde_json::to_string(&(requested, resolved))?;
        for private_value in [
            "private-server",
            "enter a credential",
            "secret.example",
            "password",
            "private-elicitation-id",
            "credential-value",
            "accept",
        ] {
            assert!(!encoded.contains(private_value));
        }
        Ok(())
    }

    #[test]
    fn claude_permission_denial_discards_tool_and_error_content() -> anyhow::Result<()> {
        let event = normalize(
            Provider::Claude,
            None,
            &json!({
                "session_id": "claude-1",
                "hook_event_name": "PermissionDenied",
                "tool_name": "Bash",
                "tool_input": {"command": "private command"},
                "tool_use_id": "private-tool-id",
                "reason": "private classifier explanation"
            }),
        )?
        .ok_or_else(|| anyhow::anyhow!("event ignored"))?;

        assert_eq!(event.kind, EventKind::Notification);
        let encoded = serde_json::to_string(&event)?;
        for private_value in [
            "Bash",
            "private command",
            "private-tool-id",
            "private classifier explanation",
        ] {
            assert!(!encoded.contains(private_value));
        }
        Ok(())
    }

    #[test]
    fn claude_stop_with_background_work_stays_working_without_retaining_details()
    -> anyhow::Result<()> {
        for (field, private_value) in [
            (
                "background_tasks",
                json!([{"command": "private background command"}]),
            ),
            (
                "session_crons",
                json!([{"prompt": "private scheduled prompt"}]),
            ),
        ] {
            let mut payload = json!({
                "session_id": "claude-1",
                "hook_event_name": "Stop",
                "last_assistant_message": "private final response"
            });
            payload[field] = private_value;
            let event = normalize(Provider::Claude, None, &payload)?
                .ok_or_else(|| anyhow::anyhow!("event ignored"))?;
            assert_eq!(event.kind, EventKind::Working);
            assert_eq!(
                event.labels.get("background_work").map(String::as_str),
                Some("true")
            );
            let encoded = serde_json::to_string(&event)?;
            assert!(!encoded.contains("private"));
        }

        let complete = normalize(
            Provider::Claude,
            None,
            &json!({
                "session_id": "claude-1",
                "hook_event_name": "Stop",
                "background_tasks": [],
                "session_crons": []
            }),
        )?
        .ok_or_else(|| anyhow::anyhow!("event ignored"))?;
        assert_eq!(complete.kind, EventKind::TurnComplete);
        assert!(!complete.labels.contains_key("background_work"));
        Ok(())
    }
}
