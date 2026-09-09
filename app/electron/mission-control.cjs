const { spawn } = require('node:child_process')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { resolveTool } = require('./tool-resolver.cjs')
const { validThreadId } = require('./codex-desktop-adapter.cjs')

const MAX_JSON_BYTES = 2 * 1024 * 1024
const MAX_AGENT_SNAPSHOT_AGE_MS = 30_000
const MAX_AGENT_SNAPSHOT_FUTURE_SKEW_MS = 5_000
const MAX_AGENT_TARGET_AGE_MS = 24 * 60 * 60 * 1_000
const MAX_CODEX_TARGET_AGE_MS = 30 * 24 * 60 * 60 * 1_000
const MAX_WORKSPACE_PATH_CHARS = 2_048
const PROVIDERS = new Set(['codex', 'claude', 'manual', 'unknown'])
const WORKSPACE_PROVIDERS = new Set(['codex', 'claude'])
const STATES = new Set(['off', 'idle', 'unread', 'working', 'needs_input', 'error'])
const PRIVATE_AGENT_TARGETS = new WeakMap()

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

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code <= 31 || (code >= 127 && code <= 159)
  })
}

function sanitizeWorkspacePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_WORKSPACE_PATH_CHARS) return null
  if (value !== value.trim() || hasControlCharacter(value)) return null
  if (!path.isAbsolute(value)) return null
  const root = path.parse(value).root
  if ((value !== root && value.endsWith(path.sep)) || value.slice(root.length).includes(`${path.sep}${path.sep}`)) return null
  const segments = value.split(path.sep)
  if (segments.some((segment) => segment === '.' || segment === '..')) return null
  const normalized = path.normalize(value)
  if (normalized !== value || normalized.length > MAX_WORKSPACE_PATH_CHARS) return null
  if (normalized === root) return null
  return normalized
}

function valid() {
  return { ok: true, code: 'ok', message: 'Payload matches the supported contract.' }
}

function invalid(code, message) {
  return { ok: false, code, message }
}

