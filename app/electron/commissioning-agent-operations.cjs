const { sanitizeCommissioningPlan } = require('./commissioning-plan.cjs')
const { sanitizeCommissioningSnapshot } = require('./commissioning-snapshot.cjs')

const COMMISSIONING_AGENT_OPERATION_SCHEMA = 'ai.ashlr.agent-board.commissioning-agent-operation/v1'
const OPERATIONS = new Set(['inspect', 'plan', 'apply', 'rollback'])
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const RESPONSE_MESSAGES = Object.freeze({
  observed: 'Read-only commissioning state observed. No configuration was changed.',
  plan_prepared: 'Read-only commissioning plan prepared. Work Louder Input and the board were not changed.',
  evidence_unavailable: 'Commissioning evidence could not be collected safely. No configuration was changed.',
  evidence_drift: 'Commissioning evidence changed between probes. No plan was saved and no configuration was changed.',
  plan_unavailable: 'A commissioning plan could not be saved safely. No configuration was changed.',
})
const APPLY_EXTERNAL_MESSAGE = 'The in-app apply executor is unavailable. An enrolled external agent may operate only the visible Work Louder Input UI against the bound candidate and source backup; this request changed nothing.'
const ROLLBACK_EXTERNAL_MESSAGE = 'The in-app rollback executor is unavailable. An enrolled external agent may restore only the bound source backup through the visible Work Louder Input UI; this request changed nothing.'
const INVALID_MESSAGE = 'The commissioning operation request was invalid. No configuration was changed.'
const BLOCKED_MESSAGE = 'The commissioning operation is blocked until its content-bound evidence is current. No configuration was changed.'
const NOT_NEEDED_MESSAGE = 'The current evidence says this operation is not needed. No configuration was changed.'

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function sanitizeCommissioningAgentOperationRequest(value) {
  if (!exactKeys(value, ['operation', 'planId']) || !OPERATIONS.has(value.operation)) return null
  if (['inspect', 'plan'].includes(value.operation)) {
    if (value.planId !== null) return null
  } else if (!SHA256_PATTERN.test(value.planId ?? '')) return null
  return { operation: value.operation, planId: value.planId }
}

function sanitizeCoordinatorResponse(value) {
  if (!exactKeys(value, ['ok', 'code', 'message', 'snapshot', 'plan', 'journalRevision'])) return null
  const message = RESPONSE_MESSAGES[value.code]
  if (typeof value.ok !== 'boolean' || !message) return null
  if ((value.code === 'observed' || value.code === 'plan_prepared') !== value.ok) return null
  const snapshot = value.snapshot === null ? null : sanitizeCommissioningSnapshot(value.snapshot)
  const plan = value.plan === null ? null : sanitizeCommissioningPlan(value.plan)
  if (value.snapshot !== null && !snapshot) return null
  if (value.plan !== null && !plan) return null
  if (value.code === 'plan_prepared' && (!snapshot || !plan)) return null
  if (value.journalRevision !== null
    && (!Number.isSafeInteger(value.journalRevision) || value.journalRevision < 1)) return null
  return {
    ok: value.ok,
    code: value.code,
    message,
    snapshot,
    plan,
    journalRevision: value.journalRevision,
  }
}

function capability(availability, executor, actor, safety) {
  return Object.freeze({ availability, executor, actor, safety })
}

function projectCapabilities(response) {
  const snapshot = response?.snapshot ?? null
  const plan = response?.plan ?? null
  const planBound = Boolean(plan && snapshot
    && plan.candidateSha256 === snapshot.candidate.sha256
    && plan.baselineSha256 === snapshot.baseline.sha256)
  const applyAvailability = plan?.outcome === 'already_configured'
    ? 'not_needed'
    : planBound && plan.outcome === 'ready'
      ? 'external_only'
      : 'blocked'
  const rollbackAvailability = planBound && snapshot.baseline.status === 'captured'
    ? 'external_only'
    : 'blocked'
  return Object.freeze({
    inspect: capability('available', 'electron_main', 'agent', 'read'),
    plan: capability(snapshot ? 'available' : 'blocked', snapshot ? 'electron_main' : 'none', 'agent', 'local_record'),
    apply: capability(applyAvailability, applyAvailability === 'external_only' ? 'enrolled_agent_visible_ui' : 'none', 'agent_or_operator', 'device_write'),
    rollback: capability(rollbackAvailability, rollbackAvailability === 'external_only' ? 'enrolled_agent_visible_ui' : 'none', 'agent_or_operator', 'device_write'),
  })
}

function result(operation, status, response, overrides = {}) {
  return {
    ...response,
    ...overrides,
    agentOperation: {
      schema: COMMISSIONING_AGENT_OPERATION_SCHEMA,
      requestedOperation: operation,
      status,
      internalExecutor: 'not_configured',
      capabilities: projectCapabilities(response),
    },
  }
}

function failure(operation, code, message, response = null) {
  const base = response ?? {
    ok: false,
    code,
    message,
    snapshot: null,
    plan: null,
    journalRevision: null,
  }
  return result(operation, 'blocked', base, { ok: false, code, message, plan: base.plan ?? null })
}

function createCommissioningAgentOperationExecutor(options) {
  if (typeof options?.inspect !== 'function') throw new TypeError('inspect must be a function')
  if (typeof options?.plan !== 'function') throw new TypeError('plan must be a function')

  async function execute(value) {
    const request = sanitizeCommissioningAgentOperationRequest(value)
    if (!request) return failure(null, 'operation_invalid', INVALID_MESSAGE)

    if (request.operation === 'inspect' || request.operation === 'plan') {
      const raw = await options[request.operation]()
      const response = sanitizeCoordinatorResponse(raw)
      if (!response) return failure(request.operation, 'operation_unavailable', INVALID_MESSAGE)
      return result(request.operation, response.ok ? 'completed' : 'blocked', response)
    }

    const response = sanitizeCoordinatorResponse(await options.inspect())
    if (!response) return failure(request.operation, 'operation_unavailable', INVALID_MESSAGE)
    const availability = projectCapabilities(response)[request.operation].availability
    if (!response.plan || response.plan.id !== request.planId || availability === 'blocked') {
      return failure(request.operation, 'operation_blocked', BLOCKED_MESSAGE, response)
    }
    if (availability === 'not_needed') {
      return result(request.operation, 'not_needed', response, {
        ok: false, code: 'operation_not_needed', message: NOT_NEEDED_MESSAGE,
      })
    }
    return result(request.operation, 'external_handoff_required', response, {
      ok: false,
      code: 'external_executor_required',
      message: request.operation === 'apply' ? APPLY_EXTERNAL_MESSAGE : ROLLBACK_EXTERNAL_MESSAGE,
    })
  }

  return Object.freeze({ execute })
}

module.exports = {
  COMMISSIONING_AGENT_OPERATION_SCHEMA,
  createCommissioningAgentOperationExecutor,
  sanitizeCommissioningAgentOperationRequest,
}
