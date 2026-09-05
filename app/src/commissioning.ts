export type CommissioningSnapshot = {
  schema: string
  observedAt: string
  route: 'ashlr_layer'
  device: { status: 'exact' | 'absent' | 'unsupported' | 'ambiguous'; vidPid: string | null }
  input: { installation: 'trusted' | 'unavailable' | 'untrusted' | 'multiple'; version: string | null; running: 'running' | 'quit' | 'unknown'; cacheStatus: 'candidate' | 'different' | 'missing' | 'unknown'; inputCacheSha256: string | null }
  receiver: { status: 'single_trusted' | 'absent' | 'multiple' | 'untrusted' | 'unknown'; inputMonitoring: 'granted' | 'denied' | 'unknown' }
  candidate: { status: 'verified' | 'missing' | 'invalid'; sha256: string | null }
  baseline: { status: 'captured' | 'missing' | 'invalid'; sha256: string | null }
  physicalAcceptance: { status: 'accepted' | 'pending' | 'failed' | 'stale'; candidateSha256: string | null; acceptedAt: string | null }
}

export type CommissioningPlan = {
  schema: string
  id: string
  createdAt: string
  expiresAt: string
  route: 'ashlr_layer'
  outcome: 'ready' | 'manual_export_required' | 'blocked' | 'already_configured'
  reason: string
  nextAction: string
  snapshotSha256: string
  candidateSha256: string | null
  baselineSha256: string | null
  inputCacheSha256: string | null
  authority: 'human_input_only'
  writesAuthorized: false
}

export type CommissioningCoordinatorResponse = { ok: boolean; code: string; message: string; snapshot: CommissioningSnapshot | null; plan: CommissioningPlan | null; journalRevision: number | null }
export type CommissioningStage = 'disconnected' | 'device_exact' | 'environment_verified' | 'baseline_captured' | 'candidate_verified' | 'manual_action_required' | 'physical_check_ready' | 'commissioned' | 'blocked'
export type CommissioningAction = 'refresh' | 'prepare' | 'manual_handoff' | 'flight_check' | 'review_receipt'
export type CommissioningNextAction = { action: CommissioningAction; label: string; description: string }

export const COMMISSIONING_GATES = [
  { id: 'device', label: 'Exact device', level: 'Observed' }, { id: 'input', label: 'Input trust', level: 'Verified' },
  { id: 'receiver', label: 'Receiver', level: 'Verified' }, { id: 'baseline', label: 'Rollback point', level: 'Protected' },
  { id: 'candidate', label: 'Candidate', level: 'Verified' }, { id: 'physical', label: 'Physical proof', level: 'Accepted' },
] as const
export type CommissioningGateId = typeof COMMISSIONING_GATES[number]['id']
export type CommissioningGateState = 'pending' | 'observed' | 'verified' | 'accepted' | 'problem'

export const commissioningPlanCurrent = (plan: CommissioningPlan | null, now = Date.now()) => {
  if (!plan) return false
  const expiry = Date.parse(plan.expiresAt)
  return Number.isFinite(expiry) && expiry >= now
}
const environmentVerified = (snapshot: CommissioningSnapshot) => snapshot.input.installation === 'trusted' && snapshot.receiver.status === 'single_trusted' && snapshot.receiver.inputMonitoring === 'granted'
const cacheMatchesCandidate = (snapshot: CommissioningSnapshot) => snapshot.input.cacheStatus === 'candidate' && snapshot.candidate.sha256 !== null && snapshot.input.inputCacheSha256 === snapshot.candidate.sha256
const physicalAcceptanceCurrent = (snapshot: CommissioningSnapshot) => snapshot.physicalAcceptance.status === 'accepted' && snapshot.candidate.sha256 !== null && snapshot.physicalAcceptance.candidateSha256 === snapshot.candidate.sha256
const hardBlocked = (snapshot: CommissioningSnapshot, plan: CommissioningPlan | null) => snapshot.device.status === 'unsupported' || snapshot.device.status === 'ambiguous' || snapshot.input.installation === 'untrusted' || snapshot.input.installation === 'multiple' || snapshot.receiver.status === 'multiple' || snapshot.receiver.status === 'untrusted' || snapshot.receiver.inputMonitoring === 'denied' || snapshot.candidate.status === 'invalid' || snapshot.baseline.status === 'invalid' || snapshot.physicalAcceptance.status === 'failed' || plan?.outcome === 'blocked'

