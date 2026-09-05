const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const {
  MAX_AGENT_SNAPSHOT_AGE_MS,
  MAX_AGENT_SNAPSHOT_FUTURE_SKEW_MS,
  appForProvider,
  detectClaudeHookHazards,
  isValidAgentPayload,
  isValidFleetPayload,
  summarizeAgentSnapshot,
  summarizeFleetStatus,
  validateAgentPayload,
  validateFleetPayload,
} = require('./mission-control.cjs')

function fixture(name) {
  const file = path.join(__dirname, '..', 'fixtures', 'provider-contracts', name)
  return JSON.parse(readFileSync(file, 'utf8'))
}

test('accepts the supported wrkpad fixture and exposes only bounded slot summaries', () => {
  const payload = fixture('wrkpad-state-v1.valid.json')
  assert.equal(validateAgentPayload(payload).code, 'ok')
  assert.equal(isValidAgentPayload(payload), true)

  const summary = summarizeAgentSnapshot(payload)
  const serialized = JSON.stringify(summary)
  assert.equal(summary.length, 6)
  assert.deepEqual(summary[0], {
    slot: 1, provider: 'codex', state: 'working', title: 'Synthetic verification', updatedAt: '2026-08-31T11:59:00Z',
  })
  assert.equal(serialized.includes('hmac-sha256:'), false)
  assert.equal(serialized.includes('last_event_id'), false)
})

test('explains an unsupported wrkpad schema without treating it as online', () => {
  const payload = fixture('wrkpad-state-v2.unsupported.json')
  assert.deepEqual(validateAgentPayload(payload), {
    ok: false,
    code: 'unsupported_schema',
    message: 'Expected wrkpad schema dev.wrkpad.hasp.state/v1.',
  })
  assert.equal(isValidAgentPayload(payload), false)
})

test('requires one complete ordered six-slot HASP snapshot', () => {
  const payload = fixture('wrkpad-state-v1.valid.json')
  const cases = [
    [{ ...payload, slots: payload.slots.slice(0, 5) }, 'invalid_slot_count'],
    [{ ...payload, slots: [...payload.slots.slice(0, 5), { slot: 5 }] }, 'duplicate_slot'],
    [{ ...payload, slots: payload.slots.map((slot, index) => index === 5 ? { slot: 7 } : slot) }, 'invalid_slot_number'],
    [{ ...payload, slots: [payload.slots[1], payload.slots[0], ...payload.slots.slice(2)] }, 'invalid_slot_order'],
  ]
  for (const [candidate, code] of cases) {
    assert.equal(validateAgentPayload(candidate).code, code)
    assert.equal(isValidAgentPayload(candidate), false)
  }
})

test('rejects malformed, stale, and future HASP snapshot metadata', () => {
  const now = new Date('2026-08-31T12:01:00.000Z')
  const payload = fixture('wrkpad-state-v1.valid.json')
  assert.equal(validateAgentPayload({ ...payload, revision: -1 }).code, 'invalid_revision')
  assert.equal(validateAgentPayload({ ...payload, generated_at: 'not-a-date' }).code, 'invalid_generated_at')
  assert.equal(validateAgentPayload({ ...payload, unassigned_active_sessions: -1 }).code, 'invalid_unassigned_sessions')
  assert.equal(validateAgentPayload({ ...payload, generated_at: new Date(now.getTime() - MAX_AGENT_SNAPSHOT_AGE_MS - 1).toISOString() }, { now }).code, 'stale_snapshot')
  assert.equal(validateAgentPayload({ ...payload, generated_at: new Date(now.getTime() + MAX_AGENT_SNAPSHOT_FUTURE_SKEW_MS + 1).toISOString() }, { now }).code, 'future_snapshot')
  assert.equal(validateAgentPayload({ ...payload, generated_at: now.toISOString() }, { now }).code, 'ok')
  assert.equal(validateAgentPayload(payload, { now: new Date('invalid') }).code, 'invalid_validation_time')
})

