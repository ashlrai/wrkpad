use std::io::{self, Read};
use std::net::SocketAddr;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use tracing_subscriber::EnvFilter;
use wrkpad::client::HaspClient;
use wrkpad::config::Paths;
use wrkpad::doctor::DoctorReport;
use wrkpad::engine::StateEngine;
use wrkpad::hooks::normalize;
use wrkpad::lighting::BlackOpaqueProfile;
use wrkpad::model::{EventKind, HaspEvent, Provider};
use wrkpad::occupancy::{OccupancyMode, OccupancyState, TransitionEvidence};
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
        #[arg(long)]
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
    /// Run the terminal dashboard. Press q or Escape to exit.
    Tui,
    /// Ingest one Claude or Codex hook from standard input.
    Hook {
        #[arg(long, value_enum)]
        provider: ProviderArg,
        #[arg(long)]
        event: Option<String>,
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
        Command::Tui => wrkpad::tui::run(client(&paths, &cli.endpoint)?).await?,
        Command::Hook { provider, event } => {
            if let Err(error) = ingest_hook(&paths, &cli.endpoint, provider, event.as_deref()).await
            {
                tracing::warn!(%error, "wrkpad hook observer failed open");
            }
        }
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
    if json || dump_hid {
        println!("{}", serde_json::to_string_pretty(&report)?);
        return Ok(());
    }
    println!("wrkpad doctor · observe ready");
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
