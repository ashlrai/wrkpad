// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { NativeAcceptanceSnapshot, PhysicalSignalEnvelope } from './board'
import { dailyFlightSteps } from './flight-check'

const correctedInputProfile = {
  cacheStatus: 'available' as const,
  activeProfile: 'Ashlr Agent Board Corrected',
  activeLayer: 'Ashlr Daily',
  encoderDirection: 'correct' as const,
}

const trustedHardwareDiagnostics = {
  inputInstallation: { status: 'verified' as const, version: '0.18.4' },
  receiverRuntime: {
    status: 'exclusive' as const,
    instanceCount: 1,
    distinctBuildCount: 1,
    currentAsarSha256: 'a'.repeat(64),
    candidateAsarSha256: null,
    candidateMatchesCurrent: null,
  },
}

const initialUnavailableMission = () => ({
  schemaVersion: 1 as const,
  observedAt: new Date().toISOString(),
  agentSource: 'unavailable' as const,
  fleetSource: 'unavailable' as const,
  agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off' as const, title: 'Available slot', updatedAt: null })),
  fleet: null,
  unassignedActiveSessions: 0,
  operatorNotices: [],
})

const nativeAcceptanceSnapshot = (status: NativeAcceptanceSnapshot['evaluation']['status'] = 'not_prepared'): NativeAcceptanceSnapshot => ({
  receipt: status === 'not_prepared' ? null : {
    schema: 'ai.ashlr.agent-board.native-acceptance/v1',
    state: status === 'accepted' ? 'accepted' : 'prepared',
    preparedAt: '2026-09-02T20:00:00.000Z',
    initializationObservedAt: status === 'initialization_observed' || status === 'accepted' ? '2026-09-02T20:01:00.000Z' : null,
    acceptedAt: status === 'accepted' ? '2026-09-02T20:02:00.000Z' : null,
    context: { route: 'codex_native', device: { vidPid: '303A:8298' }, codex: { version: '1.0.0', build: '100' } },
    attestations: {
      settingsConnected: status === 'accepted', dial: status === 'accepted', joystick: status === 'accepted',
      agentKeys: status === 'accepted', actionKeys: status === 'accepted', microphone: status === 'accepted', lighting: status === 'accepted',
    },
  },
  evaluation: {
    status,
    reason: 'bounded fixture reason',
    attestations: status === 'not_prepared' ? undefined : {
      settingsConnected: status === 'accepted', dial: status === 'accepted', joystick: status === 'accepted',
      agentKeys: status === 'accepted', actionKeys: status === 'accepted', microphone: status === 'accepted', lighting: status === 'accepted',
    },
  },
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete window.agentBoard
})

