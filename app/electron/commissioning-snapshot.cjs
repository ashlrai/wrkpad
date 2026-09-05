const { createHash } = require('node:crypto')

const COMMISSIONING_SNAPSHOT_SCHEMA = 'ai.ashlr.agent-board.commissioning-snapshot/v1'
const CREATOR_MICRO_2_VID_PID = '303A:8298'
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const VID_PID_PATTERN = /^[0-9A-F]{4}:[0-9A-F]{4}$/
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/

const DEVICE_STATUSES = new Set(['exact', 'absent', 'unsupported', 'ambiguous'])
const INSTALLATION_STATUSES = new Set(['trusted', 'unavailable', 'untrusted', 'multiple'])
const RUNNING_STATUSES = new Set(['running', 'quit', 'unknown'])
const CACHE_STATUSES = new Set(['candidate', 'different', 'missing', 'unknown'])
const RECEIVER_STATUSES = new Set(['single_trusted', 'absent', 'multiple', 'untrusted', 'unknown'])
const MONITORING_STATUSES = new Set(['granted', 'denied', 'unknown'])
const CANDIDATE_STATUSES = new Set(['verified', 'missing', 'invalid'])
const BASELINE_STATUSES = new Set(['captured', 'missing', 'invalid'])
const ACCEPTANCE_STATUSES = new Set(['accepted', 'pending', 'failed', 'stale'])

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

function sanitizeDevice(value) {
  if (!exactKeys(value, ['status', 'vidPid']) || !DEVICE_STATUSES.has(value.status)) return null
  if (value.status === 'exact') {
    if (value.vidPid !== CREATOR_MICRO_2_VID_PID) return null
  } else if (value.status === 'unsupported') {
    if (!VID_PID_PATTERN.test(value.vidPid ?? '') || value.vidPid === CREATOR_MICRO_2_VID_PID) return null
  } else if (value.vidPid !== null) return null
  return { status: value.status, vidPid: value.vidPid }
}

function sanitizeInput(value) {
  if (!exactKeys(value, ['installation', 'version', 'running', 'cacheStatus', 'inputCacheSha256'])) return null
  if (!INSTALLATION_STATUSES.has(value.installation) || !RUNNING_STATUSES.has(value.running)
    || !CACHE_STATUSES.has(value.cacheStatus) || !nullableSha256(value.inputCacheSha256)) return null
  if (value.installation === 'trusted') {
    if (!VERSION_PATTERN.test(value.version ?? '')) return null
  } else if (value.version !== null) return null
  if (['candidate', 'different'].includes(value.cacheStatus)) {
    if (!SHA256_PATTERN.test(value.inputCacheSha256 ?? '')) return null
  } else if (value.inputCacheSha256 !== null) return null
  return {
    installation: value.installation,
    version: value.version,
    running: value.running,
    cacheStatus: value.cacheStatus,
    inputCacheSha256: value.inputCacheSha256,
  }
}

function sanitizeReceiver(value) {
  if (!exactKeys(value, ['status', 'inputMonitoring'])) return null
  if (!RECEIVER_STATUSES.has(value.status) || !MONITORING_STATUSES.has(value.inputMonitoring)) return null
  return { status: value.status, inputMonitoring: value.inputMonitoring }
}

function sanitizeArtifact(value, statuses) {
  if (!exactKeys(value, ['status', 'sha256']) || !statuses.has(value.status) || !nullableSha256(value.sha256)) return null
  const hasArtifact = value.status === 'verified' || value.status === 'captured'
  if (hasArtifact !== SHA256_PATTERN.test(value.sha256 ?? '')) return null
  return { status: value.status, sha256: value.sha256 }
}

function sanitizePhysicalAcceptance(value) {
  if (!exactKeys(value, ['status', 'candidateSha256', 'acceptedAt']) || !ACCEPTANCE_STATUSES.has(value.status)) return null
  if (!nullableSha256(value.candidateSha256)) return null
  if (value.status === 'accepted' || value.status === 'stale') {
    if (!SHA256_PATTERN.test(value.candidateSha256 ?? '') || !validIsoTimestamp(value.acceptedAt)) return null
  } else if (value.candidateSha256 !== null || value.acceptedAt !== null) return null
  return {
    status: value.status,
    candidateSha256: value.candidateSha256,
    acceptedAt: value.acceptedAt,
  }
}