function validateAgentPayload(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return invalid('invalid_payload', 'wrkpad status must return a JSON object.')
  }
  if (raw.schema !== 'dev.wrkpad.hasp.state/v1') {
    return invalid('unsupported_schema', 'Expected wrkpad schema dev.wrkpad.hasp.state/v1.')
  }
  if (!Array.isArray(raw.slots)) {
    return invalid('invalid_slots', 'Expected wrkpad field slots to be an array.')
  }
  if (!Number.isSafeInteger(raw.revision) || raw.revision < 0) {
    return invalid('invalid_revision', 'Expected wrkpad field revision to be a non-negative safe integer.')
  }
  if (!timestampField(raw.generated_at)) {
    return invalid('invalid_generated_at', 'Expected wrkpad field generated_at to be a bounded timestamp.')
  }
  if (!finiteCountField(raw.unassigned_active_sessions)) {
    return invalid('invalid_unassigned_sessions', 'Expected wrkpad field unassigned_active_sessions to be a non-negative safe integer.')
  }
  if (raw.slots.length !== 6) {
    return invalid('invalid_slot_count', 'Expected exactly six wrkpad slots.')
  }
  const seen = new Set()
  for (const [index, candidate] of raw.slots.entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return invalid('invalid_slot', 'Expected each wrkpad slot to be an object.')
    }
    if (!Number.isInteger(candidate.slot) || candidate.slot < 1 || candidate.slot > 6) {
      return invalid('invalid_slot_number', 'Expected every wrkpad slot number to be between 1 and 6.')
    }
    if (seen.has(candidate.slot)) {
      return invalid('duplicate_slot', 'Expected every wrkpad slot number to be unique.')
    }
    seen.add(candidate.slot)
    if (candidate.slot !== index + 1) {
      return invalid('invalid_slot_order', 'Expected wrkpad slots in ascending physical order.')
    }
    if (candidate.session !== undefined && (!candidate.session || typeof candidate.session !== 'object' || Array.isArray(candidate.session))) {
      return invalid('invalid_session', 'Expected an occupied wrkpad slot session to be an object.')
    }
  }
  if (options.now !== undefined) {
    const now = options.now instanceof Date && Number.isFinite(options.now.getTime()) ? options.now.getTime() : NaN
    if (!Number.isFinite(now)) return invalid('invalid_validation_time', 'Agent snapshot validation requires a valid current time.')
    const generatedAt = Date.parse(raw.generated_at)
    if (generatedAt > now + MAX_AGENT_SNAPSHOT_FUTURE_SKEW_MS) {
      return invalid('future_snapshot', 'wrkpad status returned a snapshot from the future.')
    }
    if (now - generatedAt > MAX_AGENT_SNAPSHOT_AGE_MS) {
      return invalid('stale_snapshot', 'wrkpad status returned a stale snapshot.')
    }
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

function freshTargetTimestamp(value, options = {}) {
  if (!timestampField(value)) return false
  if (options.now === undefined) return true
  const now = options.now instanceof Date && Number.isFinite(options.now.getTime()) ? options.now.getTime() : NaN
  const observed = Date.parse(value)
  const maxAgeMs = Number.isSafeInteger(options.maxAgeMs) && options.maxAgeMs >= 0 ? options.maxAgeMs : 0
  return Number.isFinite(now)
    && observed <= now + MAX_AGENT_SNAPSHOT_FUTURE_SKEW_MS
    && now - observed <= maxAgeMs
}

function isValidAgentPayload(raw) {
  return validateAgentPayload(raw).ok
}

function isValidFleetPayload(raw) {
  return validateFleetPayload(raw).ok
}

function privateTargetFromAgentPayload(raw, slot, options = {}) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 6) return null
  if (!validateAgentPayload(raw, options).ok) return null
  const session = raw.slots[slot - 1]?.session
  if (!session || typeof session !== 'object' || session.state === 'off') return null
  if (!WORKSPACE_PROVIDERS.has(session.provider) || !STATES.has(session.state)) return null
  if (typeof session.session_id !== 'string' || !/^hmac-sha256:[a-f0-9]{64}$/.test(session.session_id)) return null
  if (!freshTargetTimestamp(session.updated_at, { now: options.now, maxAgeMs: MAX_AGENT_TARGET_AGE_MS })) return null
  const workspace = sanitizeWorkspacePath(session.cwd)
  if (!workspace) return null
  return Object.freeze({
    slot,
    provider: session.provider,
    state: session.state,
    sessionBinding: session.session_id,
    workspace,
    updatedAt: session.updated_at,
  })
}

function attachPrivateTargets(agents, raw, options = {}) {
  const targets = new Map()
  for (let slot = 1; slot <= 6; slot += 1) {
    const target = privateTargetFromAgentPayload(raw, slot, options)
    if (target) targets.set(slot, target)
  }
  PRIVATE_AGENT_TARGETS.set(agents, targets)
}

function codexTaskTarget(task, slot, options = {}) {
  if (!task || typeof task !== 'object' || !validThreadId(task.threadId)) return null
  const workspace = sanitizeWorkspacePath(task.cwd)
  if (!workspace || !timestampField(task.createdAt) || !timestampField(task.updatedAt)) return null
  if (Date.parse(task.updatedAt) < Date.parse(task.createdAt)) return null
  if (!freshTargetTimestamp(task.updatedAt, { now: options.now, maxAgeMs: MAX_CODEX_TARGET_AGE_MS })) return null
  return Object.freeze({
    slot,
    provider: 'codex',
    state: 'idle',
    targetKind: 'codex_task',
    threadId: task.threadId.toLowerCase(),
    workspace,
    updatedAt: task.updatedAt,
  })
}

