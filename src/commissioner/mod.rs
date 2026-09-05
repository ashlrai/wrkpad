//! Content-bound primitives for an opt-in, agent-operated board commissioner.
//!
//! This module deliberately contains no process launcher and no device writer.
//! Agents can inspect enrollment and build typed plans, but a future executor
//! must consume the closed [`executor::ExecutorRequest`] enum rather than raw
//! commands or arguments.

pub mod executor;
pub mod grant;
pub mod plan;
pub mod transaction;

use std::path::Path;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use self::grant::{GrantInspection, inspect_grant};
use self::transaction::{TransactionInspection, inspect_transaction};

pub const STATUS_SCHEMA: &str = "dev.wrkpad.commissioner.status/v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutorStatus {
    NotConfigured,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommissionerStatus {
    pub schema: String,
    pub route: String,
    pub enrollment: GrantInspection,
    pub transaction: TransactionInspection,
    pub executor: ExecutorStatus,
    pub mutation_available: bool,
    pub firmware_writes_available: bool,
    pub reason: String,
}

#[must_use]
pub fn status(root: &Path, now: DateTime<Utc>) -> CommissionerStatus {
    let commissioning_root = root.join("commissioning");
    let enrollment = inspect_grant(&commissioning_root.join("grant.json"), now);
    let transaction = inspect_transaction(&commissioning_root.join("transaction.json"));
    let reason = match enrollment {
        GrantInspection::NotEnrolled => "no autonomous commissioning grant is enrolled",
        GrantInspection::Expired => "the autonomous commissioning grant expired",
        GrantInspection::Invalid => "the autonomous commissioning grant is invalid or unsafe",
        GrantInspection::Enrolled => {
            "an exact compatible executor is not configured; device writes remain unavailable"
        }
    };
    CommissionerStatus {
        schema: STATUS_SCHEMA.to_owned(),
        route: "ashlr_layer".to_owned(),
        enrollment,
        transaction,
        executor: ExecutorStatus::NotConfigured,
        mutation_available: false,
        firmware_writes_available: false,
        reason: reason.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use tempfile::tempdir;

    use super::{ExecutorStatus, status};
    use crate::commissioner::grant::GrantInspection;
    use crate::commissioner::transaction::TransactionInspection;

    #[test]
    fn status_is_truthful_before_enrollment_or_executor_support() -> anyhow::Result<()> {
        let root = tempdir()?;
        let now = chrono::Utc
            .with_ymd_and_hms(2026, 9, 5, 3, 0, 0)
            .single()
            .ok_or_else(|| anyhow::anyhow!("invalid fixture time"))?;
        let value = status(root.path(), now);
        assert_eq!(value.enrollment, GrantInspection::NotEnrolled);
        assert_eq!(value.transaction, TransactionInspection::Idle);
        assert_eq!(value.executor, ExecutorStatus::NotConfigured);
        assert!(!value.mutation_available);
        assert!(!value.firmware_writes_available);
        assert!(value.reason.contains("no autonomous"));
        Ok(())
    }
}
