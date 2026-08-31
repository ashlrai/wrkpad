use std::process::Command;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sysinfo::System;

use crate::device::{DeviceObservation, enumerate};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessOwners {
    pub chatgpt: bool,
    pub work_louder_input: bool,
    pub logitech: bool,
    pub karabiner: bool,
}

impl ProcessOwners {
    #[must_use]
    pub const fn likely_writer_running(&self) -> bool {
        self.chatgpt || self.work_louder_input
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolVersion {
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProbeStatus {
    Ok,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhysicalConclusion {
    RelevantHidPresent,
    UsbPresentNotHid,
    BoardAbsentFromUsb,
    ProbeUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsbIdentity {
    pub vendor_id: u16,
    pub product_id: u16,
    pub product: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsbProbe {
    pub status: ProbeStatus,
    pub source: String,
    pub external_device_present: Option<bool>,
    pub relevant_matches: Vec<UsbIdentity>,
    pub error_category: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DoctorReport {
    pub schema: String,
    pub observed_at: DateTime<Utc>,
    pub software_observer_ready: bool,
    pub device_observer_ready: bool,
    pub physical_conclusion: PhysicalConclusion,
    pub hid_probe_status: ProbeStatus,
    pub hid_error_category: Option<String>,
    pub usb: UsbProbe,
    pub devices: Vec<DeviceObservation>,
    pub owners: ProcessOwners,
    pub codex: ToolVersion,
    pub claude: ToolVersion,
    pub shadow_blockers: Vec<String>,
    pub takeover_blockers: Vec<String>,
    pub hid_writes_enabled: bool,
}

#[must_use]
pub fn run() -> DoctorReport {
    let (devices, hid_probe_status, hid_error_category) = match enumerate() {
        Ok(devices) => (devices, ProbeStatus::Ok, None),
        Err(_) => (
            Vec::new(),
            ProbeStatus::Error,
            Some("hid_backend_initialization_failed".to_owned()),
        ),
    };
    let usb = usb_probe();
    let owners = process_owners();
    let supported_present = devices
        .iter()
        .any(|device| device.current_generation_candidate);
    let physical_conclusion = derive_physical_conclusion(&devices, hid_probe_status, &usb);
    let device_observer_ready =
        matches!(physical_conclusion, PhysicalConclusion::RelevantHidPresent);

    let mut shadow_blockers = Vec::new();
    if hid_probe_status != ProbeStatus::Ok {
        shadow_blockers.push("the platform HID probe failed; device absence is unknown".to_owned());
    }
    if !supported_present {
        shadow_blockers.push("no recognized Creator Micro 2 or Codex Micro is present".to_owned());
    }
    shadow_blockers.push(
        "no live descriptor and firmware capability tuple has been accepted for this desk"
            .to_owned(),
    );

    let mut takeover_blockers = shadow_blockers.clone();
    if owners.chatgpt {
        takeover_blockers.push("ChatGPT Desktop is running".to_owned());
    }
    if owners.work_louder_input {
        takeover_blockers.push("Work Louder Input is running".to_owned());
    }
    if owners.logitech {
        takeover_blockers
            .push("Logitech software is running as a generic HID-manager caution".to_owned());
    }
    takeover_blockers.push(
        "the reverse-engineered lighting transport is intentionally disabled in v0.1 source"
            .to_owned(),
    );

    DoctorReport {
        schema: "dev.wrkpad.doctor/v2".to_owned(),
        observed_at: Utc::now(),
        software_observer_ready: true,
        device_observer_ready,
        physical_conclusion,
        hid_probe_status,
        hid_error_category,
        usb,
        devices,
        owners,
        codex: tool_version("codex", &["--version"]),
        claude: tool_version("claude", &["--version"]),
        shadow_blockers,
        takeover_blockers,
        hid_writes_enabled: false,
    }
}

fn derive_physical_conclusion(
    devices: &[DeviceObservation],
    hid_status: ProbeStatus,
    usb: &UsbProbe,
) -> PhysicalConclusion {
    if devices
        .iter()
        .any(|device| device.current_generation_candidate)
    {
        return PhysicalConclusion::RelevantHidPresent;
    }
    if hid_status != ProbeStatus::Ok || usb.status != ProbeStatus::Ok {
        return PhysicalConclusion::ProbeUnavailable;
    }
    if usb.relevant_matches.is_empty() {
        PhysicalConclusion::BoardAbsentFromUsb
    } else {
        PhysicalConclusion::UsbPresentNotHid
    }
}

#[cfg(target_os = "macos")]
fn usb_probe() -> UsbProbe {
    let output = Command::new("/usr/sbin/system_profiler")
        .args(["SPUSBDataType", "-json", "-detailLevel", "mini"])
        .output();
    let Ok(output) = output else {
        return unavailable_usb_probe("system_profiler_unavailable");
    };
    if !output.status.success() {
        return unavailable_usb_probe("system_profiler_failed");
    }
    let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) else {
        return unavailable_usb_probe("system_profiler_invalid_json");
    };
    let mut all = Vec::new();
    collect_usb_identities(&value, &mut all);
    let relevant_matches = all
        .iter()
        .filter(|identity| {
            identity.vendor_id == 0x303A
                || (identity.vendor_id == 0x574C && identity.product_id == 0xE6E3)
        })
        .cloned()
        .collect();
    UsbProbe {
        status: ProbeStatus::Ok,
        source: "system_profiler_json".to_owned(),
        external_device_present: Some(!all.is_empty()),
        relevant_matches,
        error_category: None,
    }
}

#[cfg(not(target_os = "macos"))]
fn usb_probe() -> UsbProbe {
    unavailable_usb_probe("platform_usb_registry_not_implemented")
}

fn unavailable_usb_probe(category: &str) -> UsbProbe {
    UsbProbe {
        status: ProbeStatus::Unavailable,
        source: "none".to_owned(),
        external_device_present: None,
        relevant_matches: Vec::new(),
        error_category: Some(category.to_owned()),
    }
}

fn collect_usb_identities(value: &Value, identities: &mut Vec<UsbIdentity>) {
    match value {
        Value::Array(values) => {
            for value in values {
                collect_usb_identities(value, identities);
            }
        }
        Value::Object(object) => {
            let vendor_id = object.get("vendor_id").and_then(parse_system_profiler_hex);
            let product_id = object.get("product_id").and_then(parse_system_profiler_hex);
            if let (Some(vendor_id), Some(product_id)) = (vendor_id, product_id) {
                identities.push(UsbIdentity {
                    vendor_id,
                    product_id,
                    product: object
                        .get("_name")
                        .and_then(Value::as_str)
                        .map(sanitize_bounded),
                });
            }
            for child in object.values() {
                collect_usb_identities(child, identities);
            }
        }
        _ => {}
    }
}

fn parse_system_profiler_hex(value: &Value) -> Option<u16> {
    let value = value.as_str()?.split_whitespace().next()?;
    u16::from_str_radix(value.trim_start_matches("0x"), 16).ok()
}

fn sanitize_bounded(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect()
}

fn process_owners() -> ProcessOwners {
    let system = System::new_all();
    let names: Vec<String> = system
        .processes()
        .values()
        .map(|process| {
            format!(
                "{} {}",
                process.name().to_string_lossy(),
                process
                    .exe()
                    .map_or_else(String::new, |path| path.to_string_lossy().into_owned())
            )
            .to_ascii_lowercase()
        })
        .collect();
    ProcessOwners {
        chatgpt: names.iter().any(|name| name.contains("chatgpt.app")),
        work_louder_input: names
            .iter()
            .any(|name| name.contains("/applications/input.app")),
        logitech: names.iter().any(|name| {
            name.contains("logi options") || name.contains("lghub") || name.contains("logitech")
        }),
        karabiner: names.iter().any(|name| name.contains("karabiner")),
    }
}

fn tool_version(executable: &str, arguments: &[&str]) -> ToolVersion {
    Command::new(executable)
        .args(arguments)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map_or(
            ToolVersion {
                installed: false,
                version: None,
            },
            |output| ToolVersion {
                installed: true,
                version: Some(sanitize_bounded(
                    String::from_utf8_lossy(&output.stdout).trim(),
                )),
            },
        )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        PhysicalConclusion, ProbeStatus, UsbProbe, collect_usb_identities,
        derive_physical_conclusion,
    };

    #[test]
    fn usb_fixture_distinguishes_relevant_hardware() {
        let fixture = json!({"SPUSBDataType":[{"_items":[{
            "_name":"Creator Micro 2",
            "vendor_id":"0x303a  (Work Louder)",
            "product_id":"0x8298"
        }]}]});
        let mut identities = Vec::new();
        collect_usb_identities(&fixture, &mut identities);
        assert_eq!(identities.len(), 1);
        assert_eq!(identities[0].vendor_id, 0x303A);
        assert_eq!(identities[0].product_id, 0x8298);
    }

    #[test]
    fn failed_hid_probe_never_claims_board_absence() {
        let usb = UsbProbe {
            status: ProbeStatus::Ok,
            source: "fixture".to_owned(),
            external_device_present: Some(false),
            relevant_matches: Vec::new(),
            error_category: None,
        };
        assert_eq!(
            derive_physical_conclusion(&[], ProbeStatus::Error, &usb),
            PhysicalConclusion::ProbeUnavailable
        );
    }
}