test('accepts the Ashlr adapter fixture and omits unrelated raw fields', () => {
  const payload = fixture('ashlr-fleet-adapter-v1.valid.json')
  assert.equal(validateFleetPayload(payload).code, 'ok')
  assert.equal(isValidFleetPayload(payload), true)

  const summary = summarizeFleetStatus(payload)
  const serialized = JSON.stringify(summary)
  assert.equal(summary.backlogItems, 4)
  assert.equal(summary.repairBlockedItems, 2)
  assert.equal(summary.nextActionSafety, 'read-only')
  assert.equal(serialized.includes('SYNTHETIC-UNEXPOSED-SENTINEL'), false)
})

test('explains an incompatible Ashlr adapter field without inventing a Fleet status', () => {
  const payload = fixture('ashlr-fleet-adapter-v1.incompatible.json')
  assert.deepEqual(validateFleetPayload(payload), {
    ok: false,
    code: 'invalid_mission_directive',
    message: 'Expected Ashlr Fleet field missionBrief.directive to match the adapter contract.',
  })
  assert.equal(isValidFleetPayload(payload), false)
  assert.equal(summarizeFleetStatus(payload), null)
})

test('rejects an invalid or unbounded Fleet timestamp', () => {
  const invalid = { ...fixture('ashlr-fleet-adapter-v1.valid.json'), generatedAt: 'not-a-timestamp' }
  assert.equal(validateFleetPayload(invalid).code, 'invalid_generated_at')
  const oversized = { ...invalid, generatedAt: `2026-08-31T12:00:00Z${'0'.repeat(65)}` }
  assert.equal(validateFleetPayload(oversized).code, 'invalid_generated_at')
})

test('agent snapshot exposes six provider-neutral slots without stable session identifiers', () => {
  const summary = summarizeAgentSnapshot({ slots: [{
    slot: 1,
    session: { provider: 'claude', state: 'needs_input', title: 'ashlr-hub', session_id: 'hmac-secret', cwd: '/private/work', updated_at: '2026-08-31T19:00:00Z' },
  }] })
  assert.equal(summary.length, 6)
  assert.deepEqual(summary[0], { slot: 1, provider: 'claude', state: 'needs_input', title: 'ashlr-hub', updatedAt: '2026-08-31T19:00:00Z' })
  assert.equal(JSON.stringify(summary).includes('hmac-secret'), false)
  assert.equal(JSON.stringify(summary).includes('/private/work'), false)
  assert.equal(summary[5].state, 'off')
})

test('fleet summary keeps the operator decision and drops the giant raw payload', () => {
  const summary = summarizeFleetStatus({
    generatedAt: '2026-08-31T19:00:00Z', daemon: { running: true, activity: { phase: 'idle' } }, killed: false,
    queue: { backlogItems: 39, eligibleBacklogItems: 0, repairControlBlockedItems: 8 }, proposals: { pending: 1 },
    goalFocus: { activeGoalCount: 18 }, guardHealth: { blocked: false },
    missionBrief: { directive: 'Inspect merge blockers', operatingMode: 'verify-only', blocker: { severity: 'high', label: 'Protected remote unavailable', detail: 'Missing live branch-protection evidence.' }, action: { label: 'Inspect protected remote authority' } },
    enormousPrivateSection: { ignored: 'must not escape' },
  })
  assert.equal(summary.eligibleItems, 0)
  assert.equal(summary.repairBlockedItems, 8)
  assert.equal(summary.blocker.label, 'Protected remote unavailable')
  assert.equal(JSON.stringify(summary).includes('must not escape'), false)
})

test('provider focus uses only fixed local app targets', () => {
  assert.equal(appForProvider('codex'), 'ChatGPT')
  assert.equal(appForProvider('claude'), 'cmux')
  assert.equal(appForProvider('unknown'), null)
  assert.equal(appForProvider('Injected.app'), null)
})

test('partial status payloads never become authoritative zeroes', () => {
  assert.equal(isValidAgentPayload({}), false)
  assert.equal(isValidFleetPayload({ daemon: { running: false } }), false)
  assert.equal(summarizeFleetStatus({}), null)
})

test('missing Claude settings produce no invented operator warning', () => {
  assert.deepEqual(detectClaudeHookHazards('/definitely/not/a/home'), [])
})
