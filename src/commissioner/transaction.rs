use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use anyhow::{Result, ensure};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::grant::CommissioningGrant;
use super::plan::CommissioningPlan;

pub const TRANSACTION_SCHEMA: &str = "dev.wrkpad.commissioner.transaction/v1";
const MAX_TRANSACTION_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionState {
    Planned,
    Applying,
    Verified,
    RollbackRequired,
    RollingBack,
    RolledBack,
    RollbackFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigurationReadback {
    pub revision: String,
    pub sha256: String,
    pub firmware_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommissioningTransaction {
    pub schema: String,
    pub plan_id: String,
    pub grant_id: String,
    pub state: TransactionState,
    pub started_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub baseline_revision: String,
    pub baseline_sha256: String,
    pub candidate_sha256: String,
    pub firmware_version_before: String,
    pub apply_readback: Option<ConfigurationReadback>,
    pub rollback_readback: Option<ConfigurationReadback>,
    pub rollback_attempts: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionInspection {
    Idle,
    Planned,
    Applying,
    Verified,
    RollbackRequired,
    RollingBack,
    RolledBack,
    RollbackFailed,
    Invalid,
}

impl From<TransactionState> for TransactionInspection {
    fn from(value: TransactionState) -> Self {
        match value {
            TransactionState::Planned => Self::Planned,
            TransactionState::Applying => Self::Applying,
            TransactionState::Verified => Self::Verified,
            TransactionState::RollbackRequired => Self::RollbackRequired,
            TransactionState::RollingBack => Self::RollingBack,
            TransactionState::RolledBack => Self::RolledBack,
            TransactionState::RollbackFailed => Self::RollbackFailed,
        }
    }
}

impl CommissioningTransaction {
    pub fn new(
        plan: &CommissioningPlan,
        grant: &CommissioningGrant,
        now: DateTime<Utc>,
    ) -> Result<Self> {
        plan.validate_at(grant, now)?;
        Ok(Self {
            schema: TRANSACTION_SCHEMA.to_owned(),
            plan_id: plan.plan_id.clone(),
            grant_id: grant.grant_id.clone(),
            state: TransactionState::Planned,
            started_at: now,
            updated_at: now,
            baseline_revision: plan.configuration.baseline_revision.clone(),
            baseline_sha256: plan.configuration.baseline_sha256.clone(),
            candidate_sha256: plan.configuration.candidate_sha256.clone(),
            firmware_version_before: plan.device.firmware_version.clone(),
            apply_readback: None,
            rollback_readback: None,
            rollback_attempts: 0,
        })
    }

    pub fn begin_apply(
        &mut self,
        plan: &CommissioningPlan,
        grant: &CommissioningGrant,
        now: DateTime<Utc>,
    ) -> Result<()> {
        self.validate_binding(plan, grant)?;
        plan.validate_at(grant, now)?;
        ensure!(
            self.state == TransactionState::Planned,
            "commissioning transaction is not awaiting apply"
        );
        self.state = TransactionState::Applying;
        self.updated_at = monotonic_time(self.updated_at, now)?;
        Ok(())
    }

    /// Records complete readback. Any mismatch enters the rollback-required
    /// state; callers never get to reinterpret a partial result as success.
    pub fn record_apply_readback(
        &mut self,
        readback: ConfigurationReadback,
        now: DateTime<Utc>,
    ) -> Result<()> {
        ensure!(
            self.state == TransactionState::Applying,
            "commissioning transaction is not applying"
        );
        validate_readback(&readback)?;
        let matches = readback.sha256 == self.candidate_sha256
            && readback.firmware_version == self.firmware_version_before;
        self.apply_readback = Some(readback);
        self.state = if matches {
            TransactionState::Verified
        } else {
            TransactionState::RollbackRequired
        };
        self.updated_at = monotonic_time(self.updated_at, now)?;
        Ok(())
    }

    pub fn require_rollback(&mut self, now: DateTime<Utc>) -> Result<()> {
        ensure!(
            matches!(
                self.state,
                TransactionState::Applying | TransactionState::RollbackRequired
            ),
            "commissioning transaction cannot request rollback now"
        );
        self.state = TransactionState::RollbackRequired;
        self.updated_at = monotonic_time(self.updated_at, now)?;
        Ok(())
    }

    pub fn begin_rollback(&mut self, now: DateTime<Utc>) -> Result<()> {
        ensure!(
            self.state == TransactionState::RollbackRequired,
            "commissioning transaction does not require rollback"
        );
        ensure!(
            self.rollback_attempts == 0,
            "commissioning transaction already used its rollback attempt"
        );
        self.rollback_attempts = 1;
        self.state = TransactionState::RollingBack;
        self.updated_at = monotonic_time(self.updated_at, now)?;
        Ok(())
    }

    pub fn record_rollback_readback(
        &mut self,
        readback: ConfigurationReadback,
        now: DateTime<Utc>,
    ) -> Result<()> {
        ensure!(
            self.state == TransactionState::RollingBack && self.rollback_attempts == 1,
            "commissioning transaction is not rolling back"
        );
        validate_readback(&readback)?;
        let matches = readback.sha256 == self.baseline_sha256
            && readback.revision == self.baseline_revision
            && readback.firmware_version == self.firmware_version_before;
        self.rollback_readback = Some(readback);
        self.state = if matches {
            TransactionState::RolledBack
        } else {
            TransactionState::RollbackFailed
        };
        self.updated_at = monotonic_time(self.updated_at, now)?;
        Ok(())
    }

    fn validate_binding(&self, plan: &CommissioningPlan, grant: &CommissioningGrant) -> Result<()> {
        ensure!(
            self.schema == TRANSACTION_SCHEMA,
            "unknown commissioning transaction schema"
        );
        ensure!(
            self.plan_id == plan.plan_id && self.grant_id == grant.grant_id,
            "commissioning transaction binding changed"
        );
        ensure!(
            self.baseline_revision == plan.configuration.baseline_revision
                && self.baseline_sha256 == plan.configuration.baseline_sha256
                && self.candidate_sha256 == plan.configuration.candidate_sha256
                && self.firmware_version_before == plan.device.firmware_version,
            "commissioning transaction content binding changed"
        );
        Ok(())
    }
}

fn monotonic_time(previous: DateTime<Utc>, next: DateTime<Utc>) -> Result<DateTime<Utc>> {
    ensure!(
        next >= previous,
        "commissioning transaction time moved backwards"
    );
    Ok(next)
}

fn validate_readback(value: &ConfigurationReadback) -> Result<()> {
    ensure!(
        is_sha256(&value.revision) && is_sha256(&value.sha256),
        "commissioning readback digest is invalid"
    );
    ensure!(
        !value.firmware_version.is_empty()
            && value.firmware_version.len() <= 64
            && value
                .firmware_version
                .chars()
                .all(|character| character.is_ascii_alphanumeric()
                    || matches!(character, '.' | '-' | '_' | '+')),
        "commissioning readback firmware version is invalid"
    );
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[must_use]
pub fn inspect_transaction(path: &Path) -> TransactionInspection {
    match read_transaction(path) {
        Ok(Some(transaction)) => TransactionInspection::from(transaction.state),
        Ok(None) => TransactionInspection::Idle,
        Err(_) => TransactionInspection::Invalid,
    }
}

#[cfg_attr(unix, allow(clippy::verbose_bit_mask))]
fn read_transaction(path: &Path) -> Result<Option<CommissioningTransaction>> {
    let before = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    ensure!(
        before.is_file() && !before.file_type().is_symlink(),
        "commissioning transaction is not a regular file"
    );
    ensure!(
        before.len() > 1 && before.len() <= MAX_TRANSACTION_BYTES,
        "commissioning transaction size is invalid"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Keep the policy legible as "no group or other permission bits".
        ensure!(
            before.permissions().mode() & 0o077 == 0,
            "commissioning transaction permissions are not private"
        );
    }
    let mut file = File::open(path)?;
    let opened = file.metadata()?;
    ensure!(
        same_file_identity(&before, &opened),
        "commissioning transaction changed while opening"
    );
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_TRANSACTION_BYTES + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() > 1 && u64::try_from(bytes.len())? <= MAX_TRANSACTION_BYTES,
        "commissioning transaction size is invalid"
    );
    let after = fs::symlink_metadata(path)?;
    ensure!(
        same_file_identity(&opened, &after) && !after.file_type().is_symlink(),
        "commissioning transaction changed while reading"
    );
    let value: CommissioningTransaction = serde_json::from_slice(&bytes)?;
    validate_persisted_transaction(&value)?;
    Ok(Some(value))
}

fn validate_persisted_transaction(value: &CommissioningTransaction) -> Result<()> {
    ensure!(
        value.schema == TRANSACTION_SCHEMA,
        "unknown commissioning transaction schema"
    );
    ensure!(
        is_sha256(&value.plan_id) && is_sha256(&value.grant_id),
        "commissioning transaction identity is invalid"
    );
    ensure!(
        is_sha256(&value.baseline_revision)
            && is_sha256(&value.baseline_sha256)
            && is_sha256(&value.candidate_sha256)
            && value.baseline_sha256 != value.candidate_sha256,
        "commissioning transaction content binding is invalid"
    );
    ensure!(
        value.updated_at >= value.started_at,
        "commissioning transaction time is invalid"
    );
    validate_readback_option(value.apply_readback.as_ref())?;
    validate_readback_option(value.rollback_readback.as_ref())?;
    let attempts_valid = match value.state {
        TransactionState::Planned
        | TransactionState::Applying
        | TransactionState::Verified
        | TransactionState::RollbackRequired => value.rollback_attempts == 0,
        TransactionState::RollingBack
        | TransactionState::RolledBack
        | TransactionState::RollbackFailed => value.rollback_attempts == 1,
    };
    ensure!(
        attempts_valid,
        "commissioning transaction rollback budget is invalid"
    );
    ensure!(
        !matches!(
            value.state,
            TransactionState::Planned | TransactionState::Applying
        ) || value.apply_readback.is_none(),
        "commissioning transaction apply readback is inconsistent"
    );
    ensure!(
        value.state != TransactionState::Verified
            || value
                .apply_readback
                .as_ref()
                .is_some_and(|readback| readback.sha256 == value.candidate_sha256
                    && readback.firmware_version == value.firmware_version_before),
        "commissioning transaction verified readback is inconsistent"
    );
    ensure!(
        !matches!(
            value.state,
            TransactionState::RolledBack | TransactionState::RollbackFailed
        ) || value.rollback_readback.is_some(),
        "commissioning transaction rollback readback is missing"
    );
    ensure!(
        value.state != TransactionState::RolledBack
            || value
                .rollback_readback
                .as_ref()
                .is_some_and(|readback| readback.revision == value.baseline_revision
                    && readback.sha256 == value.baseline_sha256
                    && readback.firmware_version == value.firmware_version_before),
        "commissioning transaction rollback readback is inconsistent"
    );
    Ok(())
}

fn validate_readback_option(value: Option<&ConfigurationReadback>) -> Result<()> {
    if let Some(readback) = value {
        validate_readback(readback)?;
    }
    Ok(())
}

#[cfg(unix)]
fn same_file_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(not(unix))]
fn same_file_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    left.is_file() && right.is_file() && left.len() == right.len()
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone, Utc};

    use super::{CommissioningTransaction, ConfigurationReadback, TransactionState};
    use crate::commissioner::grant::{
        CommissioningGrant, DeviceBinding, ExecutorBinding, ProviderBinding,
    };
    use crate::commissioner::plan::{CommissioningPlan, ConfigurationBinding};

    fn now() -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 5, 3, 0, 0)
            .single()
            .unwrap_or_default()
    }

    fn fixtures() -> anyhow::Result<(CommissioningGrant, CommissioningPlan)> {
        let grant = CommissioningGrant::new(
            now(),
            now() + Duration::days(1),
            DeviceBinding {
                vendor_id: 0x303A,
                product_id: 0x8298,
                manufacturer: "Work Louder".to_owned(),
                product: "Creator Micro 2".to_owned(),
                transport: "usb".to_owned(),
                usage_page: 0xFF00,
                usage: 1,
                descriptor_sha256: "a".repeat(64),
                firmware_version: "0.6.2".to_owned(),
            },
            ProviderBinding {
                name: "work_louder_input".to_owned(),
                version: "0.18.4".to_owned(),
                app_sha256: "c".repeat(64),
                bridge_sha256: "d".repeat(64),
                capabilities_sha256: "e".repeat(64),
            },
            ExecutorBinding {
                name: "worklouderctl".to_owned(),
                version: "0.1.1".to_owned(),
                sha256: "b".repeat(64),
            },
            1,
        )?;
        let plan = CommissioningPlan::new(
            &grant,
            now(),
            now() + Duration::minutes(15),
            ConfigurationBinding {
                baseline_revision: "c".repeat(64),
                baseline_sha256: "d".repeat(64),
                candidate_sha256: "e".repeat(64),
                rollback_catalog_sha256: "f".repeat(64),
            },
        )?;
        Ok((grant, plan))
    }

    fn readback(revision: char, hash: char, firmware: &str) -> ConfigurationReadback {
        ConfigurationReadback {
            revision: revision.to_string().repeat(64),
            sha256: hash.to_string().repeat(64),
            firmware_version: firmware.to_owned(),
        }
    }

    #[test]
    fn exact_readback_verifies_without_rollback() -> anyhow::Result<()> {
        let (grant, plan) = fixtures()?;
        let mut transaction = CommissioningTransaction::new(&plan, &grant, now())?;
        transaction.begin_apply(&plan, &grant, now() + Duration::seconds(1))?;
        transaction
            .record_apply_readback(readback('1', 'e', "0.6.2"), now() + Duration::seconds(2))?;
        assert_eq!(transaction.state, TransactionState::Verified);
        assert_eq!(transaction.rollback_attempts, 0);
        Ok(())
    }

    #[test]
    fn corrupt_or_firmware_changed_readback_requires_exactly_one_rollback() -> anyhow::Result<()> {
        let (grant, plan) = fixtures()?;
        let mut transaction = CommissioningTransaction::new(&plan, &grant, now())?;
        transaction.begin_apply(&plan, &grant, now() + Duration::seconds(1))?;
        transaction
            .record_apply_readback(readback('1', '9', "0.6.3"), now() + Duration::seconds(2))?;
        assert_eq!(transaction.state, TransactionState::RollbackRequired);
        transaction.begin_rollback(now() + Duration::seconds(3))?;
        assert!(
            transaction
                .begin_rollback(now() + Duration::seconds(4))
                .is_err()
        );
        transaction
            .record_rollback_readback(readback('c', 'd', "0.6.2"), now() + Duration::seconds(5))?;
        assert_eq!(transaction.state, TransactionState::RolledBack);
        assert_eq!(transaction.rollback_attempts, 1);
        Ok(())
    }

    #[test]
    fn rollback_mismatch_is_terminal_failure() -> anyhow::Result<()> {
        let (grant, plan) = fixtures()?;
        let mut transaction = CommissioningTransaction::new(&plan, &grant, now())?;
        transaction.begin_apply(&plan, &grant, now() + Duration::seconds(1))?;
        transaction.require_rollback(now() + Duration::seconds(2))?;
        transaction.begin_rollback(now() + Duration::seconds(3))?;
        transaction
            .record_rollback_readback(readback('7', '7', "0.6.2"), now() + Duration::seconds(4))?;
        assert_eq!(transaction.state, TransactionState::RollbackFailed);
        assert!(
            transaction
                .require_rollback(now() + Duration::seconds(5))
                .is_err()
        );
        Ok(())
    }
}
