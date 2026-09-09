const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const {
  MAX_AGENT_SNAPSHOT_AGE_MS,
  MAX_AGENT_SNAPSHOT_FUTURE_SKEW_MS,
  MAX_AGENT_TARGET_AGE_MS,
  MAX_CODEX_TARGET_AGE_MS,
  MAX_WORKSPACE_PATH_CHARS,
  appForProvider,
  codexTaskTarget,
  composeAgentRunway,
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

test('workspace paths are absolute, canonical, bounded, and control-free', () => {
  assert.equal(sanitizeWorkspacePath('/Users/example/work/wrkpad'), '/Users/example/work/wrkpad')
  for (const candidate of [
    '',
    '/',
    'relative/workspace',
    '/Users/example/../private',
    '/Users/example/work/',
    '/Users/example//work',
    '/Users/example/\u0000work',
    '/Users/example/\nwork',
    `/${'x'.repeat(MAX_WORKSPACE_PATH_CHARS)}`,
  ]) {
    assert.equal(sanitizeWorkspacePath(candidate), null, candidate)
  }
})

test('private slot targets remain module-private and fail closed', () => {
  const now = new Date('2026-08-31T12:00:01.000Z')
  const payload = fixture('wrkpad-state-v1.valid.json')
  payload.slots[0].session.cwd = '/Users/example/work/wrkpad'
  const target = privateTargetFromAgentPayload(payload, 1, { now })
  assert.deepEqual(target, {
    slot: 1,
    provider: 'codex',
    state: 'working',
    sessionBinding: payload.slots[0].session.session_id,
    workspace: '/Users/example/work/wrkpad',
    updatedAt: '2026-08-31T11:59:00Z',
  })
  assert.equal(Object.isFrozen(target), true)

  const agents = summarizeAgentSnapshot(payload, { attachPrivateTargets: true, now })
  const mission = { agents }
  assert.equal(Object.hasOwn(agents[0], 'workspaceLabel'), false)
  assert.equal(workspaceForSlot(mission, 1), '/Users/example/work/wrkpad')
  assert.deepEqual(privateTargetForSlot(mission, 1), target)
  assert.equal(privateTargetForSlot(mission, 2), null)
  assert.equal(workspaceForSlot(structuredClone(mission), 1), null)
  const serialized = JSON.stringify(mission)
  assert.equal(serialized.includes('/Users/example/work/wrkpad'), false)
  assert.equal(serialized.includes(payload.slots[0].session.session_id), false)
})

test('off, malformed, stale, and pathless sessions never grant workspace authority', () => {
  const now = new Date('2026-08-31T12:00:01.000Z')
  const payload = fixture('wrkpad-state-v1.valid.json')
  payload.slots[0].session.cwd = '/Users/example/work/wrkpad'
  assert.equal(privateTargetFromAgentPayload({ ...payload, generated_at: '2026-08-31T11:00:00Z' }, 1, { now }), null)
  const offPayload = { ...payload, slots: payload.slots.map((entry, index) => index === 0 ? { ...entry, session: { ...entry.session, state: 'off' } } : entry) }
  assert.equal(privateTargetFromAgentPayload(offPayload, 1, { now }), null)
  assert.equal(Object.hasOwn(summarizeAgentSnapshot(offPayload)[0], 'workspaceLabel'), false)
  const staleTarget = { ...payload, slots: payload.slots.map((entry, index) => index === 0 ? { ...entry, session: { ...entry.session, updated_at: new Date(now.getTime() - MAX_AGENT_TARGET_AGE_MS - 1).toISOString() } } : entry) }
  assert.equal(privateTargetFromAgentPayload(staleTarget, 1, { now }), null)
  assert.equal(privateTargetFromAgentPayload({ ...payload, slots: payload.slots.map((entry, index) => index === 0 ? { ...entry, session: { ...entry.session, cwd: '../wrkpad' } } : entry) }, 1, { now }), null)
  assert.equal(privateTargetFromAgentPayload({ ...payload, slots: payload.slots.map((entry, index) => index === 0 ? { ...entry, session: { ...entry.session, session_id: 'provider-raw-id' } } : entry) }, 1, { now }), null)
  assert.equal(privateTargetFromAgentPayload({ ...payload, slots: payload.slots.map((entry, index) => index === 0 ? { ...entry, session: { ...entry.session, provider: 'manual' } } : entry) }, 1, { now }), null)
  assert.equal(privateTargetFromAgentPayload(payload, 0, { now }), null)
})

test('recent Codex tasks fill only empty or inactive slots with private deep-link targets', () => {
  const now = new Date('2026-08-31T12:00:01.000Z')
  const payload = fixture('wrkpad-state-v1.valid.json')
  payload.slots[0].session.cwd = '/Users/example/live'
  const task = {
    threadId: '019cbb00-1234-7abc-8def-0123456789ab',
    title: 'Current Codex task',
    cwd: '/Users/example/recent',
    createdAt: '2026-08-31T11:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
  }
  const agents = composeAgentRunway(payload, [task], { now })
  assert.equal(agents[0].title, 'Synthetic verification')
  const recentAgent = agents.find((agent) => agent.targeting === 'codex_deep_link')
  assert.equal(recentAgent.title, 'Current Codex task')
  assert.equal(Object.hasOwn(recentAgent, 'workspaceLabel'), false)
  assert.deepEqual(privateTargetForSlot({ agents }, recentAgent.slot), {
    slot: recentAgent.slot,
    provider: 'codex',
    state: 'idle',
    targetKind: 'codex_task',
    threadId: task.threadId,
    workspace: task.cwd,
    updatedAt: task.updatedAt,
  })
  assert.equal(JSON.stringify(agents).includes(task.threadId), false)
  assert.equal(JSON.stringify(agents).includes(task.cwd), false)
})

test('Codex task targets reject malformed identity, timestamps, and workspaces', () => {
  const valid = {
    threadId: '019cbb00-1234-7abc-8def-0123456789ab',
    cwd: '/Users/example/recent',
    createdAt: '2026-08-31T11:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
  }
  assert.equal(codexTaskTarget({ ...valid, threadId: 'bad' }, 1), null)
  assert.equal(codexTaskTarget({ ...valid, cwd: '../relative' }, 1), null)
  assert.equal(codexTaskTarget({ ...valid, updatedAt: 'not-a-date' }, 1), null)
  assert.equal(codexTaskTarget({ ...valid, updatedAt: '2026-08-31T10:00:00.000Z' }, 1), null)
  const now = new Date('2026-08-31T12:00:01.000Z')
  assert.equal(codexTaskTarget({ ...valid, updatedAt: new Date(now.getTime() - MAX_CODEX_TARGET_AGE_MS - 1).toISOString() }, 1, { now }), null)
  assert.equal(codexTaskTarget({ ...valid, updatedAt: new Date(now.getTime() + MAX_AGENT_SNAPSHOT_FUTURE_SKEW_MS + 1).toISOString() }, 1, { now }), null)
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
