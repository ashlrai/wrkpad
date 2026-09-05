use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

use crate::device::{DeviceGeneration, DeviceObservation};
use crate::protocol::{RPC_CHANNEL, decode_report};

const WORK_LOUDER_VENDOR_ID: u16 = 0x303A;
const CREATOR_MICRO_2_PRODUCT_IDS: [u16; 2] = [0x8297, 0x8298];
const VENDOR_USAGE_PAGE: u16 = 0xFF00;
const VENDOR_USAGE: u16 = 0x0001;
const MAX_SHADOW_MESSAGE_BYTES: usize = 4 * 1024;
const MAX_EVENTS_PER_REPORT: usize = 16;
#[cfg(test)]
const MAX_READ_TIMEOUT_MS: u16 = 5_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShadowControl {
    #[serde(rename = "AG00")]
    Agent0,
    #[serde(rename = "AG01")]
    Agent1,
    #[serde(rename = "AG02")]
    Agent2,
    #[serde(rename = "AG03")]
    Agent3,
    #[serde(rename = "AG04")]
    Agent4,
    #[serde(rename = "AG05")]
    Agent5,
    #[serde(rename = "ACT06")]
    Action6,
    #[serde(rename = "ACT07")]
    Action7,
    #[serde(rename = "ACT08")]
    Action8,
    #[serde(rename = "ACT09")]
    Action9,
    #[serde(rename = "ACT10")]
    Action10,
    #[serde(rename = "ACT11")]
    Action11,
    #[serde(rename = "ACT12")]
    Action12,
    #[serde(rename = "ENC_CLK")]
    EncoderPress,
    #[serde(rename = "ENC_CW")]
    EncoderClockwise,
    #[serde(rename = "ENC_CC")]
    EncoderCounterClockwise,
}

impl ShadowControl {
    fn from_wire(value: &str) -> Option<Self> {
        match value {
            "AG00" => Some(Self::Agent0),
            "AG01" => Some(Self::Agent1),
            "AG02" => Some(Self::Agent2),
            "AG03" => Some(Self::Agent3),
            "AG04" => Some(Self::Agent4),
            "AG05" => Some(Self::Agent5),
            "ACT06" => Some(Self::Action6),
            "ACT07" => Some(Self::Action7),
            "ACT08" => Some(Self::Action8),
            "ACT09" => Some(Self::Action9),
            "ACT10" => Some(Self::Action10),
            "ACT11" => Some(Self::Action11),
            "ACT12" => Some(Self::Action12),
            "ENC_CLK" => Some(Self::EncoderPress),
            "ENC_CW" => Some(Self::EncoderClockwise),
            "ENC_CC" => Some(Self::EncoderCounterClockwise),
            _ => None,
        }
    }

