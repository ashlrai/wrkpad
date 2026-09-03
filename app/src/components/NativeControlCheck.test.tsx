// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NATIVE_CONTROL_REPORT_FRESHNESS_MS, nativeControlReportFresh } from '../native-control-report'
import NativeControlCheck, { type NativeControlCheckReceipt } from './NativeControlCheck'

const receipt: NativeControlCheckReceipt = {
  schema: 'ai.ashlr.agent-board.native-control-check/v1', overall: 'reported_failure', reportedAt: '2026-09-02T20:00:00.000Z',
  context: { route: 'codex_native', device: { vidPid: '303A:8298' }, codex: { version: '26.818.61809', build: '7019' } },
  settings: 'connected_granted',
  outcomes: { dial: 'skipped', joystick: 'skipped', agentKeys: { AG00: 'no_response', AG01: 'skipped', AG02: 'skipped', AG03: 'skipped', AG04: 'skipped', AG05: 'skipped' }, actionKeys: { ACT06: 'skipped', ACT07: 'skipped', ACT08: 'skipped', ACT09: 'skipped', ACT10: 'skipped', ACT11: 'skipped', ACT12: 'skipped' }, lighting: 'skipped' },
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('NativeControlCheck', () => {
  it('explains visible navigation and names the physically correct controls', () => {
    render(<NativeControlCheck receipt={null} busy={false} error={null} onSave={vi.fn()} />)
    expect(screen.getByText(/will not animate/i)).toBeTruthy()
    expect(screen.getByText(/double-tap within 350 ms/i)).toBeTruthy()
    const preflight = screen.getByText('Put the board on the native wired route first').closest('.native-route-preflight')
    expect(preflight?.textContent).toMatch(/hold the bottom-left touch sensor for three seconds.*fourth.*WIRED.*underglow is white/i)
    expect(preflight?.textContent).toMatch(/after the communication selector exits.*Layer 1.*layer LEDs indicate Layer 1/i)
    expect(preflight?.textContent).toMatch(/Do not reset settings, import a profile, or automate a device write/i)
    expect(preflight?.textContent).toMatch(/White underglow proves only firmware-selected wired mode/i)
    expect(screen.getByLabelText(/Left rotary dial/i)).toBeTruthy()
    expect(screen.getByLabelText(/Right planar toggle/i)).toBeTruthy()
    expect(screen.getByLabelText(/AG00 · Agent 1/i)).toBeTruthy()
    expect(screen.getByLabelText(/AG05 · Agent 6/i)).toBeTruthy()
    expect(screen.getByLabelText(/ACT11 · Action 6.*Bottom Copy next \/ Continue position/i)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Bottom Send / Continue position')
  })

  it('requires a Settings observation and a changed result before saving', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<NativeControlCheck receipt={null} busy={false} error={null} onSave={onSave} />)
    const save = screen.getByRole('button', { name: 'Save operator report' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Connected + Input Monitoring Granted'))
    fireEvent.change(screen.getByLabelText(/AG00 · Agent 1/i), { target: { value: 'no_response' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ settings: 'connected_granted', outcomes: expect.objectContaining({ agentKeys: expect.objectContaining({ AG00: 'no_response' }) }) })))
  })

  it('shows a saved failure without exposing private task data', () => {
    render(<NativeControlCheck receipt={receipt} busy={false} error={null} onSave={vi.fn()} />)
    expect(screen.getByText('Response needs recovery')).toBeTruthy()
    expect(screen.getByText(/AG00 reporting no response/i)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/secret customer prompt|private repository path/i)
  })

  it('expires an accepted operator report after thirty minutes instead of presenting it as current', () => {
    const observed = 'observed_response' as const
    const accepted: NativeControlCheckReceipt = {
      ...receipt,
      overall: 'operator_accepted',
      settings: 'connected_granted',
      outcomes: {
        dial: observed, joystick: observed,
        agentKeys: { AG00: observed, AG01: observed, AG02: observed, AG03: observed, AG04: observed, AG05: observed },
        actionKeys: { ACT06: observed, ACT07: observed, ACT08: observed, ACT09: observed, ACT10: observed, ACT11: observed, ACT12: observed },
        lighting: observed,
      },
    }
    const reportedAt = Date.parse(accepted.reportedAt)
    expect(nativeControlReportFresh(accepted, reportedAt + NATIVE_CONTROL_REPORT_FRESHNESS_MS)).toBe(true)
    expect(nativeControlReportFresh(accepted, reportedAt + NATIVE_CONTROL_REPORT_FRESHNESS_MS + 1)).toBe(false)

    vi.useFakeTimers()
    vi.setSystemTime(reportedAt + NATIVE_CONTROL_REPORT_FRESHNESS_MS + 1)
    render(<NativeControlCheck receipt={accepted} busy={false} error={null} onSave={vi.fn()} />)
    expect(screen.getByText('Saved report expired · retest')).toBeTruthy()
    expect(screen.getByText(/older than 30 minutes; retest now/i)).toBeTruthy()
  })
})
