import { describe, expect, it } from 'vitest'
import { commissioningPlanCurrent, currentGateIndex, deriveCommissioningStage, gateState, nextCommissioningAction, type CommissioningPlan, type CommissioningSnapshot } from './commissioning'

const candidateHash = 'b'.repeat(64)
const plan: CommissioningPlan = {
  schema: 'ai.ashlr.agent-board.commissioning-plan/v1', id: 'plan-01', createdAt: '2026-09-04T16:00:00.000Z', expiresAt: '2026-09-04T16:15:00.000Z', route: 'ashlr_layer', outcome: 'ready',
  reason: 'manual handoff required', nextAction: 'open handoff', snapshotSha256: 'c'.repeat(64), candidateSha256: candidateHash, baselineSha256: 'a'.repeat(64), inputCacheSha256: null, authority: 'human_input_only', writesAuthorized: false,
}
const base: CommissioningSnapshot = {
  schema: 'ai.ashlr.agent-board.commissioning-snapshot/v1', observedAt: '2026-09-04T16:00:00.000Z', route: 'ashlr_layer', device: { status: 'exact', vidPid: '303A:8298' },
  input: { installation: 'trusted', version: '0.18.4', running: 'quit', cacheStatus: 'different', inputCacheSha256: 'd'.repeat(64) }, receiver: { status: 'single_trusted', inputMonitoring: 'granted' },
  candidate: { status: 'verified', sha256: candidateHash }, baseline: { status: 'captured', sha256: 'a'.repeat(64) }, physicalAcceptance: { status: 'pending', candidateSha256: null, acceptedAt: null },
}

describe('commissioning selectors', () => {
  it('derives bounded stages from the backend snapshot', () => {
    expect(deriveCommissioningStage({ ...base, device: { status: 'absent', vidPid: null } }, null)).toBe('disconnected')
    expect(deriveCommissioningStage({ ...base, input: { ...base.input, installation: 'unavailable' } }, null)).toBe('device_exact')
    expect(deriveCommissioningStage({ ...base, baseline: { status: 'missing', sha256: null } }, null)).toBe('environment_verified')
    expect(deriveCommissioningStage({ ...base, candidate: { status: 'missing', sha256: null } }, null)).toBe('baseline_captured')
    expect(deriveCommissioningStage(base, null)).toBe('candidate_verified')
    expect(deriveCommissioningStage(base, plan)).toBe('manual_action_required')
    expect(deriveCommissioningStage({ ...base, baseline: { status: 'missing', sha256: null } }, { ...plan, outcome: 'manual_export_required' })).toBe('manual_action_required')
  })

  it('requires candidate-bound physical acceptance', () => {
    const accepted = { ...base, input: { ...base.input, cacheStatus: 'candidate' as const, inputCacheSha256: candidateHash }, physicalAcceptance: { status: 'accepted' as const, candidateSha256: candidateHash, acceptedAt: base.observedAt } }
    expect(deriveCommissioningStage(accepted, plan)).toBe('commissioned')
    expect(gateState(accepted, 'physical')).toBe('accepted')
    expect(deriveCommissioningStage({ ...accepted, physicalAcceptance: { ...accepted.physicalAcceptance, candidateSha256: 'other' } }, plan)).toBe('physical_check_ready')
  })

  it('never turns planning into write authority', () => {
    const action = nextCommissioningAction(base, plan, Date.parse(plan.createdAt))
    expect(action).toMatchObject({ action: 'manual_handoff', label: 'Open manual handoff' })
    expect(plan.authority).toBe('human_input_only')
    expect(plan.writesAuthorized).toBe(false)
    expect(action).not.toHaveProperty('apply')
  })

  it('expires plans closed and locates the first unresolved gate', () => {
    expect(commissioningPlanCurrent(plan, Date.parse(plan.expiresAt))).toBe(true)
    expect(commissioningPlanCurrent(plan, Date.parse(plan.expiresAt) + 1)).toBe(false)
    expect(nextCommissioningAction(base, plan, Date.parse(plan.expiresAt) + 1).action).toBe('prepare')
    expect(currentGateIndex({ ...base, receiver: { status: 'absent', inputMonitoring: 'unknown' } })).toBe(2)
  })
})
