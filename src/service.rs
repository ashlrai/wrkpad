use std::fs::{self, OpenOptions};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use chrono::Utc;
use plist::Value;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::time::{Instant, sleep};
use uuid::Uuid;

use crate::DEFAULT_ENDPOINT;
use crate::client::HaspClient;
use crate::config::Paths;

pub const LABEL: &str = "dev.wrkpad.hasp";
pub const BIND_ADDRESS: &str = "127.0.0.1:43187";
const MAX_PLIST_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StartTransition {
    Bootstrap,
    Kickstart,
}

fn start_transition(already_loaded: bool) -> StartTransition {
    if already_loaded {
        StartTransition::Kickstart
    } else {
        StartTransition::Bootstrap
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceAction {
    Install,
    Repair,
    Uninstall,
    Start,
    Stop,
    Restart,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServicePlan {
    pub schema: String,
    pub action: ServiceAction,
    pub label: String,
    pub target: PathBuf,
    pub executable: PathBuf,
    pub executable_sha256: String,
    pub target_exists: bool,
    pub target_owned: bool,
    pub target_sha256: Option<String>,
    pub proposed_sha256: Option<String>,
    pub plan_id: String,
    pub outcome: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceStatus {
    pub schema: String,
    pub label: String,
    pub target: PathBuf,
    pub installed: bool,
    pub owned: bool,
    pub loaded: bool,
    pub healthy: bool,
    pub detail: String,
}

#[must_use]
pub fn target_path(home: &Path) -> PathBuf {
    home.join("Library/LaunchAgents")
        .join(format!("{LABEL}.plist"))
}

pub fn plan(
    action: ServiceAction,
    target: PathBuf,
    executable: &Path,
    stderr_path: &Path,
) -> Result<ServicePlan> {
    platform_check()?;
    validate_absolute_regular_executable(executable)?;
    let executable_sha256 = sha256(&fs::read(executable)?);
    validate_service_paths(&target, stderr_path)?;
    let expected = render_plist(executable, stderr_path)?;
    let current = read_target(&target)?;
    let target_exists = current.is_some();
    let target_owned = current
        .as_deref()
        .is_some_and(|bytes| is_owned_plist(bytes, executable, stderr_path));
    if target_exists && !target_owned {
        bail!(
            "refusing foreign LaunchAgent at {}; inspect or move it manually",
            target.display()
        );
    }
    let target_sha256 = current.as_deref().map(sha256);
    let exact = current.as_deref() == Some(expected.as_slice());
    let outcome = match action {
        ServiceAction::Install if !target_exists => "install",
        ServiceAction::Install if exact => "unchanged",
        ServiceAction::Install => "repair_required",
        ServiceAction::Repair if !target_exists => "not_installed",
        ServiceAction::Repair if exact => "unchanged",
        ServiceAction::Repair => "repair",
        ServiceAction::Uninstall if target_exists => "uninstall",
        ServiceAction::Start if target_exists => "start",
        ServiceAction::Stop if target_exists => "stop",
        ServiceAction::Restart if target_exists => "restart",
        ServiceAction::Uninstall
        | ServiceAction::Start
        | ServiceAction::Stop
        | ServiceAction::Restart => "not_installed",
    }
    .to_owned();
    let proposed_sha256 = match action {
        ServiceAction::Install | ServiceAction::Repair => Some(sha256(&expected)),
        ServiceAction::Uninstall => None,
        ServiceAction::Start | ServiceAction::Stop | ServiceAction::Restart => {
            target_sha256.clone()
        }
    };
    let seed = serde_json::json!({
        "action": action,
        "label": LABEL,
        "target": target,
        "executable": executable,
        "executable_sha256": executable_sha256,
        "target_sha256": target_sha256,
        "proposed_sha256": proposed_sha256,
        "outcome": outcome,
    });
    let plan_id = sha256(&serde_json::to_vec(&seed)?);
    Ok(ServicePlan {
        schema: "dev.wrkpad.service.plan/v1".to_owned(),
        action,
        label: LABEL.to_owned(),
        target,
        executable: executable.to_path_buf(),
        executable_sha256,
        target_exists,
        target_owned,
        target_sha256,
        proposed_sha256,
        plan_id,
        outcome,
        warnings: vec![
            "this changes only the current user's macOS LaunchAgent state".to_owned(),
            "token, state, hooks, and logs are preserved by uninstall".to_owned(),
        ],
    })
}

pub async fn status(
    target: PathBuf,
    executable: &Path,
    paths: &Paths,
    uid: u32,
) -> Result<ServiceStatus> {
    platform_check()?;
    let current = read_target(&target)?;
    let installed = current.is_some();
    let owned = current
        .as_deref()
        .is_some_and(|bytes| is_owned_plist(bytes, executable, &stderr_path(paths)));
    let loaded_output = launchctl(&["print", &service_target(uid)])?;
    let loaded = loaded_output.status.success();
    let healthy = loaded && authenticated_health(paths).await;
    let detail = if installed && !owned {
        "foreign plist present; no mutation is allowed"
    } else if healthy {
        "installed, loaded, and authenticated HASP health passed"
    } else if loaded {
        "loaded, but authenticated HASP health failed"
    } else if installed {
        "installed but not loaded"
    } else {
        "not installed"
    };
    Ok(ServiceStatus {
        schema: "dev.wrkpad.service.status/v1".to_owned(),
        label: LABEL.to_owned(),
        target,
        installed,
        owned,
        loaded,
        healthy,
        detail: detail.to_owned(),
    })
}

pub async fn apply(
    action: ServiceAction,
    target: PathBuf,
    executable: &Path,
    paths: &Paths,
    uid: u32,
    confirmed_plan_id: &str,
) -> Result<ServicePlan> {
    platform_check()?;
    let stderr = stderr_path(paths);
    let _lock = ServiceLock::acquire(paths)?;
    let current_plan = plan(action, target.clone(), executable, &stderr)?;
    if current_plan.plan_id != confirmed_plan_id {
        bail!("service plan is stale; run wrkpad service plan again");
    }
    match current_plan.outcome.as_str() {
        "repair_required" => bail!("the installed wrkpad plist differs; use service repair"),
        "not_installed" => bail!("wrkpad service is not installed"),
        "unchanged" => return Ok(current_plan),
        _ => {}
    }
    paths.ensure()?;
    let token = if matches!(
        action,
        ServiceAction::Install
            | ServiceAction::Repair
            | ServiceAction::Start
            | ServiceAction::Restart
    ) {
        ensure_not_disabled(uid)?;
        Some(paths.ensure_token()?)
    } else {
        None
    };
    let was_loaded = is_loaded(uid)?;
    if token.is_some() && !was_loaded && authenticated_health(paths).await {
        bail!(
            "an unmanaged authenticated HASP listener already answers at {DEFAULT_ENDPOINT}; stop it before changing the managed service"
        );
    }
    let original = read_target(&target)?;
    if original.as_deref().map(sha256) != current_plan.target_sha256 {
        bail!("service target changed after planning; no mutation was performed");
    }
    if let Some(bytes) = original.as_deref() {
        write_backup(paths, bytes)?;
    }

    match action {
        ServiceAction::Install | ServiceAction::Repair => {
            let expected = render_plist(executable, &stderr)?;
            if action == ServiceAction::Repair {
                bootout_if_loaded(uid)?;
            }
            write_atomic(&target, &expected, current_plan.target_sha256.as_deref())?;
            if let Err(error) =
                start_and_verify(uid, &target, paths, token.as_deref().unwrap_or_default()).await
            {
                rollback(&target, original.as_deref(), uid)?;
                return Err(error.context("service activation failed; prior plist was restored"));
            }
        }
        ServiceAction::Uninstall => {
            bootout_if_loaded(uid)?;
            remove_owned(&target, current_plan.target_sha256.as_deref())?;
        }
        ServiceAction::Start => {
            if let Err(error) =
                start_and_verify(uid, &target, paths, token.as_deref().unwrap_or_default()).await
            {
                if !was_loaded {
                    bootout_if_loaded(uid)?;
                }
                return Err(error.context("service start failed"));
            }
        }
        ServiceAction::Stop => bootout_if_loaded(uid)?,
        ServiceAction::Restart => {
            bootout_if_loaded(uid)?;
            let deadline = Instant::now() + Duration::from_secs(2);
            while is_loaded(uid)? && Instant::now() < deadline {
                sleep(Duration::from_millis(25)).await;
            }
            if is_loaded(uid)? {
                bail!("launchd did not finish unloading {LABEL}");
            }
            start_and_verify(uid, &target, paths, token.as_deref().unwrap_or_default())
                .await
                .context("service restart failed")?;
        }
    }
    plan(action, target, executable, &stderr)
}

fn stderr_path(paths: &Paths) -> PathBuf {
    paths.root.join("service.stderr.log")
}

fn render_plist(executable: &Path, stderr_path: &Path) -> Result<Vec<u8>> {
    let executable = executable
        .to_str()
        .context("service executable path must be valid UTF-8")?;
    let stderr = stderr_path
        .to_str()
        .context("service stderr path must be valid UTF-8")?;
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{}</string>
    <string>serve</string>
    <string>--bind</string>
    <string>{BIND_ADDRESS}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>Umask</key><integer>63</integer>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>{}</string>
</dict>
</plist>
"#,
        LABEL,
        xml_escape(executable),
        xml_escape(stderr)
    );
    Ok(xml.into_bytes())
}

fn is_owned_plist(bytes: &[u8], executable: &Path, stderr_path: &Path) -> bool {
    let Ok(value) = Value::from_reader(Cursor::new(bytes)) else {
        return false;
    };
    let Some(dictionary) = value.as_dictionary() else {
        return false;
    };
    let expected_stderr = stderr_path.to_string_lossy();
    let arguments = dictionary.get("ProgramArguments").and_then(Value::as_array);
    let safe_arguments = arguments.is_some_and(|arguments| {
        arguments.len() == 4
            && arguments.first().and_then(Value::as_string) == executable.to_str()
            && arguments.get(1).and_then(Value::as_string) == Some("serve")
            && arguments.get(2).and_then(Value::as_string) == Some("--bind")
            && arguments.get(3).and_then(Value::as_string) == Some(BIND_ADDRESS)
    });
    let keep_alive_exact = dictionary
        .get("KeepAlive")
        .and_then(Value::as_dictionary)
        .is_some_and(|keep_alive| {
            keep_alive.len() == 1
                && keep_alive.get("SuccessfulExit").and_then(Value::as_boolean) == Some(false)
        });
    dictionary.len() == 9
        && dictionary.get("Label").and_then(Value::as_string) == Some(LABEL)
        && safe_arguments
        && dictionary.get("RunAtLoad").and_then(Value::as_boolean) == Some(true)
        && keep_alive_exact
        && dictionary
            .get("ThrottleInterval")
            .and_then(Value::as_unsigned_integer)
            == Some(30)
        && dictionary.get("Umask").and_then(Value::as_unsigned_integer) == Some(63)
        && dictionary.get("StandardOutPath").and_then(Value::as_string) == Some("/dev/null")
        && dictionary
            .get("StandardErrorPath")
            .and_then(Value::as_string)
            == Some(expected_stderr.as_ref())
        && dictionary.get("ProcessType").and_then(Value::as_string) == Some("Background")
}

fn read_target(path: &Path) -> Result<Option<Vec<u8>>> {
    validate_target(path)?;
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                bail!("refusing to follow symlink at {}", path.display());
            }
            if !metadata.is_file() {
                bail!("service target must be a regular file: {}", path.display());
            }
            if metadata.len() > MAX_PLIST_BYTES {
                bail!("service plist exceeds the 1 MiB safety limit");
            }
            Ok(Some(fs::read(path)?))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn write_atomic(path: &Path, bytes: &[u8], expected_sha256: Option<&str>) -> Result<()> {
    validate_target(path)?;
    let parent = path.parent().context("service target has no parent")?;
    #[cfg(unix)]
    let parent_existed = parent.exists();
    fs::create_dir_all(parent)?;
    #[cfg(unix)]
    if !parent_existed {
        set_private_directory(parent)?;
    }
    validate_target(path)?;
    let temporary = parent.join(format!(".wrkpad-service-{}.tmp", Uuid::new_v4()));
    write_private_new(&temporary, bytes)?;
    let current = read_target(path)?.as_deref().map(sha256);
    if current.as_deref() != expected_sha256 {
        let _ = fs::remove_file(&temporary);
        bail!("service target changed immediately before replacement");
    }
    fs::rename(&temporary, path)?;
    #[cfg(unix)]
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

fn remove_owned(path: &Path, expected_sha256: Option<&str>) -> Result<()> {
    let current = read_target(path)?;
    if current.as_deref().map(sha256).as_deref() != expected_sha256 {
        bail!("service target changed immediately before removal");
    }
    fs::remove_file(path)?;
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

fn write_backup(paths: &Paths, bytes: &[u8]) -> Result<()> {
    let root = paths.root.join("service-backups");
    fs::create_dir_all(&root)?;
    #[cfg(unix)]
    set_private_directory(&root)?;
    let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
    let path = root.join(format!(
        "{LABEL}-{timestamp}-{}.plist",
        &sha256(bytes)[..12]
    ));
    if !path.exists() {
        write_private_new(&path, bytes)?;
    }
    Ok(())
}

fn rollback(path: &Path, original: Option<&[u8]>, uid: u32) -> Result<()> {
    bootout_if_loaded(uid)?;
    let current_hash = read_target(path)?.as_deref().map(sha256);
    match original {
        Some(bytes) => {
            write_atomic(path, bytes, current_hash.as_deref())?;
            let output = launchctl(&[
                "bootstrap",
                &domain_target(uid),
                path.to_str().context("service path must be valid UTF-8")?,
            ])?;
            if !output.status.success() {
                bail!("prior plist was restored but could not be reloaded");
            }
        }
        None => {
            if path.exists() {
                remove_owned(path, current_hash.as_deref())?;
            }
        }
    }
    Ok(())
}

async fn start_and_verify(uid: u32, target: &Path, paths: &Paths, token: &str) -> Result<()> {
    if start_transition(is_loaded(uid)?) == StartTransition::Kickstart {
        // RunAtLoad starts a newly bootstrapped job. A second immediate kickstart can race
        // launchd's registration/throttle window and return 118 after a successful bootstrap.
        let kickstart = launchctl(&["kickstart", "-kp", &service_target(uid)])?;
        if !kickstart.status.success() {
            bail!("launchctl kickstart failed: {}", concise_stderr(&kickstart));
        }
    } else {
        let bootstrap = launchctl(&[
            "bootstrap",
            &domain_target(uid),
            target
                .to_str()
                .context("service path must be valid UTF-8")?,
        ])?;
        if !bootstrap.status.success() {
            bail!("launchctl bootstrap failed: {}", concise_stderr(&bootstrap));
        }
    }
    let client = HaspClient::new(DEFAULT_ENDPOINT, token)?;
    let deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < deadline {
        if client.snapshot().await.is_ok() {
            return Ok(());
        }
        sleep(Duration::from_millis(100)).await;
    }
    bail!(
        "authenticated HASP health did not pass; inspect {}",
        paths.root.join("service.stderr.log").display()
    )
}

async fn authenticated_health(paths: &Paths) -> bool {
    let Ok(token) = paths.read_token() else {
        return false;
    };
    let Ok(client) = HaspClient::new(DEFAULT_ENDPOINT, token) else {
        return false;
    };
    for attempt in 0..3 {
        if client.snapshot().await.is_ok() {
            return true;
        }
        if attempt < 2 {
            sleep(Duration::from_millis(100)).await;
        }
    }
    false
}

fn bootout_if_loaded(uid: u32) -> Result<()> {
    if !is_loaded(uid)? {
        return Ok(());
    }
    let output = launchctl(&["bootout", &service_target(uid)])?;
    if !output.status.success() {
        bail!("launchctl bootout failed: {}", concise_stderr(&output));
    }
    Ok(())
}

fn is_loaded(uid: u32) -> Result<bool> {
    Ok(launchctl(&["print", &service_target(uid)])?
        .status
        .success())
}

fn ensure_not_disabled(uid: u32) -> Result<()> {
    let output = launchctl(&["print-disabled", &domain_target(uid)])?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        if text
            .lines()
            .any(|line| line.contains(LABEL) && line.contains("true"))
        {
            bail!("{LABEL} is disabled; enable it manually before continuing");
        }
    }
    Ok(())
}

fn launchctl(arguments: &[&str]) -> Result<Output> {
    Command::new("/bin/launchctl")
        .args(arguments)
        .output()
        .context("failed to execute /bin/launchctl")
}

fn domain_target(uid: u32) -> String {
    format!("gui/{uid}")
}

fn service_target(uid: u32) -> String {
    format!("gui/{uid}/{LABEL}")
}

fn concise_stderr(output: &Output) -> String {
    let text = String::from_utf8_lossy(&output.stderr);
    let sanitized: String = text
        .chars()
        .filter(|character| !character.is_control() || *character == ' ')
        .take(512)
        .collect();
    if sanitized.trim().is_empty() {
        format!("exit status {}", output.status)
    } else {
        sanitized.trim().to_owned()
    }
}

fn validate_absolute_regular_executable(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        bail!("service executable path must be absolute");
    }
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("failed to inspect executable {}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        bail!("service executable must be a non-symlink regular file");
    }
    Ok(())
}

fn validate_service_paths(target: &Path, stderr_path: &Path) -> Result<()> {
    if !target.is_absolute() || !stderr_path.is_absolute() {
        bail!("service paths must be absolute");
    }
    validate_target(target)
}

fn validate_target(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        for ancestor in parent.ancestors() {
            match fs::symlink_metadata(ancestor) {
                Ok(metadata) => {
                    if metadata.file_type().is_symlink() {
                        bail!(
                            "refusing symlinked path component at {}",
                            ancestor.display()
                        );
                    }
                    if !metadata.is_dir() {
                        bail!("expected a directory at {}", ancestor.display());
                    }
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    Ok(())
}

fn write_private_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(unix)]
fn set_private_directory(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(target_os = "macos")]
#[allow(clippy::unnecessary_wraps)]
fn platform_check() -> Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn platform_check() -> Result<()> {
    bail!("wrkpad service management is currently supported only on macOS")
}

struct ServiceLock {
    path: PathBuf,
}

impl ServiceLock {
    fn acquire(paths: &Paths) -> Result<Self> {
        paths.ensure()?;
        let path = paths.root.join("service.lock");
        write_private_new(&path, format!("{}\n", std::process::id()).as_bytes())
            .context("another wrkpad service mutation may be in progress")?;
        Ok(Self { path })
    }
}

impl Drop for ServiceLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use tempfile::tempdir;

    use super::{
        LABEL, ServiceAction, StartTransition, is_owned_plist, plan, render_plist,
        start_transition, target_path,
    };

    fn executable(root: &Path) -> anyhow::Result<PathBuf> {
        let path = root.join("wrkpad-bin");
        fs::write(&path, b"binary")?;
        Ok(path)
    }

    #[test]
    fn exact_plist_has_no_secret_shell_or_environment() -> anyhow::Result<()> {
        let directory = tempdir()?;
        let executable = executable(directory.path())?;
        let stderr = directory.path().join("service.stderr.log");
        let bytes = render_plist(&executable, &stderr)?;
        let text = String::from_utf8(bytes.clone())?;
        assert!(is_owned_plist(&bytes, &executable, &stderr));
        assert!(text.contains("<string>serve</string>"));
        assert!(text.contains("<integer>63</integer>"));
        assert!(text.contains("<integer>30</integer>"));
        assert!(!text.contains("auth.token"));
        assert!(!text.contains("EnvironmentVariables"));
        assert!(!text.contains("/bin/sh"));
        let different = directory.path().join("different-wrkpad");
        fs::write(&different, b"binary")?;
        assert!(!is_owned_plist(&bytes, &different, &stderr));
        Ok(())
    }

    #[test]
    fn fresh_start_bootstraps_and_loaded_start_kickstarts() {
        assert_eq!(start_transition(false), StartTransition::Bootstrap);
        assert_eq!(start_transition(true), StartTransition::Kickstart);
    }

    #[test]
    fn plan_refuses_a_plist_owned_by_a_different_executable() -> anyhow::Result<()> {
        if !cfg!(target_os = "macos") {
            return Ok(());
        }
        let directory = tempdir()?;
        let target = target_path(directory.path());
        let first = executable(directory.path())?;
        let second = directory.path().join("second-wrkpad");
        fs::write(&second, b"binary")?;
        let stderr = directory.path().join("service.stderr.log");
        fs::create_dir_all(target.parent().unwrap_or(directory.path()))?;
        fs::write(&target, render_plist(&first, &stderr)?)?;
        assert!(plan(ServiceAction::Repair, target, &second, &stderr).is_err());
        Ok(())
    }

    #[test]
    fn content_bound_plan_changes_with_source() -> anyhow::Result<()> {
        if !cfg!(target_os = "macos") {
            return Ok(());
        }
        let directory = tempdir()?;
        let target = target_path(directory.path());
        let executable = executable(directory.path())?;
        let stderr = directory.path().join("service.stderr.log");
        let first = plan(ServiceAction::Install, target.clone(), &executable, &stderr)?;
        fs::create_dir_all(target.parent().unwrap_or(directory.path()))?;
        fs::write(&target, render_plist(&executable, &stderr)?)?;
        let second = plan(ServiceAction::Install, target, &executable, &stderr)?;
        assert_ne!(first.plan_id, second.plan_id);
        assert_eq!(first.outcome, "install");
        assert_eq!(second.outcome, "unchanged");
        Ok(())
    }

    #[test]
    fn refuses_foreign_or_symlinked_target() -> anyhow::Result<()> {
        if !cfg!(target_os = "macos") {
            return Ok(());
        }
        let directory = tempdir()?;
        let target = target_path(directory.path());
        let executable = executable(directory.path())?;
        let stderr = directory.path().join("service.stderr.log");
        fs::create_dir_all(target.parent().unwrap_or(directory.path()))?;
        fs::write(
            &target,
            format!("<plist><dict><key>Label</key><string>{LABEL}</string></dict></plist>"),
        )?;
        assert!(plan(ServiceAction::Repair, target.clone(), &executable, &stderr).is_err());
        fs::remove_file(&target)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let foreign = directory.path().join("foreign");
            fs::write(&foreign, b"foreign")?;
            symlink(&foreign, &target)?;
            assert!(plan(ServiceAction::Install, target, &executable, &stderr).is_err());
        }
        Ok(())
    }
}