function composeAgentRunway(raw, codexTasks, options = {}) {
  const agents = summarizeAgentSnapshot(raw)
  const targets = new Map()
  for (let slot = 1; slot <= 6; slot += 1) {
    const target = privateTargetFromAgentPayload(raw, slot, { now: options.now })
    if (target) targets.set(slot, target)
  }
  const tasks = Array.isArray(codexTasks) ? codexTasks : []
  const usedTaskIds = new Set()
  for (const agent of agents) {
    if (agent.state !== 'off') continue
    const task = tasks.find((candidate) => {
      const target = codexTaskTarget(candidate, agent.slot, { now: options.now })
      return target && !usedTaskIds.has(target.threadId)
    })
    if (!task) continue
    const target = codexTaskTarget(task, agent.slot, { now: options.now })
    usedTaskIds.add(target.threadId)
    targets.set(agent.slot, target)
    agent.provider = 'codex'
    agent.state = 'idle'
    agent.title = boundedText(task.title, 'Untitled Codex task', 120)
    agent.updatedAt = task.updatedAt
    agent.targeting = 'codex_deep_link'
  }
  PRIVATE_AGENT_TARGETS.set(agents, targets)
  return agents
}

function privateTargetForSlot(snapshot, slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 6) return null
  const agents = Array.isArray(snapshot) ? snapshot : snapshot?.agents
  if (!Array.isArray(agents)) return null
  return PRIVATE_AGENT_TARGETS.get(agents)?.get(slot) ?? null
}

function workspaceForSlot(snapshot, slot) {
  return privateTargetForSlot(snapshot, slot)?.workspace ?? null
}

function summarizeAgentSnapshot(raw, options = {}) {
  const slots = Array.isArray(raw?.slots) ? raw.slots : []
  const agents = Array.from({ length: 6 }, (_, index) => {
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
  if (options.attachPrivateTargets === true) attachPrivateTargets(agents, raw, { now: options.now })
  return agents
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

async function collectMissionControl(home, options = {}) {
  const wrkpad = resolveTool('wrkpad', { home })
  const ashlr = resolveTool('ashlr', { home })
  const [agentsResult, fleetResult, codexResult] = await Promise.allSettled([
    wrkpad ? captureJson(wrkpad, ['status', '--json'], 1200) : Promise.reject(new Error('wrkpad is unavailable')),
    ashlr ? captureJson(ashlr, ['fleet', 'status', '--json']) : Promise.reject(new Error('ashlr is unavailable')),
    options.codexDesktopAdapter?.listRecentTasks
      ? options.codexDesktopAdapter.listRecentTasks(6)
      : Promise.reject(new Error('Codex Desktop catalog is unavailable')),
  ])
  const agentPayload = agentsResult.status === 'fulfilled' ? agentsResult.value : null
  const fleetPayload = fleetResult.status === 'fulfilled' ? fleetResult.value : null
  const observedAt = new Date()
  const validAgentPayload = validateAgentPayload(agentPayload, { now: observedAt }).ok
  const validFleetPayload = isValidFleetPayload(fleetPayload)
  const codexCatalog = codexResult.status === 'fulfilled' && codexResult.value?.ok === true ? codexResult.value : null
  const agents = composeAgentRunway(validAgentPayload ? agentPayload : null, codexCatalog?.tasks, { now: observedAt })
  return {
    schemaVersion: 1,
    observedAt: observedAt.toISOString(),
    agentSource: validAgentPayload ? 'observer_online' : agentsResult.status === 'fulfilled' ? 'invalid' : 'unavailable',
    codexCatalogSource: codexCatalog ? 'recent_tasks' : codexResult.status === 'fulfilled' ? 'invalid' : 'unavailable',
    fleetSource: validFleetPayload ? 'status_receipt' : fleetResult.status === 'fulfilled' ? 'invalid' : 'unavailable',
    agents,
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
  MAX_AGENT_SNAPSHOT_AGE_MS,
  MAX_AGENT_SNAPSHOT_FUTURE_SKEW_MS,
  MAX_AGENT_TARGET_AGE_MS,
  MAX_CODEX_TARGET_AGE_MS,
  MAX_WORKSPACE_PATH_CHARS,
  appForProvider,
  collectMissionControl,
  composeAgentRunway,
  codexTaskTarget,
  detectClaudeHookHazards,
  isValidAgentPayload,
  isValidFleetPayload,
  privateTargetForSlot,
  privateTargetFromAgentPayload,
  sanitizeWorkspacePath,
  summarizeAgentSnapshot,
  summarizeFleetStatus,
  validateAgentPayload,
  validateFleetPayload,
  workspaceForSlot,
}
