const test = require('node:test')
const assert = require('node:assert/strict')
const { appForProvider, detectClaudeHookHazards, isValidAgentPayload, isValidFleetPayload, summarizeAgentSnapshot, summarizeFleetStatus } = require('./mission-control.cjs')

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
