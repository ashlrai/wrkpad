use std::io::{self, Read};
use std::net::SocketAddr;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use directories::BaseDirs;
use tracing_subscriber::EnvFilter;
use wrkpad::client::HaspClient;
use wrkpad::commissioner::CommissionerStatus;
use wrkpad::config::Paths;
use wrkpad::doctor::DoctorReport;
use wrkpad::engine::StateEngine;
use wrkpad::hook_config::{HookAction, HookPlan, HookProvider, HookScope};
use wrkpad::hooks::normalize;
use wrkpad::lighting::BlackOpaqueProfile;
use wrkpad::model::{EventKind, HaspEvent, Provider};
use wrkpad::occupancy::{OccupancyMode, OccupancyState, TransitionEvidence};
use wrkpad::service::{ServiceAction, ServicePlan};
use wrkpad::storage::JsonStore;

#[derive(Debug, Parser)]
#[command(
    name = "wrkpad",
    version,
    about = "Local-first agent status for Work Louder Micro hardware",
    long_about = None
)]
struct Cli {
    #[arg(long, env = "WRKPAD_ENDPOINT", default_value = wrkpad::DEFAULT_ENDPOINT)]
    endpoint: String,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Create the private local token and state directory.
    Init,
    /// Inspect hardware, tools, likely competing owners, and write blockers.
    Doctor {
        #[arg(long)]
        json: bool,
        #[arg(
            long,
            help = "Include descriptor-only HID evidence; no live input reports are read"
        )]
        dump_hid: bool,
    },
    /// Run the authenticated loopback HASP server.
    Serve {
        #[arg(long, default_value = "127.0.0.1:43187")]
        bind: SocketAddr,
    },
    /// Print the current six-slot state from the local HASP server.
    Status {
        #[arg(long)]
        json: bool,
    },
    /// Forget one local status slot without controlling the underlying agent.
    Forget {
        /// Agent-key index from 0 through 5 (AG00 through AG05).
        #[arg(value_parser = clap::value_parser!(u8).range(0..=5))]
        agent_key: u8,
    },
    /// Run the terminal dashboard. Press q or Escape to exit.
    #[command(visible_alias = "dashboard")]
    Tui,
    /// Ingest one Claude or Codex hook from standard input.
    Hook {
        #[arg(long, value_enum)]
        provider: ProviderArg,
        #[arg(long)]
        event: Option<String>,
        /// Ownership marker used by the managed hook lifecycle.
        #[arg(long, hide = true, value_parser = ["dev.wrkpad.hook-v1"])]
        managed_by: Option<String>,
    },
    /// Inspect or transactionally manage Claude and Codex lifecycle observers.
    Hooks {
        #[command(subcommand)]
        command: HooksCommand,
    },
    /// Manage the fixed per-user macOS HASP `LaunchAgent`.
    Service {
        #[command(subcommand)]
        command: ServiceCommand,
    },
    /// Inspect the opt-in, rollback-first agent commissioning boundary.
    Commissioner {
        #[command(subcommand)]
        command: CommissionerCommand,
    },
    /// Render all six semantic states without touching hardware.
    Demo {
        #[arg(long)]
        json: bool,
    },
    /// Inspect or request an occupancy transition.
    Occupancy {
        #[command(subcommand)]
        command: OccupancyCommand,
    },
    /// Print the proposed black-opaque palette.
    Palette,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum ProviderArg {
    Claude,
    Codex,
    CodexNotify,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum HookProviderArg {
    Codex,
    Claude,
}

impl From<HookProviderArg> for HookProvider {
    fn from(value: HookProviderArg) -> Self {
        match value {
            HookProviderArg::Codex => Self::Codex,
            HookProviderArg::Claude => Self::Claude,
        }
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum HookScopeArg {
    User,
    Project,
}

impl From<HookScopeArg> for HookScope {
    fn from(value: HookScopeArg) -> Self {
        match value {
            HookScopeArg::User => Self::User,
            HookScopeArg::Project => Self::Project,
        }
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum HookActionArg {
    Install,
    Repair,
    Uninstall,
}

impl From<HookActionArg> for HookAction {
    fn from(value: HookActionArg) -> Self {
        match value {
            HookActionArg::Install => Self::Install,
            HookActionArg::Repair => Self::Repair,
            HookActionArg::Uninstall => Self::Uninstall,
        }
    }
}

#[derive(Debug, Subcommand)]
enum HooksCommand {
    /// Read current configuration without changing it.
    Status {
        #[arg(long, value_enum)]
        provider: HookProviderArg,
        #[arg(long, value_enum, default_value = "project")]
        scope: HookScopeArg,
        #[arg(long)]
        json: bool,
    },
    /// Produce a content-bound confirmation plan without writing.
    Plan {
        #[arg(long, value_enum)]
        provider: HookProviderArg,
        #[arg(long, value_enum, default_value = "project")]
        scope: HookScopeArg,
        #[arg(long, value_enum, default_value = "install")]
        action: HookActionArg,
        #[arg(long)]
        json: bool,
    },
    /// Add missing wrkpad handlers, preserving unrelated hooks.
    Install {
        #[arg(long, value_enum)]
        provider: HookProviderArg,
        #[arg(long, value_enum, default_value = "project")]
        scope: HookScopeArg,
        #[arg(long)]
        confirm: String,
    },
    /// Replace only stale or duplicate wrkpad handlers.
    Repair {
        #[arg(long, value_enum)]
        provider: HookProviderArg,
        #[arg(long, value_enum, default_value = "project")]
        scope: HookScopeArg,
        #[arg(long)]
        confirm: String,
    },
    /// Remove only wrkpad-owned handlers.
    Uninstall {
        #[arg(long, value_enum)]
        provider: HookProviderArg,
        #[arg(long, value_enum, default_value = "project")]
        scope: HookScopeArg,
        #[arg(long)]
        confirm: String,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum ServiceActionArg {
    Install,
    Repair,
    Uninstall,
    Start,
    Stop,
    Restart,
}

impl From<ServiceActionArg> for ServiceAction {
    fn from(value: ServiceActionArg) -> Self {
        match value {
            ServiceActionArg::Install => Self::Install,
            ServiceActionArg::Repair => Self::Repair,
            ServiceActionArg::Uninstall => Self::Uninstall,
            ServiceActionArg::Start => Self::Start,
            ServiceActionArg::Stop => Self::Stop,
            ServiceActionArg::Restart => Self::Restart,
        }
    }
}

#[derive(Debug, Subcommand)]
enum ServiceCommand {
    /// Inspect the plist, launchd state, and authenticated HASP health.
    Status {
        #[arg(long)]
        json: bool,
    },
    /// Produce a content-bound confirmation plan without changing service state.
    Plan {
        #[arg(long, value_enum, default_value = "install")]
        action: ServiceActionArg,
        #[arg(long)]
        json: bool,
    },
    /// Install and start the exact wrkpad per-user `LaunchAgent`.
    Install {
        #[arg(long)]
        confirm: String,
    },
    /// Replace only a recognized wrkpad `LaunchAgent`, then verify health.
    Repair {
        #[arg(long)]
        confirm: String,
    },
    /// Unload and remove only the owned plist, preserving data and hooks.
    Uninstall {
        #[arg(long)]
        confirm: String,
    },
    /// Load the installed `LaunchAgent` and verify authenticated health.
    Start {
        #[arg(long)]
        confirm: String,
    },
    /// Unload the `LaunchAgent` without deleting its plist or data.
    Stop {
        #[arg(long)]
        confirm: String,
    },
    /// Unload, reload, and verify authenticated health.
    Restart {
        #[arg(long)]
        confirm: String,
    },
}

#[derive(Debug, Subcommand)]
enum CommissionerCommand {
    /// Report enrollment and transaction state without opening an executor.
    Status {
        #[arg(long)]
        json: bool,
    },
}

impl ProviderArg {
    const fn provider(self) -> Provider {
        match self {
            Self::Claude => Provider::Claude,
            Self::Codex | Self::CodexNotify => Provider::Codex,
        }
    }
}

#[derive(Debug, Subcommand)]
enum OccupancyCommand {
    Status,
    Observe,
    Shadow,
    Takeover {
        #[arg(long)]
        confirm_exclusive: bool,
    },
    Release,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn")),
        )
        .with_writer(io::stderr)
        .init();
    let cli = Cli::parse();
    let paths = Paths::discover()?;

    match cli.command {
        Command::Init => {
            paths.ensure_token()?;
            println!("wrkpad initialized at {}", paths.root.display());
        }
        Command::Doctor { json, dump_hid } => print_doctor(wrkpad::doctor::run(), json, dump_hid)?,
        Command::Serve { bind } => {
            let token = paths.ensure_token()?;
            let store = JsonStore::new(paths.state.clone());
            wrkpad::server::serve(bind, token, store).await?;
        }
        Command::Status { json } => {
            let snapshot = client(&paths, &cli.endpoint)?.snapshot().await?;
            if json {
                println!("{}", serde_json::to_string_pretty(&snapshot)?);
            } else {
                print_snapshot(&snapshot);
            }
        }
        Command::Forget { agent_key } => {
            let snapshot = client(&paths, &cli.endpoint)?
                .forget_slot(agent_key)
                .await?;
            println!(
                "forgot AG{agent_key:02}; HASP revision {}",
                snapshot.revision
            );
        }
        Command::Tui => wrkpad::tui::run(client(&paths, &cli.endpoint)?).await?,
        Command::Hook {
            provider,
            event,
            managed_by: _,
        } => {
            if let Err(error) = ingest_hook(&paths, &cli.endpoint, provider, event.as_deref()).await
            {
                tracing::warn!(%error, "wrkpad hook observer failed open");
            }
        }
        Command::Hooks { command } => manage_hooks(&paths, command)?,
        Command::Service { command } => {
            manage_service(&paths, &cli.endpoint, command).await?;
        }
        Command::Commissioner { command } => manage_commissioner(&paths, command)?,
        Command::Demo { json } => demo(json)?,
        Command::Occupancy { command } => occupancy(&paths, command)?,
        Command::Palette => {
            let palette = serde_json::json!({
                "schema": "dev.wrkpad.palette/v1",
                "profile": "black-opaque",
                "calibration": "proposed; physical acceptance required",
                "error": BlackOpaqueProfile::ERROR.hex(),
                "needs_input": BlackOpaqueProfile::NEEDS_INPUT.hex(),
                "working": BlackOpaqueProfile::WORKING.hex(),
                "unread": BlackOpaqueProfile::UNREAD.hex(),
                "idle": BlackOpaqueProfile::IDLE.hex(),
                "off": "#000000",
            });
            println!("{}", serde_json::to_string_pretty(&palette)?);
        }
    }
    Ok(())
}

fn manage_commissioner(paths: &Paths, command: CommissionerCommand) -> Result<()> {
    match command {
        CommissionerCommand::Status { json } => {
            let status = wrkpad::commissioner::status(&paths.root, chrono::Utc::now());
            print_commissioner_status(&status, json)?;
        }
    }
    Ok(())
}

fn print_commissioner_status(status: &CommissionerStatus, json: bool) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string_pretty(status)?);
        return Ok(());
    }
    println!("wrkpad commissioner · {}", status.reason);
    println!("  route: {}", status.route);
    println!("  enrollment: {:?}", status.enrollment);
    println!("  transaction: {:?}", status.transaction);
    println!("  executor: {:?}", status.executor);
    println!("  device mutation available: {}", status.mutation_available);
    println!(
        "  firmware writes available: {}",
        status.firmware_writes_available
    );
    Ok(())
}

fn manage_hooks(paths: &Paths, command: HooksCommand) -> Result<()> {
    let workspace = wrkpad::hook_config::project_root(&std::env::current_dir()?);
    let home = BaseDirs::new()
        .context("could not determine the current user's home directory")?
        .home_dir()
        .to_path_buf();
    let executable = std::env::current_exe()?.canonicalize()?;
    let (provider_arg, scope_arg, action, confirm, json) = match command {
        HooksCommand::Status {
            provider,
            scope,
            json,
        } => (provider, scope, HookAction::Install, None, json),
        HooksCommand::Plan {
            provider,
            scope,
            action,
            json,
        } => (provider, scope, action.into(), None, json),
        HooksCommand::Install {
            provider,
            scope,
            confirm,
        } => (provider, scope, HookAction::Install, Some(confirm), true),
        HooksCommand::Repair {
            provider,
            scope,
            confirm,
        } => (provider, scope, HookAction::Repair, Some(confirm), true),
        HooksCommand::Uninstall {
            provider,
            scope,
            confirm,
        } => (provider, scope, HookAction::Uninstall, Some(confirm), true),
    };
    let provider = HookProvider::from(provider_arg);
    let scope = HookScope::from(scope_arg);
    let target = wrkpad::hook_config::target_path(provider, scope, &workspace, &home);
    let result = if let Some(plan_id) = confirm {
        wrkpad::hook_config::apply(
            provider,
            scope,
            action,
            target,
            &executable,
            &paths.root.join("hook-backups"),
            &plan_id,
        )?
    } else {
        wrkpad::hook_config::plan(provider, scope, action, target, &executable)?
    };
    print_hook_plan(&result, json)?;
    Ok(())
}

fn print_hook_plan(plan: &HookPlan, json: bool) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string_pretty(plan)?);
        return Ok(());
    }
    println!("wrkpad hooks · {:?} {:?}", plan.provider, plan.scope);
    println!("  target: {}", plan.target.display());
    println!("  outcome: {}", plan.outcome);
    println!(
        "  handlers: {}/{} exact · {} stale/duplicate · {} unrelated",
        plan.exact_handlers,
        plan.expected_handlers,
        plan.stale_or_duplicate_handlers,
        plan.unrelated_handlers
    );
    println!("  trust: {}", plan.trust);
    println!("  plan id: {}", plan.plan_id);
    for warning in &plan.warnings {
        println!("  warning: {warning}");
    }
    Ok(())
}

