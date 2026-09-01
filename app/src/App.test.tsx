// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete window.agentBoard
})

describe('operator interface', () => {
  it('gives digital twin agent keys the live provider, title, and state', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue({
        schemaVersion: 1, observedAt: new Date().toISOString(), agentSource: 'observer_online', fleetSource: 'unavailable',
        agents: [
          { slot: 1, provider: 'codex', state: 'error', title: 'gateway', updatedAt: new Date().toISOString() },
          ...Array.from({ length: 5 }, (_, index) => ({ slot: index + 2, provider: null, state: 'off' as const, title: 'Available slot', updatedAt: null })),
        ],
        fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
      }),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>
    render(<App />)
    expect(await screen.findByRole('button', { name: 'AG00: Agent 1, Codex, gateway, Error. Open agent surface 1.' })).toBeTruthy()
  })

  it('includes an on-screen state legend for opaque black keycaps', () => {
    render(<App />)
    expect(screen.getByLabelText('Agent state legend for opaque keycaps').textContent).toContain('BLACK-CAP LEGEND')
    expect(screen.getByLabelText('Agent state legend for opaque keycaps').textContent).toContain('Needs you')
    expect(screen.getByText(/Screen is authoritative now/i)).toBeTruthy()
  })

  it('selects the paired Mic cap as one logical control', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Pair.*CLAUDE \+ CODEX/i }))
    fireEvent.click(screen.getByRole('button', { name: /ACT10: Voice prompt key/i }))
    expect(screen.getByRole('heading', { name: 'Voice prompt key' })).toBeTruthy()
    expect(screen.getByText(/ACT10 and set ACT11 to None/i)).toBeTruthy()
  })

  it('keeps macOS permission verification visibly unresolved', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(screen.getByText('Human verification required')).toBeTruthy()
    expect(screen.getByText(/Only you can grant this/i)).toBeTruthy()
  })

  it('keeps the physical Input layer unresolved when all desktop shortcuts register', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue({
        schemaVersion: 1, observedAt: new Date().toISOString(), agentSource: 'unavailable', fleetSource: 'unavailable',
        agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off' as const, title: 'Available slot', updatedAt: null })),
        fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
      }),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(),
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    const state = await screen.findByText('20/20 desktop endpoints registered · physical layer unverified')
    expect(state.closest('article')?.classList.contains('ready')).toBe(false)
    expect(screen.getByText(/only a physical Flight Check verifies the active board layer/i)).toBeTruthy()
  })

  it('uses canonical black-cap labels and freezes firmware during acceptance', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    const legend = screen.getByLabelText('Black-opaque state language')
    expect(legend.textContent).toContain('Error Needs you Working Ready to review Idle Available')
    expect(legend.textContent).not.toContain('Completed')
    expect(screen.getByText(/Freeze firmware during acceptance/i)).toBeTruthy()
    expect(screen.getByText(/defer it until the active profile is backed up/i)).toBeTruthy()
  })

  it('requires one continuous keyboard hold and ignores key repeat', async () => {
    vi.useFakeTimers()
    const beginHold = vi.fn().mockResolvedValue(true)
    const cancelHold = vi.fn().mockResolvedValue(true)
    const confirmAction = vi.fn().mockResolvedValue({
      ok: true, title: 'Action complete', message: 'Fleet paused.', timestamp: new Date().toISOString(),
    })
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue({
        schemaVersion: 1, observedAt: new Date().toISOString(), agentSource: 'unavailable', fleetSource: 'unavailable',
        agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off' as const, title: 'Available slot', updatedAt: null })),
        fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
      }),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(),
      requestAction: vi.fn().mockResolvedValue({
        ok: true, title: 'Confirmation required', message: 'Review first.',
        needsConfirmation: true, token: 'hold-token', timestamp: new Date().toISOString(),
      }),
      confirmAction, beginHold, cancelHold, chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(),
      onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Recovery.*GUARDED STOPS/i }))
    fireEvent.click(screen.getByRole('button', { name: /ACT06: Pause autonomous fleet/i }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Arm action' }))
      await Promise.resolve()
    })
    const holdButton = screen.getByRole('button', { name: 'Hold 1.6 seconds' })

    await act(async () => {
      fireEvent.keyDown(holdButton, { key: ' ', code: 'Space' })
      await Promise.resolve()
    })
    fireEvent.keyDown(holdButton, { key: ' ', code: 'Space', repeat: true })
    expect(beginHold).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(900))
    fireEvent.keyUp(holdButton, { key: ' ', code: 'Space' })
    act(() => vi.advanceTimersByTime(900))
    expect(confirmAction).not.toHaveBeenCalled()
    expect(cancelHold).toHaveBeenCalledWith('pause_fleet', 'hold-token')

    await act(async () => {
      fireEvent.keyDown(holdButton, { key: 'Enter', code: 'Enter' })
      await Promise.resolve()
    })
    act(() => vi.advanceTimersByTime(600))
    fireEvent.blur(window)
    act(() => vi.advanceTimersByTime(1_100))
    expect(confirmAction).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.keyDown(holdButton, { key: ' ', code: 'Space' })
      await Promise.resolve()
      vi.advanceTimersByTime(1_620)
      await Promise.resolve()
    })
    expect(beginHold).toHaveBeenCalledTimes(3)
    expect(confirmAction).toHaveBeenCalledTimes(1)
    expect(confirmAction).toHaveBeenCalledWith('pause_fleet', 'hold-token')
  })

  it('cannot authorize after release while the main hold acknowledgement is pending', async () => {
    vi.useFakeTimers()
    let acknowledgeHold: ((accepted: boolean) => void) | undefined
    const beginHold = vi.fn(() => new Promise<boolean>((resolve) => { acknowledgeHold = resolve }))
    const cancelHold = vi.fn().mockResolvedValue(true)
    const confirmAction = vi.fn()
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue({
        schemaVersion: 1, observedAt: new Date().toISOString(), agentSource: 'unavailable', fleetSource: 'unavailable',
        agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off' as const, title: 'Available slot', updatedAt: null })),
        fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
      }),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(),
      requestAction: vi.fn().mockResolvedValue({
        ok: true, title: 'Confirmation required', message: 'Review first.',
        needsConfirmation: true, token: 'pending-token', timestamp: new Date().toISOString(),
      }),
      confirmAction, beginHold, cancelHold, chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(),
      onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Recovery.*GUARDED STOPS/i }))
    fireEvent.click(screen.getByRole('button', { name: /ACT06: Pause autonomous fleet/i }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Arm action' }))
      await Promise.resolve()
    })
    const holdButton = screen.getByRole('button', { name: 'Hold 1.6 seconds' })

    fireEvent.keyDown(holdButton, { key: ' ', code: 'Space' })
    fireEvent.keyDown(holdButton, { key: 'Enter', code: 'Enter' })
    expect(beginHold).toHaveBeenCalledWith('pause_fleet', 'pending-token')
    expect(beginHold).toHaveBeenCalledTimes(1)
    fireEvent.keyUp(holdButton, { key: ' ', code: 'Space' })
    await act(async () => {
      acknowledgeHold?.(true)
      await Promise.resolve()
      vi.advanceTimersByTime(2_000)
    })

    expect(confirmAction).not.toHaveBeenCalled()
    expect(cancelHold).toHaveBeenCalledWith('pause_fleet', 'pending-token')
  })

  it('shows suppression only after the main process acknowledges the interlock', async () => {
    let acknowledge: ((value: { acknowledged: boolean; active: boolean; startedAt: string }) => void) | undefined
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      setProfile: vi.fn().mockResolvedValue('codex'),
      setFlightCheck: vi.fn((active: boolean) => active
        ? new Promise((resolve) => { acknowledge = resolve })
        : Promise.resolve({ acknowledged: true, active: false, startedAt: null })),
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    const daily = screen.getByRole('button', { name: /Daily profile/i })
    await waitFor(() => expect((daily as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(daily)
    expect(screen.getByText('WAIT FOR INTERLOCK')).toBeTruthy()
    expect(screen.getByText('Arming')).toBeTruthy()
    expect(screen.queryByText('Suppressed')).toBeNull()
    acknowledge?.({ acknowledged: true, active: true, startedAt: new Date().toISOString() })
    await waitFor(() => expect(screen.getByText('NEXT PHYSICAL GESTURE')).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Dial left' })).toBeTruthy()
    expect(screen.getByText(/only after the app confirms Actions Suppressed/i)).toBeTruthy()
    expect(screen.getByText('Suppressed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /End check/i }))
    await waitFor(() => expect(screen.getByText('READY WHEN YOU ARE')).toBeTruthy())
    expect(screen.getByText('Not started')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Export receipt/i })).toBeNull()
  })

  it('labels tool presence, observer evidence, and desktop endpoints precisely', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: false, workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue({
        schemaVersion: 1, observedAt: new Date().toISOString(), agentSource: 'observer_online', fleetSource: 'unavailable',
        agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off' as const, title: 'Available slot', updatedAt: null })),
        fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
      }),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    expect(await screen.findByText('Codex CLI found')).toBeTruthy()
    expect(screen.getByText('Claude CLI found')).toBeTruthy()
    expect(await screen.findByText('Agent observer online')).toBeTruthy()
    expect(screen.getByText('20/20 desktop endpoints registered')).toBeTruthy()
    expect(screen.queryByText('Codex local')).toBeNull()
  })

  it('blocks Flight Check until USB and every desktop endpoint are ready', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: false, inputInstalled: true, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: false, workspace: '/tmp', shortcutCount: 19,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue({
        schemaVersion: 1, observedAt: new Date().toISOString(), agentSource: 'unavailable', fleetSource: 'unavailable',
        agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off' as const, title: 'Available slot', updatedAt: null })),
        fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
      }),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    await screen.findByText('Complete preflight first')
    expect((screen.getByRole('button', { name: /Daily profile/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /20-signal diagnostic/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/USB must be linked and all 20 desktop endpoints/i)).toBeTruthy()
  })

  it('routes Setup to preflight without arming an unavailable Flight Check', async () => {
    const setFlightCheck = vi.fn()
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: false, inputInstalled: true, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: false, workspace: '/tmp', shortcutCount: 19,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue({
        schemaVersion: 1, observedAt: new Date().toISOString(), agentSource: 'unavailable', fleetSource: 'unavailable',
        agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off' as const, title: 'Available slot', updatedAt: null })),
        fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
      }),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck, requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    await screen.findByText('19/20 desktop endpoints registered · physical layer unverified')
    fireEvent.click(screen.getByRole('button', { name: /Run Flight Check/i }))

    expect(await screen.findByText('Complete preflight first')).toBeTruthy()
    expect(setFlightCheck).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: /Daily profile/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('stops prompting after a misroute and offers a clean restart', async () => {
    let controlHandler: ((signal: { schemaVersion: 1; sequence: number; signalId: 'joyUp'; source: 'global-shortcut'; accelerator: string; receivedAt: string; monotonicNs: string }) => void) | undefined
    const setFlightCheck = vi.fn((active: boolean) => Promise.resolve({ acknowledged: true, active, startedAt: active ? new Date().toISOString() : null }))
    const restartFlightCheck = vi.fn().mockResolvedValue({ acknowledged: true, active: true, startedAt: new Date().toISOString() })
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: false, workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue({
        schemaVersion: 1, observedAt: new Date().toISOString(), agentSource: 'unavailable', fleetSource: 'unavailable',
        agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off' as const, title: 'Available slot', updatedAt: null })),
        fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
      }),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck, restartFlightCheck, requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(),
      onControl: vi.fn((callback) => { controlHandler = callback as typeof controlHandler; return () => {} }),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    const daily = screen.getByRole('button', { name: /Daily profile/i })
    await waitFor(() => expect((daily as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(daily)
    await screen.findByRole('heading', { name: 'Dial left' })
    act(() => controlHandler?.({
      schemaVersion: 1, sequence: 1, signalId: 'joyUp', source: 'global-shortcut', accelerator: 'Control+Alt+Command+Up',
      receivedAt: new Date().toISOString(), monotonicNs: '1',
    }))

    expect(screen.getByText('THIS RUN CANNOT PASS')).toBeTruthy()
    expect(screen.getByText(/continuing cannot produce a passing receipt/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /End and restart/i }))
    await waitFor(() => expect(restartFlightCheck).toHaveBeenCalledTimes(1))
    expect(setFlightCheck.mock.calls.map(([active]) => active)).toEqual([true])
    expect(await screen.findByRole('heading', { name: 'Dial left' })).toBeTruthy()
  })
})
