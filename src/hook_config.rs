use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const OWNER_MARKER: &str = "dev.wrkpad.hook-v1";
const MAX_HOOK_CONFIG_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookProvider {
    Codex,
    Claude,
}

impl HookProvider {
    const fn argument(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookScope {
    User,
    Project,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookAction {
    Install,
    Repair,
    Uninstall,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HookPlan {
    pub schema: String,
    pub provider: HookProvider,
    pub scope: HookScope,
    pub action: HookAction,
    pub target: PathBuf,
    pub target_exists: bool,
    pub target_sha256: Option<String>,
    pub proposed_sha256: String,
    pub plan_id: String,
    pub expected_handlers: usize,
    pub exact_handlers: usize,
    pub stale_or_duplicate_handlers: usize,
    pub unrelated_handlers: usize,
    pub outcome: String,
    pub trust: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct HookSpec {
    event: &'static str,
    matcher: Option<&'static str>,
}

#[must_use]
pub fn target_path(
    provider: HookProvider,
    scope: HookScope,
    workspace: &Path,
    home: &Path,
) -> PathBuf {
    match (provider, scope) {
        (HookProvider::Codex, HookScope::User) => home.join(".codex/hooks.json"),
        (HookProvider::Codex, HookScope::Project) => workspace.join(".codex/hooks.json"),
        (HookProvider::Claude, HookScope::User) => home.join(".claude/settings.json"),
        (HookProvider::Claude, HookScope::Project) => workspace.join(".claude/settings.local.json"),
    }
}

#[must_use]
pub fn project_root(start: &Path) -> PathBuf {
    start
        .ancestors()
        .find(|candidate| candidate.join(".git").exists())
        .unwrap_or(start)
        .to_path_buf()
}

pub fn plan(
    provider: HookProvider,
    scope: HookScope,
    action: HookAction,
    target: PathBuf,
    executable: &Path,
) -> Result<HookPlan> {
    let (mut document, bytes) = read_document(&target)?;
    let target_exists = bytes.is_some();
    let target_sha256 = bytes.as_deref().map(sha256);
    let command = hook_command(executable, provider)?;
    let specs = specs(provider);
    let inventory = inventory(&document, provider, &command, &specs);
    let mut warnings = Vec::new();
    if scope == HookScope::Project {
        warnings.push(
            "project hook contains this machine's absolute executable path; do not commit it"
                .to_owned(),
        );
    }
    if provider == HookProvider::Codex {
        warnings.push(
            "Codex trust remains unknown until the exact definition is reviewed in /hooks"
                .to_owned(),
        );
        if inventory.unrelated > 0 {
            warnings.push(format!(
                "Codex trust is per hook definition; {} unrelated handler(s) share this file. Never choose `Trust all and continue`; review and trust only commands ending `--managed-by dev.wrkpad.hook-v1`",
                inventory.unrelated
            ));
        }
        if has_inline_codex_hooks(&target)? {
            warnings.push(
                "the adjacent config.toml contains inline hooks; review mixed hook sources"
                    .to_owned(),
            );
        }
    }
    let outcome = outcome(action, &inventory, specs.len());

    // The confirmation binds the exact canonical result, not only the source file.
    transform(&mut document, provider, action, &command, &specs)?;
    let proposed_sha256 = sha256(&serde_json::to_vec(&document)?);
    let seed = json!({
        "provider": provider,
        "scope": scope,
        "action": action,
        "target": target,
        "target_sha256": target_sha256,
        "command": command,
        "outcome": outcome,
        "proposed_sha256": proposed_sha256,
    });
    let plan_id = sha256(&serde_json::to_vec(&seed)?);

    Ok(HookPlan {
        schema: "dev.wrkpad.hooks.plan/v1".to_owned(),
        provider,
        scope,
        action,
        target,
        target_exists,
        target_sha256,
        proposed_sha256,
        plan_id,
        expected_handlers: specs.len(),
        exact_handlers: inventory.exact,
        stale_or_duplicate_handlers: inventory.stale,
        unrelated_handlers: inventory.unrelated,
        outcome,
        trust: "untrusted_or_unknown".to_owned(),
        warnings,
    })
}

pub fn apply(
    provider: HookProvider,
    scope: HookScope,
    action: HookAction,
    target: PathBuf,
    executable: &Path,
    backup_root: &Path,
    confirmed_plan_id: &str,
) -> Result<HookPlan> {
    let _lock = HookLock::acquire(&target)?;
    let current_plan = plan(provider, scope, action, target.clone(), executable)?;
    if current_plan.plan_id != confirmed_plan_id {
        bail!("hook plan is stale; run `wrkpad hooks plan` again");
    }
    if current_plan.outcome == "repair_required" {
        bail!("stale or duplicate wrkpad handlers require the repair action");
    }
    if current_plan.outcome == "unchanged" || current_plan.outcome == "not_configured" {
        return Ok(current_plan);
    }

    let (mut document, original) = read_document(&target)?;
    let original_hash = original.as_deref().map(sha256);
    if original_hash != current_plan.target_sha256 {
        bail!("hook target changed after planning; no write was performed");
    }
    let command = hook_command(executable, provider)?;
    transform(&mut document, provider, action, &command, &specs(provider))?;
    if let Some(bytes) = original.as_deref() {
        write_backup(backup_root, provider, bytes)?;
    }
    write_atomic_json(&target, &document, original_hash.as_deref())?;
    let verified = read_document(&target)?.0;
    if verified != document {
        bail!("hook target verification failed after atomic replacement");
    }
    plan(provider, scope, action, target, executable)
}

#[derive(Default)]
struct Inventory {
    exact: usize,
    stale: usize,
    unrelated: usize,
}

fn inventory(
    document: &Value,
    provider: HookProvider,
    command: &str,
    specs: &[HookSpec],
) -> Inventory {
    let mut result = Inventory::default();
    let mut satisfied = HashSet::new();
    let Some(events) = document.get("hooks").and_then(Value::as_object) else {
        return result;
    };
    for (event, groups) in events {
        let Some(groups) = groups.as_array() else {
            continue;
        };
        for group in groups {
            let matcher = group.get("matcher").and_then(Value::as_str);
            let Some(handlers) = group.get("hooks").and_then(Value::as_array) else {
                continue;
            };
            for handler in handlers {
                if is_wrkpad_handler(handler, provider) {
                    let matching_spec = specs.iter().position(|spec| {
                        spec.event == event
                            && matcher.unwrap_or_default() == spec.matcher.unwrap_or_default()
                    });
                    if let Some(index) = matching_spec
                        && is_exact_handler(handler, command)
                        && satisfied.insert(index)
                    {
                        result.exact += 1;
                    } else {
                        result.stale += 1;
                    }
                } else {
                    result.unrelated += 1;
                }
            }
        }
    }
    result
}

fn outcome(action: HookAction, inventory: &Inventory, expected: usize) -> String {
    match action {
        HookAction::Install if inventory.stale > 0 || inventory.exact > expected => {
            "repair_required"
        }
        HookAction::Install if inventory.exact == expected => "unchanged",
        HookAction::Install => "install",
        HookAction::Repair | HookAction::Uninstall if inventory.exact + inventory.stale == 0 => {
            "not_configured"
        }
        HookAction::Repair if inventory.exact == expected && inventory.stale == 0 => "unchanged",
        HookAction::Repair => "repair",
        HookAction::Uninstall => "uninstall",
    }
    .to_owned()
}

fn transform(
    document: &mut Value,
    provider: HookProvider,
    action: HookAction,
    command: &str,
    specs: &[HookSpec],
) -> Result<()> {
    let root = document
        .as_object_mut()
        .context("hook configuration must contain a JSON object")?;
    if matches!(action, HookAction::Repair | HookAction::Uninstall) {
        remove_wrkpad_handlers(root, provider);
    }
    if matches!(action, HookAction::Install | HookAction::Repair) {
        let hooks = root
            .entry("hooks")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .context("the top-level hooks value must be an object")?;
        for spec in specs {
            add_spec(hooks, spec, command)?;
        }
    }
    Ok(())
}

fn add_spec(hooks: &mut Map<String, Value>, spec: &HookSpec, command: &str) -> Result<()> {
    let groups = hooks
        .entry(spec.event)
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .with_context(|| format!("hook event {} must contain an array", spec.event))?;
    if groups.iter().any(|group| {
        group
            .get("matcher")
            .and_then(Value::as_str)
            .unwrap_or_default()
            == spec.matcher.unwrap_or_default()
            && group
                .get("hooks")
                .and_then(Value::as_array)
                .is_some_and(|handlers| handlers.iter().any(|item| is_exact_handler(item, command)))
    }) {
        return Ok(());
    }
    let handler = json!({"type": "command", "command": command, "timeout": 2});
    if let Some(group) = groups.iter_mut().find(|group| {
        group
            .get("matcher")
            .and_then(Value::as_str)
            .unwrap_or_default()
            == spec.matcher.unwrap_or_default()
    }) {
        let handlers = group
            .get_mut("hooks")
            .and_then(Value::as_array_mut)
            .context("hook matcher group must contain a hooks array")?;
        handlers.push(handler);
        return Ok(());
    }
    let mut group = Map::new();
    if let Some(matcher) = spec.matcher {
        group.insert("matcher".to_owned(), Value::String(matcher.to_owned()));
    }
    group.insert("hooks".to_owned(), Value::Array(vec![handler]));
    groups.push(Value::Object(group));
    Ok(())
}

fn remove_wrkpad_handlers(root: &mut Map<String, Value>, provider: HookProvider) {
    let Some(events) = root.get_mut("hooks").and_then(Value::as_object_mut) else {
        return;
    };
    events.retain(|_, groups| {
        let Some(groups) = groups.as_array_mut() else {
            return true;
        };
        groups.retain_mut(|group| {
            let Some(handlers) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
                return true;
            };
            handlers.retain(|handler| !is_wrkpad_handler(handler, provider));
            !handlers.is_empty()
        });
        !groups.is_empty()
    });
}

fn is_exact_handler(handler: &Value, command: &str) -> bool {
    handler.as_object().is_some_and(|object| object.len() == 3)
        && handler.get("type").and_then(Value::as_str) == Some("command")
        && handler.get("command").and_then(Value::as_str) == Some(command)
        && handler.get("timeout").and_then(Value::as_u64) == Some(2)
}

fn is_wrkpad_handler(handler: &Value, provider: HookProvider) -> bool {
    let suffix = format!(
        " hook --provider {} --managed-by {OWNER_MARKER}",
        provider.argument()
    );
    handler.get("type").and_then(Value::as_str) == Some("command")
        && handler
            .get("command")
            .and_then(Value::as_str)
            .is_some_and(|command| command.ends_with(&suffix))
}

fn specs(provider: HookProvider) -> Vec<HookSpec> {
    let mut values = match provider {
        HookProvider::Codex => vec![
            HookSpec {
                event: "SessionStart",
                matcher: Some("startup|resume|clear|compact"),
            },
            HookSpec {
                event: "UserPromptSubmit",
                matcher: None,
            },
            HookSpec {
                event: "PermissionRequest",
                matcher: Some("*"),
            },
            HookSpec {
                event: "PostToolUse",
                matcher: None,
            },
            HookSpec {
                event: "Stop",
                matcher: None,
            },
            HookSpec {
                event: "SubagentStart",
                matcher: Some("*"),
            },
            HookSpec {
                event: "SubagentStop",
                matcher: Some("*"),
            },
        ],
        HookProvider::Claude => vec![
            HookSpec {
                event: "SessionStart",
                matcher: Some("startup|resume|clear|compact|fork"),
            },
            HookSpec {
                event: "UserPromptSubmit",
                matcher: None,
            },
            HookSpec {
                event: "PermissionRequest",
                matcher: Some("*"),
            },
            HookSpec {
                event: "PermissionDenied",
                matcher: Some("*"),
            },
            HookSpec {
                event: "Notification",
                matcher: Some(
                    "permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input|idle_prompt|agent_completed",
                ),
            },
            HookSpec {
                event: "PostToolUse",
                matcher: None,
            },
            HookSpec {
                event: "PostToolUseFailure",
                matcher: None,
            },
            HookSpec {
                event: "Stop",
                matcher: None,
            },
            HookSpec {
                event: "StopFailure",
                matcher: None,
            },
            HookSpec {
                event: "SubagentStart",
                matcher: Some("*"),
            },
            HookSpec {
                event: "SubagentStop",
                matcher: Some("*"),
            },
            HookSpec {
                event: "Elicitation",
                matcher: Some("*"),
            },
            HookSpec {
                event: "ElicitationResult",
                matcher: Some("*"),
            },
        ],
    };
    values.push(HookSpec {
        event: "SessionEnd",
        matcher: None,
    });
    values
}

fn hook_command(executable: &Path, provider: HookProvider) -> Result<String> {
    if !executable.is_absolute() {
        bail!("hook executable path must be absolute");
    }
    let executable = executable
        .to_str()
        .context("hook executable path must be valid UTF-8")?;
    Ok(format!(
        "{} hook --provider {} --managed-by {OWNER_MARKER}",
        shell_quote(executable),
        provider.argument()
    ))
}

#[cfg(unix)]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(windows)]
fn shell_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn read_document(path: &Path) -> Result<(Value, Option<Vec<u8>>)> {
    validate_target_path(path)?;
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Value::Object(Map::new()), None));
        }
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() {
        bail!("refusing to follow symlink at {}", path.display());
    }
    if !metadata.is_file() {
        bail!("hook target must be a regular file: {}", path.display());
    }
    anyhow::ensure!(
        metadata.len() <= MAX_HOOK_CONFIG_BYTES,
        "hook configuration exceeds the 4 MiB safety limit"
    );
    let bytes = fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
    let document = serde_json::from_slice(&bytes)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    Ok((document, Some(bytes)))
}

fn write_atomic_json(path: &Path, document: &Value, expected_sha256: Option<&str>) -> Result<()> {
    validate_target_path(path)?;
    let parent = path.parent().context("hook target has no parent")?;
    #[cfg(unix)]
    let parent_existed = parent.exists();
    fs::create_dir_all(parent)?;
    validate_directory_path(parent)?;
    #[cfg(unix)]
    if !parent_existed {
        set_directory_private(parent)?;
    }
    let temporary = parent.join(format!(".wrkpad-hooks-{}.tmp", Uuid::new_v4()));
    let mut bytes = serde_json::to_vec_pretty(document)?;
    bytes.push(b'\n');
    write_private_new(&temporary, &bytes)?;
    #[cfg(unix)]
    if path.exists() {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path)?.permissions().mode();
        fs::set_permissions(&temporary, fs::Permissions::from_mode(mode))?;
    }
    let current = match fs::read(path) {
        Ok(bytes) => Some(sha256(&bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            return Err(error.into());
        }
    };
    if current.as_deref() != expected_sha256 {
        let _ = fs::remove_file(&temporary);
        bail!("hook target changed immediately before replacement; no write was performed");
    }
    fs::rename(&temporary, path)?;
    #[cfg(unix)]
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

fn write_backup(root: &Path, provider: HookProvider, bytes: &[u8]) -> Result<()> {
    validate_directory_path(root)?;
    fs::create_dir_all(root)?;
    validate_directory_path(root)?;
    #[cfg(unix)]
    set_directory_private(root)?;
    let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
    let path = root.join(format!(
        "{}-{timestamp}-{}.json",
        provider.argument(),
        &sha256(bytes)[..12]
    ));
    if !path.exists() {
        write_private_new(&path, bytes)?;
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
fn set_directory_private(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn validate_target_path(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        validate_directory_path(parent)?;
    }
    if let Ok(metadata) = fs::symlink_metadata(path) {
        anyhow::ensure!(
            !metadata.file_type().is_symlink(),
            "refusing to follow symlink at {}",
            path.display()
        );
        anyhow::ensure!(
            metadata.is_file(),
            "hook target must be a regular file: {}",
            path.display()
        );
    }
    Ok(())
}

fn validate_directory_path(path: &Path) -> Result<()> {
    for component in path.ancestors() {
        match fs::symlink_metadata(component) {
            Ok(metadata) => {
                anyhow::ensure!(
                    !metadata.file_type().is_symlink(),
                    "refusing symlinked path component at {}",
                    component.display()
                );
                anyhow::ensure!(
                    metadata.is_dir(),
                    "expected a directory at {}",
                    component.display()
                );
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

struct HookLock {
    path: PathBuf,
}

impl HookLock {
    fn acquire(target: &Path) -> Result<Self> {
        let parent = target.parent().context("hook target has no parent")?;
        validate_directory_path(parent)?;
        fs::create_dir_all(parent)?;
        validate_directory_path(parent)?;
        let path = parent.join(".wrkpad-hooks.lock");
        write_private_new(&path, std::process::id().to_string().as_bytes())
            .context("another wrkpad hook update may be in progress")?;
        Ok(Self { path })
    }
}

impl Drop for HookLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn has_inline_codex_hooks(target: &Path) -> Result<bool> {
    let Some(parent) = target.parent() else {
        return Ok(false);
    };
    let config = parent.join("config.toml");
    if !config.exists() {
        return Ok(false);
    }
    validate_target_path(&config)?;
    let text = fs::read_to_string(config)?;
    Ok(text.lines().any(|line| {
        let line = line.trim();
        line == "[hooks]" || line.starts_with("[[hooks.")
    }))
}

fn sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use tempfile::tempdir;

    use super::{HookAction, HookProvider, HookScope, apply, plan, project_root, specs};

    #[test]
    fn install_is_idempotent_and_uninstall_preserves_unrelated_hooks() -> anyhow::Result<()> {
        let directory = tempdir()?;
        let target = directory.path().join("settings.json");
        std::fs::write(
            &target,
            br#"{"description":"keep","hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"entire hooks claude session-start","timeout":15000}]}]}}"#,
        )?;
        let executable = directory.path().join("path with spaces/wrkpad");
        let backup = directory.path().join("backups");

        let install = plan(
            HookProvider::Claude,
            HookScope::User,
            HookAction::Install,
            target.clone(),
            &executable,
        )?;
        assert_eq!(install.outcome, "install");
        apply(
            HookProvider::Claude,
            HookScope::User,
            HookAction::Install,
            target.clone(),
            &executable,
            &backup,
            &install.plan_id,
        )?;
        let unchanged = plan(
            HookProvider::Claude,
            HookScope::User,
            HookAction::Install,
            target.clone(),
            &executable,
        )?;
        assert_eq!(unchanged.outcome, "unchanged");

        let uninstall = plan(
            HookProvider::Claude,
            HookScope::User,
            HookAction::Uninstall,
            target.clone(),
            &executable,
        )?;
        apply(
            HookProvider::Claude,
            HookScope::User,
            HookAction::Uninstall,
            target.clone(),
            &executable,
            &backup,
            &uninstall.plan_id,
        )?;
        let text = std::fs::read_to_string(target)?;
        assert!(text.contains("entire hooks claude session-start"));
        assert!(!text.contains("hook --provider claude"));
        assert!(backup.read_dir()?.next().is_some());
        Ok(())
    }

    #[test]
    fn stale_confirmation_refuses_concurrent_edits() -> anyhow::Result<()> {
        let directory = tempdir()?;
        let target = directory.path().join("hooks.json");
        let executable = directory.path().join("wrkpad");
        let first = plan(
            HookProvider::Codex,
            HookScope::User,
            HookAction::Install,
            target.clone(),
            &executable,
        )?;
        std::fs::write(&target, b"{\"unrelated\":true}")?;
        let result = apply(
            HookProvider::Codex,
            HookScope::User,
            HookAction::Install,
            target,
            &executable,
            &directory.path().join("backups"),
            &first.plan_id,
        );
        assert!(result.is_err());
        Ok(())
    }

    #[test]
    fn duplicate_cannot_mask_a_missing_required_handler() -> anyhow::Result<()> {
        let directory = tempdir()?;
        let target = directory.path().join("hooks.json");
        let executable = directory.path().join("wrkpad");
        let install = plan(
            HookProvider::Codex,
            HookScope::User,
            HookAction::Install,
            target.clone(),
            &executable,
        )?;
        apply(
            HookProvider::Codex,
            HookScope::User,
            HookAction::Install,
            target.clone(),
            &executable,
            &directory.path().join("backups"),
            &install.plan_id,
        )?;

        let mut document: Value = serde_json::from_slice(&std::fs::read(&target)?)?;
        let hooks = document["hooks"]
            .as_object_mut()
            .ok_or_else(|| anyhow::anyhow!("expected hooks object"))?;
        hooks.remove("SessionEnd");
        let duplicate = hooks["SessionStart"][0]["hooks"][0].clone();
        hooks["SessionStart"][0]["hooks"]
            .as_array_mut()
            .ok_or_else(|| anyhow::anyhow!("expected handler array"))?
            .push(duplicate);
        std::fs::write(&target, serde_json::to_vec_pretty(&document)?)?;

        let result = plan(
            HookProvider::Codex,
            HookScope::User,
            HookAction::Install,
            target,
            &executable,
        )?;
        assert_eq!(result.outcome, "repair_required");
        assert_eq!(result.exact_handlers, result.expected_handlers - 1);
        assert_eq!(result.stale_or_duplicate_handlers, 1);
        Ok(())
    }

    #[test]
    fn behavior_changing_handler_fields_require_repair() -> anyhow::Result<()> {
        let directory = tempdir()?;
        let target = directory.path().join("hooks.json");
        let executable = directory.path().join("wrkpad");
        let install = plan(
            HookProvider::Codex,
            HookScope::User,
            HookAction::Install,
            target.clone(),
            &executable,
        )?;
        apply(
            HookProvider::Codex,
            HookScope::User,
            HookAction::Install,
            target.clone(),
            &executable,
            &directory.path().join("backups"),
            &install.plan_id,
        )?;
        let mut document: Value = serde_json::from_slice(&std::fs::read(&target)?)?;
        document["hooks"]["Stop"][0]["hooks"][0]["async"] = Value::Bool(true);
        std::fs::write(&target, serde_json::to_vec_pretty(&document)?)?;

        let result = plan(
            HookProvider::Codex,
            HookScope::User,
            HookAction::Install,
            target,
            &executable,
        )?;
        assert_eq!(result.outcome, "repair_required");
        assert_eq!(result.exact_handlers, result.expected_handlers - 1);
        assert_eq!(result.stale_or_duplicate_handlers, 1);
        Ok(())
    }

    #[test]
    fn unmarked_near_match_is_never_claimed_or_removed() -> anyhow::Result<()> {
        let directory = tempdir()?;
        let target = directory.path().join("hooks.json");
        let original = br#"{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"/tmp/wrkpad hook --provider codex","timeout":2}]}]}}"#;
        std::fs::write(&target, original)?;
        let executable = directory.path().join("wrkpad");
        let uninstall = plan(
            HookProvider::Codex,
            HookScope::User,
            HookAction::Uninstall,
            target.clone(),
            &executable,
        )?;
        assert_eq!(uninstall.outcome, "not_configured");
        assert!(uninstall.warnings.iter().any(|warning| {
            warning.contains("Never choose `Trust all and continue`")
                && warning.contains("1 unrelated handler(s)")
        }));
        apply(
            HookProvider::Codex,
            HookScope::User,
            HookAction::Uninstall,
            target.clone(),
            &executable,
            &directory.path().join("backups"),
            &uninstall.plan_id,
        )?;
        assert_eq!(std::fs::read(target)?, original);
        Ok(())
    }

    #[test]
    fn repair_refuses_to_install_an_unconfigured_target() -> anyhow::Result<()> {
        let directory = tempdir()?;
        let target = directory.path().join("hooks.json");
        let result = plan(
            HookProvider::Claude,
            HookScope::User,
            HookAction::Repair,
            target.clone(),
            &directory.path().join("wrkpad"),
        )?;
        assert_eq!(result.outcome, "not_configured");
        assert!(!target.exists());
        Ok(())
    }

    #[test]
    fn project_scope_resolves_from_nested_directories() -> anyhow::Result<()> {
        let directory = tempdir()?;
        std::fs::create_dir(directory.path().join(".git"))?;
        let nested = directory.path().join("one/two");
        std::fs::create_dir_all(&nested)?;
        assert_eq!(project_root(&nested), directory.path());
        Ok(())
    }

    #[test]
    fn checked_in_examples_cover_the_canonical_event_specs() -> anyhow::Result<()> {
        for (provider, text) in [
            (
                HookProvider::Codex,
                include_str!("../examples/codex-hooks.json"),
            ),
            (
                HookProvider::Claude,
                include_str!("../examples/claude-hooks.json"),
            ),
        ] {
            let document: Value = serde_json::from_str(text)?;
            let hooks = document["hooks"]
                .as_object()
                .ok_or_else(|| anyhow::anyhow!("expected hooks object"))?;
            let expected = specs(provider);
            assert_eq!(hooks.len(), expected.len());
            for spec in expected {
                let groups = hooks[spec.event]
                    .as_array()
                    .ok_or_else(|| anyhow::anyhow!("missing event {}", spec.event))?;
                let group = groups
                    .iter()
                    .find(|group| {
                        group
                            .get("matcher")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            == spec.matcher.unwrap_or_default()
                    })
                    .ok_or_else(|| anyhow::anyhow!("missing matcher for {}", spec.event))?;
                let handler = &group["hooks"][0];
                assert_eq!(handler["type"], "command");
                assert_eq!(handler["timeout"], 2);
                let command = handler["command"].as_str().unwrap_or_default();
                assert!(command.contains("--managed-by dev.wrkpad.hook-v1"));
            }
        }
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn plan_refuses_symlinked_targets() -> anyhow::Result<()> {
        use std::os::unix::fs::symlink;

        let directory = tempdir()?;
        let target = directory.path().join("hooks.json");
        let real = directory.path().join("real.json");
        std::fs::write(&real, b"{}")?;
        symlink(real, &target)?;
        assert!(
            plan(
                HookProvider::Codex,
                HookScope::User,
                HookAction::Install,
                target,
                &directory.path().join("wrkpad"),
            )
            .is_err()
        );
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn plan_refuses_dangling_and_parent_symlinks() -> anyhow::Result<()> {
        use std::os::unix::fs::symlink;

        let directory = tempdir()?;
        let executable = directory.path().join("wrkpad");
        let dangling = directory.path().join("dangling.json");
        symlink(directory.path().join("missing.json"), &dangling)?;
        assert!(
            plan(
                HookProvider::Codex,
                HookScope::Project,
                HookAction::Install,
                dangling,
                &executable,
            )
            .is_err()
        );

        let outside = tempdir()?;
        let redirected = directory.path().join(".codex");
        symlink(outside.path(), &redirected)?;
        assert!(
            plan(
                HookProvider::Codex,
                HookScope::Project,
                HookAction::Install,
                redirected.join("hooks.json"),
                &executable,
            )
            .is_err()
        );
        Ok(())
    }
}
