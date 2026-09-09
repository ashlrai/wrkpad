const COMPACT_ACTION_IDS = Object.freeze([
  'copy_amplify_skill',
  'copy_verify_skill',
  'copy_polish_skill',
  'copy_advance_skill',
])

const COMPACT_ACTION_ID_SET = new Set(COMPACT_ACTION_IDS)
const COMPACT_WORKFLOW_ACTIONS = Object.freeze({
  stage_voice: Object.freeze({ kind: 'stage', intent: 'voice_capture' }),
  copy_guarded_continue: Object.freeze({ kind: 'copy' }),
  stage_attention: Object.freeze({ kind: 'stage', intent: 'focus_attention' }),
})

function compactActionAllowed(actionId, actionSpecs) {
  if (typeof actionId !== 'string' || !COMPACT_ACTION_ID_SET.has(actionId)) return false
  if (!actionSpecs || typeof actionSpecs !== 'object' || Array.isArray(actionSpecs)) return false
  if (!Object.hasOwn(actionSpecs, actionId)) return false

  const spec = actionSpecs[actionId]
  return Boolean(
    spec
    && typeof spec === 'object'
    && !Array.isArray(spec)
    && spec.safety === 'safe'
    && spec.kind === 'copy',
  )
}

function requireCompactAction(actionId, actionSpecs) {
  if (!compactActionAllowed(actionId, actionSpecs)) {
    throw new TypeError('Compact Deck action is not an allowlisted safe copy action')
  }
  return actionSpecs[actionId]
}

function compactWorkflowActionAllowed(actionId, actionSpecs) {
  if (typeof actionId !== 'string' || !Object.hasOwn(COMPACT_WORKFLOW_ACTIONS, actionId)) return false
  if (!actionSpecs || typeof actionSpecs !== 'object' || Array.isArray(actionSpecs) || !Object.hasOwn(actionSpecs, actionId)) return false
  const expected = COMPACT_WORKFLOW_ACTIONS[actionId]
  const spec = actionSpecs[actionId]
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) || spec.safety !== 'safe' || spec.kind !== expected.kind) return false
  if (expected.kind === 'stage') return spec.intent === expected.intent
  return typeof spec.text === 'string' && spec.text.length > 0 && spec.text.length <= 8_192
}

function requireCompactWorkflowAction(actionId, actionSpecs) {
  if (!compactWorkflowActionAllowed(actionId, actionSpecs)) {
    throw new TypeError('Compact Deck workflow action is not an allowlisted safe copy or staged intent')
  }
  return actionSpecs[actionId]
}

module.exports = {
  COMPACT_ACTION_IDS,
  COMPACT_WORKFLOW_ACTIONS,
  compactActionAllowed,
  compactWorkflowActionAllowed,
  requireCompactAction,
  requireCompactWorkflowAction,
}
