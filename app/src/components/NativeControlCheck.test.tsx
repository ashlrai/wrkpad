// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NativeControlCheck, { type NativeControlCheckReceipt } from './NativeControlCheck'

const receipt: NativeControlCheckReceipt = {
  schema: 'ai.ashlr.agent-board.native-control-check/v1', overall: 'reported_failure', reportedAt: '2026-09-02T20:00:00.000Z',
  context: { route: 'codex_native', device: { vidPid: '303A:8298' }, codex: { version: '26.818.61809', build: '7019' } },
  settings: 'connected_granted',
  outcomes: { dial: 'skipped', joystick: 'skipped', agentKeys: { AG00: 'no_response', AG01: 'skipped', AG02: 'skipped', AG03: 'skipped', AG04: 'skipped', AG05: 'skipped' }, actionKeys: { ACT06: 'skipped', ACT07: 'skipped', ACT08: 'skipped', ACT09: 'skipped', ACT10: 'skipped', ACT11: 'skipped', ACT12: 'skipped' }, lighting: 'skipped' },
}

afterEach(cleanup)

describe('NativeControlCheck', () => {
  it('explains visible navigation and names the physically correct controls', () => {
    render(<NativeControlCheck receipt={null} busy={false} error={null} onSave={vi.fn()} />)
    expect(screen.getByText(/will not animate/i)).toBeTruthy()
    expect(screen.getByText(/double-tap within 350 ms/i)).toBeTruthy()
    expect(screen.getByLabelText(/Left rotary dial/i)).toBeTruthy()
    expect(screen.getByLabelText(/Right planar toggle/i)).toBeTruthy()
    expect(screen.getByLabelText(/AG00 · Agent 1/i)).toBeTruthy()
    expect(screen.getByLabelText(/AG05 · Agent 6/i)).toBeTruthy()
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
})
