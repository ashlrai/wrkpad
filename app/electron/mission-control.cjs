const { spawn } = require('node:child_process')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { resolveTool } = require('./tool-resolver.cjs')

const MAX_JSON_BYTES = 2 * 1024 * 1024
const PROVIDERS = new Set(['codex', 'claude', 'manual', 'unknown'])
const STATES = new Set(['off', 'idle', 'unread', 'working', 'needs_input', 'error'])

function boundedText(value, fallback, limit = 160) {
  if (typeof value !== 'string') return fallback
  const clean = [...value].filter((character) => {
    const code = character.codePointAt(0) ?? 0
    return code >= 32 && code !== 127
  }).join('').trim()
  return clean ? clean.slice(0, limit) : fallback
}

function finiteCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function valid() {
  return { ok: true, code: 'ok', message: 'Payload matches the supported contract.' }
}

function invalid(code, message) {
  return { ok: false, code, message }
}

function validateAgentPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return invalid('invalid_payload', 'wrkpad status must return a JSON object.')
  }
  if (raw.schema !== 'dev.wrkpad.hasp.state/v1') {
    return invalid('unsupported_schema', 'Expected wrkpad schema dev.wrkpad.hasp.state/v1.')
  }
  if (!Array.isArray(raw.slots)) {
    return invalid('invalid_slots', 'Expected wrkpad field slots to be an array.')
  }
  return valid()
}

function validateFleetPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return invalid('invalid_payload', 'Ashlr Fleet status must return a JSON object.')
  }
  const fields = [
    ['generatedAt', 'invalid_generated_at', raw.generatedAt, timestampField],
    ['daemon.running', 'invalid_daemon_running', raw.daemon?.running, (value) => typeof value === 'boolean'],
    ['daemon.activity.phase', 'invalid_daemon_phase', raw.daemon?.activity?.phase, (value) => typeof value === 'string'],
    ['queue.backlogItems', 'invalid_queue_backlog_items', raw.queue?.backlogItems, finiteCountField],
    ['queue.eligibleBacklogItems', 'invalid_queue_eligible_items', raw.queue?.eligibleBacklogItems, finiteCountField],
    ['queue.repairControlBlockedItems', 'invalid_queue_repair_blocked_items', raw.queue?.repairControlBlockedItems, finiteCountField],
    ['proposals.pending', 'invalid_pending_proposals', raw.proposals?.pending, finiteCountField],
    ['goalFocus.activeGoalCount', 'invalid_active_goal_count', raw.goalFocus?.activeGoalCount, finiteCountField],
    ['missionBrief.operatingMode', 'invalid_operating_mode', raw.missionBrief?.operatingMode, (value) => typeof value === 'string'],
    ['missionBrief.directive', 'invalid_mission_directive', raw.missionBrief?.directive, (value) => typeof value === 'string'],
  ]
  for (const [field, code, value, accepts] of fields) {
    if (!accepts(value)) {
      return invalid(code, `Expected Ashlr Fleet field ${field} to match the adapter contract.`)
    }
  }
  return valid()
}

function finiteCountField(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function timestampField(value) {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))
}

function isValidAgentPayload(raw) {
  return validateAgentPayload(raw).ok
}

function isValidFleetPayload(raw) {
  return validateFleetPayload(raw).ok
}

function summarizeAgentSnapshot(raw) {
  const slots = Array.isArray(raw?.slots) ? raw.slots : []
  return Array.from({ length: 6 }, (_, index) => {
    const slotNumber = index + 1
    const candidate = slots.find((slot) => slot?.slot === slotNumber)
    const session = candidate?.session
    if (!session || typeof session !== 'object') return { slot: slotNumber, provider: null, state: 'off', title: 'Available slot', updatedAt: null }
    const provider = PROVIDERS.has(session.provider) ? session.provider : 'unknown'
    const state = STATES.has(session.state) ? session.state : 'off'
    return {
      slot: slotNumber,
      provider,
      state,
      title: boundedText(session.title, `${provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex' : 'Agent'} session`, 120),
      updatedAt: typeof session.updated_at === 'string' ? session.updated_at : null,
    }
  })
}