    const fn is_encoder_tick(self) -> bool {
        matches!(self, Self::EncoderClockwise | Self::EncoderCounterClockwise)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShadowAction {
    Down,
    Up,
    Tick,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ShadowEvent {
    Control {
        control: ShadowControl,
        action: ShadowAction,
    },
    Joystick {
        angle: f64,
        distance: f64,
    },
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShadowPoll {
    TimedOut,
    Events(Vec<ShadowEvent>),
}

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ShadowError {
    #[error("the HID identity is not an exact supported Creator Micro 2 vendor collection")]
    UnsupportedIdentity,
    #[cfg(test)]
    #[error("the shadow read timeout exceeds the bounded maximum")]
    TimeoutTooLong,
    #[cfg(test)]
    #[error("the HID read failed")]
    ReadFailed,
    #[error("the input was not a supported Report 6 frame")]
    InvalidReport,
    #[error("the buffered notification exceeded the safety limit")]
    MessageTooLarge,
    #[error("the notification was not valid JSON")]
    InvalidJson,
    #[error("the notification payload was invalid")]
    InvalidPayload,
    #[error("one HID report produced too many notifications")]
    TooManyEvents,
}

/// Returns true only for the two Creator Micro 2 identities and the exact
/// vendor-defined collection used by Report 6. A generic Espressif identity,
/// a legacy Micro, or a standard keyboard collection cannot enter shadow mode.
#[must_use]
pub fn supports_shadow_identity(observation: &DeviceObservation) -> bool {
    observation.vendor_id == WORK_LOUDER_VENDOR_ID
        && CREATOR_MICRO_2_PRODUCT_IDS.contains(&observation.product_id)
        && observation.usage_page == VENDOR_USAGE_PAGE
        && observation.usage == VENDOR_USAGE
        && observation.generation == DeviceGeneration::CreatorMicro2
}

#[derive(Debug, Default)]
pub struct ShadowDecoder {
    buffer: Vec<u8>,
}

impl ShadowDecoder {
    /// Consumes one 63-byte stripped or 64-byte Report 6 input frame. Only
    /// allowlisted control events are returned; response and foreign methods
    /// are ignored without preserving their payloads.
    pub fn push_report(&mut self, report: &[u8]) -> Result<Vec<ShadowEvent>, ShadowError> {
        let frame = decode_report(report).map_err(|_| ShadowError::InvalidReport)?;
        if frame.channel != RPC_CHANNEL {
            return Ok(Vec::new());
        }

        let mut events = Vec::new();
        for byte in frame.payload {
            self.buffer.push(byte);
            if self.buffer.len() > MAX_SHADOW_MESSAGE_BYTES {
                self.buffer.clear();
                return Err(ShadowError::MessageTooLarge);
            }
            if self.buffer.ends_with(b"\r\n") {
                self.buffer.truncate(self.buffer.len().saturating_sub(2));
                let line = std::mem::take(&mut self.buffer);
                if line.is_empty() {
                    continue;
                }
                if let Some(event) = parse_notification(&line)? {
                    if events.len() >= MAX_EVENTS_PER_REPORT {
                        return Err(ShadowError::TooManyEvents);
                    }
                    events.push(event);
                }
            }
        }
        Ok(events)
    }
}

#[cfg(test)]
trait ReadOnlyTransport {
    fn read_timeout(&self, buffer: &mut [u8], timeout_ms: i32) -> Result<usize, ()>;
}

#[cfg(test)]
fn read_once<T: ReadOnlyTransport>(
    transport: &T,
    decoder: &mut ShadowDecoder,
    timeout_ms: u16,
) -> Result<ShadowPoll, ShadowError> {
    if timeout_ms > MAX_READ_TIMEOUT_MS {
        return Err(ShadowError::TimeoutTooLong);
    }
    let mut report = [0_u8; 64];
    let read = transport
        .read_timeout(&mut report, i32::from(timeout_ms))
        .map_err(|()| ShadowError::ReadFailed)?;
    if read == 0 {
        return Ok(ShadowPoll::TimedOut);
    }
    if !matches!(read, 63 | 64) {
        return Err(ShadowError::InvalidReport);
    }
    Ok(ShadowPoll::Events(decoder.push_report(&report[..read])?))
}

fn parse_notification(line: &[u8]) -> Result<Option<ShadowEvent>, ShadowError> {
    let value: Value = serde_json::from_slice(line).map_err(|_| ShadowError::InvalidJson)?;
    let object = value.as_object().ok_or(ShadowError::InvalidPayload)?;
    let compact_method = object.get("m");
    let standard_method = object.get("method");
    if compact_method.is_some() && standard_method.is_some() {
        return Err(ShadowError::InvalidPayload);
    }
    let Some(method) = compact_method.or(standard_method).and_then(Value::as_str) else {
        // Correlated RPC responses and other channel-2 traffic are not input
        // events and are intentionally discarded.
        return Ok(None);
    };

    let compact_params = object.get("p");
    let standard_params = object.get("params");
    if compact_params.is_some() && standard_params.is_some() {
        return Err(ShadowError::InvalidPayload);
    }
    let params = compact_params
        .or(standard_params)
        .ok_or(ShadowError::InvalidPayload)?;

    match method {
        "v.oai.hid" => parse_control(params).map(Some),
        "v.oai.rad" => parse_joystick(params).map(Some),
        _ => Ok(None),
    }
}

fn parse_control(params: &Value) -> Result<ShadowEvent, ShadowError> {
    let params = params.as_object().ok_or(ShadowError::InvalidPayload)?;
    let control = params
        .get("k")
        .and_then(Value::as_str)
        .and_then(ShadowControl::from_wire)
        .ok_or(ShadowError::InvalidPayload)?;
    let action = if control.is_encoder_tick() {
        ShadowAction::Tick
    } else {
        match params.get("act").and_then(Value::as_i64) {
            Some(1) => ShadowAction::Down,
            Some(0) => ShadowAction::Up,
            _ => return Err(ShadowError::InvalidPayload),
        }
    };
    Ok(ShadowEvent::Control { control, action })
}

fn parse_joystick(params: &Value) -> Result<ShadowEvent, ShadowError> {
    let params = params.as_object().ok_or(ShadowError::InvalidPayload)?;
    let angle = normalized_number(params.get("a"))?;
    let distance = normalized_number(params.get("d"))?;
    Ok(ShadowEvent::Joystick { angle, distance })
}

fn normalized_number(value: Option<&Value>) -> Result<f64, ShadowError> {
    let value = value
        .and_then(Value::as_f64)
        .ok_or(ShadowError::InvalidPayload)?;
    if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        return Err(ShadowError::InvalidPayload);
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use serde_json::{Value, json};

    use super::{
        ShadowAction, ShadowControl, ShadowDecoder, ShadowError, ShadowEvent, ShadowPoll,
        read_once, supports_shadow_identity,
    };
    use crate::device::{DeviceGeneration, DeviceObservation, EvidenceLevel};
    use crate::protocol::{RPC_CHANNEL, encode_message};

    fn observation(product_id: u16, usage_page: u16, usage: u16) -> DeviceObservation {
        DeviceObservation {
            vendor_id: 0x303A,
            product_id,
            manufacturer: None,
            product: None,
            usage_page,
            usage,
            interface_number: -1,
            device_path_sha256: "redacted-fixture".into(),
            serial_redacted: true,
            generation: DeviceGeneration::CreatorMicro2,
            identity_evidence: EvidenceLevel::PriorLiveObservation,
            current_generation_candidate: true,
            writable: false,
        }
    }

    fn reports(value: Value) -> anyhow::Result<Vec<[u8; 64]>> {
        let mut payload = serde_json::to_vec(&value)?;
        payload.extend_from_slice(b"\r\n");
        Ok(encode_message(RPC_CHANNEL, &payload)?)
    }

    #[test]
    fn identity_requires_creator_micro_2_vendor_collection() {
        assert!(supports_shadow_identity(&observation(0x8297, 0xFF00, 1)));
        assert!(supports_shadow_identity(&observation(0x8298, 0xFF00, 1)));
        assert!(!supports_shadow_identity(&observation(0x8360, 0xFF00, 1)));
        assert!(!supports_shadow_identity(&observation(0x8298, 0x0001, 6)));
        assert!(!supports_shadow_identity(&observation(0x8298, 0xFF00, 2)));
    }

    #[test]
    fn decodes_fragmented_full_and_stripped_reports() -> anyhow::Result<()> {
        let frames = reports(json!({
            "m": "v.oai.hid",
            "p": {"k": "AG00", "act": 1, "ag": 0, "ignored": "forces a second report without entering the event"}
        }))?;
        assert!(frames.len() > 1);
        let mut decoder = ShadowDecoder::default();
        assert!(decoder.push_report(&frames[0])?.is_empty());
        assert_eq!(
            decoder.push_report(&frames[1][1..])?,
            vec![ShadowEvent::Control {
                control: ShadowControl::Agent0,
                action: ShadowAction::Down,
            }]
        );
        Ok(())
    }

    #[test]
    fn accepts_only_allowlisted_controls_and_encoder_ticks_ignore_act() -> anyhow::Result<()> {
        let mut decoder = ShadowDecoder::default();
        let frame = reports(json!({"m":"v.oai.hid","p":{"k":"ENC_CW","act":7}}))?;
        assert_eq!(
            decoder.push_report(&frame[0])?,
            vec![ShadowEvent::Control {
                control: ShadowControl::EncoderClockwise,
                action: ShadowAction::Tick,
            }]
        );

        let unknown = reports(json!({"m":"v.oai.hid","p":{"k":"PRIVATE_KEY","act":1}}))?;
        assert_eq!(
            decoder.push_report(&unknown[0]),
            Err(ShadowError::InvalidPayload)
        );
        Ok(())
    }

    #[test]
    fn every_supported_control_has_a_stable_sanitized_id() -> anyhow::Result<()> {
        let cases = [
            ("AG00", 'd'),
            ("AG01", 'd'),
            ("AG02", 'd'),
            ("AG03", 'd'),
            ("AG04", 'd'),
            ("AG05", 'd'),
            ("ACT06", 'd'),
            ("ACT07", 'd'),
            ("ACT08", 'd'),
            ("ACT09", 'd'),
            ("ACT10", 'd'),
            ("ACT11", 'd'),
            ("ACT12", 'd'),
            ("ENC_CLK", 'd'),
            ("ENC_CW", 't'),
            ("ENC_CC", 't'),
        ];
        for (wire_id, expected_action) in cases {
            let mut decoder = ShadowDecoder::default();
            let frame = reports(json!({
                "m":"v.oai.hid",
                "p":{"k":wire_id,"act":1,"ag":99}
            }))?;
            let events = decoder.push_report(&frame[0])?;
            assert_eq!(events.len(), 1);
            let encoded = serde_json::to_value(&events[0])?;
            assert_eq!(encoded.get("control"), Some(&json!(wire_id)));
            let action = if expected_action == 't' {
                "tick"
            } else {
                "down"
            };
            assert_eq!(encoded.get("action"), Some(&json!(action)));
            assert!(encoded.get("ag").is_none());
        }
        Ok(())
    }

    #[test]
    fn joystick_values_must_be_finite_and_normalized() -> anyhow::Result<()> {
        let mut decoder = ShadowDecoder::default();
        let valid = reports(json!({"method":"v.oai.rad","params":{"a":0.75,"d":1.0}}))?;
        assert_eq!(
            decoder.push_report(&valid[0])?,
            vec![ShadowEvent::Joystick {
                angle: 0.75,
                distance: 1.0,
            }]
        );
        for invalid in [-0.1, 1.1] {
            let frame = reports(json!({"m":"v.oai.rad","p":{"a":invalid,"d":0.5}}))?;
            assert_eq!(
                decoder.push_report(&frame[0]),
                Err(ShadowError::InvalidPayload)
            );
        }
        Ok(())
    }

    #[test]
    fn ignores_foreign_methods_and_rpc_responses() -> anyhow::Result<()> {
        let mut decoder = ShadowDecoder::default();
        for value in [
            json!({"m":"device.status","p":{"serial":"must-not-escape"}}),
            json!({"id":7,"result":{"path":"must-not-escape"}}),
        ] {
            let frame = reports(value)?;
            assert!(decoder.push_report(&frame[0])?.is_empty());
        }
        Ok(())
    }

    #[test]
    fn serialized_event_contains_only_sanitized_typed_fields() -> anyhow::Result<()> {
        let mut decoder = ShadowDecoder::default();
        let frame = reports(json!({
            "m":"v.oai.hid",
            "p":{
                "k":"ACT12",
                "act":1,
                "serial":"private-serial",
                "path":"/private/device",
                "debug":"private-debug",
                "prompt":"private-prompt"
            }
        }))?;
        let mut events = Vec::new();
        for report in frame {
            events.extend(decoder.push_report(&report)?);
        }
        let encoded = serde_json::to_string(&events)?;
        assert_eq!(
            encoded,
            r#"[{"type":"control","control":"ACT12","action":"down"}]"#
        );
        Ok(())
    }

    struct FakeTransport {
        report: RefCell<Option<Vec<u8>>>,
        fail: bool,
    }

    impl super::ReadOnlyTransport for FakeTransport {
        fn read_timeout(&self, buffer: &mut [u8], _timeout_ms: i32) -> Result<usize, ()> {
            if self.fail {
                return Err(());
            }
            let Some(report) = self.report.borrow_mut().take() else {
                return Ok(0);
            };
            buffer[..report.len()].copy_from_slice(&report);
            Ok(report.len())
        }
    }

    #[test]
    fn transport_surface_reads_or_times_out_without_a_write_operation() -> anyhow::Result<()> {
        let report = reports(json!({"m":"v.oai.hid","p":{"k":"ENC_CC","act":9}}))?[0];
        let transport = FakeTransport {
            report: RefCell::new(Some(report.to_vec())),
            fail: false,
        };
        let mut decoder = ShadowDecoder::default();
        assert_eq!(
            read_once(&transport, &mut decoder, 250)?,
            ShadowPoll::Events(vec![ShadowEvent::Control {
                control: ShadowControl::EncoderCounterClockwise,
                action: ShadowAction::Tick,
            }])
        );
        assert_eq!(
            read_once(&transport, &mut decoder, 250)?,
            ShadowPoll::TimedOut
        );
        assert_eq!(
            read_once(&transport, &mut decoder, 5_001),
            Err(ShadowError::TimeoutTooLong)
        );
        Ok(())
    }

    #[test]
    fn invalid_frames_and_unterminated_streams_fail_bounded() -> anyhow::Result<()> {
        let mut decoder = ShadowDecoder::default();
        assert_eq!(
            decoder.push_report(&[0; 62]),
            Err(ShadowError::InvalidReport)
        );

        let payload = vec![b'x'; 61];
        let frame = encode_message(RPC_CHANNEL, &payload)?[0];
        for _ in 0..67 {
            assert!(decoder.push_report(&frame)?.is_empty());
        }
        assert_eq!(
            decoder.push_report(&frame),
            Err(ShadowError::MessageTooLarge)
        );
        Ok(())
    }
}
