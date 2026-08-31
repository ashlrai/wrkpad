use std::ffi::CStr;

use anyhow::{Context, Result};
use hidapi::{DeviceInfo, HidApi};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceGeneration {
    CreatorMicro2,
    CodexMicro,
    LegacyMicroV1,
    UnknownEspressif,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceLevel {
    PriorLiveObservation,
    CommunityHardware,
    UserSuppliedCandidate,
    OfficialLegacy,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceObservation {
    pub vendor_id: u16,
    pub product_id: u16,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub usage_page: u16,
    pub usage: u16,
    pub interface_number: i32,
    #[serde(alias = "path_sha256")]
    pub device_path_sha256: String,
    pub serial_redacted: bool,
    pub generation: DeviceGeneration,
    pub identity_evidence: EvidenceLevel,
    pub current_generation_candidate: bool,
    pub writable: bool,
}

#[derive(Debug, Clone, Copy)]
struct KnownIdentity {
    vendor_id: u16,
    product_id: u16,
    generation: DeviceGeneration,
    evidence: EvidenceLevel,
}

const IDENTITIES: [KnownIdentity; 4] = [
    KnownIdentity {
        vendor_id: 0x303A,
        product_id: 0x8297,
        generation: DeviceGeneration::CreatorMicro2,
        evidence: EvidenceLevel::UserSuppliedCandidate,
    },
    KnownIdentity {
        vendor_id: 0x303A,
        product_id: 0x8298,
        generation: DeviceGeneration::CreatorMicro2,
        evidence: EvidenceLevel::PriorLiveObservation,
    },
    KnownIdentity {
        vendor_id: 0x303A,
        product_id: 0x8360,
        generation: DeviceGeneration::CodexMicro,
        evidence: EvidenceLevel::CommunityHardware,
    },
    KnownIdentity {
        vendor_id: 0x574C,
        product_id: 0xE6E3,
        generation: DeviceGeneration::LegacyMicroV1,
        evidence: EvidenceLevel::OfficialLegacy,
    },
];

pub fn enumerate() -> Result<Vec<DeviceObservation>> {
    let api = HidApi::new().context("failed to initialize the platform HID API")?;
    Ok(api
        .device_list()
        .filter(|info| is_relevant(info.vendor_id(), info.product_id(), info))
        .map(observation)
        .collect())
}

fn is_relevant(vendor_id: u16, product_id: u16, info: &DeviceInfo) -> bool {
    IDENTITIES
        .iter()
        .any(|known| known.vendor_id == vendor_id && known.product_id == product_id)
        || vendor_id == 0x303A
        || info
            .manufacturer_string()
            .is_some_and(|value| value.to_ascii_lowercase().contains("work louder"))
}

fn observation(info: &DeviceInfo) -> DeviceObservation {
    let known = IDENTITIES
        .iter()
        .find(|known| known.vendor_id == info.vendor_id() && known.product_id == info.product_id());
    let generation = known.map_or_else(
        || {
            if info.vendor_id() == 0x303A {
                DeviceGeneration::UnknownEspressif
            } else {
                DeviceGeneration::Unknown
            }
        },
        |value| value.generation,
    );
    DeviceObservation {
        vendor_id: info.vendor_id(),
        product_id: info.product_id(),
        manufacturer: info.manufacturer_string().map(str::to_owned),
        product: info.product_string().map(str::to_owned),
        usage_page: info.usage_page(),
        usage: info.usage(),
        interface_number: info.interface_number(),
        device_path_sha256: hash_path(info.path()),
        serial_redacted: info.serial_number().is_some(),
        generation,
        identity_evidence: known.map_or(EvidenceLevel::Unknown, |value| value.evidence),
        current_generation_candidate: matches!(
            generation,
            DeviceGeneration::CreatorMicro2 | DeviceGeneration::CodexMicro
        ),
        writable: false,
    }
}

fn hash_path(path: &CStr) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::{DeviceGeneration, IDENTITIES};

    #[test]
    fn current_generation_ids_never_route_to_legacy_qmk() {
        for product_id in [0x8297, 0x8298, 0x8360] {
            let generation = IDENTITIES
                .iter()
                .find(|identity| identity.product_id == product_id)
                .map(|identity| identity.generation);
            assert_ne!(generation, Some(DeviceGeneration::LegacyMicroV1));
        }
    }
}