describe('operator interface', () => {
  it('declares a board route locally without invoking actions or flight mode', async () => {
    const setBoardRoute = vi.fn().mockResolvedValue('codex_native')
    const requestAction = vi.fn()
    const setFlightCheck = vi.fn()
    const focusAgentSlot = vi.fn().mockResolvedValue({ ok: true, title: 'Agent focused', message: 'Opened ChatGPT.', timestamp: new Date().toISOString() })
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, boardRoute: 'unknown',
        nativeCodexMicro: { status: 'firmware_rpc_missing', observedAt: '2026-09-01T17:18:10Z', detail: 'RPC 404', fresh: true },
        workspace: '/tmp', shortcutCount: 20, shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue({
        schemaVersion: 1, observedAt: new Date().toISOString(), agentSource: 'unavailable', fleetSource: 'unavailable',
        agents: Array.from({ length: 6 }, (_, index) => index === 0
          ? { slot: 1, provider: 'codex' as const, state: 'idle' as const, title: 'Native review', updatedAt: new Date().toISOString() }
          : { slot: index + 1, provider: null, state: 'off' as const, title: 'Available slot', updatedAt: null }),
        fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
      }),
      setBoardRoute, focusAgentSlot, setProfile: vi.fn(), setFlightCheck,
      requestAction, confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    expect(await screen.findByText('Native route not selected')).toBeTruthy()
    const unknownRouteAction = screen.getByRole('button', { name: 'Select Ashlr Layer for mapped actions' })
    expect(unknownRouteAction.hasAttribute('disabled')).toBe(true)
    fireEvent.click(unknownRouteAction)
    expect(requestAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: /Codex Native/i }))
    expect(setBoardRoute).toHaveBeenCalledWith('codex_native')
    expect(requestAction).not.toHaveBeenCalled()
    expect(setFlightCheck).not.toHaveBeenCalled()
    expect(await screen.findByText('Expected board route saved')).toBeTruthy()
    expect(screen.getByText(/changed Agent Board’s local preference and runtime global-shortcut ownership/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Agent 1, AG00, Codex, Native review.*open its provider app/i }))
    expect(focusAgentSlot).toHaveBeenCalledWith(1)
  })

  it('keeps Codex Native observer-only and out of the Ashlr Flight Check', async () => {
    const setFlightCheck = vi.fn()
    const requestAction = vi.fn()
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, boardRoute: 'codex_native',
        nativeCodexMicro: { status: 'firmware_rpc_missing', observedAt: '2026-09-01T04:38:28Z', detail: 'RPC 404', fresh: false },
        workspace: '/tmp', shortcutCount: 20, shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue({
        schemaVersion: 1, observedAt: new Date().toISOString(), agentSource: 'unavailable', fleetSource: 'unavailable',
        agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off', title: 'Available slot', updatedAt: null })),
        fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
      }),
      setBoardRoute: vi.fn(), focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck,
      requestAction, confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    expect(await screen.findByText('Codex Native observer only.')).toBeTruthy()
    const nativeRibbon = document.querySelector('.readiness-ribbon')
    expect(nativeRibbon?.textContent).toContain('ChatGPT Desktop metadata unavailable')
    expect(nativeRibbon?.textContent).toContain('Native initialization unverified')
    expect(nativeRibbon?.textContent).toContain('Open native acceptance handoff')
    expect(nativeRibbon?.textContent).not.toContain('Input Monitoring')
    expect(nativeRibbon?.textContent).not.toContain('shortcut receiver')
    expect(nativeRibbon?.textContent).not.toContain('desktop endpoints')
    expect(screen.getByRole('button', { name: 'Disabled in Codex Native' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(screen.queryByRole('button', { name: /Run Ashlr Flight Check/i })).toBeNull()
    const nativeGate = screen.getByText(/Operator acceptance handoff/i).closest('.native-manual-gate')
    expect(nativeGate?.textContent).toContain('unregisters its shortcuts')
    expect(nativeGate?.textContent).toContain('may remain open in passive Codex Native mode')
    expect(nativeGate?.textContent).toContain('Automatic evidence watching never checks a box or accepts for you')
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    expect(screen.getByRole('heading', { name: 'Flight Check belongs to Ashlr Layer.' })).toBeTruthy()
    expect(screen.getByText(/Keep Codex Native declared so Agent Board remains passive/i)).toBeTruthy()
    expect(setFlightCheck).not.toHaveBeenCalled()
    expect(requestAction).not.toHaveBeenCalled()
  })

  it('shows only native-route prerequisites and labels inferred initialization as observation', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: false, inputMonitoring: 'unverified',
        inputInstallation: { status: 'invalid_signature', version: '0.18.4' },
        receiverRuntime: { status: 'contended_distinct_builds', instanceCount: 3, distinctBuildCount: 2, currentAsarSha256: null, candidateAsarSha256: null, candidateMatchesCurrent: null },
        receiverIdentity: { appVersion: 'private-receiver-version', packaged: false, appAsarSha256: 'd'.repeat(64) },
        inputProfile: { cacheStatus: 'unsafe', activeProfile: 'private-profile', activeLayer: 'private-layer', encoderDirection: 'reversed' },
        codex: true, claude: true, ashlr: true, boardRoute: 'codex_native',
        chatgptDesktop: { status: 'metadata_observed', version: '1.2026.238', build: '1822' },
        nativeCodexMicro: { status: 'connected', observedAt: '2026-09-02T20:01:00.000Z', detail: 'bounded', fresh: true },
        workspace: '/Users/private/company', shortcutCount: 0, shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getNativeAcceptance: vi.fn().mockResolvedValue(nativeAcceptanceSnapshot()),
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      setBoardRoute: vi.fn(), focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(),
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    expect(await screen.findByText('Native initialization observed')).toBeTruthy()
    const inferredRibbon = screen.getByText('Native initialization inferred')
    expect(inferredRibbon.className).toContain('observed')
    expect(inferredRibbon.className).not.toContain('ready')
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))

    expect(screen.getByRole('heading', { name: 'Observe ChatGPT Desktop metadata' })).toBeTruthy()
    expect(screen.getByText('ChatGPT Desktop 1.2026.238 · build 1822 metadata observed')).toBeTruthy()
    expect(screen.getByText(/Input Monitoring for Agent Board.*not native-route prerequisites/i)).toBeTruthy()
    expect(screen.getByText(/ChatGPT Desktop’s displayed Input Monitoring state remains part of the Codex Settings observation/i)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Infer native initialization' })).toBeTruthy()
    expect(screen.getByText('Ordered native initialization inferred')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Observe Creator Micro in Codex Settings' })).toBeTruthy()
    expect(screen.getByText(/Connection: Connected and Input Monitoring: Granted.*Connection failed does not count/i)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Exercise the dial' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Exercise the joystick' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Exercise all six agent keys' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Exercise all seven action keys' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Exercise the bottom keys' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Observe lighting' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Verify Work Louder Input' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Prove one shortcut receiver' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Verify Input Monitoring' })).toBeNull()
    expect(screen.queryByRole('heading', { name: "Inspect Input's cached profile" })).toBeNull()
    expect(screen.queryByText('private-profile')).toBeNull()
    expect(screen.queryByText('private-receiver-version')).toBeNull()
    expect(screen.queryByText('Native connection evidence')).toBeNull()
  })

  it('resumes a native handoff and enables acceptance only after every operator observation', async () => {
    const pending = nativeAcceptanceSnapshot('pending')
    const initialized = nativeAcceptanceSnapshot('initialization_observed')
    const accepted = nativeAcceptanceSnapshot('accepted')
    const prepareNativeAcceptance = vi.fn().mockResolvedValue({ ok: true, message: '/Users/private should not render', snapshot: pending })
    const getNativeAcceptance = vi.fn()
      .mockResolvedValueOnce(nativeAcceptanceSnapshot())
      .mockResolvedValueOnce(initialized)
    const acceptNativeAcceptance = vi.fn().mockResolvedValue({ ok: true, message: 'private backend text', snapshot: accepted })
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: false, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, boardRoute: 'codex_native',
        chatgptDesktop: { status: 'metadata_observed', version: '1.2026.238', build: '1822' },
        nativeCodexMicro: { status: 'connected', observedAt: '2026-09-02T20:01:00.000Z', detail: 'bounded', fresh: true },
        workspace: '/Users/private/company', shortcutCount: 0, shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getNativeAcceptance, prepareNativeAcceptance, acceptNativeAcceptance,
      clearNativeAcceptance: vi.fn(), getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      setBoardRoute: vi.fn(), focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(),
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    await waitFor(() => expect(getNativeAcceptance).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('list', { name: 'Native evidence ladder' })).toBeTruthy()
    expect(screen.getByText('Awaiting post-prepare observation')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Prepare handoff' }))
    await screen.findByText(/Handoff prepared locally/i)
    expect(prepareNativeAcceptance).toHaveBeenCalledTimes(1)
    const observationLabels = [
      'Codex Settings shows Connection: Connected and Input Monitoring: Granted', 'Dial left, right, and press observed',
      'Joystick up, right, down, and left observed', 'All six agent keys observed',
      'All seven action keys observed', 'Microphone key observed', 'Black-cap lighting observed',
    ]
    const acceptButton = screen.getByRole('button', { name: 'Accept operator attestation' }) as HTMLButtonElement
    expect(acceptButton.disabled).toBe(true)
    observationLabels.forEach((label) => expect((screen.getByRole('checkbox', { name: label }) as HTMLInputElement).disabled).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }))
    await screen.findByText(/Native initialization observation refreshed/i)
    expect(getNativeAcceptance).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Inferred after prepare')).toBeTruthy()
    observationLabels.forEach((label) => expect((screen.getByRole('checkbox', { name: label }) as HTMLInputElement).disabled).toBe(false))
    observationLabels.slice(0, -1).forEach((label) => fireEvent.click(screen.getByRole('checkbox', { name: label })))
    expect(acceptButton.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: observationLabels.at(-1)! }))
    expect(acceptButton.disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Accept operator attestation' }))
    await screen.findByText('Operator attestation saved for this prepared context.')
    expect(acceptNativeAcceptance).toHaveBeenCalledWith({
      settingsConnected: true, dial: true, joystick: true, agentKeys: true,
      actionKeys: true, microphone: true, lighting: true,
    })
    expect(screen.getByText(/Operator attestation—not device proof/i)).toBeTruthy()
    expect(screen.queryByText(/Users\/private should not render/i)).toBeNull()
    expect(screen.queryByText('private backend text')).toBeNull()
  })

  it('passively polls a prepared native handoff without running full status or recording observations', async () => {
    vi.useFakeTimers()
    const pending = nativeAcceptanceSnapshot('pending')
    const initialized = nativeAcceptanceSnapshot('initialization_observed')
    const getStatus = vi.fn().mockResolvedValue({
      boardConnected: true, boardVidPid: '303A:8298', inputInstalled: false, inputMonitoring: 'unverified',
      codex: true, claude: true, ashlr: true, boardRoute: 'codex_native',
      chatgptDesktop: { status: 'metadata_observed', version: '1.0.0', build: '100' },
      nativeCodexMicro: { status: 'not_observed', observedAt: null, detail: 'bounded', fresh: false },
      workspace: '/tmp', shortcutCount: 0, shortcutRegistrations: [], workspaceSnapshot: null,
    })
    const getNativeAcceptance = vi.fn()
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(initialized)
    const acceptNativeAcceptance = vi.fn()
    window.agentBoard = {
      getStatus, getNativeAcceptance, acceptNativeAcceptance,
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      setBoardRoute: vi.fn(), focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(),
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(getNativeAcceptance).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Awaiting post-prepare observation')).toBeTruthy()
    expect(screen.getByText(/periodically, targeting five-second intervals while Agent Board is active.*Refresh now is the authoritative manual check/i)).toBeTruthy()
    const statusCallsBeforeNativePoll = getStatus.mock.calls.length

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getNativeAcceptance).toHaveBeenCalledTimes(2)
    expect(getStatus).toHaveBeenCalledTimes(statusCallsBeforeNativePoll)
    expect(screen.getByText('Inferred after prepare')).toBeTruthy()
    const observations = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(observations).toHaveLength(7)
    observations.forEach((observation) => expect(observation.checked).toBe(false))
    expect((screen.getByRole('button', { name: 'Accept operator attestation' }) as HTMLButtonElement).disabled).toBe(true)
    expect(acceptNativeAcceptance).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(getNativeAcceptance).toHaveBeenCalledTimes(2)
  })

  it('does not overlap native watcher reads and stops the watcher when Setup unmounts', async () => {
    vi.useFakeTimers()
    const pending = nativeAcceptanceSnapshot('pending')
    const watcherRead = deferred<NativeAcceptanceSnapshot>()
    const getNativeAcceptance = vi.fn()
      .mockResolvedValueOnce(pending)
      .mockReturnValueOnce(watcherRead.promise)
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, boardVidPid: '303A:8298', inputInstalled: false, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, boardRoute: 'codex_native',
        chatgptDesktop: { status: 'metadata_observed', version: '1.0.0', build: '100' },
        nativeCodexMicro: { status: 'not_observed', observedAt: null, detail: 'bounded', fresh: false },
        workspace: '/tmp', shortcutCount: 0, shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getNativeAcceptance, getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      setBoardRoute: vi.fn(), focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(),
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    const rendered = render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(getNativeAcceptance).toHaveBeenCalledTimes(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(getNativeAcceptance).toHaveBeenCalledTimes(2)
    rendered.unmount()
    watcherRead.resolve(pending)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(getNativeAcceptance).toHaveBeenCalledTimes(2)
  })

  it('shows interrupted two-phase acceptance and starts a fresh preparation in one action', async () => {
    const interrupted = nativeAcceptanceSnapshot('pending')
    interrupted.receipt = {
      ...interrupted.receipt!,
      state: 'accepting',
      initializationObservedAt: '2026-09-02T20:01:00.000Z',
      attestations: {
        settingsConnected: true, dial: true, joystick: true, agentKeys: true,
        actionKeys: true, microphone: true, lighting: true,
      },
    }
    interrupted.evaluation = {
      ...interrupted.evaluation,
      reason: 'acceptance_incomplete',
      attestations: interrupted.receipt.attestations,
    }
    const preparing = deferred<{ ok: boolean; message: string; snapshot: NativeAcceptanceSnapshot }>()
    const prepareNativeAcceptance = vi.fn(() => preparing.promise)
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, boardVidPid: '303A:8298', inputInstalled: false, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, boardRoute: 'codex_native',
        chatgptDesktop: { status: 'metadata_observed', version: '1.0.0', build: '100' },
        nativeCodexMicro: { status: 'connected', observedAt: '2026-09-02T20:01:00.000Z', detail: 'bounded', fresh: true },
        workspace: '/tmp', shortcutCount: 0, shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getNativeAcceptance: vi.fn().mockResolvedValue(interrupted), prepareNativeAcceptance,
      clearNativeAcceptance: vi.fn(), getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      setBoardRoute: vi.fn(), focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(),
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(await screen.findByText('Acceptance interrupted before completion')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept operator attestation' })).toBeNull()

    const freshButton = screen.getByRole('button', { name: 'Start fresh handoff' }) as HTMLButtonElement
    freshButton.focus()
    fireEvent.click(freshButton)
    expect(prepareNativeAcceptance).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Confirm fresh handoff' })).toBeNull()
    const progress = screen.getByText('Preparing a new private handoff…')
    expect(progress.getAttribute('role')).toBe('status')
    expect(progress.getAttribute('aria-live')).toBe('polite')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Preparing handoff…' }))

    preparing.resolve({ ok: true, message: 'bounded', snapshot: nativeAcceptanceSnapshot('pending') })
    await screen.findByText(/Handoff prepared locally/i)
  })

  it('announces refresh, accept, and clear progress on their initiating controls', async () => {
    const initialized = nativeAcceptanceSnapshot('initialization_observed')
    const accepted = nativeAcceptanceSnapshot('accepted')
    const refreshing = deferred<NativeAcceptanceSnapshot>()
    const accepting = deferred<{ ok: boolean; message: string; snapshot: NativeAcceptanceSnapshot }>()
    const clearing = deferred<{ ok: boolean; message: string; snapshot: NativeAcceptanceSnapshot }>()
    const getNativeAcceptance = vi.fn()
      .mockResolvedValueOnce(initialized)
      .mockReturnValueOnce(refreshing.promise)
    const acceptNativeAcceptance = vi.fn(() => accepting.promise)
    const clearNativeAcceptance = vi.fn(() => clearing.promise)
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, boardVidPid: '303A:8298', inputInstalled: false, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, boardRoute: 'codex_native',
        chatgptDesktop: { status: 'metadata_observed', version: '1.0.0', build: '100' },
        nativeCodexMicro: { status: 'connected', observedAt: '2026-09-02T20:01:00.000Z', detail: 'bounded', fresh: true },
        workspace: '/tmp', shortcutCount: 0, shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getNativeAcceptance, acceptNativeAcceptance, clearNativeAcceptance,
      prepareNativeAcceptance: vi.fn(), getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      setBoardRoute: vi.fn(), focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(),
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    await waitFor(() => expect(getNativeAcceptance).toHaveBeenCalledTimes(1))

    const refreshButton = screen.getByRole('button', { name: 'Refresh now' }) as HTMLButtonElement
    refreshButton.focus()
    fireEvent.click(refreshButton)
    expect(await screen.findByText('Refreshing current USB, Desktop, and initialization evidence…')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Refreshing evidence…' }))
    refreshing.resolve(initialized)
    await screen.findByText(/Native initialization observation refreshed/i)

    screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox))
    const acceptButton = screen.getByRole('button', { name: 'Accept operator attestation' }) as HTMLButtonElement
    acceptButton.focus()
    fireEvent.click(acceptButton)
    expect(screen.getByText('Validating and saving the operator attestation…').getAttribute('aria-live')).toBe('polite')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Saving attestation…' }))
    accepting.resolve({ ok: true, message: 'bounded', snapshot: accepted })
    await screen.findByText('Operator attestation saved for this prepared context.')

    const clearButton = screen.getByRole('button', { name: 'Clear handoff' }) as HTMLButtonElement
    clearButton.focus()
    fireEvent.click(clearButton)
    expect(screen.getByText('Clearing the local native handoff…').getAttribute('aria-live')).toBe('polite')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clearing handoff…' }))
    clearing.resolve({ ok: true, message: 'bounded', snapshot: nativeAcceptanceSnapshot() })
    await screen.findByText(/Local native handoff cleared/i)
  })

  it('requires a fresh preparation when a prior accepted receipt is no longer current', async () => {
    const revoked = nativeAcceptanceSnapshot('accepted')
    revoked.evaluation = {
      ...revoked.evaluation,
      status: 'pending',
      reason: 'initialization_historical',
    }
    const prepareNativeAcceptance = vi.fn().mockResolvedValue({ ok: true, message: 'bounded', snapshot: nativeAcceptanceSnapshot('pending') })
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: false, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, boardRoute: 'codex_native',
        chatgptDesktop: { status: 'metadata_observed', version: '1.2026.238', build: '1822' },
        nativeCodexMicro: { status: 'not_observed', observedAt: null, detail: 'bounded', fresh: false },
        workspace: '/tmp', shortcutCount: 0, shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getNativeAcceptance: vi.fn().mockResolvedValue(revoked), prepareNativeAcceptance,
      clearNativeAcceptance: vi.fn(), getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      setBoardRoute: vi.fn(), focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(),
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(await screen.findByText('Prior acceptance is no longer current')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept operator attestation' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear handoff' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare fresh handoff' }))
    expect(prepareNativeAcceptance).not.toHaveBeenCalled()
    const confirmation = screen.getByText(/Confirm once more to start a fresh handoff/i)
    expect(confirmation.getAttribute('role')).toBe('status')
    expect(confirmation.className).not.toContain('failed')
    expect(screen.getByRole('button', { name: 'Cancel fresh handoff' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel fresh handoff' }))
    expect(screen.getByRole('button', { name: 'Prepare fresh handoff' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirm fresh handoff' })).toBeNull()
    expect(prepareNativeAcceptance).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Prepare fresh handoff' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm fresh handoff' }))
    await waitFor(() => expect(prepareNativeAcceptance).toHaveBeenCalledTimes(1))
  })

  it('hides accepted native state while a same-presence VID:PID swap is revalidated', async () => {
    vi.useFakeTimers()
    let boardVidPid = '303A:8298'
    let resolveRevalidation: ((snapshot: NativeAcceptanceSnapshot) => void) | undefined
    const revalidation = new Promise<NativeAcceptanceSnapshot>((resolve) => { resolveRevalidation = resolve })
    const getNativeAcceptance = vi.fn()
      .mockResolvedValueOnce(nativeAcceptanceSnapshot('accepted'))
      .mockReturnValueOnce(revalidation)
    window.agentBoard = {
      getStatus: vi.fn().mockImplementation(() => Promise.resolve({
        boardConnected: true, boardVidPid, inputInstalled: false, inputMonitoring: 'unverified',
        codex: true, claude: true, ashlr: true, boardRoute: 'codex_native',
        chatgptDesktop: { status: 'metadata_observed', version: '1.0.0', build: '100' },
        nativeCodexMicro: { status: 'connected', observedAt: '2026-09-02T20:01:00.000Z', detail: 'bounded', fresh: true },
        workspace: '/tmp', shortcutCount: 0, shortcutRegistrations: [], workspaceSnapshot: null,
      })),
      getNativeAcceptance, getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      setBoardRoute: vi.fn(), focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(),
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.getByText('Operator attestation saved')).toBeTruthy()

    boardVidPid = '303A:8297'
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000) })
    expect(screen.getByText('Checking current handoff')).toBeTruthy()
    expect(screen.queryByText('Operator attestation saved')).toBeNull()
    expect(screen.queryByText('Operator attestation recorded')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Exercise the dial' }).closest('article')?.className).not.toContain('observed')
    expect((screen.getByRole('button', { name: 'Prepare handoff' }) as HTMLButtonElement).disabled).toBe(true)

    resolveRevalidation?.(nativeAcceptanceSnapshot('pending'))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(screen.queryByText('Operator attestation saved')).toBeNull()
    expect(screen.getByText('Handoff prepared')).toBeTruthy()
  })

  it('keeps the Ashlr Setup checklist and excludes the native handoff', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified', ...trustedHardwareDiagnostics,
        inputProfile: correctedInputProfile, codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer',
        workspace: '/tmp', shortcutCount: 20, shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      setBoardRoute: vi.fn(), focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(),
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(await screen.findByRole('heading', { name: 'Verify Work Louder Input' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Prove one shortcut receiver' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: "Inspect Input's cached profile" })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /Carry the physical check/i })).toBeNull()
  })

  it('gives digital twin agent keys the live provider, title, and state', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        inputProfile: correctedInputProfile,
        codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
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

  it('renders the physical top row as dial, two agent keys, then planar stick', () => {
    render(<App />)
    const topRow = document.querySelector('.hardware-grid')?.children
    expect(topRow?.[0].classList.contains('dial-module')).toBe(true)
    expect(topRow?.[1].getAttribute('aria-label')).toMatch(/^AG00:/)
    expect(topRow?.[2].getAttribute('aria-label')).toMatch(/^AG01:/)
    expect(topRow?.[3].classList.contains('joystick-module')).toBe(true)
  })

  it('renders ACT10 and ACT11 as separate bottom-row keys', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Pair.*CLAUDE \+ CODEX/i }))
    fireEvent.click(screen.getByRole('button', { name: /ACT10: Voice capture/i }))
    expect(screen.getByRole('heading', { name: 'Voice capture' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /ACT11: Guarded Continue/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /ACT12:/i }).className).toContain('transparent')
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
        ...trustedHardwareDiagnostics,
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
    const profileState = screen.getByText('Current keyboard profile requires physical verification')
    expect(profileState.closest('article')?.classList.contains('ready')).toBe(false)
    expect(screen.getByText(/A correct encoder-only receipt under another profile name is not enough/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    expect((screen.getByRole('button', { name: 'Daily profile' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/requires Ashlr Agent Board Corrected, Ashlr Daily, and a corrected encoder receipt/i)).toBeTruthy()
  })

  it('keeps a cache match observational and exposes sanitized receiver provenance', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        ...trustedHardwareDiagnostics,
        inputProfile: correctedInputProfile,
        inputRuntime: { status: 'not_observed', profileIndex: null, layerIndex: null, observedAt: null, fresh: false },
        receiverIdentity: { appVersion: '0.1.0', packaged: true, appAsarSha256: 'a'.repeat(64) },
        receiverRuntime: { status: 'exclusive', instanceCount: 1, distinctBuildCount: 1, currentAsarSha256: 'a'.repeat(64), candidateAsarSha256: null, candidateMatchesCurrent: null },
        codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    const cacheState = await screen.findByText(/Cache observed · Ashlr Agent Board Corrected/i)
    expect(cacheState.closest('article')?.classList.contains('observed')).toBe(true)
    expect(cacheState.closest('article')?.classList.contains('ready')).toBe(false)
    expect(cacheState.textContent).toContain('device sync unproven')
    expect(screen.queryByText('Set the live keyboard profile')).toBeNull()
    expect(screen.getByText(/app\.asar aaaaaaaaaaaa/i)).toBeTruthy()
    expect(screen.getByText(/only observed Agent Board receiver/i)).toBeTruthy()
  })

  it('resumes a private recovery handoff with exact accessible operator actions', async () => {
    const revealRecoveryArtifact = vi.fn().mockResolvedValue({ ok: true, message: 'The corrected profile is selected in Finder.' })
    const copyRecoveryChecklist = vi.fn().mockResolvedValue({ ok: true, message: 'Recovery checklist and artifact receipt copied.' })
    const openInputMonitoringSettings = vi.fn().mockResolvedValue({ ok: true, message: 'Input Monitoring settings opened. Verify manually.' })
    const dismissRecoveryHandoff = vi.fn().mockResolvedValue({ ok: true, message: 'The saved startup reminder was dismissed.' })
    const artifactPath = '/Users/example/Documents/Ashlr-Agent-Board-corrected.json'
    const steps = [
      'Open Work Louder Input alone. Choose Import Profile.',
      'Choose Set as current profile, select Ashlr Daily, then fully quit and relaunch Input.',
    ]
    const getRecoveryGuide = vi.fn()
      .mockResolvedValueOnce({
        handoff: { schema: 'ai.ashlr.agent-board.input-recovery/v1', artifactPath, sha256: 'a'.repeat(64), createdAt: '2026-09-01T20:00:00.000Z' },
        artifact: { status: 'available', available: true }, steps,
      })
      .mockResolvedValue({ handoff: null, artifact: { status: 'invalid', available: false }, steps })
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        ...trustedHardwareDiagnostics,
        inputProfile: correctedInputProfile,
        inputRuntime: { status: 'not_observed', profileIndex: null, layerIndex: null, observedAt: null, fresh: false },
        receiverIdentity: { appVersion: '0.1.0', packaged: true },
        codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      getRecoveryGuide,
      revealRecoveryArtifact, copyRecoveryChecklist, openInputMonitoringSettings, dismissRecoveryHandoff,
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    const heading = await screen.findByRole('heading', { name: 'Resume the saved recovery handoff.' })
    expect(screen.getByText(artifactPath)).toBeTruthy()
    expect(screen.getByText(/receipt does not prove import, activation, synchronization, permission, or physical acceptance/i)).toBeTruthy()
    expect(screen.getByText(/Choose Import Profile/)).toBeTruthy()
    await waitFor(() => expect(heading.closest('section')).toBe(document.activeElement))

    fireEvent.click(screen.getByRole('button', { name: 'Reveal artifact in Finder' }))
    await waitFor(() => expect(revealRecoveryArtifact).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Copy recovery checklist' }))
    await waitFor(() => expect(copyRecoveryChecklist).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Open Input Monitoring settings' }))
    await waitFor(() => expect(openInputMonitoringSettings).toHaveBeenCalledOnce())
    expect(await screen.findByText(/Input Monitoring settings opened/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss saved handoff' }))
    expect(screen.getByRole('button', { name: 'Confirm dismiss reminder' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm dismiss reminder' }))
    await waitFor(() => expect(dismissRecoveryHandoff).toHaveBeenCalledOnce())
    expect(await screen.findByRole('heading', { name: 'Keep these steps visible before you quit.' })).toBeTruthy()

    cleanup()
    render(<App />)
    await screen.findByText('USB present')
    await waitFor(() => expect(getRecoveryGuide).toHaveBeenCalledTimes(3))
    expect(screen.queryByRole('heading', { name: 'Resume the saved recovery handoff.' })).toBeNull()
  })

  it('fails closed when a saved recovery artifact is missing or changed', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        ...trustedHardwareDiagnostics,
        inputProfile: correctedInputProfile,
        inputRuntime: { status: 'not_observed', profileIndex: null, layerIndex: null, observedAt: null, fresh: false },
        codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      getRecoveryGuide: vi.fn().mockResolvedValue({
        handoff: { schema: 'ai.ashlr.agent-board.input-recovery/v1', artifactPath: '/Users/example/Documents/moved.json', sha256: 'a'.repeat(64), createdAt: '2026-09-01T20:00:00.000Z' },
        artifact: { status: 'hash_mismatch', available: false },
        steps: ['The recorded corrected artifact is missing, moved, unsafe, or does not match its saved SHA-256.'],
      }),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'The saved artifact needs attention.' })).toBeTruthy()
    expect(screen.getByText(/Artifact hash mismatch/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reveal artifact in Finder' })).toBeNull()
    expect(screen.getByText(/missing, moved, unsafe, or does not match/i)).toBeTruthy()
    expect(screen.getByText(/saved Input recovery artifact is missing or changed/i)).toBeTruthy()
  })

  it('turns a fresh Input profile-layer error into a safe reconciliation path', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        ...trustedHardwareDiagnostics,
        inputProfile: correctedInputProfile,
        inputRuntime: { status: 'unresolved_profile_layer', profileIndex: 2, layerIndex: 1, observedAt: '2026-09-01T19:33:00.000Z', fresh: true },
        receiverIdentity: null, codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(await screen.findByRole('heading', { name: 'Keep these steps visible before you quit.' })).toBeTruthy()
    expect(screen.getByText(/Input logged profile 2 \/ layer 1 as unresolved/i)).toBeTruthy()
    expect(screen.getByText(/may predate the current cache/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create corrected Input profile' })).toBeNull()
    const cacheState = screen.getByText(/Cache observed · Ashlr Agent Board Corrected/i)
    expect(cacheState.closest('article')?.classList.contains('observed')).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    expect((screen.getByRole('button', { name: 'Daily profile' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows one recovery path when cache and recent Input log evidence both disagree', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        ...trustedHardwareDiagnostics,
        inputProfile: { cacheStatus: 'available', activeProfile: 'Default', activeLayer: 'Layer 1', encoderDirection: 'unrecognized' },
        inputRuntime: { status: 'unresolved_profile_layer', profileIndex: 2, layerIndex: 1, observedAt: '2026-09-01T19:33:00.000Z', fresh: true },
        receiverIdentity: null, codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(await screen.findByRole('button', { name: 'Create corrected Input profile' })).toBeTruthy()
    expect(screen.getByText(/Input also logged profile 2 \/ layer 1 as unresolved recently/i)).toBeTruthy()
    expect(screen.queryByText('Input recently logged an unresolved combination.')).toBeNull()
    expect(document.querySelectorAll('.profile-repair')).toHaveLength(1)
  })

  it('surfaces the sanitized active Input profile and blocks a reversed dial mapping', async () => {
    const setFlightCheck = vi.fn()
    const createCorrectedInputProfile = vi.fn().mockResolvedValue({
      status: 'saved', message: 'Corrected profile saved, but the private recovery handoff could not be saved.', handoffPersisted: false,
      filePath: '/tmp/Ashlr-Agent-Board-corrected.json', sha256: 'abc123',
      recoverySteps: [
        'Keep the ordinary Input export as your rollback backup.',
        'Use Command-Q to fully quit every other board controller.',
        'If Import Profile is absent, export a backup and remove only an unused ordinary profile.',
        'If Input says update error, retry, keep Input as the only board controller.',
        'Open Input Monitoring settings and verify the exact receiver build manually.',
        'Run a fresh Daily Flight Check using only the physical board.',
      ],
    })
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        ...trustedHardwareDiagnostics,
        inputProfile: { cacheStatus: 'available', activeProfile: 'Ashlr Agent Board', activeLayer: 'Ashlr Daily', encoderDirection: 'reversed' },
        codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue({
        schemaVersion: 1, observedAt: new Date().toISOString(), agentSource: 'unavailable', fleetSource: 'unavailable',
        agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off' as const, title: 'Available slot', updatedAt: null })),
        fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
      }),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck,
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), createCorrectedInputProfile, saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    const state = await screen.findByText('Ashlr Agent Board · Ashlr Daily · dial directions reversed')
    expect(state.closest('article')?.classList.contains('ready')).toBe(false)
    expect(screen.getByText(/known clockwise\/counterclockwise inversion/i)).toBeTruthy()
    expect(screen.getByText(/It never opens Input, edits Input's cache, or writes to the board/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Run Ashlr Flight Check/i }))
    const dailyButton = screen.getByRole('button', { name: 'Daily profile' })
    expect(dailyButton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/active Input receipt has clockwise and counterclockwise reversed/i)).toBeTruthy()
    fireEvent.click(dailyButton)
    expect(setFlightCheck).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create corrected Input profile' }))
    expect(await screen.findByText('Repair artifact ready—nothing activated yet.')).toBeTruthy()
    expect(screen.getByText('/tmp/Ashlr-Agent-Board-corrected.json')).toBeTruthy()
    expect(screen.getByText('Import Profile')).toBeTruthy()
    expect(screen.getByText('Set as current profile')).toBeTruthy()
    expect(screen.getByText(/private recovery handoff could not be saved/i)).toBeTruthy()
    expect(screen.getByText(/layout updated.*alone is not acceptance/i)).toBeTruthy()
    expect(screen.getByText(/If Import Profile is absent/i)).toBeTruthy()
    expect(screen.getByText(/update error, retry/i)).toBeTruthy()
    expect(screen.getAllByText(/Open Input Monitoring settings/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Run a fresh Daily Flight Check/i)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Keep these steps visible before you quit.' })).toBeTruthy()
    expect(createCorrectedInputProfile).toHaveBeenCalledOnce()
  })

  it('reveals zero-signal recovery after 12 seconds and disarms before opening Setup', async () => {
    const startedAt = '2026-09-01T18:00:00.000Z'
    const setFlightCheck = vi.fn().mockImplementation(async (enabled: boolean) => enabled
      ? { acknowledged: true, active: true, startedAt }
      : { acknowledged: true, active: false, startedAt: null })
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        ...trustedHardwareDiagnostics,
        inputProfile: correctedInputProfile,
        inputRuntime: {
          status: 'not_observed', profileIndex: null, layerIndex: null, observedAt: null, fresh: false,
          codexProtocolTraffic: { status: 'recurring_unresolved_response', observedAt: startedAt, fresh: true },
        },
        codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue({
        schemaVersion: 1, observedAt: startedAt, agentSource: 'unavailable', fleetSource: 'unavailable',
        agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off' as const, title: 'Available slot', updatedAt: null })),
        fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
      }),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck,
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    expect(await screen.findByText('USB present')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    vi.useFakeTimers()
    vi.setSystemTime(new Date(startedAt))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Daily profile' }))
      await Promise.resolve()
    })
    expect(screen.getByText('0 raw desktop receipts since Flight Check started.')).toBeTruthy()
    expect(screen.queryByText('No physical shortcut arrived')).toBeNull()
    act(() => vi.advanceTimersByTime(12_000))
    expect(screen.getByText('No physical shortcut arrived')).toBeTruthy()
    expect(screen.getByText(/not an exclusive Input-only window/i)).toBeTruthy()
    expect(screen.getByText(/no application was automatically quit/i)).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open recovery checklist' }))
      await Promise.resolve()
    })
    expect(setFlightCheck.mock.calls).toEqual([[true, 'daily'], [false, 'daily']])
    expect(screen.getByRole('heading', { name: 'Make every layer observable.' })).toBeTruthy()
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
        ...trustedHardwareDiagnostics,
        inputProfile: correctedInputProfile,
        codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
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
    await act(async () => { await Promise.resolve() })
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
        codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
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
    await act(async () => { await Promise.resolve() })
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
        ...trustedHardwareDiagnostics,
        inputProfile: correctedInputProfile,
        codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
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

  it('keeps daily and diagnostic profile acceptance separate', async () => {
    const setFlightCheck = vi.fn().mockResolvedValue({
      acknowledged: true,
      active: true,
      startedAt: '2026-09-01T19:00:00.000Z',
    })
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        ...trustedHardwareDiagnostics,
        inputProfile: {
          cacheStatus: 'available',
          activeProfile: 'Ashlr Flight Check Corrected - diagnostic',
          activeLayer: 'Ashlr Diagnostic',
          encoderDirection: 'correct',
        },
        codex: true, claude: true, ashlr: true, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      setFlightCheck,
      setProfile: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    const daily = await screen.findByRole('button', { name: 'Daily profile' })
    const diagnostic = screen.getByRole('button', { name: '20-signal diagnostic' })
    expect((daily as HTMLButtonElement).disabled).toBe(true)
    expect((diagnostic as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(diagnostic)
    await waitFor(() => expect(setFlightCheck).toHaveBeenCalledWith(true, 'diagnostic'))
  })

  it('labels tool presence, observer evidence, and desktop endpoints precisely', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        ...trustedHardwareDiagnostics,
        codex: true, claude: true, ashlr: false, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
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
        ...trustedHardwareDiagnostics,
        inputProfile: correctedInputProfile,
        codex: true, claude: true, ashlr: false, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 19,
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
    expect(screen.getByText(/USB must be present and all 20 desktop endpoints/i)).toBeTruthy()
  })

  it('blocks Flight Check when the vendor Input installation fails integrity verification', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        inputInstallation: { status: 'invalid_signature', version: '0.18.4' },
        receiverRuntime: { status: 'exclusive', instanceCount: 1, distinctBuildCount: 1, currentAsarSha256: 'a'.repeat(64), candidateAsarSha256: null, candidateMatchesCurrent: null },
        inputProfile: correctedInputProfile,
        codex: true, claude: true, ashlr: false, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(await screen.findByText(/Input 0\.18\.4 · invalid signature/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    expect((screen.getByRole('button', { name: /Daily profile/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/replace it in Finder from the official Work Louder release/i)).toBeTruthy()
  })

  it.each([
    ['missing', 'Install Work Louder Input from the official release'],
    ['multiple_installations', 'keep one intended official Input installation'],
    ['unsafe', 'Replace the unsafe copy through Finder'],
    ['invalid_metadata', 'bundle metadata could not be verified'],
    ['publisher_unrecognized', 'Do not approve or work around an unexpected publisher'],
    ['invalid_signature', 'Do not ad-hoc sign or alter the app'],
    ['known_resource_mutation', 'this installed copy is not trusted or verified'],
    ['gatekeeper_rejected', 'Do not bypass Gatekeeper or strip quarantine metadata'],
    ['probe_unavailable', 'Do not continue while trust is unknown'],
  ] as const)('shows bounded recovery guidance for Input status %s', async (inputStatus, expectedGuidance) => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: inputStatus !== 'missing', inputMonitoring: 'unverified',
        inputInstallation: { status: inputStatus, version: null },
        receiverRuntime: trustedHardwareDiagnostics.receiverRuntime,
        inputProfile: correctedInputProfile,
        codex: true, claude: true, ashlr: false, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(await screen.findByText(new RegExp(expectedGuidance, 'i'))).toBeTruthy()
  })

  it('keeps the known Input 0.18.4 resource mutation fail closed through stopped-state recovery', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        inputInstallation: { status: 'known_resource_mutation', version: '0.18.4' },
        receiverRuntime: trustedHardwareDiagnostics.receiverRuntime,
        inputProfile: { cacheStatus: 'available', activeProfile: 'Ashlr Agent Board', activeLayer: 'Ashlr Daily', encoderDirection: 'reversed' },
        codex: true, claude: true, ashlr: false, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(await screen.findByText(/Input 0\.18\.4 · sealed helper changed · not verified · shortcuts disabled/i)).toBeTruthy()
    expect(screen.getByText(/make a stopped-state backup, reinstall the official 0\.18\.4 DMG/i)).toBeTruthy()
    expect(screen.getByText(/verify the fresh copy before launching it/i)).toBeTruthy()
    expect(screen.getByText(/leave Input closed during commissioning/i)).toBeTruthy()
    expect(screen.getByText(/never authorizes firmware work/i)).toBeTruthy()
    expect(screen.getByText(/Profile repair, import, activation, and synchronization stay paused/i)).toBeTruthy()
    expect(screen.getByText(/Blocked by Input integrity/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Create corrected Input profile/i })).toBeNull()
    expect(screen.queryByText(/choose Import Profile/i)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    expect((screen.getByRole('button', { name: /Daily profile/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('fails closed when Input trust and receiver ownership diagnostics are missing', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        inputProfile: correctedInputProfile,
        codex: true, claude: true, ashlr: false, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    expect((screen.getByRole('button', { name: /Daily profile/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/could not verify shortcut receiver ownership/i)).toBeTruthy()
    expect(screen.getByText('Unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(await screen.findByText(/Input · verification unavailable · shortcuts disabled/i)).toBeTruthy()
    expect(screen.getByText(/Receiver ownership unavailable · shortcuts disabled/i)).toBeTruthy()
  })

  it('fails closed and explains recovery when multiple receiver builds contend', async () => {
    window.agentBoard = {
      getStatus: vi.fn().mockResolvedValue({
        boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified',
        inputInstallation: { status: 'verified', version: '0.18.4' },
        receiverRuntime: { status: 'contended_distinct_builds', instanceCount: 2, distinctBuildCount: 2, currentAsarSha256: 'a'.repeat(64), candidateAsarSha256: null, candidateMatchesCurrent: null },
        receiverIdentity: { appVersion: '0.1.0', packaged: true, appAsarSha256: 'a'.repeat(64) },
        inputProfile: correctedInputProfile,
        codex: true, claude: true, ashlr: false, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 0,
        shortcutRegistrations: [], workspaceSnapshot: null,
      }),
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(),
      beginHold: vi.fn(), cancelHold: vi.fn(), chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    expect(await screen.findByText(/2 receivers · ownership disabled/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    expect((screen.getByRole('button', { name: /Daily profile/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Fully quit every copy manually/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Setup' }))
    expect(await screen.findByText(/2 receivers across 2 builds are contending/i)).toBeTruthy()
    expect(screen.getByText(/No process was quit automatically/i)).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: /Run Ashlr Flight Check/i }))

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
        ...trustedHardwareDiagnostics,
        inputProfile: correctedInputProfile,
        codex: true, claude: true, ashlr: false, boardRoute: 'ashlr_layer', workspace: '/tmp', shortcutCount: 20,
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
    await waitFor(() => expect(restartFlightCheck).toHaveBeenCalledWith('daily'))
    expect(setFlightCheck.mock.calls).toEqual([[true, 'daily']])
    expect(await screen.findByRole('heading', { name: 'Dial left' })).toBeTruthy()
  })

  it('invalidates an active Flight Check when Input trust changes and requires a fresh restart', async () => {
    const startedAt = '2026-09-01T19:00:00.000Z'
    const restartedAt = '2026-09-01T19:01:00.000Z'
    const trustedStatus = {
      boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified' as const,
      ...trustedHardwareDiagnostics,
      inputProfile: correctedInputProfile,
      codex: true, claude: true, ashlr: false, boardRoute: 'ashlr_layer' as const, workspace: '/tmp', shortcutCount: 20,
      shortcutRegistrations: [], workspaceSnapshot: null,
    }
    let inputMutated = false
    const getStatus = vi.fn().mockImplementation(() => Promise.resolve(inputMutated
      ? { ...trustedStatus, inputInstallation: { status: 'known_resource_mutation' as const, version: '0.18.4' } }
      : trustedStatus))
    const setFlightCheck = vi.fn().mockResolvedValue({ acknowledged: true, active: true, startedAt })
    let resolveRestart: ((value: { acknowledged: boolean; active: boolean; startedAt: string | null }) => void) | undefined
    const restartFlightCheck = vi.fn().mockImplementation(() => new Promise<{ acknowledged: boolean; active: boolean; startedAt: string | null }>((resolve) => { resolveRestart = resolve }))
    let resolveSave: ((value: string | null) => void) | undefined
    const saveFlightReceipt = vi.fn().mockImplementation(() => new Promise<string | null>((resolve) => { resolveSave = resolve }))
    let controlHandler: ((signal: PhysicalSignalEnvelope) => void) | undefined
    window.agentBoard = {
      getStatus,
      getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck, restartFlightCheck,
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt,
      onControl: vi.fn((callback) => { controlHandler = callback; return () => {} }),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    const daily = await screen.findByRole('button', { name: 'Daily profile' })
    await waitFor(() => expect((daily as HTMLButtonElement).disabled).toBe(false))
    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(daily)
      await Promise.resolve()
    })
    expect(screen.getByRole('heading', { name: 'Dial left' })).toBeTruthy()

    let sequence = 0
    act(() => {
      for (const step of dailyFlightSteps) {
        for (let repeat = 0; repeat < (step.requiredCount ?? 1); repeat += 1) {
          for (const signalId of step.signals) {
            sequence += 1
            controlHandler?.({
              schemaVersion: 1, sequence, signalId, source: 'global-shortcut',
              accelerator: `test-${signalId}`, receivedAt: new Date(Date.parse(startedAt) + sequence).toISOString(),
              monotonicNs: String(sequence),
            })
          }
        }
      }
    })
    expect(screen.getByText('ACCEPTANCE PASSED')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Export receipt/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Start operating/i })).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Export receipt/i }))
      await Promise.resolve()
    })
    expect(saveFlightReceipt).toHaveBeenCalledOnce()

    inputMutated = true
    await act(async () => {
      vi.advanceTimersByTime(12_000)
      await Promise.resolve()
    })
    expect(screen.getByText('THIS RUN CANNOT PASS')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'A live acceptance gate changed' })).toBeTruthy()
    expect(screen.getByText(/Recover every gate, then end and restart/i)).toBeTruthy()
    expect(screen.queryByText('ACCEPTANCE PASSED')).toBeNull()
    expect(screen.queryByRole('button', { name: /Export receipt/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Start operating/i })).toBeNull()
    expect((screen.getByRole('button', { name: /End invalidated check/i }) as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      resolveSave?.('/tmp/stale-flight-receipt.json')
      await Promise.resolve()
    })
    expect(screen.queryByText('Receipt saved')).toBeNull()

    inputMutated = false
    await act(async () => {
      vi.advanceTimersByTime(12_000)
      await Promise.resolve()
    })
    expect(screen.getByText('THIS RUN CANNOT PASS')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'A live acceptance gate changed' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End and restart/i }))
      await Promise.resolve()
    })
    expect(restartFlightCheck).toHaveBeenCalledWith('daily')
    expect(screen.queryByText('ACCEPTANCE PASSED')).toBeNull()
    expect(screen.queryByRole('button', { name: /Export receipt/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Start operating/i })).toBeNull()
    expect(screen.getByText('THIS RUN CANNOT PASS')).toBeTruthy()
    await act(async () => {
      resolveRestart?.({ acknowledged: true, active: true, startedAt: restartedAt })
      await Promise.resolve()
    })
    expect(screen.queryByText('THIS RUN CANNOT PASS')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Dial left' })).toBeTruthy()
  })

  it('fails closed when the fresh post-arm status receipt is rejected', async () => {
    const trustedStatus = {
      boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified' as const,
      ...trustedHardwareDiagnostics, inputProfile: correctedInputProfile,
      codex: true, claude: true, ashlr: false, boardRoute: 'ashlr_layer' as const, workspace: '/tmp', shortcutCount: 20,
      shortcutRegistrations: [], workspaceSnapshot: null,
    }
    const getStatus = vi.fn()
      .mockResolvedValueOnce(trustedStatus)
      .mockRejectedValueOnce(new Error('status unavailable'))
    window.agentBoard = {
      getStatus, getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(),
      setFlightCheck: vi.fn().mockResolvedValue({ acknowledged: true, active: true, startedAt: '2026-09-01T19:10:00.000Z' }),
      restartFlightCheck: vi.fn(), requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    const daily = await screen.findByRole('button', { name: 'Daily profile' })
    await waitFor(() => expect((daily as HTMLButtonElement).disabled).toBe(false))
    await act(async () => {
      fireEvent.click(daily)
      await Promise.resolve()
    })

    expect(await screen.findByText('THIS RUN CANNOT PASS')).toBeTruthy()
    expect(screen.getByText(/HARDWARE ACCEPTANCE \/ INTERLOCK UNVERIFIED/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Restore safe state/i })).toBeTruthy()
    expect(screen.queryByText('ACCEPTANCE PASSED')).toBeNull()
    expect(screen.queryByRole('button', { name: /Export receipt/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /Start operating/i })).toBeNull()
  })

  it('preserves sticky invalidation when stopping the interlock fails', async () => {
    const trustedStatus = {
      boardConnected: true, inputInstalled: true, inputMonitoring: 'unverified' as const,
      ...trustedHardwareDiagnostics, inputProfile: correctedInputProfile,
      codex: true, claude: true, ashlr: false, boardRoute: 'ashlr_layer' as const, workspace: '/tmp', shortcutCount: 20,
      shortcutRegistrations: [], workspaceSnapshot: null,
    }
    let inputMutated = false
    const getStatus = vi.fn().mockImplementation(() => Promise.resolve(inputMutated
      ? { ...trustedStatus, inputInstallation: { status: 'known_resource_mutation' as const, version: '0.18.4' } }
      : trustedStatus))
    let stopAttempts = 0
    const setFlightCheck = vi.fn().mockImplementation((active: boolean) => {
      if (active) return Promise.resolve({ acknowledged: true, active: true, startedAt: '2026-09-01T19:20:00.000Z' })
      stopAttempts += 1
      return Promise.resolve(stopAttempts === 1
        ? { acknowledged: false, active: true, startedAt: '2026-09-01T19:20:00.000Z' }
        : { acknowledged: true, active: false, startedAt: null })
    })
    window.agentBoard = {
      getStatus, getMissionControl: vi.fn().mockResolvedValue(initialUnavailableMission()),
      focusAgentSlot: vi.fn(), setProfile: vi.fn(), setFlightCheck, restartFlightCheck: vi.fn(),
      requestAction: vi.fn(), confirmAction: vi.fn(), beginHold: vi.fn(), cancelHold: vi.fn(),
      chooseWorkspace: vi.fn(), saveFlightReceipt: vi.fn(), onControl: vi.fn(() => () => {}),
    } as unknown as NonNullable<typeof window.agentBoard>

    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'Flight Check' }))
    const daily = await screen.findByRole('button', { name: 'Daily profile' })
    await waitFor(() => expect((daily as HTMLButtonElement).disabled).toBe(false))
    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(daily)
      await Promise.resolve()
    })
    expect(screen.getByRole('heading', { name: 'Dial left' })).toBeTruthy()

    inputMutated = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000)
    })
    expect(screen.getByText('THIS RUN CANNOT PASS')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End invalidated check/i }))
      await Promise.resolve()
    })
    expect(setFlightCheck).toHaveBeenLastCalledWith(false, 'daily')

    inputMutated = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000)
    })
    expect(screen.getByText('THIS RUN CANNOT PASS')).toBeTruthy()
    expect(screen.getByRole('button', { name: /End invalidated check/i })).toBeTruthy()
    expect(screen.queryByText('ACCEPTANCE PASSED')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /End invalidated check/i }))
      await Promise.resolve()
    })
    expect(screen.queryByText('THIS RUN CANNOT PASS')).toBeNull()
    expect(screen.getByRole('button', { name: 'Daily profile' })).toBeTruthy()
  })
})