async fn manage_service(paths: &Paths, endpoint: &str, command: ServiceCommand) -> Result<()> {
    anyhow::ensure!(
        endpoint == wrkpad::DEFAULT_ENDPOINT,
        "managed service requires the fixed endpoint {}",
        wrkpad::DEFAULT_ENDPOINT
    );
    anyhow::ensure!(
        std::env::var_os("WRKPAD_HOME").is_none(),
        "managed service refuses WRKPAD_HOME; use the standard per-user data directory"
    );
    let base = BaseDirs::new().context("could not determine the current user's home directory")?;
    let home = base.home_dir();
    let target = wrkpad::service::target_path(home);
    let executable = std::env::current_exe()?.canonicalize()?;
    let uid = manager_uid(home)?;
    if let ServiceCommand::Status { json } = command {
        let status = wrkpad::service::status(target, &executable, paths, uid).await?;
        if json {
            println!("{}", serde_json::to_string_pretty(&status)?);
        } else {
            println!("wrkpad service · {}", status.detail);
            println!("  target: {}", status.target.display());
            println!(
                "  installed={} owned={} loaded={} healthy={}",
                status.installed, status.owned, status.loaded, status.healthy
            );
        }
        return Ok(());
    }
    let (action, confirm, json) = match command {
        ServiceCommand::Status { .. } => unreachable!(),
        ServiceCommand::Plan { action, json } => (action.into(), None, json),
        ServiceCommand::Install { confirm } => (ServiceAction::Install, Some(confirm), true),
        ServiceCommand::Repair { confirm } => (ServiceAction::Repair, Some(confirm), true),
        ServiceCommand::Uninstall { confirm } => (ServiceAction::Uninstall, Some(confirm), true),
        ServiceCommand::Start { confirm } => (ServiceAction::Start, Some(confirm), true),
        ServiceCommand::Stop { confirm } => (ServiceAction::Stop, Some(confirm), true),
        ServiceCommand::Restart { confirm } => (ServiceAction::Restart, Some(confirm), true),
    };
    let result = if let Some(plan_id) = confirm {
        wrkpad::service::apply(action, target, &executable, paths, uid, &plan_id).await?
    } else {
        wrkpad::service::plan(
            action,
            target,
            &executable,
            &paths.root.join("service.stderr.log"),
        )?
    };
    print_service_plan(&result, json)?;
    Ok(())
}

