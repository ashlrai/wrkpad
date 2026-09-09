use anyhow::{Result, ensure};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::grant::{
    BoardRoute, CommissioningGrant, DeviceBinding, ExecutorBinding, ProfileTemplate,
    ProviderBinding,
};

pub const PLAN_SCHEMA: &str = "dev.wrkpad.commissioner.plan/v1";
const MAX_PLAN_LIFETIME: Duration = Duration::minutes(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedChange {
    UpsertAndActivateAshlrDailyV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigurationBinding {
    pub baseline_revision: String,
    pub baseline_sha256: String,
    pub candidate_sha256: String,
    pub rollback_catalog_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommissioningPlan {
    pub schema: String,
    pub plan_id: String,
    pub grant_id: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub route: BoardRoute,
    pub profile_template: ProfileTemplate,
    pub change: ManagedChange,
    pub device: DeviceBinding,
    pub provider: ProviderBinding,
    pub executor: ExecutorBinding,
    pub configuration: ConfigurationBinding,
    pub restore_required: bool,
    pub firmware_writes: bool,
}

#[derive(Serialize)]
struct PlanBody<'a> {
    schema: &'a str,
    grant_id: &'a str,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    route: BoardRoute,
    profile_template: ProfileTemplate,
    change: ManagedChange,
    device: &'a DeviceBinding,
    provider: &'a ProviderBinding,
    executor: &'a ExecutorBinding,
    configuration: &'a ConfigurationBinding,
    restore_required: bool,
    firmware_writes: bool,
}

impl CommissioningPlan {
    pub fn new(
        grant: &CommissioningGrant,
        created_at: DateTime<Utc>,
        expires_at: DateTime<Utc>,
        configuration: ConfigurationBinding,
    ) -> Result<Self> {
        grant.validate_at(created_at)?;
        let mut value = Self {
            schema: PLAN_SCHEMA.to_owned(),
            plan_id: String::new(),
            grant_id: grant.grant_id.clone(),
            created_at,
            expires_at,
            route: grant.route,
            profile_template: grant.profile_template,
            change: ManagedChange::UpsertAndActivateAshlrDailyV1,
            device: grant.device.clone(),
            provider: grant.provider.clone(),
            executor: grant.executor.clone(),
            configuration,
            restore_required: true,
            firmware_writes: false,
        };
        value.plan_id = value.computed_id()?;
        value.validate_at(grant, created_at)?;
        Ok(value)
    }

    pub fn validate_at(&self, grant: &CommissioningGrant, now: DateTime<Utc>) -> Result<()> {
        grant.validate_at(now)?;
        ensure!(
            self.schema == PLAN_SCHEMA,
            "unknown commissioning plan schema"
        );
        ensure!(
            self.grant_id == grant.grant_id,
            "commissioning plan grant changed"
        );
        ensure!(
            self.created_at <= now && self.expires_at > now,
            "commissioning plan is not current"
        );
        let lifetime = self.expires_at - self.created_at;
        ensure!(
            lifetime > Duration::zero() && lifetime <= MAX_PLAN_LIFETIME,
            "commissioning plan lifetime is invalid"
        );
        ensure!(
            self.expires_at <= grant.expires_at,
            "commissioning plan outlives its grant"
        );
        ensure!(
            self.route == grant.route && self.profile_template == grant.profile_template,
            "commissioning plan route or template changed"
        );
        ensure!(
            self.device == grant.device
                && self.provider == grant.provider
                && self.executor == grant.executor,
            "commissioning plan device, provider, or executor binding changed"
        );
        ensure!(
            self.change == ManagedChange::UpsertAndActivateAshlrDailyV1,
            "commissioning plan change is not allowlisted"
        );
        ensure!(
            self.restore_required && !self.firmware_writes,
            "commissioning plan is not rollback-first"
        );
        validate_configuration(&self.configuration)?;
        ensure!(
            self.plan_id == self.computed_id()?,
            "commissioning plan content binding is invalid"
        );
        Ok(())
    }

    fn computed_id(&self) -> Result<String> {
        let body = PlanBody {
            schema: PLAN_SCHEMA,
            grant_id: &self.grant_id,
            created_at: self.created_at,
            expires_at: self.expires_at,
            route: self.route,
            profile_template: self.profile_template,
            change: self.change,
            device: &self.device,
            provider: &self.provider,
            executor: &self.executor,
            configuration: &self.configuration,
            restore_required: self.restore_required,
            firmware_writes: self.firmware_writes,
        };
        Ok(hex::encode(Sha256::digest(serde_json::to_vec(&body)?)))
    }
}

fn validate_configuration(value: &ConfigurationBinding) -> Result<()> {
    for (label, digest) in [
        ("baseline revision", &value.baseline_revision),
        ("baseline digest", &value.baseline_sha256),
        ("candidate digest", &value.candidate_sha256),
        ("rollback catalog digest", &value.rollback_catalog_sha256),
    ] {
        ensure!(is_sha256(digest), "commissioning plan {label} is invalid");
    }
    ensure!(
        value.baseline_sha256 != value.candidate_sha256,
        "commissioning plan contains no configuration change"
    );
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone, Utc};

    use super::{CommissioningPlan, ConfigurationBinding};
    use crate::commissioner::grant::{
        CommissioningGrant, DeviceBinding, ExecutorBinding, ProviderBinding,
    };

    fn now() -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 5, 3, 0, 0)
            .single()
            .unwrap_or_default()
    }

    fn grant() -> anyhow::Result<CommissioningGrant> {
        CommissioningGrant::new(
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
        )
    }

    fn binding() -> ConfigurationBinding {
        ConfigurationBinding {
            baseline_revision: "c".repeat(64),
            baseline_sha256: "d".repeat(64),
            candidate_sha256: "e".repeat(64),
            rollback_catalog_sha256: "f".repeat(64),
        }
    }

    #[test]
    fn plan_binds_grant_device_executor_candidate_and_rollback() -> anyhow::Result<()> {
        let grant = grant()?;
        let plan = CommissioningPlan::new(&grant, now(), now() + Duration::minutes(15), binding())?;
        plan.validate_at(&grant, now())?;
        assert!(plan.restore_required);
        assert!(!plan.firmware_writes);
        let mut tampered = plan.clone();
        tampered.configuration.candidate_sha256 = "1".repeat(64);
        assert!(tampered.validate_at(&grant, now()).is_err());
        Ok(())
    }

    #[test]
    fn plan_rejects_noop_stale_and_overlong_candidates() -> anyhow::Result<()> {
        let grant = grant()?;
        let mut noop = binding();
        noop.candidate_sha256 = noop.baseline_sha256.clone();
        assert!(CommissioningPlan::new(&grant, now(), now() + Duration::minutes(1), noop).is_err());
        let plan = CommissioningPlan::new(&grant, now(), now() + Duration::minutes(15), binding())?;
        assert!(
            plan.validate_at(&grant, now() + Duration::minutes(16))
                .is_err()
        );
        assert!(
            CommissioningPlan::new(&grant, now(), now() + Duration::minutes(31), binding())
                .is_err()
        );
        Ok(())
    }
}
