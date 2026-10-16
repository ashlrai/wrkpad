const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')
const { runGit } = require('./git-runner.cjs')
const { resolveTool } = require('./tool-resolver.cjs')

const BRIEFS = {
  copy_plan_brief: 'Investigate the current state first. Surface assumptions, risks, and unknowns. Propose a detailed plan with explicit acceptance criteria, safety boundaries, and rollback. Do not implement or perform consequential actions until the architecture is confirmed.',
  copy_test_brief: 'Verify this work end to end. Run the relevant tests, inspect failure and recovery paths, and report exact evidence. Keep source completion separate from deployment, provider activation, and customer acceptance. Do not push, merge, deploy, publish, or approve permissions.',
  copy_review_brief: 'Review this change independently for correctness, security, edge cases, maintainability, regression risk, and completeness. Lead with actionable findings and exact file locations. Do not modify files or perform release actions.',
}

const ACTION_SPECS = {
  open_codex: { safety: 'safe', kind: 'openCodex' },
  open_claude: { safety: 'safe', kind: 'openApp', app: 'Claude' },
  copy_plan_brief: { safety: 'safe', kind: 'copy', text: BRIEFS.copy_plan_brief },
  copy_test_brief: { safety: 'safe', kind: 'copy', text: BRIEFS.copy_test_brief },
  copy_review_brief: { safety: 'safe', kind: 'copy', text: BRIEFS.copy_review_brief },
  fleet_status: { safety: 'safe', kind: 'inspect', executable: 'ashlr', args: ['fleet', 'status', '--json'] },
  fleet_direction: { safety: 'safe', kind: 'inspect', executable: 'ashlr', args: ['fleet', 'direction', '--json'] },
  fleet_doctor: { safety: 'safe', kind: 'inspect', executable: 'ashlr', args: ['fleet', 'doctor', '--json'] },
  git_status: { safety: 'safe', kind: 'gitInspect', args: ['status', '--short', '--branch'] },
  git_diff: { safety: 'safe', kind: 'gitInspect', args: ['diff', '--stat'] },
  git_log: { safety: 'safe', kind: 'gitInspect', args: ['log', '-8', '--oneline', '--decorate'] },
  tool_health: { safety: 'safe', kind: 'toolHealth' },
  start_codex: { safety: 'confirm', kind: 'terminal', command: (workspace) => `codex -C ${shellQuote(workspace)}` },
  resume_codex: { safety: 'confirm', kind: 'terminal', command: (workspace) => `codex -C ${shellQuote(workspace)} resume --last` },
  codex_review: { safety: 'confirm', kind: 'terminal', command: (workspace) => `cd ${shellQuote(workspace)} && codex review --uncommitted` },
  start_claude: { safety: 'confirm', kind: 'terminal', command: (workspace) => `cd ${shellQuote(workspace)} && claude` },
  resume_claude: { safety: 'confirm', kind: 'terminal', command: (workspace) => `cd ${shellQuote(workspace)} && claude --continue` },
  claude_agents: { safety: 'confirm', kind: 'terminal', command: (workspace) => `cd ${shellQuote(workspace)} && claude agents` },
  ashlr_inbox: { safety: 'confirm', kind: 'terminal', command: () => 'ashlr inbox' },
  ashlr_tui: { safety: 'confirm', kind: 'terminal', command: () => 'ashlr tui' },
  run_tests: { safety: 'confirm', kind: 'terminal', command: testCommand },
  pause_fleet: { safety: 'hold', kind: 'inspect', executable: 'ashlr', args: ['fleet', 'pause'] },
  resume_fleet: { safety: 'hold', kind: 'inspect', executable: 'ashlr', args: ['fleet', 'resume'] },
  daemon_stop: { safety: 'hold', kind: 'inspect', executable: 'ashlr', args: ['daemon', 'stop'] },
}

