import { Activity, Check, ChevronRight, CircleAlert, Fingerprint, HardDrive, KeyRound, RadioTower, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { COMMISSIONING_GATES, currentGateIndex, deriveCommissioningStage, gateState, nextCommissioningAction, type CommissioningAction, type CommissioningAgentOperationState, type CommissioningGateId, type CommissioningOperation, type CommissioningOperationAvailability, type CommissioningPlan, type CommissioningSnapshot } from '../commissioning'

export interface CommissioningWizardProps {
  snapshot: CommissioningSnapshot
  plan: CommissioningPlan | null
  agentOperation: CommissioningAgentOperationState | null
  busy: boolean
  onRefresh: () => void | Promise<void>
  onPrepare: () => void | Promise<void>
  onManualHandoff: () => void | Promise<void>
  onFlightCheck: () => void | Promise<void>
}

const gateExplanation: Record<CommissioningGateId, string> = {
  device: 'Exact USB identity observed; control behavior is not inferred.', input: 'Installed app trust and integrity evidence.',
  receiver: 'One trusted receiver. Permission is accepted only through the later operator check.', baseline: 'A private source export preserved before candidate work; it is not asserted to be the current board state.',
  candidate: 'The managed candidate passed semantic validation.', physical: 'An operator-attested global-shortcut run for the active session; keyboard source is not cryptographically identifiable.',
}
const stageCopy = {
  disconnected: ['DISCOVERY / LOCAL ONLY', 'Connect one exact board.', 'Waiting for a Creator Micro 2 over USB. Detection proves identity only.'],
  device_exact: ['IDENTITY / OBSERVED', 'The board is here. Prove the route.', 'Next, verify the local receiver, Work Louder Input integrity, and macOS permission evidence.'],
  environment_verified: ['ENVIRONMENT / VERIFIED', 'Protect the source artifact.', 'Preserve the selected export before preparing a managed candidate.'],
  baseline_captured: ['SOURCE / PROTECTED', 'Build the plan, not the write.', 'Validate a candidate and bind it to current evidence without changing the board.'],
  candidate_verified: ['CANDIDATE / VERIFIED', 'Prepare a bound agent handoff.', 'A short-lived plan binds an enrolled external agent to the visible Input workflow without authorizing an in-app write.'],
  manual_action_required: ['EXTERNAL AGENT / READY', 'Keep the run visible and bounded.', 'Review the hashes, then let an enrolled external agent continue through visible Work Louder Input UI.'],
  physical_check_ready: ['OPERATOR CHECK / READY', 'Attest the shortcut path.', 'Cache agreement is not device sync proof. Use only the intended board during the guided sequence.'],
  commissioned: ['ACTIVE RUN / ACCEPTED', 'Shortcut path accepted for this run.', 'The active operator-guided run passed. Saved receipts remain historical and do not commission a future session.'],
  blocked: ['COMMISSIONING / PAUSED', 'Stop at the failed gate.', 'Nothing downstream is treated as proven. Resolve the local blocker and run checks again.'],
} as const

const operationCopy: Record<CommissioningOperation, { label: string; detail: string }> = {
  inspect: { label: 'Inspect', detail: 'Bounded evidence through Electron main.' },
  plan: { label: 'Plan', detail: 'Private, expiring, content-bound local record.' },
  apply: { label: 'Apply', detail: 'External visible-UI workflow; candidate, source backup, and cold-relaunch readback stay bound.' },
  rollback: { label: 'Rollback', detail: 'External visible-UI restore only; the in-app executor cannot write the device.' },
}
const availabilityLabel: Record<CommissioningOperationAvailability, string> = {
  available: 'Available here',
  external_only: 'External agent only',
  blocked: 'Blocked',
  not_needed: 'Not needed',
}

const gateIcon = (id: CommissioningGateId) => {
  switch (id) {
    case 'device': return <Fingerprint size={16} />
    case 'input': return <ShieldCheck size={16} />
    case 'receiver': return <RadioTower size={16} />
    case 'baseline': return <HardDrive size={16} />
    case 'candidate': return <SlidersHorizontal size={16} />
    case 'physical': return <KeyRound size={16} />
  }
}
const compactHash = (value: string | null) => value ? `${value.slice(0, 8)}…${value.slice(-6)}` : 'Not recorded'
const blockedLabel = (snapshot: CommissioningSnapshot, plan: CommissioningPlan | null) => {
  if (snapshot.device.status === 'ambiguous') return 'More than one eligible board was observed.'
  if (snapshot.device.status === 'unsupported') return 'The connected device is not the exact supported model.'
  if (snapshot.input.installation === 'untrusted' || snapshot.input.installation === 'multiple') return 'Work Louder Input trust could not be established.'
  if (snapshot.input.cacheStatus === 'invalid' || snapshot.input.cacheStatus === 'unsafe') return 'Work Louder Input cache evidence is invalid or unsafe.'
  if (snapshot.receiver.status === 'multiple' || snapshot.receiver.status === 'untrusted') return 'Receiver exclusivity or integrity failed.'
  if (snapshot.receiver.inputMonitoring === 'denied') return 'Input Monitoring permission is denied.'
  if (snapshot.baseline.status === 'invalid') return 'The protected source export is invalid.'
  if (snapshot.candidate.status === 'invalid') return 'The candidate failed validation.'
  if (snapshot.physicalAcceptance.status === 'failed') return 'A physical control reached the wrong destination.'
  if (plan?.outcome === 'blocked') return 'The bounded plan is blocked.'
  return null
}

export default function CommissioningWizard({ snapshot, plan, agentOperation, busy, onRefresh, onPrepare, onManualHandoff, onFlightCheck }: CommissioningWizardProps) {
  const stage = deriveCommissioningStage(snapshot, plan)
  const copy = stageCopy[stage]
  const next = nextCommissioningAction(snapshot, plan)
  const currentIndex = currentGateIndex(snapshot)
  const blocker = blockedLabel(snapshot, plan)
  const callbacks: Record<CommissioningAction, () => void | Promise<void>> = { refresh: onRefresh, prepare: onPrepare, manual_handoff: onManualHandoff, flight_check: onFlightCheck }

  return <section className="commissioner" aria-labelledby="commissioner-title" aria-busy={busy}>
    <header className="commissioner-hero">
      <div className="commissioner-copy"><span className="eyebrow">{copy[0]}</span><h2 id="commissioner-title">{copy[1]}</h2><p>{copy[2]}</p></div>
      <div className={`commissioner-device ${snapshot.device.status === 'exact' ? 'observed' : ''}`} aria-label={snapshot.device.status === 'exact' ? 'Creator Micro 2 observed' : 'Creator Micro 2 not observed'}>
        <span className="commissioner-dial" aria-hidden="true" />
        <div className="commissioner-agent-lamps" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div>
        <span className="commissioner-stick" aria-hidden="true"><i /></span>
        <small>{snapshot.device.status === 'exact' ? `Creator Micro 2 · ${snapshot.device.vidPid}` : 'USB waiting'}</small>
      </div>
    </header>

    <ol className="commissioner-spine" aria-label="Commissioning proof levels">
      {COMMISSIONING_GATES.map((gate, index) => {
        const state = gateState(snapshot, gate.id)
        const current = index === currentIndex && stage !== 'commissioned'
        return <li key={gate.id} className={`proof-${state}${current ? ' current' : ''}`} aria-current={current ? 'step' : undefined}>
          <span className="commissioner-proof-icon">{gateIcon(gate.id)}</span><span><b>{gate.label}</b><small>{gate.level}</small></span><i aria-hidden="true" />
        </li>
      })}
    </ol>

    {blocker && <div className="commissioner-alert" role="alert"><CircleAlert size={18} /><span><strong>Commissioning is paused.</strong>{blocker} Nothing was written to the board.</span></div>}

    <div className="commissioner-console">
      <div className="commissioner-next"><span className="eyebrow">ONE SAFE NEXT ACTION</span><h3>{next.label}</h3><p>{next.description}</p>
        <button type="button" disabled={busy} onClick={() => void callbacks[next.action]()}>{busy ? <Activity className="spin" size={16} /> : stage === 'commissioned' ? <Check size={16} /> : <ChevronRight size={16} />}{busy ? 'Checking bounded evidence…' : next.label}</button>
      </div>
      <aside className="commissioner-boundary" aria-label="Commissioning authority boundary"><ShieldCheck size={19} /><div><span className="eyebrow">AGENT COMMISSIONING</span><strong>External agent workflow available</strong><p>An enrolled Codex or Claude agent may back up, import, activate, cold-relaunch, verify, and roll back through visible Work Louder Input UI. The embedded unattended executor is not configured; reset, firmware, raw HID, and direct cache or device-file writes remain unavailable.</p></div></aside>
    </div>

    {agentOperation && <section className="commissioner-agent-operations" aria-labelledby="commissioner-agent-operations-title">
      <header><div><span className="eyebrow">AGENT OPERATIONS</span><h3 id="commissioner-agent-operations-title">Typed commissioning surface</h3></div><span className="commissioner-executor-status">Internal executor · not configured</span></header>
      <ol>{(['inspect', 'plan', 'apply', 'rollback'] as const).map((operation) => { const capability = agentOperation.capabilities[operation]; return <li key={operation} className={`operation-${capability.availability}`}><div><strong>{operationCopy[operation].label}</strong><p>{operationCopy[operation].detail}</p></div><span>{availabilityLabel[capability.availability]}</span></li> })}</ol>
      <p><ShieldCheck size={14} /> External-only means an enrolled agent uses the visible Work Louder Input UI. It does not make profile or device mutation available through Electron IPC.</p>
    </section>}

    {plan && <details className="commissioner-plan"><summary>Review bounded commissioning plan <span>{plan.outcome.replaceAll('_', ' ')}</span></summary>
      <div className="commissioner-plan-grid"><dl><div><dt>Route</dt><dd>Ashlr layer</dd></div><div><dt>Source backup</dt><dd><code>{compactHash(plan.baselineSha256)}</code></dd></div><div><dt>Candidate</dt><dd><code>{compactHash(plan.candidateSha256)}</code></dd></div><div><dt>Authority</dt><dd>Interactive Input UI</dd></div></dl>
        <ul><li><Check size={13} /> Unmanaged profiles preserved</li><li><Check size={13} /> Source artifact remains available</li><li><Check size={13} /> Cold relaunch readback required</li></ul></div>
      <p className="commissioner-manual-note"><CircleAlert size={15} /><span><strong>Preparing this plan does not apply it.</strong> An enrolled external agent may follow the visible Work Louder Input handoff. Cache agreement, device synchronization, and physical acceptance remain separate.</span></p>
    </details>}

    <details className="commissioner-evidence"><summary>Evidence by proof level <span>{COMMISSIONING_GATES.filter((gate) => ['observed', 'verified', 'accepted'].includes(gateState(snapshot, gate.id))).length}/{COMMISSIONING_GATES.length} gates</span></summary>
      <div className="commissioner-evidence-list">{COMMISSIONING_GATES.map((gate) => { const state = gateState(snapshot, gate.id); return <article key={gate.id} className={`proof-${state}`}><span>{gateIcon(gate.id)}</span><div><strong>{gate.label}</strong><p>{gateExplanation[gate.id]}</p></div><small>{state}</small></article> })}</div>
      <p className="commissioner-cache-caveat"><ShieldCheck size={14} /> Work Louder Input cache status is supporting evidence only. It never proves the physical board synchronized.</p>
    </details>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{copy[1]} {next.label}.</p>
  </section>
}
