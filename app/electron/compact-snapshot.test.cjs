const test = require('node:test')
const assert = require('node:assert/strict')
const {
  COMPACT_SNAPSHOT_SCHEMA,
  STATE_PRIORITY,
  projectCompactActionResult,
  projectCompactSnapshot,
  selectAttentionSlot,
} = require('./compact-snapshot.cjs')

test('projects action receipts to a bounded title-free bridge contract', () => {
  const result = projectCompactActionResult({
    ok: true,
    title: 'Opened ChatGPT for private session title',
    message: `Codex Desktop is foregrounded.${'x'.repeat(400)}`,
    timestamp: '2026-09-02T20:01:00.000Z',
    stagedIntent: { private: true },
  })
  assert.deepEqual(Object.keys(result).sort(), ['message', 'ok'])
  assert.equal(result.ok, true)
  assert.equal(result.message.length, 240)
  assert.equal(JSON.stringify(result).includes('private session title'), false)
})

const rawAgents = [
  { slot: 1, provider: 'codex', state: 'unread', title: 'Release notes', updatedAt: '2026-09-02T20:00:00.000Z', sessionId: 'private-1' },
  { slot: 2, provider: 'claude', state: 'needs_input', title: 'Customer secret', updatedAt: '2026-09-02T20:00:01.000Z', prompt: 'private prompt' },
  { slot: 3, provider: 'codex', state: 'working', title: 'Long refactor', updatedAt: '2026-09-02T20:00:02.000Z' },
  { slot: 4, provider: 'claude', state: 'error', title: 'Broken build', updatedAt: '2026-09-02T20:00:03.000Z' },
  { slot: 5, provider: 'manual', state: 'idle', title: 'Local fleet', updatedAt: '2026-09-02T20:00:04.000Z' },
]

test('projects exactly six privacy-minimal slots and strips titles by default', () => {
  const snapshot = projectCompactSnapshot({
    observedAt: '2026-09-02T20:01:00.000Z',
    agentSource: 'observer_online',
    agents: rawAgents,
    unassignedActiveSessions: 42,
    operatorNotices: [{ detail: 'private' }],
  })
  assert.equal(snapshot.schema, COMPACT_SNAPSHOT_SCHEMA)
  assert.equal(snapshot.observedAt, '2026-09-02T20:01:00.000Z')
  assert.equal(snapshot.agentSource, 'observer_online')
  assert.equal(snapshot.agents.length, 6)
  assert.equal(snapshot.attentionSlot, 4)
  for (const agent of snapshot.agents) {
    assert.deepEqual(Object.keys(agent).sort(), ['provider', 'slot', 'state'])
  }
  assert.equal(JSON.stringify(snapshot).includes('Customer secret'), false)
  assert.equal(JSON.stringify(snapshot).includes('private'), false)
  assert.deepEqual(snapshot.agents[5], { slot: 6, provider: null, state: 'off' })
})

test('reveals only bounded printable titles when explicitly enabled', () => {
  const snapshot = projectCompactSnapshot({
    observedAt: '2026-09-02T20:01:00.000Z',
    agentSource: 'observer_online',
    agents: [
      { slot: 1, provider: 'codex', state: 'working', title: `  safe\u0000title ${'x'.repeat(200)}  ` },
      { slot: 2, provider: 'claude', state: 'idle', title: '' },
    ],
  }, { showTitles: true })
  assert.equal(snapshot.agents[0].title.includes('\u0000'), false)
  assert.equal(snapshot.agents[0].title.length, 120)
  assert.equal(snapshot.agents[1].title, 'Claude Code session')
  assert.equal(snapshot.agents[5].title, 'Available slot')
})

test('uses the exact deterministic attention priority and the lowest slot as tie-breaker', () => {
  assert.deepEqual(STATE_PRIORITY, {
    error: 0,
    needs_input: 1,
    working: 2,
    unread: 3,
    idle: 4,
    off: 5,
  })
  assert.equal(selectAttentionSlot([
    { slot: 1, state: 'idle' },
    { slot: 2, state: 'unread' },
    { slot: 3, state: 'working' },
    { slot: 4, state: 'needs_input' },
    { slot: 5, state: 'error' },
  ]), 5)
  assert.equal(selectAttentionSlot([
    { slot: 4, state: 'needs_input' },
    { slot: 2, state: 'needs_input' },
  ]), 2)
  assert.equal(selectAttentionSlot(Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, state: 'off' }))), null)
})

test('fails invalid provider, state, source, and time fields closed', () => {
  const now = new Date('2026-09-02T21:00:00.000Z')
  const snapshot = projectCompactSnapshot({
    observedAt: 'not-a-date',
    agentSource: 'connected',
    agents: [
      { slot: 1, provider: 'codex', state: 'invented', title: 'private' },
      { slot: 2, provider: 'invented', state: 'working', title: 'private' },
    ],
  }, { now })
  assert.equal(snapshot.observedAt, now.toISOString())
  assert.equal(snapshot.agentSource, 'unavailable')
  assert.deepEqual(snapshot.agents[0], { slot: 1, provider: null, state: 'off' })
  assert.deepEqual(snapshot.agents[1], { slot: 2, provider: null, state: 'working' })
  assert.equal(snapshot.attentionSlot, 2)
})
