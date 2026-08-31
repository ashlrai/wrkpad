use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum OccupancyMode {
    #[default]
    Observe,
    Shadow,
    Takeover,
    Release,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OccupancyState {
    pub schema: String,
    pub mode: OccupancyMode,
    pub changed_at: DateTime<Utc>,
    pub reason: String,
}

impl Default for OccupancyState {
    fn default() -> Self {
        Self {
            schema: "dev.wrkpad.occupancy/v1".to_owned(),
            mode: OccupancyMode::Observe,
            changed_at: Utc::now(),
            reason: "safe default".to_owned(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TransitionEvidence {
    pub device_present: bool,
    pub descriptor_known: bool,
    pub firmware_known: bool,
    pub transport_verified: bool,
    pub active_oai_layer_verified: bool,
    pub competing_writer_running: bool,
    pub local_lease_available: bool,
    pub explicit_human_confirmation: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum OccupancyError {
    #[error("shadow requires a present device and a recognized report descriptor")]
    ShadowEvidenceMissing,
    #[error("takeover must be requested from shadow mode")]
    TakeoverRequiresShadow,
    #[error("takeover is blocked because a competing writer is running")]
    CompetingWriter,
    #[error(
        "takeover requires an exact verified device, firmware, transport, and active-layer tuple"
    )]
    CompatibilityUnverified,
    #[error("takeover requires a free local writer lease")]
    LeaseUnavailable,
    #[error("takeover requires an explicit local human confirmation")]
    ConfirmationRequired,
    #[error("release is only valid while takeover is active")]
    ReleaseRequiresTakeover,
}

impl OccupancyState {
    pub fn transition(
        &self,
        target: OccupancyMode,
        evidence: TransitionEvidence,
    ) -> Result<Self, OccupancyError> {
        match target {
            OccupancyMode::Observe => Ok(Self::new(target, "operator returned to observe")),
            OccupancyMode::Shadow => {
                if !evidence.device_present || !evidence.descriptor_known {
                    return Err(OccupancyError::ShadowEvidenceMissing);
                }
                Ok(Self::new(target, "bounded read-only shadow session"))
            }
            OccupancyMode::Takeover => {
                if self.mode != OccupancyMode::Shadow {
                    return Err(OccupancyError::TakeoverRequiresShadow);
                }
                if evidence.competing_writer_running {
                    return Err(OccupancyError::CompetingWriter);
                }
                if !(evidence.device_present
                    && evidence.descriptor_known
                    && evidence.firmware_known
                    && evidence.transport_verified
                    && evidence.active_oai_layer_verified)
                {
                    return Err(OccupancyError::CompatibilityUnverified);
                }
                if !evidence.local_lease_available {
                    return Err(OccupancyError::LeaseUnavailable);
                }
                if !evidence.explicit_human_confirmation {
                    return Err(OccupancyError::ConfirmationRequired);
                }
                Ok(Self::new(target, "exclusive lighting takeover accepted"))
            }
            OccupancyMode::Release => {
                if self.mode != OccupancyMode::Takeover {
                    return Err(OccupancyError::ReleaseRequiresTakeover);
                }
                Ok(Self::new(
                    target,
                    "stop writes, close device, and invalidate lease",
                ))
            }
        }
    }

    fn new(mode: OccupancyMode, reason: &str) -> Self {
        Self {
            schema: "dev.wrkpad.occupancy/v1".to_owned(),
            mode,
            changed_at: Utc::now(),
            reason: reason.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{OccupancyError, OccupancyMode, OccupancyState, TransitionEvidence};

    #[test]
    fn takeover_fails_closed_without_exact_evidence() {
        let shadow = OccupancyState {
            mode: OccupancyMode::Shadow,
            ..OccupancyState::default()
        };
        let result = shadow.transition(
            OccupancyMode::Takeover,
            TransitionEvidence {
                device_present: true,
                descriptor_known: true,
                explicit_human_confirmation: true,
                local_lease_available: true,
                ..TransitionEvidence::default()
            },
        );
        assert_eq!(result, Err(OccupancyError::CompatibilityUnverified));
    }

    #[test]
    fn competing_writer_blocks_even_verified_takeover() {
        let shadow = OccupancyState {
            mode: OccupancyMode::Shadow,
            ..OccupancyState::default()
        };
        let result = shadow.transition(
            OccupancyMode::Takeover,
            TransitionEvidence {
                device_present: true,
                descriptor_known: true,
                firmware_known: true,
                transport_verified: true,
                active_oai_layer_verified: true,
                competing_writer_running: true,
                local_lease_available: true,
                explicit_human_confirmation: true,
            },
        );
        assert_eq!(result, Err(OccupancyError::CompetingWriter));
    }
}
