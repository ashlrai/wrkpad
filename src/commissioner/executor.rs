use std::ffi::OsString;
use std::path::{Path, PathBuf};

use anyhow::{Result, ensure};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceOwner {
    Auto,
    Input,
}

impl DeviceOwner {
    const fn argument(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Input => "input",
        }
    }
}

/// The complete executor surface. There is intentionally no raw-command
/// variant, no shell string, and no firmware, reset, delete, or HID operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutorRequest {
    DoctorStrict,
    ProviderStatus,
    DeviceSnapshot {
        output: PathBuf,
        owner: DeviceOwner,
    },
    DeviceValidate {
        input: PathBuf,
        expected_revision: String,
        owner: DeviceOwner,
    },
    ConfigDiff {
        baseline: PathBuf,
        candidate: PathBuf,
    },
    DeviceApply {
        input: PathBuf,
        backup: PathBuf,
        expected_revision: String,
        idempotency_key: String,
        owner: DeviceOwner,
    },
    DeviceRestore {
        input: PathBuf,
        backup: PathBuf,
        expected_revision: String,
        idempotency_key: String,
        owner: DeviceOwner,
    },
}

impl ExecutorRequest {
    pub fn argv(&self) -> Result<Vec<OsString>> {
        let values: Vec<OsString> = match self {
            Self::DoctorStrict => strings(&["--json", "doctor", "--strict"]),
            Self::ProviderStatus => strings(&["--json", "provider", "status"]),
            Self::DeviceSnapshot { output, owner } => {
                validate_path(output)?;
                let mut argv = strings(&["--json", "device", "config", "snapshot", "--output"]);
                argv.push(output.as_os_str().to_owned());
                argv.extend(strings(&["--owner", owner.argument()]));
                argv
            }
            Self::DeviceValidate {
                input,
                expected_revision,
                owner,
            } => {
                validate_path(input)?;
                validate_digest(expected_revision, "expected revision")?;
                let mut argv = strings(&["--json", "device", "config", "validate", "--input"]);
                argv.push(input.as_os_str().to_owned());
                argv.extend(strings(&[
                    "--expected-revision",
                    expected_revision,
                    "--owner",
                    owner.argument(),
                ]));
                argv
            }
            Self::ConfigDiff {
                baseline,
                candidate,
            } => {
                validate_path(baseline)?;
                validate_path(candidate)?;
                let mut argv = strings(&["--json", "config", "diff"]);
                argv.push(baseline.as_os_str().to_owned());
                argv.push(candidate.as_os_str().to_owned());
                argv
            }
            Self::DeviceApply {
                input,
                backup,
                expected_revision,
                idempotency_key,
                owner,
            } => mutation_argv(
                "apply",
                input,
                backup,
                expected_revision,
                idempotency_key,
                *owner,
            )?,
            Self::DeviceRestore {
                input,
                backup,
                expected_revision,
                idempotency_key,
                owner,
            } => mutation_argv(
                "restore",
                input,
                backup,
                expected_revision,
                idempotency_key,
                *owner,
            )?,
        };
        ensure!(
            values.len() <= 16,
            "commissioning executor argument count is invalid"
        );
        Ok(values)
    }
}

fn mutation_argv(
    operation: &str,
    input: &Path,
    backup: &Path,
    expected_revision: &str,
    idempotency_key: &str,
    owner: DeviceOwner,
) -> Result<Vec<OsString>> {
    validate_path(input)?;
    validate_path(backup)?;
    validate_digest(expected_revision, "expected revision")?;
    validate_digest(idempotency_key, "idempotency key")?;
    let mut argv = strings(&["--json", "device", "config", operation, "--input"]);
    argv.push(input.as_os_str().to_owned());
    argv.push(OsString::from("--backup"));
    argv.push(backup.as_os_str().to_owned());
    argv.extend(strings(&[
        "--expected-revision",
        expected_revision,
        "--idempotency-key",
        idempotency_key,
        "--owner",
        owner.argument(),
    ]));
    Ok(argv)
}

fn strings(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

fn validate_path(path: &Path) -> Result<()> {
    ensure!(
        path.is_absolute(),
        "commissioning executor paths must be absolute"
    );
    let value = path.as_os_str().to_string_lossy();
    ensure!(
        !value.is_empty() && value.len() <= 4096,
        "commissioning executor path is invalid"
    );
    ensure!(
        !value.chars().any(char::is_control),
        "commissioning executor path is invalid"
    );
    Ok(())
}

fn validate_digest(value: &str, label: &str) -> Result<()> {
    ensure!(
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
        "commissioning executor {label} is invalid"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::path::PathBuf;

    use super::{DeviceOwner, ExecutorRequest};

    fn absolute(name: &str) -> PathBuf {
        env::temp_dir().join(name)
    }

    #[test]
    fn mutation_argv_is_fixed_and_shell_free() -> anyhow::Result<()> {
        let request = ExecutorRequest::DeviceApply {
            input: absolute("candidate.json"),
            backup: absolute("backup.json"),
            expected_revision: "a".repeat(64),
            idempotency_key: "b".repeat(64),
            owner: DeviceOwner::Auto,
        };
        let argv = request.argv()?;
        let rendered: Vec<_> = argv.iter().map(|value| value.to_string_lossy()).collect();
        assert_eq!(
            rendered[0..5],
            ["--json", "device", "config", "apply", "--input"]
        );
        assert!(rendered.contains(&"--expected-revision".into()));
        assert!(rendered.contains(&"--idempotency-key".into()));
        assert!(!rendered.iter().any(|value| value.contains("firmware")
            || value.contains("reset")
            || value.contains("delete")));
        Ok(())
    }

    #[test]
    fn request_surface_has_only_bounded_operations() -> anyhow::Result<()> {
        let requests = [
            ExecutorRequest::DoctorStrict,
            ExecutorRequest::ProviderStatus,
            ExecutorRequest::DeviceSnapshot {
                output: absolute("snapshot.json"),
                owner: DeviceOwner::Input,
            },
            ExecutorRequest::DeviceValidate {
                input: absolute("snapshot.json"),
                expected_revision: "c".repeat(64),
                owner: DeviceOwner::Input,
            },
            ExecutorRequest::ConfigDiff {
                baseline: absolute("base.json"),
                candidate: absolute("candidate.json"),
            },
        ];
        for request in requests {
            let argv = request.argv()?;
            assert!(
                !argv
                    .iter()
                    .any(|value| value.to_string_lossy().contains("firmware"))
            );
        }
        Ok(())
    }

    #[test]
    fn rejects_relative_paths_and_unbound_identifiers() {
        let request = ExecutorRequest::DeviceApply {
            input: PathBuf::from("candidate.json"),
            backup: absolute("backup.json"),
            expected_revision: "a".repeat(64),
            idempotency_key: "b".repeat(64),
            owner: DeviceOwner::Auto,
        };
        assert!(request.argv().is_err());
        let bad_key = ExecutorRequest::DeviceRestore {
            input: absolute("base.json"),
            backup: absolute("backup.json"),
            expected_revision: "a".repeat(64),
            idempotency_key: "free-form".to_owned(),
            owner: DeviceOwner::Auto,
        };
        assert!(bad_key.argv().is_err());
    }
}