function sanitizeCommissioningSnapshot(value) {
  if (!exactKeys(value, [
    'schema',
    'observedAt',
    'route',
    'device',
    'input',
    'receiver',
    'candidate',
    'baseline',
    'physicalAcceptance',
  ])) return null
  if (value.schema !== COMMISSIONING_SNAPSHOT_SCHEMA || value.route !== 'ashlr_layer' || !validIsoTimestamp(value.observedAt)) return null
  const device = sanitizeDevice(value.device)
  const input = sanitizeInput(value.input)
  const receiver = sanitizeReceiver(value.receiver)
  const candidate = sanitizeArtifact(value.candidate, CANDIDATE_STATUSES)
  const baseline = sanitizeArtifact(value.baseline, BASELINE_STATUSES)
  const physicalAcceptance = sanitizePhysicalAcceptance(value.physicalAcceptance)
  if (!device || !input || !receiver || !candidate || !baseline || !physicalAcceptance) return null

  if (input.cacheStatus === 'candidate' && input.inputCacheSha256 !== candidate.sha256) return null
  if (input.cacheStatus === 'different' && candidate.sha256 && input.inputCacheSha256 === candidate.sha256) return null
  if (physicalAcceptance.status === 'accepted' && physicalAcceptance.candidateSha256 !== candidate.sha256) return null
  if (Date.parse(physicalAcceptance.acceptedAt ?? value.observedAt) > Date.parse(value.observedAt)) return null

  return {
    schema: COMMISSIONING_SNAPSHOT_SCHEMA,
    observedAt: value.observedAt,
    route: 'ashlr_layer',
    device,
    input,
    receiver,
    candidate,
    baseline,
    physicalAcceptance,
  }
}

function createCommissioningSnapshot(evidence, observedAt = new Date().toISOString()) {
  const snapshot = sanitizeCommissioningSnapshot({
    schema: COMMISSIONING_SNAPSHOT_SCHEMA,
    observedAt,
    route: 'ashlr_layer',
    ...evidence,
  })
  if (!snapshot) throw new TypeError('commissioning evidence is invalid or privacy-unbounded')
  return snapshot
}

function commissioningSnapshotSha256(value) {
  const snapshot = sanitizeCommissioningSnapshot(value)
  if (!snapshot) throw new TypeError('commissioning snapshot is invalid')
  // observedAt is collection metadata, not commissioning state. Excluding it
  // lets a coordinator compare two fresh probes without treating clock drift as
  // hardware drift.
  const { observedAt: _observedAt, ...state } = snapshot
  return createHash('sha256').update(JSON.stringify(state)).digest('hex')
}

function blocked(reason) {
  return { outcome: 'blocked', reason, nextAction: 'resolve_blocker' }
}

function evaluateCommissioningOutcome(value) {
  const snapshot = sanitizeCommissioningSnapshot(value)
  if (!snapshot) return blocked('snapshot_invalid')
  if (snapshot.device.status !== 'exact') return blocked(`device_${snapshot.device.status}`)
  if (snapshot.input.installation !== 'trusted') return blocked(`input_${snapshot.input.installation}`)
  if (snapshot.receiver.status !== 'single_trusted') return blocked(`receiver_${snapshot.receiver.status}`)
  if (snapshot.receiver.inputMonitoring !== 'granted') return blocked(`input_monitoring_${snapshot.receiver.inputMonitoring}`)
  if (snapshot.candidate.status !== 'verified') return blocked(`candidate_${snapshot.candidate.status}`)
  if (snapshot.baseline.status === 'invalid') return blocked('baseline_invalid')

  // Cache equivalence is deliberately insufficient. `already_configured`
  // requires a candidate-bound physical acceptance receipt as independent
  // evidence that the actual controls responded.
  if (snapshot.input.cacheStatus === 'candidate' && snapshot.physicalAcceptance.status === 'accepted') {
    return { outcome: 'already_configured', reason: 'candidate_physically_accepted', nextAction: 'none' }
  }
  if (snapshot.baseline.status === 'missing') {
    return { outcome: 'manual_export_required', reason: 'baseline_export_required', nextAction: 'export_baseline_in_input' }
  }
  return { outcome: 'ready', reason: 'candidate_ready_for_human_input', nextAction: 'review_manual_input_steps' }
}

module.exports = {
  COMMISSIONING_SNAPSHOT_SCHEMA,
  CREATOR_MICRO_2_VID_PID,
  commissioningSnapshotSha256,
  createCommissioningSnapshot,
  evaluateCommissioningOutcome,
  sanitizeCommissioningSnapshot,
}
