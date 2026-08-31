use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{HASP_SCHEMA, SNAPSHOT_SCHEMA};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Off,
    Idle,
    Unread,
    Working,
    NeedsInput,
    Error,
}

impl AgentState {
    #[must_use]
    pub const fn priority(self) -> u8 {
        match self {
            Self::Off => 0,
            Self::Idle => 1,
            Self::Unread => 2,
            Self::Working => 3,
            Self::NeedsInput => 4,
            Self::Error => 5,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Claude,
    Codex,
    Manual,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    SessionStart,
    Working,
    NeedsInput,
    Notification,
    TurnComplete,
    Error,
    Stop,
    Heartbeat,
    SessionEnd,
}

impl EventKind {
    #[must_use]
    pub fn resulting_state(self, current: AgentState) -> AgentState {
        match self {
            Self::SessionStart | Self::Stop => AgentState::Idle,
            Self::Working => {
                if matches!(current, AgentState::Error) {
                    AgentState::Error
                } else {
                    AgentState::Working
                }
            }
            Self::NeedsInput => {
                if matches!(current, AgentState::Error) {
                    AgentState::Error
                } else {
                    AgentState::NeedsInput
                }
            }
            Self::Notification => current.max(AgentState::Unread),
            Self::TurnComplete => {
                if matches!(current, AgentState::Error) {
                    AgentState::Error
                } else {
                    AgentState::Unread
                }
            }
            Self::Error => AgentState::Error,
            Self::Heartbeat => current,
            Self::SessionEnd => {
                if matches!(current, AgentState::Error | AgentState::Unread) {
                    current
                } else {
                    AgentState::Off
                }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HaspEvent {
    pub schema: String,
    pub event_id: Uuid,
    pub provider: Provider,
    pub session_id: String,
    pub kind: EventKind,
    pub at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub labels: BTreeMap<String, String>,
}

impl HaspEvent {
    #[must_use]
    pub fn new(provider: Provider, session_id: impl Into<String>, kind: EventKind) -> Self {
        Self {
            schema: HASP_SCHEMA.to_owned(),
            event_id: Uuid::new_v4(),
            provider,
            session_id: session_id.into(),
            kind,
            at: Utc::now(),
            title: None,
            cwd: None,
            labels: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionRecord {
    pub session_id: String,
    pub provider: Provider,
    pub state: AgentState,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub first_seen_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_event_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotView {
    pub slot: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<SessionRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BoardSnapshot {
    pub schema: String,
    pub revision: u64,
    pub generated_at: DateTime<Utc>,
    pub slots: Vec<SlotView>,
    pub unassigned_active_sessions: usize,
}

impl BoardSnapshot {
    #[must_use]
    pub fn empty() -> Self {
        Self {
            schema: SNAPSHOT_SCHEMA.to_owned(),
            revision: 0,
            generated_at: Utc::now(),
            slots: (1..=6)
                .map(|slot| SlotView {
                    slot,
                    session: None,
                })
                .collect(),
            unassigned_active_sessions: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApplyOutcome {
    pub accepted: bool,
    pub duplicate: bool,
    pub assigned_slot: Option<u8>,
    pub evicted_session_id: Option<String>,
    pub snapshot: BoardSnapshot,
}