export function deriveCommissioningStage(snapshot: CommissioningSnapshot, plan: CommissioningPlan | null): CommissioningStage {
  if (snapshot.device.status === 'absent') return 'disconnected'
  if (hardBlocked(snapshot, plan) || snapshot.device.status !== 'exact') return 'blocked'
  if (!environmentVerified(snapshot)) return 'device_exact'
  if (plan?.outcome === 'manual_export_required') return 'manual_action_required'
  if (snapshot.baseline.status !== 'captured') return 'environment_verified'
  if (snapshot.candidate.status !== 'verified') return 'baseline_captured'
  if (physicalAcceptanceCurrent(snapshot)) return 'commissioned'
  if (cacheMatchesCandidate(snapshot) || plan?.outcome === 'already_configured') return 'physical_check_ready'
  if (!plan) return 'candidate_verified'
  return 'manual_action_required'
}

export function gateState(snapshot: CommissioningSnapshot, gate: CommissioningGateId): CommissioningGateState {
  switch (gate) {
    case 'device': return snapshot.device.status === 'exact' ? 'observed' : snapshot.device.status === 'absent' ? 'pending' : 'problem'
    case 'input': return snapshot.input.installation === 'trusted' ? 'verified' : snapshot.input.installation === 'unavailable' ? 'pending' : 'problem'
    case 'receiver':
      if (snapshot.receiver.status === 'single_trusted' && snapshot.receiver.inputMonitoring === 'granted') return 'verified'
      return snapshot.receiver.status === 'multiple' || snapshot.receiver.status === 'untrusted' || snapshot.receiver.inputMonitoring === 'denied' ? 'problem' : 'pending'
    case 'baseline': return snapshot.baseline.status === 'captured' ? 'verified' : snapshot.baseline.status === 'invalid' ? 'problem' : 'pending'
    case 'candidate': return snapshot.candidate.status === 'verified' ? 'verified' : snapshot.candidate.status === 'invalid' ? 'problem' : 'pending'
    case 'physical': return physicalAcceptanceCurrent(snapshot) ? 'accepted' : snapshot.physicalAcceptance.status === 'failed' ? 'problem' : 'pending'
  }
}

export function nextCommissioningAction(snapshot: CommissioningSnapshot, plan: CommissioningPlan | null, now = Date.now()): CommissioningNextAction {
  switch (deriveCommissioningStage(snapshot, plan)) {
    case 'disconnected': return { action: 'refresh', label: 'Detect my board', description: 'Look only for the exact Creator Micro 2 USB identity.' }
    case 'device_exact': return { action: 'refresh', label: 'Verify local environment', description: 'Re-check app integrity, receiver exclusivity, and permission evidence.' }
    case 'environment_verified': return { action: 'prepare', label: 'Protect current setup', description: 'Capture a private rollback baseline before candidate work.' }
    case 'baseline_captured': return { action: 'prepare', label: 'Prepare commissioning plan', description: 'Validate the candidate without writing to the board.' }
    case 'candidate_verified': return { action: 'prepare', label: 'Prepare commissioning plan', description: 'Bind current evidence to a short-lived, human-only handoff.' }
    case 'manual_action_required':
      return !commissioningPlanCurrent(plan, now)
        ? { action: 'prepare', label: 'Refresh commissioning plan', description: 'Prepare a fresh plan because the previous evidence binding expired.' }
        : { action: 'manual_handoff', label: 'Open manual handoff', description: 'Complete the exact device action yourself in Work Louder Input.' }
    case 'physical_check_ready': return { action: 'flight_check', label: 'Start physical check', description: 'Press the real controls to produce fresh acceptance evidence.' }
    case 'commissioned': return { action: 'review_receipt', label: 'Review acceptance receipt', description: 'Inspect the bounded evidence that completed commissioning.' }
    case 'blocked': return { action: 'refresh', label: 'Run checks again', description: 'Re-check bounded local evidence after resolving the failed gate.' }
  }
}

export const currentGateIndex = (snapshot: CommissioningSnapshot) => {
  const states = COMMISSIONING_GATES.map((gate) => gateState(snapshot, gate.id))
  const unresolved = states.findIndex((state) => state === 'pending' || state === 'problem')
  return unresolved === -1 ? COMMISSIONING_GATES.length - 1 : unresolved
}
