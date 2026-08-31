use serde::{Deserialize, Serialize};

use crate::model::{AgentState, BoardSnapshot};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rgb {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
}

impl Rgb {
    pub const BLACK: Self = Self::new(0x00, 0x00, 0x00);

    #[must_use]
    pub const fn new(red: u8, green: u8, blue: u8) -> Self {
        Self { red, green, blue }
    }

    #[must_use]
    pub fn hex(self) -> String {
        format!("#{:02X}{:02X}{:02X}", self.red, self.green, self.blue)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LightingFrame {
    pub profile: String,
    pub ambient: Rgb,
    pub agent_keys: [Rgb; 6],
    pub transport_ready: bool,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct BlackOpaqueProfile;

impl BlackOpaqueProfile {
    pub const ERROR: Rgb = Rgb::new(0xFF, 0x17, 0x44);
    pub const NEEDS_INPUT: Rgb = Rgb::new(0xFF, 0xAB, 0x00);
    pub const WORKING: Rgb = Rgb::new(0x29, 0x79, 0xFF);
    pub const UNREAD: Rgb = Rgb::new(0x00, 0xE6, 0x76);
    pub const IDLE: Rgb = Rgb::new(0x7C, 0x4D, 0xFF);
    pub const AMBIENT: Rgb = Rgb::new(0x08, 0x0A, 0x12);

    #[must_use]
    pub const fn color(state: AgentState) -> Rgb {
        match state {
            AgentState::Error => Self::ERROR,
            AgentState::NeedsInput => Self::NEEDS_INPUT,
            AgentState::Working => Self::WORKING,
            AgentState::Unread => Self::UNREAD,
            AgentState::Idle => Self::IDLE,
            AgentState::Off => Rgb::BLACK,
        }
    }

    #[must_use]
    pub fn render(snapshot: &BoardSnapshot) -> LightingFrame {
        let agent_keys = std::array::from_fn(|index| {
            snapshot
                .slots
                .get(index)
                .and_then(|slot| slot.session.as_ref())
                .map_or(Rgb::BLACK, |session| Self::color(session.state))
        });
        LightingFrame {
            profile: "black-opaque".to_owned(),
            ambient: Self::AMBIENT,
            agent_keys,
            transport_ready: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::engine::StateEngine;
    use crate::model::{EventKind, HaspEvent, Provider};

    use super::{BlackOpaqueProfile, Rgb};

    #[test]
    fn black_opaque_profile_uses_high_contrast_agent_colors() -> anyhow::Result<()> {
        let mut engine = StateEngine::default();
        engine.apply(HaspEvent::new(Provider::Codex, "a", EventKind::Working))?;
        engine.apply(HaspEvent::new(Provider::Claude, "b", EventKind::NeedsInput))?;
        let frame = BlackOpaqueProfile::render(&engine.snapshot());
        assert_eq!(frame.agent_keys[0], BlackOpaqueProfile::WORKING);
        assert_eq!(frame.agent_keys[1], BlackOpaqueProfile::NEEDS_INPUT);
        assert_eq!(frame.agent_keys[2], Rgb::BLACK);
        assert!(!frame.transport_ready);
        Ok(())
    }
}
