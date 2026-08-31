use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

pub const REPORT_ID: u8 = 0x06;
pub const REPORT_BYTES: usize = 64;
pub const MAX_FRAGMENT_BYTES: usize = 61;
pub const RPC_CHANNEL: u8 = 0x02;
pub const DEBUG_CHANNEL: u8 = 0x01;
pub const MAX_MESSAGE_BYTES: usize = 32 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HidFrame {
    pub channel: u8,
    pub payload: Vec<u8>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum FrameError {
    #[error("report must contain either 63 bytes without the report ID or 64 bytes with it")]
    InvalidReportSize,
    #[error("unexpected HID report ID: 0x{0:02X}")]
    UnexpectedReportId(u8),
    #[error("fragment length {declared} exceeds the available {available} bytes")]
    InvalidFragmentLength { declared: usize, available: usize },
    #[error("message exceeded the {MAX_MESSAGE_BYTES}-byte safety limit")]
    MessageTooLarge,
    #[error("RPC payload is not valid UTF-8 JSON")]
    InvalidJson,
    #[error("request id must be between 1 and 999")]
    InvalidRequestId,
    #[error("method is denied by the v0.1 safety contract: {0}")]
    DeniedMethod(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RpcRequest {
    pub method: String,
    pub params: Value,
    pub id: u16,
}

impl RpcRequest {
    pub fn read_only(
        method: impl Into<String>,
        params: Value,
        id: u16,
    ) -> Result<Self, FrameError> {
        let method = method.into();
        if !(1..1000).contains(&id) {
            return Err(FrameError::InvalidRequestId);
        }
        if !matches!(method.as_str(), "sys.version" | "device.status") {
            return Err(FrameError::DeniedMethod(method));
        }
        Ok(Self { method, params, id })
    }

    pub fn encode(&self) -> Result<Vec<[u8; REPORT_BYTES]>, FrameError> {
        let bytes = serde_json::to_vec(self).map_err(|_| FrameError::InvalidJson)?;
        encode_message(RPC_CHANNEL, &bytes)
    }
}

pub fn encode_message(channel: u8, payload: &[u8]) -> Result<Vec<[u8; REPORT_BYTES]>, FrameError> {
    if payload.len() > MAX_MESSAGE_BYTES {
        return Err(FrameError::MessageTooLarge);
    }
    let mut reports = Vec::new();
    for fragment in payload.chunks(MAX_FRAGMENT_BYTES) {
        let mut report = [0_u8; REPORT_BYTES];
        report[0] = REPORT_ID;
        report[1] = channel;
        report[2] = u8::try_from(fragment.len()).map_err(|_| FrameError::MessageTooLarge)?;
        report[3..3 + fragment.len()].copy_from_slice(fragment);
        reports.push(report);
    }
    if reports.is_empty() {
        let mut report = [0_u8; REPORT_BYTES];
        report[0] = REPORT_ID;
        report[1] = channel;
        reports.push(report);
    }
    Ok(reports)
}

pub fn decode_report(report: &[u8]) -> Result<HidFrame, FrameError> {
    let body = match report.len() {
        REPORT_BYTES => {
            if report[0] != REPORT_ID {
                return Err(FrameError::UnexpectedReportId(report[0]));
            }
            &report[1..]
        }
        63 => report,
        _ => return Err(FrameError::InvalidReportSize),
    };
    let channel = body[0];
    let declared = usize::from(body[1]);
    let available = body.len().saturating_sub(2).min(MAX_FRAGMENT_BYTES);
    if declared > available {
        return Err(FrameError::InvalidFragmentLength {
            declared,
            available,
        });
    }
    Ok(HidFrame {
        channel,
        payload: body[2..2 + declared].to_vec(),
    })
}

#[derive(Debug, Default)]
pub struct MessageAssembler {
    buffer: Vec<u8>,
}

impl MessageAssembler {
    pub fn push(&mut self, frame: &HidFrame) -> Result<Option<Value>, FrameError> {
        if frame.channel != RPC_CHANNEL {
            return Ok(None);
        }
        if self.buffer.len().saturating_add(frame.payload.len()) > MAX_MESSAGE_BYTES {
            self.buffer.clear();
            return Err(FrameError::MessageTooLarge);
        }
        self.buffer.extend_from_slice(&frame.payload);
        match serde_json::from_slice::<Value>(&self.buffer) {
            Ok(value) => {
                self.buffer.clear();
                Ok(Some(value))
            }
            Err(error) if error.is_eof() => Ok(None),
            Err(_) => {
                self.buffer.clear();
                Err(FrameError::InvalidJson)
            }
        }
    }
}

#[must_use]
pub fn response_matches_request(value: &Value, request_id: u16) -> bool {
    value.get("id").and_then(Value::as_u64) == Some(u64::from(request_id))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        MAX_FRAGMENT_BYTES, MessageAssembler, REPORT_ID, RPC_CHANNEL, RpcRequest, decode_report,
        encode_message, response_matches_request,
    };

    #[test]
    fn supports_report_id_present_and_stripped_views() -> anyhow::Result<()> {
        let reports = encode_message(RPC_CHANNEL, br#"{"id":7}"#)?;
        let full = decode_report(&reports[0])?;
        let stripped = decode_report(&reports[0][1..])?;
        assert_eq!(full, stripped);
        assert_eq!(reports[0][0], REPORT_ID);
        Ok(())
    }

    #[test]
    fn reassembles_fragmented_unicode_json() -> anyhow::Result<()> {
        let payload = serde_json::to_vec(&json!({
            "id": 9,
            "result": "agent status 🚀 repeated to cross a report boundary repeated to cross a report boundary"
        }))?;
        assert!(payload.len() > MAX_FRAGMENT_BYTES);
        let reports = encode_message(RPC_CHANNEL, &payload)?;
        let mut assembler = MessageAssembler::default();
        let mut result = None;
        for report in reports {
            result = assembler.push(&decode_report(&report)?)?;
        }
        assert_eq!(
            result.and_then(|value| value.get("id").cloned()),
            Some(json!(9))
        );
        Ok(())
    }

    #[test]
    fn read_only_builder_rejects_mutating_methods_and_large_ids() {
        assert!(RpcRequest::read_only("v.oai.rgbcfg", json!({}), 1).is_err());
        assert!(RpcRequest::read_only("sys.bootloader", json!({}), 1).is_err());
        assert!(RpcRequest::read_only("sys.version", json!({}), 1000).is_err());
    }

    #[test]
    fn ignores_foreign_response_ids() {
        assert!(response_matches_request(
            &json!({"id": 12, "result": "ok"}),
            12
        ));
        assert!(!response_matches_request(
            &json!({"id": 13, "result": "ok"}),
            12
        ));
        assert!(!response_matches_request(&json!({"m": "v.oai.hid"}), 12));
    }
}
