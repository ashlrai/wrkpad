use std::collections::{BTreeMap, BTreeSet, VecDeque};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::HASP_SCHEMA;
use crate::model::{AgentState, ApplyOutcome, BoardSnapshot, HaspEvent, SessionRecord, SlotView};

const SLOT_COUNT: usize = 6;
const EVENT_HISTORY_LIMIT: usize = 4096;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum EngineError {
    #[error("unsupported HASP schema: {0}")]
    UnsupportedSchema(String),
    #[error("session_id must contain between 1 and 200 characters")]
    InvalidSessionId,
    #[error("session_id and title must not contain terminal control characters")]
    UnsafeDisplayText,
    #[error("title exceeds 120 characters")]
    TitleTooLong,
    #[error("cwd exceeds 4096 characters")]
    CwdTooLong,
    #[error("all six sticky slots are protected; acknowledge or forget an inactive session")]
    SlotsFull,
    #[error("agent slot must be between AG00 and AG05")]
    InvalidSlot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateEngine {
    revision: u64,
    slots: [Option<String>; SLOT_COUNT],
    sessions: BTreeMap<String, SessionRecord>,
    seen_events: BTreeSet<Uuid>,
    #[serde(default)]
    event_history: VecDeque<Uuid>,
}

impl Default for StateEngine {
    fn default() -> Self {
        Self {
            revision: 0,
            slots: std::array::from_fn(|_| None),
            sessions: BTreeMap::new(),
            seen_events: BTreeSet::new(),
            event_history: VecDeque::new(),
        }
    }
}

impl StateEngine {
    pub fn apply(&mut self, event: HaspEvent) -> Result<ApplyOutcome, EngineError> {
        Self::validate(&event)?;

        if self.seen_events.contains(&event.event_id) {
            let assigned_slot = self.slot_for(&event.session_id);
            return Ok(ApplyOutcome {
                accepted: true,
                duplicate: true,
                assigned_slot,
                evicted_session_id: None,
                snapshot: self.snapshot(),
            });
        }

        let previous_engine = self.clone();
        let current_state = self
            .sessions
            .get(&event.session_id)
            .map_or(AgentState::Off, |session| session.state);
        let next_state = event.kind.resulting_state(current_state);
        let first_seen_at = self
            .sessions
            .get(&event.session_id)
            .map_or(event.at, |session| session.first_seen_at);
        let previous = self.sessions.get(&event.session_id).cloned();

        self.sessions.insert(
            event.session_id.clone(),
            SessionRecord {
                session_id: event.session_id.clone(),
                provider: event.provider,
                state: next_state,
                title: event
                    .title
                    .clone()
                    .or_else(|| previous.as_ref().and_then(|session| session.title.clone())),
                cwd: event
                    .cwd
                    .clone()
                    .or_else(|| previous.as_ref().and_then(|session| session.cwd.clone())),
                first_seen_at,
                updated_at: event.at,
                last_event_id: event.event_id,
            },
        );

        let (assigned_slot, evicted_session_id) = self.assign_slot(&event.session_id, next_state);
        if assigned_slot.is_none() && next_state != AgentState::Off {
            *self = previous_engine;
            return Err(EngineError::SlotsFull);
        }
        if assigned_slot.is_none() {
            self.sessions.remove(&event.session_id);
        }
        if let Some(evicted) = evicted_session_id.as_ref() {
            self.sessions.remove(evicted);
        }
        self.record_event(event.event_id);
        self.revision = self.revision.saturating_add(1);

        Ok(ApplyOutcome {
            accepted: true,
            duplicate: false,
            assigned_slot,
            evicted_session_id,
            snapshot: self.snapshot(),
        })
    }

    #[must_use]
    pub fn snapshot(&self) -> BoardSnapshot {
        let assigned: BTreeSet<&str> = self.slots.iter().flatten().map(String::as_str).collect();
        BoardSnapshot {
            schema: crate::SNAPSHOT_SCHEMA.to_owned(),
            revision: self.revision,
            generated_at: Utc::now(),
            slots: self
                .slots
                .iter()
                .enumerate()
                .map(|(index, session_id)| SlotView {
                    slot: u8::try_from(index + 1).unwrap_or(0),
                    session: session_id
                        .as_ref()
                        .and_then(|id| self.sessions.get(id))
                        .cloned(),
                })
                .collect(),
            unassigned_active_sessions: self
                .sessions
                .values()
                .filter(|session| {
                    session.state != AgentState::Off
                        && !assigned.contains(session.session_id.as_str())
                })
                .count(),
        }
    }

    pub fn forget_slot(&mut self, agent_key: u8) -> Result<BoardSnapshot, EngineError> {
        let index = usize::from(agent_key);
        let slot = self.slots.get_mut(index).ok_or(EngineError::InvalidSlot)?;
        if let Some(session_id) = slot.take() {
            self.sessions.remove(&session_id);
            self.revision = self.revision.saturating_add(1);
        }
        Ok(self.snapshot())
    }

    fn validate(event: &HaspEvent) -> Result<(), EngineError> {
        if event.schema != HASP_SCHEMA {
            return Err(EngineError::UnsupportedSchema(event.schema.clone()));
        }
        let session_len = event.session_id.chars().count();
        if session_len == 0 || session_len > 200 {
            return Err(EngineError::InvalidSessionId);
        }
        if event.session_id.chars().any(char::is_control)
            || event
                .title
                .as_ref()
                .is_some_and(|title| title.chars().any(char::is_control))
        {
            return Err(EngineError::UnsafeDisplayText);
        }
        if event
            .title
            .as_ref()
            .is_some_and(|title| title.chars().count() > 120)
        {
            return Err(EngineError::TitleTooLong);
        }
        if event
            .cwd
            .as_ref()
            .is_some_and(|cwd| cwd.chars().count() > 4096)
        {
            return Err(EngineError::CwdTooLong);
        }
        Ok(())
    }

    fn record_event(&mut self, event_id: Uuid) {
        self.seen_events.insert(event_id);
        self.event_history.push_back(event_id);
        while self.event_history.len() > EVENT_HISTORY_LIMIT {
            if let Some(expired) = self.event_history.pop_front() {
                self.seen_events.remove(&expired);
            }
        }
    }

    fn slot_for(&self, session_id: &str) -> Option<u8> {
        self.slots
            .iter()
            .position(|candidate| candidate.as_deref() == Some(session_id))
            .and_then(|index| u8::try_from(index + 1).ok())
    }

    fn assign_slot(
        &mut self,
        session_id: &str,
        incoming_state: AgentState,
    ) -> (Option<u8>, Option<String>) {
        if let Some(slot) = self.slot_for(session_id) {
            return (Some(slot), None);
        }

        if let Some(index) = self.slots.iter().position(Option::is_none) {
            self.slots[index] = Some(session_id.to_owned());
            return (u8::try_from(index + 1).ok(), None);
        }

        let victim = self
            .slots
            .iter()
            .enumerate()
            .filter_map(|(index, id)| {
                let id = id.as_ref()?;
                let record = self.sessions.get(id)?;
                (matches!(record.state, AgentState::Off | AgentState::Idle)
                    && record.state.priority() < incoming_state.priority())
                .then_some((
                    index,
                    record.state.priority(),
                    record.updated_at,
                    id.clone(),
                ))
            })
            .min_by_key(|(_, priority, updated_at, _)| (*priority, *updated_at));

        if let Some((index, _, _, evicted)) = victim {
            self.slots[index] = Some(session_id.to_owned());
            return (u8::try_from(index + 1).ok(), Some(evicted));
        }

        (None, None)
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};

    use super::StateEngine;
    use crate::model::{AgentState, EventKind, HaspEvent, Provider};

    #[test]
    fn keeps_existing_sessions_sticky() -> anyhow::Result<()> {
        let mut engine = StateEngine::default();
        let mut start = HaspEvent::new(Provider::Claude, "claude-1", EventKind::SessionStart);
        start.at = Utc::now();
        let first = engine.apply(start)?;
        assert_eq!(first.assigned_slot, Some(1));

        let working = HaspEvent::new(Provider::Claude, "claude-1", EventKind::Working);
        let second = engine.apply(working)?;
        assert_eq!(second.assigned_slot, Some(1));
        assert_eq!(
            second.snapshot.slots[0].session.as_ref().map(|s| s.state),
            Some(AgentState::Working)
        );
        Ok(())
    }

    #[test]
    fn higher_priority_session_evicts_oldest_lower_priority_slot() -> anyhow::Result<()> {
        let mut engine = StateEngine::default();
        let base = Utc::now() - Duration::minutes(10);
        for index in 0..6 {
            let mut event = HaspEvent::new(
                Provider::Manual,
                format!("idle-{index}"),
                EventKind::SessionStart,
            );
            event.at = base + Duration::seconds(i64::from(index));
            engine.apply(event)?;
        }

        let urgent = HaspEvent::new(Provider::Codex, "urgent", EventKind::Error);
        let outcome = engine.apply(urgent)?;
        assert_eq!(outcome.assigned_slot, Some(1));
        assert_eq!(outcome.evicted_session_id.as_deref(), Some("idle-0"));
        Ok(())
    }

    #[test]
    fn duplicate_event_is_idempotent() -> anyhow::Result<()> {
        let mut engine = StateEngine::default();
        let event = HaspEvent::new(Provider::Codex, "thread-1", EventKind::Working);
        let first = engine.apply(event.clone())?;
        let second = engine.apply(event)?;
        assert!(!first.duplicate);
        assert!(second.duplicate);
        assert_eq!(first.snapshot.revision, second.snapshot.revision);
        Ok(())
    }

    #[test]
    fn seventh_session_cannot_evict_a_protected_slot() -> anyhow::Result<()> {
        let mut engine = StateEngine::default();
        for index in 0..6 {
            engine.apply(HaspEvent::new(
                Provider::Codex,
                format!("working-{index}"),
                EventKind::Working,
            ))?;
        }
        let result = engine.apply(HaspEvent::new(Provider::Claude, "urgent", EventKind::Error));
        assert!(matches!(result, Err(super::EngineError::SlotsFull)));
        assert_eq!(engine.snapshot().revision, 6);
        Ok(())
    }

    #[test]
    fn lower_priority_events_do_not_clear_an_error() -> anyhow::Result<()> {
        let mut engine = StateEngine::default();
        engine.apply(HaspEvent::new(Provider::Codex, "broken", EventKind::Error))?;
        let outcome = engine.apply(HaspEvent::new(
            Provider::Codex,
            "broken",
            EventKind::TurnComplete,
        ))?;
        assert_eq!(
            outcome.snapshot.slots[0].session.as_ref().map(|s| s.state),
            Some(AgentState::Error)
        );
        Ok(())
    }

    #[test]
    fn rejects_terminal_control_sequences() {
        let mut engine = StateEngine::default();
        let mut event = HaspEvent::new(Provider::Manual, "session", EventKind::Working);
        event.title = Some("unsafe\u{001b}[2J".to_owned());
        assert!(matches!(
            engine.apply(event),
            Err(super::EngineError::UnsafeDisplayText)
        ));
    }

    #[test]
    fn bounds_idempotency_history_and_unknown_off_sessions() -> anyhow::Result<()> {
        let mut engine = StateEngine::default();
        for _ in 0..(super::EVENT_HISTORY_LIMIT + 12) {
            engine.apply(HaspEvent::new(
                Provider::Manual,
                "same-session",
                EventKind::Working,
            ))?;
        }
        assert_eq!(engine.seen_events.len(), super::EVENT_HISTORY_LIMIT);
        assert_eq!(engine.event_history.len(), super::EVENT_HISTORY_LIMIT);

        let mut off_only = StateEngine::default();
        for index in 0..20 {
            off_only.apply(HaspEvent::new(
                Provider::Manual,
                format!("unknown-{index}"),
                EventKind::SessionEnd,
            ))?;
        }
        assert!(off_only.sessions.len() <= super::SLOT_COUNT);
        Ok(())
    }

    #[test]
    fn forget_releases_only_the_requested_agent_key() -> anyhow::Result<()> {
        let mut engine = StateEngine::default();
        engine.apply(HaspEvent::new(Provider::Codex, "first", EventKind::Error))?;
        engine.apply(HaspEvent::new(
            Provider::Claude,
            "second",
            EventKind::NeedsInput,
        ))?;
        let snapshot = engine.forget_slot(0)?;
        assert!(snapshot.slots[0].session.is_none());
        assert!(snapshot.slots[1].session.is_some());
        assert!(matches!(
            engine.forget_slot(6),
            Err(super::EngineError::InvalidSlot)
        ));
        Ok(())
    }
}
