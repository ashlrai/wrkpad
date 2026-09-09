use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use anyhow::{Result, ensure};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const GRANT_SCHEMA: &str = "dev.wrkpad.commissioner.grant/v1";
const MAX_GRANT_BYTES: u64 = 64 * 1024;
const MAX_GRANT_LIFETIME: Duration = Duration::days(90);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BoardRoute {
    AshlrLayer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileTemplate {
    AshlrDailyV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommissioningOperation {
    ApplyProfile,
    RestoreBaseline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeviceBinding {
    pub vendor_id: u16,
    pub product_id: u16,
    pub manufacturer: String,
    pub product: String,
    pub transport: String,
    pub usage_page: u16,
    pub usage: u16,
    pub descriptor_sha256: String,
    pub firmware_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutorBinding {
    pub name: String,
    pub version: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderBinding {
    pub name: String,
    pub version: String,
    pub app_sha256: String,
    pub bridge_sha256: String,
    pub capabilities_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommissioningGrant {
    pub schema: String,
    pub grant_id: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub route: BoardRoute,
    pub profile_template: ProfileTemplate,
    pub device: DeviceBinding,
    pub provider: ProviderBinding,
    pub executor: ExecutorBinding,
    pub allowed_operations: Vec<CommissioningOperation>,
    pub maximum_transactions: u16,
    pub firmware_writes: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct GrantBody<'a> {
    schema: &'a str,
    issued_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    route: BoardRoute,
    profile_template: ProfileTemplate,
    device: &'a DeviceBinding,
    provider: &'a ProviderBinding,
    executor: &'a ExecutorBinding,
    allowed_operations: &'a [CommissioningOperation],
    maximum_transactions: u16,
    firmware_writes: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrantInspection {
    NotEnrolled,
    Enrolled,
    Expired,
    Invalid,
}

impl CommissioningGrant {
    pub fn new(
        issued_at: DateTime<Utc>,
        expires_at: DateTime<Utc>,
        device: DeviceBinding,
        provider: ProviderBinding,
        executor: ExecutorBinding,
        maximum_transactions: u16,
    ) -> Result<Self> {
        let mut value = Self {
            schema: GRANT_SCHEMA.to_owned(),
            grant_id: String::new(),
            issued_at,
            expires_at,
            route: BoardRoute::AshlrLayer,
            profile_template: ProfileTemplate::AshlrDailyV1,
            device,
            provider,
            executor,
            allowed_operations: vec![
                CommissioningOperation::ApplyProfile,
                CommissioningOperation::RestoreBaseline,
            ],
            maximum_transactions,
            firmware_writes: false,
        };
        value.grant_id = value.computed_id()?;
        value.validate_at(issued_at)?;
        Ok(value)
    }

    pub fn validate_at(&self, now: DateTime<Utc>) -> Result<()> {
        ensure!(
            self.schema == GRANT_SCHEMA,
            "unknown commissioning grant schema"
        );
        ensure!(
            self.issued_at <= now,
            "commissioning grant is not active yet"
        );
        ensure!(self.expires_at > now, "commissioning grant expired");
        let lifetime = self.expires_at - self.issued_at;
        ensure!(
            lifetime > Duration::zero() && lifetime <= MAX_GRANT_LIFETIME,
            "commissioning grant lifetime is invalid"
        );
        ensure!(
            self.maximum_transactions > 0 && self.maximum_transactions <= 100,
            "commissioning grant transaction budget is invalid"
        );
        ensure!(
            !self.firmware_writes,
            "commissioning grants cannot authorize firmware writes"
        );
        ensure!(
            self.allowed_operations
                == [
                    CommissioningOperation::ApplyProfile,
                    CommissioningOperation::RestoreBaseline
                ],
            "commissioning grant operations are not the exact rollback-first allowlist"
        );
        validate_device(&self.device)?;
        validate_provider(&self.provider)?;
        validate_executor(&self.executor)?;
        ensure!(
            self.grant_id == self.computed_id()?,
            "commissioning grant content binding is invalid"
        );
        Ok(())
    }

    fn computed_id(&self) -> Result<String> {
        let body = GrantBody {
            schema: GRANT_SCHEMA,
            issued_at: self.issued_at,
            expires_at: self.expires_at,
            route: self.route,
            profile_template: self.profile_template,
            device: &self.device,
            provider: &self.provider,
            executor: &self.executor,
            allowed_operations: &self.allowed_operations,
            maximum_transactions: self.maximum_transactions,
            firmware_writes: self.firmware_writes,
        };
        Ok(hex::encode(Sha256::digest(serde_json::to_vec(&body)?)))
    }
}

fn validate_device(device: &DeviceBinding) -> Result<()> {
    ensure!(
        device.vendor_id == 0x303A,
        "commissioning grant vendor is not allowlisted"
    );
    ensure!(
        matches!(device.product_id, 0x8297 | 0x8298),
        "commissioning grant product is not allowlisted"
    );
    ensure!(
        device.manufacturer == "Work Louder" && device.product == "Creator Micro 2",
        "commissioning grant device strings are not exact"
    );
    ensure!(
        device.transport == "usb",
        "autonomous commissioning requires the USB transport"
    );
    ensure!(
        device.usage_page == 0xFF00 && device.usage > 0,
        "commissioning grant HID usage is not exact"
    );
    ensure!(
        is_sha256(&device.descriptor_sha256),
        "commissioning grant descriptor digest is invalid"
    );
    validate_bounded_label(&device.firmware_version, "firmware version")
}

fn validate_provider(provider: &ProviderBinding) -> Result<()> {
    ensure!(
        provider.name == "work_louder_input",
        "commissioning provider is not allowlisted"
    );
    validate_bounded_label(&provider.version, "provider version")?;
    for (label, value) in [
        ("provider app digest", &provider.app_sha256),
        ("provider bridge digest", &provider.bridge_sha256),
        (
            "provider capabilities digest",
            &provider.capabilities_sha256,
        ),
    ] {
        ensure!(is_sha256(value), "commissioning {label} is invalid");
    }
    Ok(())
}

fn validate_executor(executor: &ExecutorBinding) -> Result<()> {
    ensure!(
        executor.name == "worklouderctl",
        "commissioning executor is not allowlisted"
    );
    validate_bounded_label(&executor.version, "executor version")?;
    ensure!(
        is_sha256(&executor.sha256),
        "commissioning executor digest is invalid"
    );
    Ok(())
}

fn validate_bounded_label(value: &str, label: &str) -> Result<()> {
    ensure!(!value.is_empty() && value.len() <= 64, "{label} is invalid");
    ensure!(
        value
            .chars()
            .all(|character| character.is_ascii_alphanumeric()
                || matches!(character, '.' | '-' | '_' | '+')),
        "{label} is invalid"
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
pub fn inspect_grant(path: &Path, now: DateTime<Utc>) -> GrantInspection {
    match read_grant(path) {
        Ok(Some(grant)) => match grant.validate_at(now) {
            Ok(()) => GrantInspection::Enrolled,
            Err(error) if error.to_string().contains("expired") => GrantInspection::Expired,
            Err(_) => GrantInspection::Invalid,
        },
        Ok(None) => GrantInspection::NotEnrolled,
        Err(_) => GrantInspection::Invalid,
    }
}

#[cfg_attr(unix, allow(clippy::verbose_bit_mask))]
fn read_grant(path: &Path) -> Result<Option<CommissioningGrant>> {
    let before = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    ensure!(
        before.is_file() && !before.file_type().is_symlink(),
        "commissioning grant is not a regular file"
    );
    ensure!(
        before.len() > 1 && before.len() <= MAX_GRANT_BYTES,
        "commissioning grant size is invalid"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Keep the policy legible as "no group or other permission bits".
        ensure!(
            before.permissions().mode() & 0o077 == 0,
            "commissioning grant permissions are not private"
        );
    }
    let mut file = File::open(path)?;
    let opened = file.metadata()?;
    ensure!(
        same_file_identity(&before, &opened),
        "commissioning grant changed while opening"
    );
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_GRANT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() > 1 && u64::try_from(bytes.len())? <= MAX_GRANT_BYTES,
        "commissioning grant size is invalid"
    );
    let after = fs::symlink_metadata(path)?;
    ensure!(
        same_file_identity(&opened, &after) && !after.file_type().is_symlink(),
        "commissioning grant changed while reading"
    );
    Ok(Some(serde_json::from_slice(&bytes)?))
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
    use std::fs;

    use chrono::{Duration, TimeZone, Utc};
    use tempfile::tempdir;

    use super::{
        CommissioningGrant, DeviceBinding, ExecutorBinding, GrantInspection, ProviderBinding,
        inspect_grant,
    };

    fn now() -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 9, 5, 3, 0, 0)
            .single()
            .unwrap_or_default()
    }

    fn device() -> DeviceBinding {
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
        }
    }

    fn provider() -> ProviderBinding {
        ProviderBinding {
            name: "work_louder_input".to_owned(),
            version: "0.18.4".to_owned(),
            app_sha256: "c".repeat(64),
            bridge_sha256: "d".repeat(64),
            capabilities_sha256: "e".repeat(64),
        }
    }

    fn executor() -> ExecutorBinding {
        ExecutorBinding {
            name: "worklouderctl".to_owned(),
            version: "0.1.1".to_owned(),
            sha256: "b".repeat(64),
        }
    }

    #[test]
    fn grant_is_content_bound_and_never_authorizes_firmware() -> anyhow::Result<()> {
        let grant = CommissioningGrant::new(
            now(),
            now() + Duration::days(30),
            device(),
            provider(),
            executor(),
            3,
        )?;
        grant.validate_at(now())?;
        assert!(!grant.firmware_writes);
        let mut tampered = grant.clone();
        tampered.maximum_transactions = 4;
        assert!(tampered.validate_at(now()).is_err());
        let mut firmware = grant;
        firmware.firmware_writes = true;
        assert!(firmware.validate_at(now()).is_err());
        Ok(())
    }

    #[test]
    fn grant_rejects_wrong_device_executor_and_lifetime() {
        let mut wrong = device();
        wrong.product_id = 0x8360;
        assert!(
            CommissioningGrant::new(
                now(),
                now() + Duration::days(1),
                wrong,
                provider(),
                executor(),
                1,
            )
            .is_err()
        );
        let mut wrong_executor = executor();
        wrong_executor.name = "sh".to_owned();
        assert!(
            CommissioningGrant::new(
                now(),
                now() + Duration::days(1),
                device(),
                provider(),
                wrong_executor,
                1
            )
            .is_err()
        );
        assert!(
            CommissioningGrant::new(
                now(),
                now() + Duration::days(91),
                device(),
                provider(),
                executor(),
                1,
            )
            .is_err()
        );
    }

    #[test]
    fn inspection_rejects_tampering_symlinks_and_public_permissions() -> anyhow::Result<()> {
        let directory = tempdir()?;
        let path = directory.path().join("grant.json");
        let grant = CommissioningGrant::new(
            now(),
            now() + Duration::days(1),
            device(),
            provider(),
            executor(),
            1,
        )?;
        fs::write(&path, serde_json::to_vec(&grant)?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        }
        assert_eq!(inspect_grant(&path, now()), GrantInspection::Enrolled);
        assert_eq!(
            inspect_grant(&path, now() + Duration::days(2)),
            GrantInspection::Expired
        );
        fs::write(&path, b"{}")?;
        assert_eq!(inspect_grant(&path, now()), GrantInspection::Invalid);
        #[cfg(unix)]
        {
            use std::os::unix::fs::{PermissionsExt, symlink};
            fs::write(&path, serde_json::to_vec(&grant)?)?;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o644))?;
            assert_eq!(inspect_grant(&path, now()), GrantInspection::Invalid);
            fs::remove_file(&path)?;
            let target = directory.path().join("target.json");
            fs::write(&target, serde_json::to_vec(&grant)?)?;
            symlink(&target, &path)?;
            assert_eq!(inspect_grant(&path, now()), GrantInspection::Invalid);
        }
        Ok(())
    }
}
