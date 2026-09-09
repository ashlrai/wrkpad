// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommissioningPlan, CommissioningSnapshot } from '../commissioning'
import CommissioningWizard from './CommissioningWizard'

const candidateHash = 'b'.repeat(64)
const snapshot: CommissioningSnapshot = {
  schema: 'ai.ashlr.agent-board.commissioning-snapshot/v1', observedAt: '2026-09-04T16:04:00.000Z', route: 'ashlr_layer', device: { status: 'exact', vidPid: '303A:8298' },
  input: { installation: 'trusted', version: '0.18.4', running: 'quit', cacheStatus: 'different', inputCacheSha256: 'd'.repeat(64) }, receiver: { status: 'single_trusted', inputMonitoring: 'granted' },
  candidate: { status: 'verified', sha256: candidateHash }, baseline: { status: 'captured', sha256: 'a'.repeat(64) }, physicalAcceptance: { status: 'pending', candidateSha256: null, acceptedAt: null },
}
const plan: CommissioningPlan = {
  schema: 'ai.ashlr.agent-board.commissioning-plan/v1', id: 'never-render-plan-id', createdAt: '2026-09-04T16:00:00.000Z', expiresAt: '2099-09-04T16:15:00.000Z', route: 'ashlr_layer', outcome: 'ready',
  reason: '/Users/private/raw-reason-must-not-render', nextAction: 'raw-next-action-must-not-render', snapshotSha256: 'c'.repeat(64), candidateSha256: candidateHash, baselineSha256: 'a'.repeat(64), inputCacheSha256: null, authority: 'external_agent_visible_ui', writesAuthorized: false,
}
const agentOperation = {
  schema: 'ai.ashlr.agent-board.commissioning-agent-operation/v1' as const,
  requestedOperation: 'inspect' as const,
  status: 'completed' as const,
  internalExecutor: 'not_configured' as const,
  capabilities: {
    inspect: { availability: 'available' as const, executor: 'electron_main' as const, actor: 'agent' as const, safety: 'read' as const },
    plan: { availability: 'available' as const, executor: 'electron_main' as const, actor: 'agent' as const, safety: 'local_record' as const },
    apply: { availability: 'external_only' as const, executor: 'enrolled_agent_visible_ui' as const, actor: 'agent_or_operator' as const, safety: 'device_write' as const },
    rollback: { availability: 'external_only' as const, executor: 'enrolled_agent_visible_ui' as const, actor: 'agent_or_operator' as const, safety: 'device_write' as const },
  },
}
const props = () => ({ snapshot, plan, agentOperation, busy: false, onRefresh: vi.fn(), onPrepare: vi.fn(), onManualHandoff: vi.fn(), onFlightCheck: vi.fn() })
afterEach(cleanup)

describe('CommissioningWizard', () => {
  it('shows the exact board silhouette and distinct proof levels', () => {
    render(<CommissioningWizard {...props()} />)
    expect(screen.getByLabelText('Creator Micro 2 observed')).toBeTruthy()
    const spine = screen.getByRole('list', { name: 'Commissioning proof levels' })
    expect(within(spine).getByText('Exact device')).toBeTruthy()
    expect(within(spine).getByText('Receiver')).toBeTruthy()
    expect(within(spine).getByText('Shortcut path')).toBeTruthy()
    expect(document.querySelector('.commissioner-dial')).toBeTruthy()
    expect(document.querySelector('.commissioner-stick')).toBeTruthy()
    expect(document.querySelector('.commissioner-agent-lamps')?.children).toHaveLength(6)
  })

  it('offers one bounded external-agent handoff and never implies embedded write authority', () => {
    const callbacks = props()
    render(<CommissioningWizard {...callbacks} />)
    const next = screen.getByText('ONE SAFE NEXT ACTION').closest('.commissioner-next') as HTMLElement
    fireEvent.click(within(next).getByRole('button', { name: 'Open agent handoff' }))
    expect(callbacks.onManualHandoff).toHaveBeenCalledOnce()
    expect(screen.getByText('External agent workflow available')).toBeTruthy()
    expect(screen.getByText(/embedded unattended executor is not configured/i)).toBeTruthy()
    expect(screen.getByText(/reset, firmware, raw HID, and direct cache or device-file writes remain unavailable/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /apply|write|activate|import/i })).toBeNull()
  })

  it('shows the typed operation availability without enabling an in-app apply', () => {
    render(<CommissioningWizard {...props()} />)
    expect(screen.getByRole('heading', { name: 'Typed commissioning surface' })).toBeTruthy()
    expect(screen.getAllByText('External agent only')).toHaveLength(2)
    expect(screen.getByText(/Internal executor · not configured/i)).toBeTruthy()
  })

  it('explains plan limits without rendering unbounded backend strings', () => {
    render(<CommissioningWizard {...props()} />)
    fireEvent.click(screen.getByText(/Review bounded commissioning plan/i))
    expect(screen.getByText(/Preparing this plan does not apply it/i)).toBeTruthy()
    expect(screen.getByText(/Cache agreement, device synchronization, and physical acceptance remain separate/i)).toBeTruthy()
    expect(document.body.textContent).not.toContain(plan.id)
    expect(document.body.textContent).not.toContain(plan.reason)
    expect(document.body.textContent).not.toContain(plan.nextAction)
  })

  it('marks the current proof and exposes blockers as alerts', () => {
    const blocked = { ...snapshot, receiver: { status: 'multiple' as const, inputMonitoring: 'granted' as const } }
    render(<CommissioningWizard {...props()} snapshot={blocked} />)
    expect(screen.getByRole('alert').textContent).toMatch(/Receiver exclusivity or integrity failed/i)
    expect(screen.getByRole('button', { name: 'Run checks again' })).toBeTruthy()
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1)
  })

  it('disables its sole action while checks are running', () => {
    render(<CommissioningWizard {...props()} busy />)
    expect((screen.getByRole('button', { name: 'Checking bounded evidence…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('describes active operator acceptance without claiming durable board proof', () => {
    const callbacks = props()
    const accepted = {
      ...snapshot,
      input: { ...snapshot.input, cacheStatus: 'candidate' as const },
      physicalAcceptance: { status: 'accepted' as const, candidateSha256: candidateHash, acceptedAt: snapshot.observedAt },
    }
    render(<CommissioningWizard {...callbacks} snapshot={accepted} />)
    expect(screen.getByText('Shortcut path accepted for this run.')).toBeTruthy()
    expect(screen.queryByText(/This board is commissioned/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open Flight Check' }))
    expect(callbacks.onFlightCheck).toHaveBeenCalledOnce()
  })
})
