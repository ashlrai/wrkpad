const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { passiveRouteActionResult, routeAllowsConfiguredActions } = require('./action-route-policy.cjs')

test('configured actions are enabled only for the exact Ashlr Layer route', () => {
  assert.equal(routeAllowsConfiguredActions({ boardRoute: 'ashlr_layer' }), true)
  for (const settings of [null, undefined, {}, { boardRoute: 'unknown' }, { boardRoute: 'codex_native' }, { boardRoute: 'ASHLR_LAYER' }]) {
    assert.equal(routeAllowsConfiguredActions(settings), false)
  }
})

test('passive-route denial is bounded and deterministic', () => {
  const result = passiveRouteActionResult(() => new Date('2026-09-02T21:00:00.000Z'))
  assert.deepEqual(result, {
    ok: false,
    title: 'Ashlr actions unavailable',
    message: 'Configured actions are disabled unless the Ashlr Layer route is active.',
    timestamp: '2026-09-02T21:00:00.000Z',
  })
  assert.throws(() => passiveRouteActionResult(() => new Date('invalid')), /valid Date/)
})

test('main action IPC handlers enforce route policy and revoke passive authorization', () => {
  const source = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
  const request = source.match(/ipcMain\.handle\('board:requestAction'[\s\S]*?\n\}\)\)/)?.[0] ?? ''
  const begin = source.match(/ipcMain\.handle\('board:beginHold'[\s\S]*?\n\}\)\)/)?.[0] ?? ''
  const cancel = source.match(/ipcMain\.handle\('board:cancelHold'[\s\S]*?\n\}\)\)/)?.[0] ?? ''
  const confirm = source.match(/ipcMain\.handle\('board:confirmAction'[\s\S]*?\n\}\)\)/)?.[0] ?? ''

  assert.match(request, /settings = readSettings\(\)[\s\S]*!routeAllowsConfiguredActions\(settings\)[\s\S]*approvals\.clear\(\)[\s\S]*passiveRouteActionResult\(\)/)
  assert.equal(request.match(/readSettings\(\)/g)?.length, 1)
  assert.match(request, /executeSpec\(actionId, settings\.workspace/)
  assert.match(begin, /settings = readSettings\(\)[\s\S]*!routeAllowsConfiguredActions\(settings\)[\s\S]*approvals\.delete\(token\)[\s\S]*return false/)
  assert.match(begin, /approval\.boardRoute !== settings\.boardRoute/)
  assert.match(cancel, /settings = readSettings\(\)[\s\S]*!routeAllowsConfiguredActions\(settings\)[\s\S]*approvals\.delete\(token\)[\s\S]*return false/)
  assert.match(confirm, /approval = approvals\.get\(token\); approvals\.delete\(token\)[\s\S]*settings = readSettings\(\)[\s\S]*!routeAllowsConfiguredActions\(settings\)[\s\S]*passiveRouteActionResult\(\)/)
  assert.match(confirm, /approval\.boardRoute !== settings\.boardRoute/)
})

test('software-only agent slot focus remains outside the configured action gate', () => {
  const source = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
  const focus = source.match(/ipcMain\.handle\('board:focusAgentSlot'[\s\S]*?\n\}\)\)/)?.[0] ?? ''
  const focusImplementation = source.match(/async function focusAgentSlotResult\(slot\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  const focusFromSnapshot = source.match(/async function focusAgentFromSnapshot\(slot, snapshot\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.doesNotMatch(focus, /routeAllowsConfiguredActions/)
  assert.match(focus, /focusAgentSlotResult/)
  assert.doesNotMatch(focusImplementation, /routeAllowsConfiguredActions/)
  assert.doesNotMatch(focusFromSnapshot, /routeAllowsConfiguredActions/)
  assert.match(focusFromSnapshot, /appForProvider/)
})
