#[cfg(target_os = "macos")]
use std::io::Cursor;
use std::process::Command;

use chrono::{DateTime, Utc};
#[cfg(any(target_os = "macos", test))]
use plist::Value as PlistValue;
use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "macos", test))]
use serde_json::Value;
#[cfg(any(target_os = "macos", test))]
use sha2::{Digest, Sha256};
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
pub struct HidRegistryIdentity {
    pub vendor_id: u16,
    pub product_id: u16,
    pub product: Option<String>,
    pub transport: Option<String>,
    pub location_id: Option<u64>,
    /// Raw USB bcdDevice value. This is not treated as semantic firmware evidence.
    pub usb_device_version_raw: Option<u64>,
    pub report_descriptor_sha256: Option<String>,
    pub report_descriptor_byte_length: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HidRegistryProbe {
    pub status: ProbeStatus,
    pub source: String,
    pub relevant_matches: Vec<HidRegistryIdentity>,
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
    pub hid_registry: HidRegistryProbe,
    pub registry_disagreement: Option<String>,
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
    let hid_registry = hid_registry_probe();
    let owners = process_owners();
    let supported_present = devices
        .iter()
        .any(|device| device.current_generation_candidate);
    let physical_conclusion = derive_physical_conclusion(&devices, hid_probe_status, &usb);
    let device_observer_ready =
        matches!(physical_conclusion, PhysicalConclusion::RelevantHidPresent);
    let registry_disagreement = registry_disagreement(&devices, &usb, &hid_registry);

    let mut shadow_blockers = Vec::new();
    if hid_probe_status != ProbeStatus::Ok {
        shadow_blockers.push("the platform HID probe failed; device absence is unknown".to_owned());
    }
    if !supported_present {
        shadow_blockers.push("no recognized Creator Micro 2 or Codex Micro is present".to_owned());
    }
    shadow_blockers.push(
        "no descriptor-and-firmware capability tuple has been accepted for this desk".to_owned(),
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
        schema: "dev.wrkpad.doctor/v3".to_owned(),
        observed_at: Utc::now(),
        software_observer_ready: true,
        device_observer_ready,
        physical_conclusion,
        hid_probe_status,
        hid_error_category,
        usb,
        hid_registry,
        registry_disagreement,
        devices,
        owners,
        codex: tool_version("codex", &["--version"]),
        claude: tool_version("claude", &["--version"]),
        shadow_blockers,
        takeover_blockers,
        hid_writes_enabled: false,
    }
}

fn registry_disagreement(
    devices: &[DeviceObservation],
    usb: &UsbProbe,
    registry: &HidRegistryProbe,
) -> Option<String> {
    let relevant_hid_present = devices
        .iter()
        .any(|device| device.current_generation_candidate);
    let relevant_ioreg_usb_present = registry.relevant_matches.iter().any(|identity| {
        identity
            .transport
            .as_deref()
            .is_some_and(|transport| transport.eq_ignore_ascii_case("usb"))
    });
    if relevant_hid_present
        && relevant_ioreg_usb_present
        && usb.status == ProbeStatus::Ok
        && usb.relevant_matches.is_empty()
    {
        return Some(
            "relevant USB HID is present in IOHID/IORegistry but system_profiler returned no matching USB child"
                .to_owned(),
        );
    }
    None
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

#[cfg(target_os = "macos")]
fn hid_registry_probe() -> HidRegistryProbe {
    let output = Command::new("/usr/sbin/ioreg")
        .args(["-a", "-r", "-c", "AppleUserUSBHostHIDDevice"])
        .output();
    let Ok(output) = output else {
        return unavailable_hid_registry_probe("ioreg_unavailable");
    };
    if !output.status.success() {
        return unavailable_hid_registry_probe("ioreg_failed");
    }
    let Ok(value) = PlistValue::from_reader(Cursor::new(&output.stdout)) else {
        return unavailable_hid_registry_probe("ioreg_invalid_plist");
    };
    let relevant_matches = collect_hid_registry_identities(&value);
    HidRegistryProbe {
        status: ProbeStatus::Ok,
        source: "ioreg_xml_apple_user_usb_host_hid_device".to_owned(),
        relevant_matches,
        error_category: None,
    }
}

#[cfg(not(target_os = "macos"))]
fn hid_registry_probe() -> HidRegistryProbe {
    unavailable_hid_registry_probe("platform_hid_registry_not_implemented")
}

fn unavailable_hid_registry_probe(category: &str) -> HidRegistryProbe {
    HidRegistryProbe {
        status: ProbeStatus::Unavailable,
        source: "none".to_owned(),
        relevant_matches: Vec::new(),
        error_category: Some(category.to_owned()),
    }
}

#[cfg(any(target_os = "macos", test))]
fn collect_hid_registry_identities(value: &PlistValue) -> Vec<HidRegistryIdentity> {
    let Some(entries) = value.as_array() else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(PlistValue::as_dictionary)
        .filter_map(|dictionary| {
            let vendor_id = dictionary
                .get("VendorID")
                .and_then(PlistValue::as_unsigned_integer)
                .and_then(|value| u16::try_from(value).ok())?;
            let product_id = dictionary
                .get("ProductID")
                .and_then(PlistValue::as_unsigned_integer)
                .and_then(|value| u16::try_from(value).ok())?;
            let product = dictionary
                .get("Product")
                .and_then(PlistValue::as_string)
                .map(sanitize_bounded);
            if !is_relevant_registry_identity(vendor_id, product_id, product.as_deref()) {
                return None;
            }
            let descriptor = dictionary
                .get("ReportDescriptor")
                .and_then(PlistValue::as_data);
            Some(HidRegistryIdentity {
                vendor_id,
                product_id,
                product,
                transport: dictionary
                    .get("Transport")
                    .and_then(PlistValue::as_string)
                    .map(sanitize_bounded),
                location_id: dictionary
                    .get("LocationID")
                    .and_then(PlistValue::as_unsigned_integer),
                usb_device_version_raw: dictionary
                    .get("VersionNumber")
                    .and_then(PlistValue::as_unsigned_integer),
                report_descriptor_sha256: descriptor.map(hash_bytes),
                report_descriptor_byte_length: descriptor.map(<[u8]>::len),
            })
        })
        .collect()
}

#[cfg(any(target_os = "macos", test))]
fn is_relevant_registry_identity(vendor_id: u16, product_id: u16, _product: Option<&str>) -> bool {
    matches!(
        (vendor_id, product_id),
        (0x303A, 0x8297 | 0x8298 | 0x8360) | (0x574C, 0xE6E3)
    )
}

#[cfg(any(target_os = "macos", test))]
fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

#[cfg(any(target_os = "macos", test))]
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

#[cfg(any(target_os = "macos", test))]
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
        HidRegistryProbe, PhysicalConclusion, ProbeStatus, UsbProbe,
        collect_hid_registry_identities, collect_usb_identities, derive_physical_conclusion,
        registry_disagreement,
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

    #[test]
    fn ioreg_fixture_hashes_descriptor_without_collecting_serial() {
        let fixture = br#"<?xml version="1.0" encoding="UTF-8"?>
        <plist version="1.0"><array><dict>
          <key>VendorID</key><integer>12346</integer>
          <key>ProductID</key><integer>33432</integer>
          <key>Product</key><string>Creator Micro 2</string>
          <key>Transport</key><string>USB</string>
          <key>VersionNumber</key><integer>14784</integer>
          <key>SerialNumber</key><string>must-not-escape</string>
          <key>ReportDescriptor</key><data>BQGJBQ==</data>
        </dict></array></plist>"#;
        let value = plist::Value::from_reader(std::io::Cursor::new(fixture))
            .unwrap_or(plist::Value::Array(Vec::new()));
        let identities = collect_hid_registry_identities(&value);
        assert_eq!(identities.len(), 1);
        assert_eq!(identities[0].report_descriptor_byte_length, Some(4));
        assert_eq!(
            identities[0].report_descriptor_sha256.as_deref(),
            Some("67da05db249981fa8a21fc3cbe0f706698f424bf2ad31a831f3d698b1e86cc78")
        );
        let serialized = serde_json::to_string(&identities).unwrap_or_default();
        assert!(!serialized.contains("must-not-escape"));
    }

    #[test]
    fn ioreg_descriptor_capture_rejects_unrelated_espressif_hid() {
        let fixture = br#"<?xml version="1.0" encoding="UTF-8"?>
        <plist version="1.0"><array>
          <dict>
            <key>VendorID</key><integer>12346</integer>
            <key>ProductID</key><integer>4660</integer>
            <key>Product</key><string>Unrelated Espressif HID</string>
            <key>ReportDescriptor</key><data>AQID</data>
          </dict>
          <dict>
            <key>VendorID</key><integer>12346</integer>
            <key>ProductID</key><integer>33432</integer>
            <key>Product</key><string>Creator Micro 2</string>
            <key>ReportDescriptor</key><data>BQGJBQ==</data>
          </dict>
        </array></plist>"#;
        let value = plist::Value::from_reader(std::io::Cursor::new(fixture))
            .unwrap_or(plist::Value::Array(Vec::new()));
        let identities = collect_hid_registry_identities(&value);
        assert_eq!(identities.len(), 1);
        assert_eq!(identities[0].vendor_id, 0x303A);
        assert_eq!(identities[0].product_id, 0x8298);
    }

    #[test]
    fn registry_disagreement_is_explicit_when_system_profiler_is_empty() {
        let usb = UsbProbe {
            status: ProbeStatus::Ok,
            source: "fixture".to_owned(),
            external_device_present: Some(false),
            relevant_matches: Vec::new(),
            error_category: None,
        };
        let registry = HidRegistryProbe {
            status: ProbeStatus::Ok,
            source: "fixture".to_owned(),
            relevant_matches: vec![super::HidRegistryIdentity {
                vendor_id: 0x303A,
                product_id: 0x8298,
                product: Some("Creator Micro 2".to_owned()),
                transport: Some("USB".to_owned()),
                location_id: None,
                usb_device_version_raw: None,
                report_descriptor_sha256: None,
                report_descriptor_byte_length: None,
            }],
            error_category: None,
        };
        let devices = vec![crate::device::DeviceObservation {
            vendor_id: 0x303A,
            product_id: 0x8298,
            manufacturer: Some("Work Louder".to_owned()),
            product: Some("Creator Micro 2".to_owned()),
            usage_page: 1,
            usage: 6,
            interface_number: -1,
            device_path_sha256: "redacted".to_owned(),
            serial_redacted: true,
            generation: crate::device::DeviceGeneration::CreatorMicro2,
            identity_evidence: crate::device::EvidenceLevel::PriorLiveObservation,
            current_generation_candidate: true,
            writable: false,
        }];
        assert!(registry_disagreement(&devices, &usb, &registry).is_some());
    }
}
