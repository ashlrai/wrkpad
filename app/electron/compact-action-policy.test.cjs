const test = require('node:test')
const assert = require('node:assert/strict')
const {
  COMPACT_ACTION_IDS,
  COMPACT_WORKFLOW_ACTIONS,
  compactActionAllowed,
  compactWorkflowActionAllowed,
  requireCompactAction,
  requireCompactWorkflowAction,
} = require('./compact-action-policy.cjs')

const validSpecs = () => Object.fromEntries(COMPACT_ACTION_IDS.map((id) => [id, {
  safety: 'safe',
  kind: 'copy',
  text: `$ashlr-delivery ${id}`,
}]))

test('admits exactly the four skill-copy action IDs', () => {
  assert.deepEqual(COMPACT_ACTION_IDS, [
    'copy_amplify_skill',
    'copy_verify_skill',
    'copy_polish_skill',
    'copy_advance_skill',
  ])
  const specs = validSpecs()
  for (const id of COMPACT_ACTION_IDS) assert.equal(compactActionAllowed(id, specs), true, id)
  assert.equal(compactActionAllowed('copy_plan_brief', specs), false)
  assert.equal(compactActionAllowed('start_codex', specs), false)
  assert.equal(compactActionAllowed('', specs), false)
  assert.equal(compactActionAllowed({ id: 'copy_amplify_skill' }, specs), false)
})

test('double-gates every compact action by safe classification and copy executor kind', () => {
  for (const id of COMPACT_ACTION_IDS) {
    const unsafe = validSpecs()
    unsafe[id] = { ...unsafe[id], safety: 'confirm' }
    assert.equal(compactActionAllowed(id, unsafe), false, `${id} safety drift`)

    const hold = validSpecs()
    hold[id] = { ...hold[id], safety: 'hold' }
    assert.equal(compactActionAllowed(id, hold), false, `${id} hold drift`)

    const terminal = validSpecs()
    terminal[id] = { ...terminal[id], kind: 'terminal' }
    assert.equal(compactActionAllowed(id, terminal), false, `${id} terminal drift`)

    const missing = validSpecs()
    delete missing[id]
    assert.equal(compactActionAllowed(id, missing), false, `${id} missing registry entry`)
  }
})

test('returns only the server-owned registry spec and fails closed otherwise', () => {
  const specs = validSpecs()
  assert.equal(requireCompactAction('copy_verify_skill', specs), specs.copy_verify_skill)
  const inherited = Object.create({ copy_verify_skill: specs.copy_verify_skill })
  assert.equal(compactActionAllowed('copy_verify_skill', inherited), false)
  assert.throws(
    () => requireCompactAction('copy_verify_skill', { copy_verify_skill: { safety: 'safe', kind: 'terminal' } }),
    /not an allowlisted safe copy action/,
  )
  assert.throws(() => requireCompactAction('rm -rf', specs), /not an allowlisted safe copy action/)
  assert.throws(() => requireCompactAction('copy_amplify_skill', null), /not an allowlisted safe copy action/)
})

test('double-gates Compact Deck workflow actions against registry drift', () => {
  const specs = {
    stage_voice: { safety: 'safe', kind: 'stage', intent: 'voice_capture' },
    copy_guarded_continue: { safety: 'safe', kind: 'copy', text: 'Continue safely.' },
    stage_attention: { safety: 'safe', kind: 'stage', intent: 'focus_attention' },
  }
  assert.deepEqual(Object.keys(COMPACT_WORKFLOW_ACTIONS), ['stage_voice', 'copy_guarded_continue', 'stage_attention'])
  for (const actionId of Object.keys(COMPACT_WORKFLOW_ACTIONS)) {
    assert.equal(compactWorkflowActionAllowed(actionId, specs), true, actionId)
    assert.equal(requireCompactWorkflowAction(actionId, specs), specs[actionId])
  }
  assert.equal(compactWorkflowActionAllowed('start_codex', specs), false)
  assert.equal(compactWorkflowActionAllowed('stage_voice', { ...specs, stage_voice: { safety: 'safe', kind: 'terminal', command: 'codex' } }), false)
  assert.equal(compactWorkflowActionAllowed('stage_voice', { ...specs, stage_voice: { safety: 'safe', kind: 'stage', intent: 'focus_attention' } }), false)
  assert.equal(compactWorkflowActionAllowed('copy_guarded_continue', { ...specs, copy_guarded_continue: { safety: 'confirm', kind: 'copy', text: 'Continue.' } }), false)
  assert.equal(compactWorkflowActionAllowed('copy_guarded_continue', { ...specs, copy_guarded_continue: { safety: 'safe', kind: 'copy', text: '' } }), false)
  assert.throws(() => requireCompactWorkflowAction('start_codex', specs), /not an allowlisted safe copy or staged intent/)
})
