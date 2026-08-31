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

function isValidAgentPayload(raw) {
  return raw?.schema === 'dev.wrkpad.hasp.state/v1' && Array.isArray(raw.slots)
}

function isValidFleetPayload(raw) {
  return typeof raw?.generatedAt === 'string'
    && typeof raw?.daemon?.running === 'boolean'
    && typeof raw?.daemon?.activity?.phase === 'string'
    && [raw?.queue?.backlogItems, raw?.queue?.eligibleBacklogItems, raw?.queue?.repairControlBlockedItems, raw?.proposals?.pending, raw?.goalFocus?.activeGoalCount]
      .every((value) => Number.isSafeInteger(value) && value >= 0)
    && typeof raw?.missionBrief?.operatingMode === 'string'
    && typeof raw?.missionBrief?.directive === 'string'
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

module.exports = { appForProvider, collectMissionControl, detectClaudeHookHazards, isValidAgentPayload, isValidFleetPayload, summarizeAgentSnapshot, summarizeFleetStatus }
