use std::process::Command;

use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DoctorReport {
    pub schema: String,
    pub observe_ready: bool,
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
    let devices = enumerate().unwrap_or_default();
    let owners = process_owners();
    let supported_present = devices
        .iter()
        .any(|device| device.current_generation_candidate);

    let mut shadow_blockers = Vec::new();
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
            .push("Logitech software is running and may contend for HID access".to_owned());
    }
    takeover_blockers.push(
        "the reverse-engineered lighting transport is intentionally disabled in v0.1 source"
            .to_owned(),
    );

    DoctorReport {
        schema: "dev.wrkpad.doctor/v1".to_owned(),
        observe_ready: true,
        devices,
        owners,
        codex: tool_version("codex", &["--version"]),
        claude: tool_version("claude", &["--version"]),
        shadow_blockers,
        takeover_blockers,
        hid_writes_enabled: false,
    }
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
                version: Some(
                    String::from_utf8_lossy(&output.stdout)
                        .trim()
                        .chars()
                        .take(200)
                        .collect(),
                ),
            },
        )
}