fn print_service_plan(plan: &ServicePlan, json: bool) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string_pretty(plan)?);
        return Ok(());
    }
    println!("wrkpad service · {:?}", plan.action);
    println!("  target: {}", plan.target.display());
    println!("  outcome: {}", plan.outcome);
    println!(
        "  present={} owned={}",
        plan.target_exists, plan.target_owned
    );
    println!("  plan id: {}", plan.plan_id);
    for warning in &plan.warnings {
        println!("  warning: {warning}");
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn manager_uid(home: &std::path::Path) -> Result<u32> {
    use std::os::unix::fs::MetadataExt;
    Ok(std::fs::metadata(home)?.uid())
}

#[cfg(not(target_os = "macos"))]
fn manager_uid(_home: &std::path::Path) -> Result<u32> {
    anyhow::bail!("wrkpad service management is currently supported only on macOS")
}

fn client(paths: &Paths, endpoint: &str) -> Result<HaspClient> {
    HaspClient::new(endpoint, paths.read_token()?)
}

async fn ingest_hook(
    paths: &Paths,
    endpoint: &str,
    provider: ProviderArg,
    event: Option<&str>,
) -> Result<()> {
    let mut bytes = Vec::new();
    io::stdin().take(1024 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 1024 * 1024 {
        anyhow::bail!("hook payload exceeded 1 MiB");
    }
    let payload: serde_json::Value = serde_json::from_slice(&bytes).context("invalid hook JSON")?;
    let declared = if matches!(provider, ProviderArg::CodexNotify) {
        Some("agent-turn-complete")
    } else {
        event
    };
    if let Some(normalized) = normalize(provider.provider(), declared, &payload)? {
        client(paths, endpoint)?.ingest(&normalized).await?;
    }
    Ok(())
}

fn print_doctor(report: DoctorReport, json: bool, dump_hid: bool) -> Result<()> {
    if dump_hid {
        let descriptor = report
            .hid_registry
            .relevant_matches
            .iter()
            .find(|identity| identity.report_descriptor_sha256.is_some());
        let status = if descriptor.is_some() {
            "captured_read_only"
        } else if report.devices.is_empty() {
            "unavailable_no_relevant_hid"
        } else {
            "unavailable_no_registry_descriptor"
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "schema": "dev.wrkpad.hid-evidence/v2",
                "doctor": report,
                "descriptor_capture": {
                    "status": status,
                    "source": descriptor.map(|_| "ioreg_xml_apple_user_usb_host_hid_device"),
                    "device_open_attempted": false,
                    "reports_read": 0,
                    "reports_written": 0,
                    "vendor_id": descriptor.map(|identity| identity.vendor_id),
                    "product_id": descriptor.map(|identity| identity.product_id),
                    "transport": descriptor.and_then(|identity| identity.transport.as_deref()),
                    "descriptor_sha256": descriptor.and_then(|identity| identity.report_descriptor_sha256.as_deref()),
                    "descriptor_byte_length": descriptor.and_then(|identity| identity.report_descriptor_byte_length),
                    "usb_device_version_raw": descriptor.and_then(|identity| identity.usb_device_version_raw),
                    "firmware_version": null,
                    "note": "descriptor read from the macOS IORegistry property list; USB bcdDevice is retained as a raw value and is not firmware acceptance"
                }
            }))?
        );
        return Ok(());
    }
    if json {
        println!("{}", serde_json::to_string_pretty(&report)?);
        return Ok(());
    }
    println!("wrkpad doctor · software observer ready");
    println!("  physical: {:?}", report.physical_conclusion);
    println!(
        "  probes: USB={:?} HID={:?} device_observer_ready={}",
        report.usb.status, report.hid_probe_status, report.device_observer_ready
    );
    if let Some(disagreement) = &report.registry_disagreement {
        println!("  registry disagreement: {disagreement}");
    }
    println!("  devices: {}", report.devices.len());
    for device in &report.devices {
        println!(
            "  - {:04X}:{:04X} {:?} usage {:04X}:{:04X} · writes disabled",
            device.vendor_id, device.product_id, device.generation, device.usage_page, device.usage
        );
    }
    println!(
        "  likely owners: ChatGPT={} Input={} Logitech={} Karabiner={}",
        report.owners.chatgpt,
        report.owners.work_louder_input,
        report.owners.logitech,
        report.owners.karabiner
    );
    println!("  shadow blockers:");
    for blocker in &report.shadow_blockers {
        println!("    - {blocker}");
    }
    println!("  takeover blockers:");
    for blocker in &report.takeover_blockers {
        println!("    - {blocker}");
    }
    Ok(())
}

