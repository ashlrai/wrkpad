const { createHash } = require('node:crypto')
const {
  commissioningSnapshotSha256,
  evaluateCommissioningOutcome,
  sanitizeCommissioningSnapshot,
} = require('./commissioning-snapshot.cjs')

const COMMISSIONING_PLAN_SCHEMA = 'ai.ashlr.agent-board.commissioning-plan/v1'
const DEFAULT_PLAN_TTL_MS = 30 * 60 * 1000
const MIN_PLAN_TTL_MS = 60 * 1000
const MAX_PLAN_TTL_MS = 24 * 60 * 60 * 1000
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const OUTCOMES = new Set(['ready', 'manual_export_required', 'blocked', 'already_configured'])
const OUTCOME_DETAILS = Object.freeze({
  ready: Object.freeze({ reason: 'candidate_ready_for_human_input', nextAction: 'review_manual_input_steps' }),
  manual_export_required: Object.freeze({ reason: 'baseline_export_required', nextAction: 'export_baseline_in_input' }),
  already_configured: Object.freeze({ reason: 'candidate_physically_accepted', nextAction: 'none' }),
})

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function validIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length !== 24) return false
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function nullableSha256(value) {
  return value === null || SHA256_PATTERN.test(value ?? '')
}

function planId(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function sanitizeCommissioningPlan(value) {
  if (!exactKeys(value, [
    'schema',
    'id',
    'createdAt',
    'expiresAt',
    'route',
    'outcome',
    'reason',
    'nextAction',
    'snapshotSha256',
    'candidateSha256',
    'baselineSha256',
    'inputCacheSha256',
    'authority',
    'writesAuthorized',
  ])) return null
  if (value.schema !== COMMISSIONING_PLAN_SCHEMA || value.route !== 'ashlr_layer') return null
  if (!SHA256_PATTERN.test(value.id ?? '') || !SHA256_PATTERN.test(value.snapshotSha256 ?? '')) return null
  if (!nullableSha256(value.candidateSha256) || !nullableSha256(value.baselineSha256)
    || !nullableSha256(value.inputCacheSha256)) return null
  if (!validIsoTimestamp(value.createdAt) || !validIsoTimestamp(value.expiresAt)) return null
  const lifetime = Date.parse(value.expiresAt) - Date.parse(value.createdAt)
  if (lifetime < MIN_PLAN_TTL_MS || lifetime > MAX_PLAN_TTL_MS) return null
  if (!OUTCOMES.has(value.outcome) || typeof value.reason !== 'string' || typeof value.nextAction !== 'string') return null
  if (value.authority !== 'external_agent_visible_ui' || value.writesAuthorized !== false) return null
  if (value.outcome === 'blocked') {
    if (!/^[a-z0-9_]{1,64}$/.test(value.reason) || value.nextAction !== 'resolve_blocker') return null
  } else {
    const detail = OUTCOME_DETAILS[value.outcome]
    if (!detail || value.reason !== detail.reason || value.nextAction !== detail.nextAction) return null
  }
  const payload = {
    schema: COMMISSIONING_PLAN_SCHEMA,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    route: 'ashlr_layer',
    outcome: value.outcome,
    reason: value.reason,
    nextAction: value.nextAction,
    snapshotSha256: value.snapshotSha256,
    candidateSha256: value.candidateSha256,
    baselineSha256: value.baselineSha256,
    inputCacheSha256: value.inputCacheSha256,
    authority: 'external_agent_visible_ui',
    writesAuthorized: false,
  }
  if (value.id !== planId(payload)) return null
  const { schema, ...rest } = payload
  return { schema, id: value.id, ...rest }
}

function createCommissioningPlan(snapshotValue, options = {}) {
  const snapshot = sanitizeCommissioningSnapshot(snapshotValue)
  if (!snapshot) throw new TypeError('commissioning snapshot is invalid')
  const createdAt = options.createdAt ?? new Date().toISOString()
  const ttlMs = options.ttlMs ?? DEFAULT_PLAN_TTL_MS
  if (!validIsoTimestamp(createdAt) || !Number.isSafeInteger(ttlMs)
    || ttlMs < MIN_PLAN_TTL_MS || ttlMs > MAX_PLAN_TTL_MS) {
    throw new TypeError('commissioning plan time bounds are invalid')
  }
  if (Date.parse(createdAt) < Date.parse(snapshot.observedAt)) {
    throw new TypeError('commissioning plan predates its evidence')
  }
  const expiresAt = new Date(Date.parse(createdAt) + ttlMs).toISOString()
  const decision = evaluateCommissioningOutcome(snapshot)
  const payload = {
    schema: COMMISSIONING_PLAN_SCHEMA,
    createdAt,
    expiresAt,
    route: 'ashlr_layer',
    outcome: decision.outcome,
    reason: decision.reason,
    nextAction: decision.nextAction,
    snapshotSha256: commissioningSnapshotSha256(snapshot),
    candidateSha256: snapshot.candidate.sha256,
    baselineSha256: snapshot.baseline.sha256,
    inputCacheSha256: snapshot.input.inputCacheSha256,
    authority: 'external_agent_visible_ui',
    writesAuthorized: false,
  }
  const plan = sanitizeCommissioningPlan({ id: planId(payload), ...payload })
  if (!plan) throw new TypeError('commissioning plan is invalid')
  return plan
}

function evaluateCommissioningPlan(planValue, snapshotValue, now = Date.now()) {
  const plan = sanitizeCommissioningPlan(planValue)
  const snapshot = sanitizeCommissioningSnapshot(snapshotValue)
  if (!plan) return { status: 'invalid', reason: 'plan_invalid' }
  if (!snapshot) return { status: 'invalid', reason: 'snapshot_invalid' }
  const current = now instanceof Date ? new Date(now.getTime()) : new Date(now)
  if (!Number.isFinite(current.getTime())) return { status: 'invalid', reason: 'current_time_invalid' }
  if (current.getTime() < Date.parse(plan.createdAt)) return { status: 'invalid', reason: 'plan_timestamp_future' }
  if (current.getTime() >= Date.parse(plan.expiresAt)) return { status: 'expired', reason: 'plan_expired' }
  if (commissioningSnapshotSha256(snapshot) !== plan.snapshotSha256) return { status: 'drifted', reason: 'snapshot_changed' }
  const expected = evaluateCommissioningOutcome(snapshot)
  if (plan.outcome !== expected.outcome || plan.reason !== expected.reason || plan.nextAction !== expected.nextAction) {
    return { status: 'invalid', reason: 'plan_decision_invalid' }
  }
  return { status: 'current', reason: 'plan_matches_snapshot' }
}

module.exports = {
  COMMISSIONING_PLAN_SCHEMA,
  DEFAULT_PLAN_TTL_MS,
  createCommissioningPlan,
  evaluateCommissioningPlan,
  sanitizeCommissioningPlan,
}