function summarizeFleetStatus(raw) {
  if (!isValidFleetPayload(raw)) return null
  const blocker = raw.missionBrief?.blocker ?? raw.operatorBriefing?.topBlocker ?? null
  const action = raw.missionBrief?.action ?? raw.operatorBriefing?.primaryAction ?? null
  return {
    daemonRunning: raw.daemon?.running === true,
    daemonPhase: boundedText(raw.daemon?.activity?.phase, raw.daemon?.running === true ? 'running' : 'offline', 40),
    killed: raw.killed === true,
    backlogItems: finiteCount(raw.queue?.backlogItems),
    eligibleItems: finiteCount(raw.queue?.eligibleBacklogItems),
    repairBlockedItems: finiteCount(raw.queue?.repairControlBlockedItems),
    pendingProposals: finiteCount(raw.proposals?.pending),
    activeGoals: finiteCount(raw.goalFocus?.activeGoalCount),
    operatingMode: boundedText(raw.missionBrief?.operatingMode, 'observe', 40),
    directive: boundedText(raw.missionBrief?.directive, 'Inspect fleet status', 120),
    blocker: blocker ? {
      severity: boundedText(blocker.severity, 'unknown', 20),
      label: boundedText(blocker.label, 'Fleet needs attention', 100),
      detail: boundedText(blocker.detail, 'Inspect the fleet before changing authority.', 280),
    } : null,
    nextAction: action ? boundedText(action.label, 'Inspect fleet status', 120) : null,
    nextActionSafety: action ? (['read-only', 'control-plane', 'manual'].includes(action.commands?.[0]?.safety) ? action.commands[0].safety : 'unknown') : null,
    guardBlocked: raw.guardHealth?.blocked === true,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null,
  }
}

function detectClaudeHookHazards(home) {
  try {
    const settings = JSON.parse(readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'))
    const sessionStart = settings?.hooks?.SessionStart
    const serialized = JSON.stringify(sessionStart ?? [])
    if (!serialized.includes('auto-sync.sh')) return []
    return [{
      code: 'claude_session_start_repo_mutation',
      severity: 'high',
      label: 'Claude startup can mutate repositories',
      detail: 'A global SessionStart hook runs repository sync during starts, resumes, compaction, and forks. Move sync into the governed fleet reconciler.',
    }]
  } catch { return [] }
}

function captureJson(executable, args, timeoutMs = 6500) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = Buffer.alloc(0)
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(reject, new Error('command timed out'))
    }, timeoutMs)
    child.once('error', (error) => finish(reject, error))
    child.stdout.on('data', (chunk) => {
      if (stdout.length + chunk.length > MAX_JSON_BYTES) {
        child.kill('SIGTERM')
        finish(reject, new Error('command output exceeded safety limit'))
        return
      }
      stdout = Buffer.concat([stdout, chunk])
    })
    child.once('close', (code) => {
      if (settled) return
      if (code !== 0) return finish(reject, new Error(`command exited ${code}`))
      try { finish(resolve, JSON.parse(stdout.toString('utf8'))) }
      catch { finish(reject, new Error('command returned invalid JSON')) }
    })
  })
}

async function collectMissionControl(home) {
  const wrkpad = resolveTool('wrkpad', { home })
  const ashlr = resolveTool('ashlr', { home })
  const [agentsResult, fleetResult] = await Promise.allSettled([
    wrkpad ? captureJson(wrkpad, ['status', '--json'], 1200) : Promise.reject(new Error('wrkpad is unavailable')),
    ashlr ? captureJson(ashlr, ['fleet', 'status', '--json']) : Promise.reject(new Error('ashlr is unavailable')),
  ])
  const agentPayload = agentsResult.status === 'fulfilled' ? agentsResult.value : null
  const fleetPayload = fleetResult.status === 'fulfilled' ? fleetResult.value : null
  const validAgentPayload = isValidAgentPayload(agentPayload)
  const validFleetPayload = isValidFleetPayload(fleetPayload)
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    agentSource: validAgentPayload ? 'observer_online' : agentsResult.status === 'fulfilled' ? 'invalid' : 'unavailable',
    fleetSource: validFleetPayload ? 'status_receipt' : fleetResult.status === 'fulfilled' ? 'invalid' : 'unavailable',
    agents: summarizeAgentSnapshot(validAgentPayload ? agentPayload : null),
    fleet: summarizeFleetStatus(validFleetPayload ? fleetPayload : null),
    unassignedActiveSessions: validAgentPayload ? finiteCount(agentPayload.unassigned_active_sessions) : 0,
    operatorNotices: detectClaudeHookHazards(home),
  }
}

function appForProvider(provider) {
  if (provider === 'codex') return 'ChatGPT'
  if (provider === 'claude') return 'cmux'
  return null
}

module.exports = {
  appForProvider,
  collectMissionControl,
  detectClaudeHookHazards,
  isValidAgentPayload,
  isValidFleetPayload,
  summarizeAgentSnapshot,
  summarizeFleetStatus,
  validateAgentPayload,
  validateFleetPayload,
}