fn print_snapshot(snapshot: &wrkpad::model::BoardSnapshot) {
    println!("wrkpad HASP revision {}", snapshot.revision);
    for slot in &snapshot.slots {
        if let Some(session) = &slot.session {
            println!(
                "  AG{:02}  {:<12?} {:<7?} {}",
                slot.slot - 1,
                session.state,
                session.provider,
                session.title.as_deref().unwrap_or("Agent session")
            );
        } else {
            println!("  AG{:02}  off", slot.slot - 1);
        }
    }
}

fn demo(json: bool) -> Result<()> {
    let mut engine = StateEngine::default();
    let events = [
        ("error", EventKind::Error),
        ("needs-input", EventKind::NeedsInput),
        ("working", EventKind::Working),
        ("unread", EventKind::Notification),
        ("idle", EventKind::SessionStart),
        ("off", EventKind::SessionEnd),
    ];
    for (name, kind) in events {
        let mut event = HaspEvent::new(Provider::Manual, name, kind);
        event.title = Some(name.replace('-', " "));
        engine.apply(event)?;
    }
    let snapshot = engine.snapshot();
    let frame = BlackOpaqueProfile::render(&snapshot);
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "snapshot": snapshot,
                "desired_lighting": frame,
                "hardware_applied": false,
            }))?
        );
    } else {
        print_snapshot(&snapshot);
        println!("desired black-opaque lighting:");
        for (index, color) in frame.agent_keys.iter().enumerate() {
            println!("  AG{index:02}  {}", color.hex());
        }
        println!("hardware applied: false");
    }
    Ok(())
}

