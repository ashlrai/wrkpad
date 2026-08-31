#![forbid(unsafe_code)]

pub mod client;
pub mod config;
pub mod device;
pub mod doctor;
pub mod engine;
pub mod hook_config;
pub mod hooks;
pub mod lighting;
pub mod model;
pub mod occupancy;
pub mod protocol;
pub mod server;
pub mod service;
pub mod storage;
pub mod tui;

pub const HASP_SCHEMA: &str = "dev.wrkpad.hasp.event/v1";
pub const SNAPSHOT_SCHEMA: &str = "dev.wrkpad.hasp.state/v1";
pub const DEFAULT_ENDPOINT: &str = "http://127.0.0.1:43187";