function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'` }
function appleScriptQuote(value) { return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"') }

function testCommand(workspace) {
  const prefix = `cd ${shellQuote(workspace)} && `
  const candidates = []
  if (existsSync(path.join(workspace, 'package.json'))) {
    if (existsSync(path.join(workspace, 'pnpm-lock.yaml'))) candidates.push(`${prefix}pnpm test`)
    else if (existsSync(path.join(workspace, 'bun.lock')) || existsSync(path.join(workspace, 'bun.lockb'))) candidates.push(`${prefix}bun test`)
    else if (existsSync(path.join(workspace, 'yarn.lock'))) candidates.push(`${prefix}yarn test`)
    else if (existsSync(path.join(workspace, 'package-lock.json'))) candidates.push(`${prefix}npm test`)
  }
  if (existsSync(path.join(workspace, 'Cargo.toml'))) candidates.push(`${prefix}cargo test --all-targets`)
  if (existsSync(path.join(workspace, 'go.mod'))) candidates.push(`${prefix}go test ./...`)
  return candidates.length === 1 ? candidates[0] : null
}

function runProcess(executable, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''; let settled = false
    const finish = (result) => { if (!settled) { settled = true; resolve(result) } }
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish({ ok: false, output: stdout, error: 'Command timed out after 20 seconds.' }) }, 20_000)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); if (stdout.length > 30_000) stdout = stdout.slice(-30_000) })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > 8_000) stderr = stderr.slice(-8_000) })
    child.on('error', (error) => { clearTimeout(timer); finish({ ok: false, output: stdout, error: error.message }) })
    child.on('close', (code) => { clearTimeout(timer); finish({ ok: code === 0, output: stdout.trim(), error: stderr.trim() || (code ? `Exited with code ${code}.` : '') }) })
  })
}

async function executeSpec(id, workspace, electron) {
  const spec = ACTION_SPECS[id]
  const home = electron.home
  if (!spec) return outcome(false, 'Action unavailable', 'The requested action is not in the allowlisted desktop registry.')
  if (spec.kind === 'copy') { electron.clipboard.writeText(spec.text); return outcome(true, 'Brief copied', 'The guarded prompt is ready on your clipboard.') }
  if (spec.kind === 'openApp') {
    const result = await runProcess('/usr/bin/open', ['-a', spec.app])
    return result.ok ? outcome(true, `${spec.app} opened`, 'No message or task was submitted.') : outcome(false, `Could not open ${spec.app}`, result.error)
  }
  if (spec.kind === 'openCodex') {
    const codex = resolveTool('codex', { home })
    if (!codex) return outcome(false, 'Could not open Codex', 'Codex was not found in a supported user-local, Homebrew, or system tool directory.')
    const result = await runProcess(codex, ['app', workspace])
    return result.ok ? outcome(true, 'Codex opened', 'The selected workspace is now available in Codex.') : outcome(false, 'Could not open Codex', result.error)
  }
  if (spec.kind === 'gitInspect') {
    const result = await runGit(spec.args, {
      cwd: workspace,
      timeoutMs: 20_000,
      stdoutLimit: 30_000,
      stderrLimit: 8_000,
    })
    return result.ok
      ? outcome(true, 'Action complete', 'The command completed with no hidden follow-up action.', result.stdout)
      : outcome(false, 'Action failed', result.error, result.stdout)
  }
  if (spec.kind === 'inspect') {
    const executable = resolveTool(spec.executable, { home })
    if (!executable) return outcome(false, 'Action unavailable', `${spec.executable} was not found in a supported local tool directory.`)
    const result = await runProcess(executable, spec.args, { cwd: spec.workspace ? workspace : undefined })
    return result.ok ? outcome(true, 'Action complete', 'The command completed with no hidden follow-up action.', result.output) : outcome(false, 'Action failed', result.error, result.output)
  }
  if (spec.kind === 'toolHealth') {
    const tools = ['codex', 'claude', 'ashlr'].map((name) => resolveTool(name, { home }))
    const checks = await Promise.all([
      tools[0] ? runProcess(tools[0], ['--version']) : Promise.resolve({ ok: false, error: 'not found' }),
      tools[1] ? runProcess(tools[1], ['--version']) : Promise.resolve({ ok: false, error: 'not found' }),
      tools[2] ? runProcess(tools[2], ['--version']) : Promise.resolve({ ok: false, error: 'not found' }),
    ])
    const labels = ['Codex', 'Claude Code', 'Ashlr Hub']
    const output = checks.map((check, index) => `${labels[index]}: ${check.ok ? check.output : check.error}`).join('\n')
    return outcome(checks.every((check) => check.ok), 'Toolchain checked', 'Version probes completed locally.', output)
  }
  if (spec.kind === 'terminal') {
    const command = spec.command(workspace)
    if (!command) return outcome(false, 'Test command unavailable', 'No single supported test command was detected. Choose the intended package or component explicitly.')
    const script = `tell application "Terminal"\nactivate\ndo script "${appleScriptQuote(command)}"\nend tell`
    const result = await runProcess('/usr/bin/osascript', ['-e', script])
    return result.ok ? outcome(true, 'Terminal session started', 'The allowlisted command is running in a new Terminal session.') : outcome(false, 'Could not start Terminal session', result.error)
  }
  return outcome(false, 'Action unavailable', 'No executor is registered for this action.')
}

function outcome(ok, title, message, output) {
  return { ok, title, message, output: output || undefined, timestamp: new Date().toISOString() }
}

module.exports = { ACTION_SPECS, BRIEFS, executeSpec, shellQuote, testCommand }