fn occupancy(paths: &Paths, command: OccupancyCommand) -> Result<()> {
    let store = JsonStore::new(paths.occupancy.clone());
    let current: OccupancyState = store.load()?;
    if matches!(command, OccupancyCommand::Status) {
        println!("{}", serde_json::to_string_pretty(&current)?);
        return Ok(());
    }
    let report = wrkpad::doctor::run();
    let evidence = TransitionEvidence {
        device_present: report
            .devices
            .iter()
            .any(|device| device.current_generation_candidate),
        descriptor_known: false,
        firmware_known: false,
        transport_verified: false,
        active_oai_layer_verified: false,
        competing_writer_running: report.owners.likely_writer_running(),
        local_lease_available: !paths.lease.exists(),
        explicit_human_confirmation: matches!(
            command,
            OccupancyCommand::Takeover {
                confirm_exclusive: true
            }
        ),
    };
    let target = match command {
        OccupancyCommand::Status | OccupancyCommand::Observe => OccupancyMode::Observe,
        OccupancyCommand::Shadow => OccupancyMode::Shadow,
        OccupancyCommand::Takeover { .. } => OccupancyMode::Takeover,
        OccupancyCommand::Release => OccupancyMode::Release,
    };
    let next = current.transition(target, evidence)?;
    store.save(&next)?;
    println!("{}", serde_json::to_string_pretty(&next)?);
    Ok(())
}
