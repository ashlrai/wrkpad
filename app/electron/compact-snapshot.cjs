const COMPACT_SNAPSHOT_SCHEMA = 'ai.ashlr.agent-board.compact-snapshot/v1'
const AGENT_SOURCES = new Set(['observer_online', 'invalid', 'unavailable'])
const PROVIDERS = new Set(['codex', 'claude', 'manual', 'unknown'])
const STATES = new Set(['off', 'idle', 'unread', 'working', 'needs_input', 'error'])
const STATE_PRIORITY = Object.freeze({
  error: 0,
  needs_input: 1,
  working: 2,
  unread: 3,
  idle: 4,
  off: 5,
})

function cleanText(value, fallback, limit = 120) {
  if (typeof value !== 'string') return fallback
  const clean = [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint >= 32 && codePoint !== 127
    })
    .join('')
    .trim()
  return clean ? clean.slice(0, limit) : fallback
}

function validTimestamp(value) {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))
}

function projectSlot(rawAgents, slot, showTitles) {
  const candidate = Array.isArray(rawAgents) ? rawAgents.find((agent) => agent?.slot === slot) : null
  const state = STATES.has(candidate?.state) ? candidate.state : 'off'
  const provider = state !== 'off' && PROVIDERS.has(candidate?.provider) ? candidate.provider : null
  const projected = { slot, provider, state }
  if (showTitles) {
    projected.title = cleanText(candidate?.title, provider ? `${provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex' : 'Agent'} session` : 'Available slot')
  }
  return projected
}

function selectAttentionSlot(agents) {
  if (!Array.isArray(agents)) return null
  let selected = null
  for (const agent of agents) {
    if (!agent || !Number.isInteger(agent.slot) || !Object.hasOwn(STATE_PRIORITY, agent.state) || agent.state === 'off') continue
    if (!selected
      || STATE_PRIORITY[agent.state] < STATE_PRIORITY[selected.state]
      || (STATE_PRIORITY[agent.state] === STATE_PRIORITY[selected.state] && agent.slot < selected.slot)) {
      selected = agent
    }
  }
  return selected?.slot ?? null
}

function projectCompactSnapshot(mission, options = {}) {
  const showTitles = options.showTitles === true
  const now = options.now instanceof Date && Number.isFinite(options.now.getTime()) ? options.now : new Date()
  const source = AGENT_SOURCES.has(mission?.agentSource) ? mission.agentSource : 'unavailable'
  const agents = Array.from({ length: 6 }, (_, index) => projectSlot(mission?.agents, index + 1, showTitles))
  return {
    schema: COMPACT_SNAPSHOT_SCHEMA,
    observedAt: validTimestamp(mission?.observedAt) ? new Date(mission.observedAt).toISOString() : now.toISOString(),
    agentSource: source,
    agents,
    attentionSlot: selectAttentionSlot(agents),
  }
}

function projectCompactActionResult(result) {
  const ok = result?.ok === true
  return {
    ok,
    message: cleanText(result?.message, ok ? 'Action completed.' : 'Action did not complete.', 240),
  }
}

module.exports = {
  COMPACT_SNAPSHOT_SCHEMA,
  STATE_PRIORITY,
  projectCompactActionResult,
  projectCompactSnapshot,
  selectAttentionSlot,
}
