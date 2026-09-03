// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CompactDeckApp from './CompactDeckApp'
import type { CompactPreferences, CompactSnapshot } from './CompactDeckApp'

const snapshot: CompactSnapshot = {
  schema: 'ai.ashlr.agent-board.compact-snapshot/v1',
  observedAt: '2026-09-02T22:00:00.000Z',
  agentSource: 'observer_online',
  attentionSlot: 2,
  agents: [
    { slot: 1, provider: 'codex', state: 'working', title: 'Control deck' },
    { slot: 2, provider: 'claude', state: 'needs_input', title: 'Landing page' },
    { slot: 3, provider: 'codex', state: 'unread', title: 'Protocol audit' },
    { slot: 4, provider: 'claude', state: 'idle', title: 'Documentation' },
    { slot: 5, provider: null, state: 'off' },
    { slot: 6, provider: null, state: 'off' },
  ],
}

const preferences: CompactPreferences = {
  schema: 'ai.ashlr.agent-board.compact-deck/v1',
  openAtLaunch: false,
  alwaysOnTop: true,
  showTitles: false,
  bounds: { x: 40, y: 40, width: 390, height: 286 },
  shortcuts: [
    { scope: 'window', chord: { code: 'Numpad2', ctrl: false, alt: false, shift: false, meta: false }, target: { kind: 'slot', slot: 2 } },
    { scope: 'window', chord: { code: 'Numpad7', ctrl: false, alt: false, shift: false, meta: false }, target: { kind: 'skill', actionId: 'copy_amplify_skill' } },
    { scope: 'window', chord: { code: 'NumpadEnter', ctrl: false, alt: false, shift: false, meta: false }, target: { kind: 'attention' } },
    { scope: 'window', chord: { code: 'NumpadDecimal', ctrl: false, alt: false, shift: false, meta: false }, target: { kind: 'privacy' } },
  ],
}

describe('Compact Deck', () => {
  const focusAgentSlot = vi.fn().mockResolvedValue({ ok: true, message: 'Agent opened.' })
  const focusAttention = vi.fn().mockResolvedValue({ ok: true, message: 'Highest-priority agent opened.' })
  const runSkillAction = vi.fn().mockResolvedValue({ ok: true, message: 'Instruction copied.' })
  const runWorkflowAction = vi.fn().mockResolvedValue({ ok: true, message: 'Workflow staged.' })
  const savePreferences = vi.fn(async (next: CompactPreferences) => next)
  const hide = vi.fn().mockResolvedValue(undefined)
  const unsubscribe = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'compactDeck', {
      configurable: true,
      value: {
        getSnapshot: vi.fn().mockResolvedValue(snapshot),
        focusAgentSlot,
        focusAttention,
        runSkillAction,
        runWorkflowAction,
        getPreferences: vi.fn().mockResolvedValue(preferences),
        savePreferences,
        hide,
        onSnapshot: vi.fn(() => unsubscribe),
      },
    })
  })

  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(window, 'compactDeck')
  })

  it('mirrors the four-row physical geometry and hides private titles by default', async () => {
    render(<CompactDeckApp />)
    await screen.findByText('Session feed live; hardware control unproven.')
    expect(screen.getByRole('status').textContent).toContain('session feed live')
    const deck = screen.getByLabelText('Creator Micro 2 control layout')
    const rows = Array.from(deck.children)
    expect(rows).toHaveLength(4)
    expect(within(rows[0] as HTMLElement).getByLabelText('Dial: select and open agents')).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByLabelText('Planar joystick: four-direction agent selection')).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByLabelText('Planar joystick center; not a press control')).toBeTruthy()
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: /Joystick press/ })).toBeNull()
    expect(within(rows[0] as HTMLElement).getByRole('button', { name: /Agent 1, Codex, Working$/ })).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getAllByRole('button')).toHaveLength(4)
    expect(within(rows[2] as HTMLElement).getAllByRole('button').map((button) => button.textContent)).toEqual(expect.arrayContaining(['7Amplify', '8Verify', '9Polish', '0Advance']))
    expect(within(rows[3] as HTMLElement).getAllByRole('button')).toHaveLength(4)
    expect(screen.queryByText('Control deck')).toBeNull()
  })

  it('uses only window-scoped configured shortcuts', async () => {
    render(<CompactDeckApp />)
    await screen.findByText('Session feed live; hardware control unproven.')

    fireEvent.keyDown(window, { code: 'Numpad2' })
    await waitFor(() => expect(focusAgentSlot).toHaveBeenCalledWith(2))
    fireEvent.keyDown(window, { code: 'Numpad7' })
    await waitFor(() => expect(runSkillAction).toHaveBeenCalledWith('copy_amplify_skill'))
    fireEvent.keyDown(window, { code: 'Digit7' })
    expect(runSkillAction).toHaveBeenCalledTimes(1)
  })

  it('turns the virtual dial to select and presses it to open', async () => {
    render(<CompactDeckApp />)
    await screen.findByText('Session feed live; hardware control unproven.')
    fireEvent.click(screen.getByRole('button', { name: 'Dial right: select next agent' }))
    expect(screen.getByText('Agent 3 selected. Press the dial or agent key to open.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dial press: open selected agent 3' }))
    await waitFor(() => expect(focusAgentSlot).toHaveBeenCalledWith(3))
  })

  it('asks the main process to resolve and focus current attention atomically', async () => {
    render(<CompactDeckApp />)
    await screen.findByText('Session feed live; hardware control unproven.')
    fireEvent.click(screen.getByRole('button', { name: 'Attention: open highest-priority agent 2' }))
    await waitFor(() => expect(focusAttention).toHaveBeenCalledOnce())
    expect(runWorkflowAction).not.toHaveBeenCalledWith('stage_attention')
    expect(focusAgentSlot).not.toHaveBeenCalled()
  })

  it('makes title visibility explicit and persists it', async () => {
    render(<CompactDeckApp />)
    await screen.findByText('Session feed live; hardware control unproven.')
    fireEvent.click(screen.getByRole('button', { name: 'Privacy: session titles are hidden' }))
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(expect.objectContaining({ showTitles: true })))
    expect(await screen.findByText('Control deck')).toBeTruthy()
  })

  it('exposes workflow consequences without sending prompt or terminal input', async () => {
    render(<CompactDeckApp />)
    await screen.findByText('Session feed live; hardware control unproven.')
    fireEvent.click(screen.getByRole('button', { name: 'Voice: prepare voice capture' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue: copy a guarded continuation without submitting it' }))
    await waitFor(() => expect(runWorkflowAction).toHaveBeenCalledWith('stage_voice'))
    await waitFor(() => expect(runWorkflowAction).toHaveBeenCalledWith('copy_guarded_continue'))
  })
})
