import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Activity, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CircleAlert, CircleCheck, CircleStop, CircleX, Command, Download, FolderOpen, Gauge, GitBranch, Keyboard,
  Mic2, Play, RotateCcw, Send, ShieldCheck, Sparkles, Split, TerminalSquare, Waypoints, X, Zap,
} from 'lucide-react'
import {
  actions, controls, correctedInputProfileObserved, correctedInputProfileObservedForVariant, effortLevels, hardware, profileOrder, profiles,
  type ActionDefinition, type AgentSlotSummary, type BoardRoute, type ControlId, type ExecutionResult, type InputInstallationStatus, type MissionControlSnapshot, type NativeAcceptanceAttestations, type NativeAcceptanceSnapshot, type PhysicalSignalEnvelope, type ProfileId, type ProfileRepairResult, type ReceiverRuntimeStatus, type SystemStatus, type WorkspaceSnapshot,
} from './board'
import { agentProviderLabel, agentStateClassName, agentStateLabels, agentStateLegendOrder, agentVisibleStateLabel } from './agent-accessibility'
import AttentionDeck from './components/AttentionDeck'
import FleetBrief from './components/FleetBrief'
import NativeControlCheck, { type NativeControlCheckReceipt, type NativeControlCheckReport } from './components/NativeControlCheck'
import { expectedSignalsAfter, flightAcceptance, flightStepComplete, noSignalRecoveryNeeded, stepsForVariant, type FlightEvent, type FlightVariant } from './flight-check'
import { nativeControlReportFresh } from './native-control-report'
import './App.css'

const initialStatus: SystemStatus = {
  boardConnected: false, boardVidPid: null, inputInstalled: false, inputMonitoring: 'unverified',
  inputInstallation: { status: 'probe_unavailable', version: null },
  inputProfile: { cacheStatus: 'missing', activeProfile: null, activeLayer: null, encoderDirection: 'unavailable' },
  inputRuntime: { status: 'not_observed', profileIndex: null, layerIndex: null, observedAt: null, fresh: false },
  codex: false, claude: false, ashlr: false,
  chatgptDesktop: { status: 'unavailable', version: null, build: null },
  nativeCodexMicro: { status: 'not_observed', observedAt: null, detail: 'No recent native Codex Creator Micro connection evidence was found.' },
  boardRoute: 'unknown',
  workspace: '/Choose a working directory', shortcutCount: 0, shortcutRegistrations: [], workspaceSnapshot: null, receiverIdentity: null,
  receiverRuntime: { status: 'unavailable', instanceCount: 0, distinctBuildCount: 0, currentAsarSha256: null, candidateAsarSha256: null, candidateMatchesCurrent: null },
}
const initialMission: MissionControlSnapshot = {
  schemaVersion: 1, observedAt: new Date(0).toISOString(), agentSource: 'unavailable', fleetSource: 'unavailable',
  agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off', title: 'Available slot', updatedAt: null })),
  fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
}

function describeInputInstallation(input: InputInstallationStatus): { state: string; guidance: string } {
  const version = input.version ? ` ${input.version}` : ''
  switch (input.status) {
    case 'verified':
      return {
        state: `Input${version} · publisher, signature, and Gatekeeper verified`,
        guidance: 'This verifies the installed app copy only. Profile state, device synchronization, permission, and physical routing remain separate gates.',
      }
    case 'missing':
      return {
        state: 'Input.app not found · shortcuts disabled',
        guidance: 'Install Work Louder Input from the official release, reopen Agent Board, and require a verified result before profile or firmware work.',
      }
    case 'multiple_installations':
      return {
        state: `Input${version} · multiple installations · shortcuts disabled`,
        guidance: 'Use Finder to keep one intended official Input installation, remove the duplicate manually, then reopen Agent Board. No application was changed automatically.',
      }
    case 'unsafe':
      return {
        state: `Input${version} · unsafe installation path · shortcuts disabled`,
        guidance: 'Replace the unsafe copy through Finder with the official Work Louder release. Do not follow symlinks, bypass Gatekeeper, or let an agent delete the app.',
      }
    case 'invalid_metadata':
      return {
        state: `Input${version} · invalid application metadata · shortcuts disabled`,
        guidance: 'Replace this copy with the official Work Louder release; its bundle metadata could not be verified. Do not continue to profile or firmware work.',
      }
    case 'publisher_unrecognized':
      return {
        state: `Input${version} · publisher unrecognized · shortcuts disabled`,
        guidance: 'Replace this copy with the official Work Louder release. Do not approve or work around an unexpected publisher.',
      }
    case 'invalid_signature':
      return {
        state: `Input${version} · invalid signature · shortcuts disabled`,
        guidance: 'Fully quit Input, replace it in Finder from the official Work Louder release, then require a verified result. Do not ad-hoc sign or alter the app.',
      }
    case 'known_resource_mutation':
      return {
        state: `Input${version} · sealed helper changed · not verified · shortcuts disabled`,
        guidance: 'On this desk, Input 0.18.4 later showed this exact sealed helper change while it was running; which process caused the change is unproven. This installed copy is not trusted or verified. Fully quit Input, make a stopped-state backup, reinstall the official 0.18.4 DMG, and verify the fresh copy before launching it. If the profile is already correct, leave Input closed during commissioning. This state never authorizes firmware work.',
      }
    case 'gatekeeper_rejected':
      return {
        state: `Input${version} · Gatekeeper rejected · shortcuts disabled`,
        guidance: 'Replace this copy with the official Work Louder release and let macOS assess it again. Do not bypass Gatekeeper or strip quarantine metadata.',
      }
    case 'probe_unavailable':
      return {
        state: `Input${version} · verification unavailable · shortcuts disabled`,
        guidance: 'Publisher, signature, and Gatekeeper verification could not complete. Retry after reopening Agent Board, then verify the intended official installation manually if the probe remains unavailable. Do not reinstall solely because a probe failed, and do not continue while trust is unknown.',
      }
  }
}
const verifiedInputInstallation = (input: InputInstallationStatus) => input.status === 'verified'
  && typeof input.version === 'string'
  && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(input.version)
const exclusiveReceiverRuntime = (receiver: ReceiverRuntimeStatus) => receiver.status === 'exclusive'
  && receiver.instanceCount === 1
  && receiver.distinctBuildCount === 1
const initialRecoveryGuide: AgentBoardRecoveryGuide = { handoff: null, artifact: { status: 'invalid', available: false }, steps: [] }
const emptyNativeAttestations: NativeAcceptanceAttestations = {
  settingsConnected: false,
  dial: false,
  joystick: false,
  agentKeys: false,
  actionKeys: false,
  microphone: false,
  lighting: false,
}
const formatClock = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const normalizeControl = (control: ControlId): ControlId => control

const hardwareIds: Partial<Record<ControlId, string>> = {
  agent1: 'AG00', agent2: 'AG01', agent3: 'AG02', agent4: 'AG03', agent5: 'AG04', agent6: 'AG05',
  cmd1: 'ACT06', cmd2: 'ACT07', cmd3: 'ACT08', cmd4: 'ACT09', cmd5: 'ACT10', cmd6: 'ACT11', cmd7: 'ACT12',
  dialLeft: 'ENC_CC', dialRight: 'ENC_CW', dialPress: 'ENC_CLK',
  joyUp: 'JOY_UP', joyRight: 'JOY_RIGHT', joyDown: 'JOY_DOWN', joyLeft: 'JOY_LEFT',
}

const STATUS_REFRESH_TIMEOUT_MS = 13_000
const NATIVE_ACCEPTANCE_POLL_MS = 5_000
const viewOrder = ['operate', 'flight', 'setup'] as const

const flightLiveGatesReady = (status: SystemStatus, variant: FlightVariant) =>
  status.boardRoute === 'ashlr_layer'
  && status.boardConnected
  && status.shortcutCount === hardware.bindableSignals
  && verifiedInputInstallation(status.inputInstallation ?? initialStatus.inputInstallation)
  && exclusiveReceiverRuntime(status.receiverRuntime ?? initialStatus.receiverRuntime)
  && correctedInputProfileObservedForVariant(status.inputProfile ?? initialStatus.inputProfile, variant)

function App() {
  const bridge = window.agentBoard
  const [profileId, setProfileId] = useState<ProfileId>('codex')
  const [activeControl, setActiveControl] = useState<ControlId>('agent1')
  const [effortIndex, setEffortIndex] = useState(2)
  const [status, setStatus] = useState<SystemStatus>(initialStatus)
  const [mission, setMission] = useState<MissionControlSnapshot>(initialMission)
  const [selectedAgentSlot, setSelectedAgentSlot] = useState(1)
  const [result, setResult] = useState<ExecutionResult | null>(null)
  const [approval, setApproval] = useState<{ action: ActionDefinition; token: string } | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  const [view, setView] = useState<'operate' | 'flight' | 'setup'>('operate')
  const [showIds, setShowIds] = useState(false)
  const [lastPhysicalSignal, setLastPhysicalSignal] = useState<Date | null>(null)
  const [flightPhase, setFlightPhase] = useState<'inactive' | 'arming' | 'active' | 'disarming' | 'error'>('inactive')
  const [flightSignals, setFlightSignals] = useState<ControlId[]>([])
  const [flightEvents, setFlightEvents] = useState<FlightEvent[]>([])
  const [flightStartedAt, setFlightStartedAt] = useState<string | null>(null)
  const [flightExport, setFlightExport] = useState<string | null>(null)
  const [flightVariant, setFlightVariant] = useState<FlightVariant>('daily')
  const [flightInvalidatedRun, setFlightInvalidatedRun] = useState<number | null>(null)
  const [routeSaving, setRouteSaving] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [recoveryGuide, setRecoveryGuide] = useState<AgentBoardRecoveryGuide>(initialRecoveryGuide)
  const [nativeControlReceipt, setNativeControlReceipt] = useState<NativeControlCheckReceipt | null>(null)
  const holdTimer = useRef<number | null>(null)
  const holdAttempt = useRef(0)
  const holdPending = useRef(false)
  const lastSignal = useRef<Partial<Record<ControlId, number>>>({})
  const flightExpected = useRef<ControlId[]>([])
  const flightRequest = useRef(0)
  const flightRun = useRef<{ request: number; underTest: boolean; invalidated: boolean; variant: FlightVariant }>({ request: 0, underTest: false, invalidated: false, variant: 'daily' })
  const statusRequest = useRef(0)
  const routeMutation = useRef(0)
  const flightActive = flightPhase === 'active'

  const profile = profiles[profileId]
  const activeAction = actions[profile.mapping[activeControl]]
  const effort = effortLevels[effortIndex]
  const nativeCodexMicro = status.nativeCodexMicro ?? initialStatus.nativeCodexMicro
  const chatgptDesktop = status.chatgptDesktop ?? initialStatus.chatgptDesktop
  const inputInstallation = status.inputInstallation ?? initialStatus.inputInstallation
  const receiverRuntime = status.receiverRuntime ?? initialStatus.receiverRuntime
  const receiverIdentity = status.receiverIdentity
  const inputInstallationDescription = describeInputInstallation(inputInstallation)
  const inputInstallationReady = verifiedInputInstallation(inputInstallation)
  const receiverExclusive = exclusiveReceiverRuntime(receiverRuntime)

  const refreshStatus = useCallback(async () => {
    if (!bridge) return null
    const request = ++statusRequest.current
    const mutation = routeMutation.current
    const flightGeneration = flightRequest.current
    let timeout: number | undefined
    try {
      const nextStatus = await Promise.race<SystemStatus | null>([
        bridge.getStatus(),
        new Promise<null>((resolve) => { timeout = window.setTimeout(() => resolve(null), STATUS_REFRESH_TIMEOUT_MS) }),
      ])
      if (!nextStatus || request !== statusRequest.current || mutation !== routeMutation.current || flightGeneration !== flightRequest.current) return null
      const run = flightRun.current
      if (run.underTest && !flightLiveGatesReady(nextStatus, run.variant)) {
        flightRun.current = { ...run, invalidated: true }
        setFlightInvalidatedRun(run.request)
        setFlightExport(null)
      }
      setStatus(nextStatus)
      return nextStatus
    } catch {
      return null
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [bridge])
  const refreshMission = useCallback(async () => {
    if (bridge?.getMissionControl) setMission(await bridge.getMissionControl())
  }, [bridge])
  const refreshRecoveryGuide = useCallback(async () => {
    if (!bridge?.getRecoveryGuide) return null
    try {
      const guide = await bridge.getRecoveryGuide()
      setRecoveryGuide(guide)
      return guide
    } catch {
      return null
    }
  }, [bridge])

  const internalResult = (title: string, message: string) => setResult({
    ok: true, title, message, timestamp: new Date().toISOString(),
  })

  const executeInternal = (action: ActionDefinition) => {
    if (action.executor === 'effort_down') {
      setEffortIndex((value) => Math.max(0, value - 1))
      internalResult('Reasoning adjusted', 'Moved one step toward faster responses.')
      return true
    }
    if (action.executor === 'effort_up') {
      setEffortIndex((value) => Math.min(effortLevels.length - 1, value + 1))
      internalResult('Reasoning adjusted', 'Moved one step toward deeper analysis.')
      return true
    }
    if (action.executor === 'profile_next' || action.executor === 'profile_previous') {
      const index = profileOrder.indexOf(profileId)
      const delta = action.executor === 'profile_next' ? 1 : -1
      const next = profileOrder[(index + delta + profileOrder.length) % profileOrder.length]
      setProfileId(next)
      internalResult('Profile changed', `Now using ${profiles[next].name}.`)
      return true
    }
    return false
  }

  const executeAction = useCallback(async (action: ActionDefinition, token?: string) => {
    if (executeInternal(action)) return
    if (!bridge) {
      internalResult(`${action.title} simulated`, 'Desktop execution is available when the Electron app is running.')
      return
    }
    setIsRunning(true)
    try {
      const focusedSlot = action.executor.startsWith('focus_agent_') ? Number(action.executor.slice('focus_agent_'.length)) : null
      if (focusedSlot) setSelectedAgentSlot(focusedSlot)
      const priority = { error: 0, needs_input: 1, working: 2, unread: 3, idle: 4, off: 5 } as const
      const attentionSlot = action.executor === 'stage_attention'
        ? [...mission.agents]
          .filter((agent) => agent.state !== 'off')
          .sort((left, right) => priority[left.state] - priority[right.state] || left.slot - right.slot)[0]?.slot ?? null
        : null
      const response = attentionSlot
        ? bridge.focusAgentSlot
          ? await bridge.focusAgentSlot(attentionSlot)
          : { ok: false, title: 'Attention unavailable', message: 'This app build does not expose live provider focus.', timestamp: new Date().toISOString() }
        : action.executor === 'stage_attention'
          ? { ok: false, title: 'No agent needs attention', message: 'All six observed slots are off. Start or resume a Codex or Claude Code session, then refresh.', timestamp: new Date().toISOString() }
        : focusedSlot
        ? bridge.focusAgentSlot
          ? await bridge.focusAgentSlot(focusedSlot)
          : { ok: false, title: 'Focus unavailable', message: 'This app build does not expose live provider focus.', timestamp: new Date().toISOString() }
        : token
          ? await bridge.confirmAction(action.id, token)
          : await bridge.requestAction(action.id)
      if (response.needsConfirmation && response.token) {
        setApproval({ action, token: response.token })
        setResult(null)
      } else {
        setResult(response)
        setApproval(null)
        refreshStatus()
        refreshMission()
      }
    } finally {
      setIsRunning(false)
    }
  // executeInternal intentionally tracks the current profile and effort.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, mission.agents, profileId, refreshMission, refreshStatus])

  const executeControl = useCallback((rawControl: ControlId) => {
    const control = normalizeControl(rawControl)
    const signalTime = Date.now()
    if (signalTime - (lastSignal.current[control] ?? 0) < 140) return
    lastSignal.current[control] = signalTime
    if (status.boardRoute !== 'ashlr_layer') {
      internalResult(
        status.boardRoute === 'codex_native' ? 'Codex Native observer only' : 'Ashlr action route not selected',
        status.boardRoute === 'codex_native'
          ? 'Agent Board does not execute its Ashlr shortcut map while Codex owns the board keys and lighting.'
          : 'Select Ashlr Layer before using mapped Agent Board actions. Software-only Agent-slot focus remains available.',
      )
      return
    }
    if (isRunning) {
      internalResult('Action already running', 'Wait for the current local action to finish before sending another signal.')
      return
    }
    const selected = actions[profiles[profileId].mapping[control]]
    if (selected.nativeOwned) {
      internalResult(
        selected.id === 'mic_setup' ? 'Voice key needs one-time setup' : 'Codex owns this control',
        selected.id === 'mic_setup'
          ? 'Choose the intended physical voice key in Codex settings, then verify ACT10 and ACT11 separately.'
          : 'Use the physical control in Codex for native thread focus and live RGB status.',
      )
      return
    }
    executeAction(selected)
  }, [executeAction, isRunning, profileId, status.boardRoute])

  useEffect(() => {
    refreshStatus()
    refreshMission()
    const interval = window.setInterval(refreshStatus, 12_000)
    const missionInterval = window.setInterval(refreshMission, 10_000)
    const unsubscribe = bridge?.onControl((signal: PhysicalSignalEnvelope) => {
      const rawControl = signal.signalId
      const control = normalizeControl(rawControl)
      setLastPhysicalSignal(new Date(signal.receivedAt))
      setActiveControl(control)
      if (flightActive) {
        setFlightSignals((seen) => seen.includes(rawControl) ? seen : [...seen, rawControl])
        setFlightEvents((events) => {
          const expectedSignals = [...flightExpected.current]
          const nextEvents = [...events.slice(-99), {
            signal: rawControl, receivedAt: signal.receivedAt, sequence: signal.sequence,
            accelerator: signal.accelerator, monotonicNs: signal.monotonicNs,
            expectedSignals, matched: expectedSignals.includes(rawControl),
          }]
          flightExpected.current = expectedSignalsAfter(flightVariant, nextEvents)
          return nextEvents
        })
        return
      }
      executeControl(rawControl)
    })
    return () => { window.clearInterval(interval); window.clearInterval(missionInterval); unsubscribe?.() }
  }, [bridge, executeControl, flightActive, flightVariant, refreshMission, refreshStatus])

  useEffect(() => {
    let current = true
    void refreshRecoveryGuide().then((guide) => {
      if (current && guide?.handoff) setView('setup')
    })
    return () => { current = false }
  }, [refreshRecoveryGuide])

  const focusAgentSlot = useCallback(async (slot: number) => {
    setSelectedAgentSlot(slot)
    setActiveControl(`agent${slot}` as ControlId)
    if (!bridge?.focusAgentSlot) return internalResult(`Agent ${slot} selected`, 'Desktop focus is available in the packaged app.')
    setIsRunning(true)
    try { setResult(await bridge.focusAgentSlot(slot)); setApproval(null); await refreshMission() }
    finally { setIsRunning(false) }
  }, [bridge, refreshMission])

  useEffect(() => {
    bridge?.setProfile(profileId)
    setResult(null)
    setApproval(null)
  }, [bridge, profileId])

  const selectControl = (control: ControlId) => {
    setActiveControl(normalizeControl(control)); setResult(null); setApproval(null)
  }

  const beginHold = async () => {
    if (!approval || holdTimer.current || holdPending.current) return
    const requestedApproval = approval
    const attempt = ++holdAttempt.current
    holdPending.current = true
    let accepted = true
    try {
      if (bridge) accepted = await bridge.beginHold(requestedApproval.action.id, requestedApproval.token)
    } catch {
      accepted = false
    }
    holdPending.current = false
    if (attempt !== holdAttempt.current) {
      if (bridge && accepted) bridge.cancelHold(requestedApproval.action.id, requestedApproval.token)
      return
    }
    if (!accepted) {
      setResult({ ok: false, title: 'Hold unavailable', message: 'Create a fresh authorization and try again.', timestamp: new Date().toISOString() })
      return
    }
    const started = Date.now()
    holdTimer.current = window.setInterval(() => {
      const progress = Math.min(1, (Date.now() - started) / 1600)
      setHoldProgress(progress)
      if (progress >= 1) {
        if (holdTimer.current) window.clearInterval(holdTimer.current)
        holdTimer.current = null; setHoldProgress(0)
        executeAction(requestedApproval.action, requestedApproval.token)
      }
    }, 30)
  }
  const cancelHold = useCallback(() => {
    holdAttempt.current += 1
    if (holdTimer.current) window.clearInterval(holdTimer.current)
    if (approval?.action.safety === 'hold') bridge?.cancelHold(approval.action.id, approval.token)
    holdTimer.current = null; setHoldProgress(0)
  }, [approval, bridge])

  const chooseWorkspace = async () => {
    if (bridge && await bridge.chooseWorkspace()) refreshStatus()
  }

  const declareBoardRoute = async (boardRoute: BoardRoute) => {
    if (!bridge?.setBoardRoute || routeSaving || boardRoute === status.boardRoute) return
    routeMutation.current += 1
    setRouteSaving(true)
    setRouteError(null)
    try {
      const saved = await bridge.setBoardRoute(boardRoute)
      setStatus((current) => ({ ...current, boardRoute: saved }))
      setApproval(null)
      internalResult(
        'Expected board route saved',
        'This declaration changed Agent Board’s local preference and runtime global-shortcut ownership. It did not change the board, firmware, Input, Codex configuration, or another process.',
      )
    } catch {
      const message = 'The route update could not be confirmed. Agent Board may have changed its local preference or runtime shortcut ownership; refresh Setup before acting. No board, firmware, Input, Codex configuration, or another process changed.'
      setRouteError(message)
      setResult({ ok: false, title: 'Route not saved', message, timestamp: new Date().toISOString() })
    } finally {
      setRouteSaving(false)
    }
  }

  const startFlightCheck = async (variant: 'daily' | 'diagnostic' = 'daily') => {
    if (status.boardRoute === 'codex_native') {
      setView('setup')
      internalResult('Native verification is separate', 'The Ashlr Flight Check validates only the Work Louder Input shortcut layer. Keep Codex Native declared so Agent Board remains passive, quit Work Louder Input, restart ChatGPT Desktop, then verify Settings → Creator Micro.')
      return
    }
    if (!verifiedInputInstallation(status.inputInstallation ?? initialStatus.inputInstallation)
      || !exclusiveReceiverRuntime(status.receiverRuntime ?? initialStatus.receiverRuntime)) {
      setView('flight')
      setFlightPhase('inactive')
      return
    }
    if (!correctedInputProfileObservedForVariant(status.inputProfile ?? initialStatus.inputProfile, variant)) {
      setView('setup')
      internalResult(
        'Activate the corrected Input profile first',
        status.inputProfile?.encoderDirection === 'reversed'
          ? 'The read-only Input receipt shows clockwise and counterclockwise are reversed. Flight Check cannot produce a valid first gesture until the corrected profile is active.'
          : variant === 'daily'
            ? 'Daily Flight Check requires the read-only Input receipt to confirm Ashlr Agent Board Corrected, Ashlr Daily, and the corrected encoder order.'
            : 'Diagnostic Flight Check requires the temporary Ashlr Flight Check Corrected - diagnostic profile, Ashlr Diagnostic layer, and the corrected encoder order.',
      )
      return
    }
    if (!status.boardConnected || status.shortcutCount !== hardware.bindableSignals) {
      setView('flight')
      setFlightPhase('inactive')
      return
    }
    const request = ++flightRequest.current
    flightRun.current = { request, underTest: true, invalidated: true, variant }
    setFlightInvalidatedRun(null)
    setFlightSignals([])
    setFlightEvents([])
    setFlightExport(null)
    setFlightStartedAt(null)
    setFlightVariant(variant)
    flightExpected.current = stepsForVariant(variant)[0].signals
    setView('flight')
    setApproval(null)
    cancelHold()
    setFlightPhase('arming')
    if (!bridge) {
      if (request === flightRequest.current) {
        flightRun.current = { request, underTest: false, invalidated: false, variant }
        setFlightPhase('error')
      }
      return
    }
    try {
      const acknowledgement = await bridge.setFlightCheck(true, variant)
      if (request !== flightRequest.current) return
      if (!acknowledgement.acknowledged || !acknowledgement.active) {
        flightRun.current = { request, underTest: false, invalidated: false, variant }
        setFlightPhase('error')
        return
      }
      setFlightStartedAt(acknowledgement.startedAt)
      const confirmedStatus = await refreshStatus()
      if (request !== flightRequest.current) return
      if (!confirmedStatus || !flightLiveGatesReady(confirmedStatus, variant)) {
        flightRun.current = { request, underTest: true, invalidated: true, variant }
        setFlightInvalidatedRun(request)
        setFlightPhase('error')
        return
      }
      flightRun.current = { request, underTest: true, invalidated: false, variant }
      setFlightInvalidatedRun(null)
      setFlightPhase('active')
    } catch {
      if (request === flightRequest.current) {
        flightRun.current = { request, underTest: false, invalidated: false, variant }
        setFlightPhase('error')
      }
    }
  }

  const stopFlightCheck = async () => {
    const priorRun = flightRun.current
    const failurePhase = flightPhase === 'active' ? 'active' : 'error'
    const request = ++flightRequest.current
    flightRun.current = { ...priorRun, request }
    if (priorRun.invalidated) setFlightInvalidatedRun(request)
    if (!bridge) { setFlightPhase('error'); return false }
    setFlightPhase('disarming')
    try {
      const acknowledgement = await bridge.setFlightCheck(false, flightVariant)
      if (request !== flightRequest.current) return false
      if (!acknowledgement.acknowledged || acknowledgement.active) {
        setFlightPhase(failurePhase)
        void refreshStatus()
        return false
      }
      setFlightSignals([])
      setFlightEvents([])
      setFlightStartedAt(null)
      setFlightExport(null)
      flightExpected.current = []
      flightRun.current = { request, underTest: false, invalidated: false, variant: flightVariant }
      setFlightInvalidatedRun(null)
      setFlightPhase('inactive')
      return true
    } catch {
      if (request === flightRequest.current) {
        setFlightPhase(failurePhase)
        void refreshStatus()
      }
      return false
    }
  }

  const changeView = async (nextView: 'operate' | 'flight' | 'setup') => {
    if (nextView !== 'flight' && flightPhase !== 'inactive') {
      if (!await stopFlightCheck()) return
    }
    setView(nextView)
  }

  const restartFlightCheck = async () => {
    if (!bridge?.restartFlightCheck || flightPhase !== 'active') return
    if (!flightLiveGatesReady(status, flightVariant)) return
    const request = ++flightRequest.current
    flightRun.current = { request, underTest: true, invalidated: true, variant: flightVariant }
    setFlightInvalidatedRun(request)
    setFlightSignals([])
    setFlightEvents([])
    setFlightStartedAt(null)
    setFlightExport(null)
    flightExpected.current = []
    setFlightPhase('arming')
    try {
      const acknowledgement = await bridge.restartFlightCheck(flightVariant)
      if (request !== flightRequest.current) return
      if (!acknowledgement.acknowledged || !acknowledgement.active || !acknowledgement.startedAt) {
        setFlightPhase('error')
        return
      }
      setFlightStartedAt(acknowledgement.startedAt)
      flightExpected.current = stepsForVariant(flightVariant)[0].signals
      const confirmedStatus = await refreshStatus()
      if (request !== flightRequest.current) return
      if (!confirmedStatus || !flightLiveGatesReady(confirmedStatus, flightVariant)) {
        flightRun.current = { request, underTest: true, invalidated: true, variant: flightVariant }
        setFlightInvalidatedRun(request)
        setFlightPhase('error')
        return
      }
      flightRun.current = { request, underTest: true, invalidated: false, variant: flightVariant }
      setFlightInvalidatedRun(null)
      setFlightPhase('active')
    } catch {
      if (request === flightRequest.current) setFlightPhase('error')
    }
  }

  const exportFlightReceipt = async () => {
    if (!bridge || !flightStartedAt || flightPhase !== 'active') return
    if (flightRun.current.invalidated || flightInvalidatedRun === flightRequest.current || !flightLiveGatesReady(status, flightVariant)) return
    const request = flightRequest.current
    const selectedSteps = stepsForVariant(flightVariant)
    const acceptance = flightAcceptance(flightVariant, flightEvents, status.boardConnected, status.shortcutCount, hardware.bindableSignals)
    const missing = selectedSteps.filter((step) => !flightStepComplete(step, flightEvents)).flatMap((step) => step.signals)
    const response = await bridge.saveFlightReceipt({
      schemaVersion: 1,
      device: { name: hardware.name, usbName: hardware.usbName, expectedSignals: hardware.bindableSignals },
      status: acceptance.passed ? 'passed' : acceptance.routesComplete ? 'failed' : 'incomplete',
      profileKind: flightVariant,
      startedAt: flightStartedAt,
      exportedAt: new Date().toISOString(),
      workspace: status.workspace,
      boardConnected: status.boardConnected,
      shortcutCount: status.shortcutCount,
      receivedSignals: flightSignals,
      missingSignals: missing,
      problems: flightEvents.filter((event) => !event.matched).map((event) => ({
        kind: 'misroute',
        observed: event.signal,
        expected: event.expectedSignals,
        receivedAt: event.receivedAt,
      })),
      events: flightEvents,
    })
    if (response
      && request === flightRequest.current
      && flightRun.current.request === request
      && flightRun.current.underTest
      && !flightRun.current.invalidated) setFlightExport(response)
  }

  useEffect(() => cancelHold, [activeControl, cancelHold, profileId, view])
  useEffect(() => {
    window.addEventListener('blur', cancelHold)
    return () => window.removeEventListener('blur', cancelHold)
  }, [cancelHold])
  useEffect(() => () => cancelHold(), [cancelHold])

  const nativeRoute = status.boardRoute === 'codex_native'
  const nativeEvidenceFresh = nativeCodexMicro.fresh === true
  const nativeControlContextKey = JSON.stringify([
    status.boardRoute,
    status.boardVidPid,
    chatgptDesktop.version,
    chatgptDesktop.build,
    nativeCodexMicro.observedAt,
  ])
  useEffect(() => {
    let current = true
    setNativeControlReceipt(null)
    if (!nativeRoute || !bridge?.getNativeControlCheck) return () => { current = false }
    void bridge.getNativeControlCheck()
      .then((receipt) => { if (current) setNativeControlReceipt(receipt) })
      .catch(() => { if (current) setNativeControlReceipt(null) })
    return () => { current = false }
  }, [bridge, nativeControlContextKey, nativeRoute])
  const nativePill = status.boardRoute !== 'codex_native'
    ? { label: status.boardRoute === 'ashlr_layer' ? 'Native not in use' : 'Native route not selected', tone: 'off' as const }
    : nativeCodexMicro.status === 'connected' && nativeEvidenceFresh
      ? { label: 'Native initialization observed', tone: 'warn' as const }
      : nativeCodexMicro.status === 'firmware_rpc_missing'
        ? { label: nativeEvidenceFresh ? 'Native RPC unavailable' : 'Historical native RPC 404', tone: 'warn' as const }
        : nativeCodexMicro.status === 'connection_failed'
          ? { label: nativeEvidenceFresh ? 'Native connection failed' : 'Native evidence expired', tone: 'warn' as const }
          : { label: 'Native unverified', tone: 'off' as const }

  const moveViewFocus = (currentView: typeof viewOrder[number], key: string) => {
    const currentIndex = viewOrder.indexOf(currentView)
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? viewOrder.length - 1
        : (currentIndex + (key === 'ArrowLeft' ? -1 : 1) + viewOrder.length) % viewOrder.length
    const nextView = viewOrder[nextIndex]
    changeView(nextView)
    document.getElementById(`view-tab-${nextView}`)?.focus()
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><Waypoints size={18} /></div>
          <div><span className="eyebrow">ASHLR // TACTILE AGENT OPERATIONS</span><h1>Agent Board</h1></div>
        </div>
        <div className="view-switch" role="tablist" aria-label="Agent Board view">
          {viewOrder.map((candidate) => <button
            id={`view-tab-${candidate}`}
            key={candidate}
            type="button"
            role="tab"
            aria-selected={view === candidate}
            tabIndex={view === candidate ? 0 : -1}
            className={view === candidate ? 'active' : ''}
            onClick={() => void changeView(candidate)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              moveViewFocus(candidate, event.key)
            }}
          >{candidate === 'operate' ? 'Operate' : candidate === 'flight' ? 'Flight Check' : 'Setup'}</button>)}
        </div>
        <div className="system-strip" aria-label="System status">
          <button type="button" className="status-pill compact-launch" onClick={() => void bridge?.showCompactDeck?.()}><Command size={14} /> Compact Deck</button>
          <StatusPill label={status.boardConnected ? 'USB identity observed' : 'USB identity not observed'} tone={status.boardConnected ? 'observed' : 'off'} icon={<Keyboard size={14} />} />
          <StatusPill
            label={nativePill.label}
            tone={nativePill.tone}
            icon={<Sparkles size={14} />}
          />
          <StatusPill label={status.codex ? 'Codex CLI found' : 'Codex CLI absent'} tone={status.codex ? 'ready' : 'off'} icon={<Sparkles size={14} />} />
          <StatusPill label={status.claude ? 'Claude CLI found' : 'Claude CLI absent'} tone={status.claude ? 'ready' : 'off'} icon={<Bot size={14} />} />
          <StatusPill
            label={mission.agentSource === 'observer_online' ? 'Agent session feed live' : mission.agentSource === 'invalid' ? 'Agent session feed invalid' : 'Agent session feed unavailable'}
            tone={mission.agentSource === 'observer_online' ? 'ready' : mission.agentSource === 'invalid' ? 'warn' : 'off'}
            icon={<Activity size={14} />}
          />
          <StatusPill
            label={mission.fleetSource === 'status_receipt' ? (mission.fleet?.daemonRunning ? `Fleet ${mission.fleet.daemonPhase}` : 'Fleet offline') : mission.fleetSource === 'invalid' ? 'Fleet invalid' : 'Fleet unavailable'}
            tone={mission.fleet?.daemonRunning ? (mission.fleet.blocker || mission.fleet.guardBlocked || mission.fleet.killed ? 'warn' : 'ready') : 'off'}
            icon={<Waypoints size={14} />}
          />
        </div>
      </header>

      {view === 'operate' ? <>
        <nav className="profile-rail" aria-label="Software lenses" role="tablist">
          {profileOrder.map((id, index) => {
            const candidate = profiles[id]
            return <button
              id={`profile-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={id === profileId}
              tabIndex={id === profileId ? 0 : -1}
              key={id}
              onClick={() => setProfileId(id)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const nextIndex = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? profileOrder.length - 1
                    : (index + (event.key === 'ArrowLeft' ? -1 : 1) + profileOrder.length) % profileOrder.length
                const nextProfile = profileOrder[nextIndex]
                setProfileId(nextProfile)
                document.getElementById(`profile-tab-${nextProfile}`)?.focus()
              }}
              className={id === profileId ? 'profile-tab active' : 'profile-tab'}>
              <span className="profile-number">0{index + 1}</span><span className="profile-signal" style={{ background: candidate.color }} />
              <span>{candidate.name}</span><small>{candidate.shortLabel}</small>
            </button>
          })}
          <div className={`profile-rail-note route-${status.boardRoute}`} aria-live="polite">
            {status.boardRoute === 'ashlr_layer'
              ? 'JOYSTICK ← → CHANGES LENS · ↑ ↓ RUNS LENS ACTIONS'
              : status.boardRoute === 'codex_native'
                ? 'JOYSTICK OWNED BY CODEX · SCREEN TWIN DISABLED'
                : 'CHOOSE A BOARD ROUTE · SCREEN TWIN IS PREVIEW ONLY'}
          </div>
        </nav>


        <BoardRouteRail route={status.boardRoute} saving={routeSaving} error={routeError} onChange={(route) => void declareBoardRoute(route)} />

        <div className="readiness-ribbon">
          <span className={status.boardConnected ? 'check observed' : 'check'}><Keyboard size={12} /> {status.boardConnected ? 'USB identity only · controls unproven' : 'USB identity not observed'}</span>
          {status.boardRoute === 'codex_native' ? <>
            <span className={chatgptDesktop.status === 'metadata_observed' ? 'check observed' : 'check warn'}><Sparkles size={12} /> {chatgptDesktop.status === 'metadata_observed' ? `ChatGPT Desktop ${chatgptDesktop.version ?? ''} metadata observed`.replace('  ', ' ') : chatgptDesktop.status === 'missing' ? 'ChatGPT Desktop not found' : 'ChatGPT Desktop metadata unavailable'}</span>
            <span className={nativeCodexMicro.status === 'connected' && nativeEvidenceFresh ? 'check observed' : 'check warn'}><Activity size={12} /> {nativeCodexMicro.status === 'connected' && nativeEvidenceFresh ? 'Native initialization inferred' : 'Native initialization unverified'}</span>
          </> : status.boardRoute === 'ashlr_layer' ? <>
            <span className={status.shortcutCount === hardware.bindableSignals ? 'check ready' : 'check'}><Check size={12} /> {status.shortcutCount}/{hardware.bindableSignals} desktop endpoints registered</span>
            <span className={inputInstallationReady ? 'check ready' : 'check warn'}><Check size={12} /> {inputInstallationReady ? `Input ${inputInstallation.version ?? ''} verified`.replace('  ', ' ') : inputInstallationDescription.state}</span>
            <span className={receiverExclusive ? 'check ready' : 'check warn'}><ShieldCheck size={12} /> {receiverExclusive ? 'One shortcut receiver' : receiverRuntime.status === 'unavailable' ? 'Receiver ownership unavailable' : `${receiverRuntime.instanceCount} receivers · ownership disabled`}</span>
          </> : <span className="check warn"><ShieldCheck size={12} /> Select a board route before commissioning</span>}
          {status.workspaceSnapshot?.isGit && <span className={!status.workspaceSnapshot.statusKnown || status.workspaceSnapshot.dirtyFiles ? 'check warn' : 'check ready'}><GitBranch size={12} /> {status.workspaceSnapshot.branch} · {!status.workspaceSnapshot.statusKnown ? 'status unknown' : status.workspaceSnapshot.dirtyFiles ? `${status.workspaceSnapshot.dirtyFiles} changed` : 'clean'}</span>}
          <span className="check"><Keyboard size={12} /> {status.boardRoute === 'codex_native' ? 'Native profile: operator verification required' : status.boardRoute === 'ashlr_layer' ? 'Ashlr layer: physical check required' : 'Physical route: not selected'}</span>
          <button type="button" onClick={() => changeView('setup')}><span className="attention-dot" /> {status.boardRoute === 'codex_native' ? 'Open native acceptance handoff' : status.boardRoute === 'ashlr_layer' ? 'Input Monitoring needs human verification' : 'Choose a route in Setup'} <ChevronRight size={13} /></button>
        </div>

        {nativeRoute && <NativeRouteTruth status={status} receipt={nativeControlReceipt} onOpenSetup={() => changeView('setup')} />}

        <div className="mission-control-grid">
          <AttentionDeck agents={mission.agents} selectedSlot={selectedAgentSlot} source={mission.agentSource} boardRoute={status.boardRoute} onSelect={setSelectedAgentSlot} onFocus={(slot) => void focusAgentSlot(slot)} />
          <FleetBrief fleet={mission.fleet} source={mission.fleetSource} notices={mission.operatorNotices} />
        </div>

        <div className="workspace-grid">
          <section className="deck-stage" style={{ '--profile-color': profile.color } as React.CSSProperties}>
            <div className="stage-heading">
              <div><span className="eyebrow">SOFTWARE MODE {String(profileOrder.indexOf(profileId) + 1).padStart(2, '0')} / 05</span><h2>{profile.name}</h2><p>{profile.description}</p></div>
              <div className="stage-tools">
                <button type="button" className={showIds ? 'id-toggle active' : 'id-toggle'} onClick={() => setShowIds((value) => !value)}>Hardware IDs</button>
                <div className="brainpower"><Gauge size={16} /><span>Brainpower</span><strong>{effort.label}</strong></div>
              </div>
            </div>

            {nativeRoute && <div className="native-observer-note"><ShieldCheck size={15} /><span><strong>Codex Native observer only.</strong> This Ashlr twin does not represent Codex’s native key map or RGB, and its mapped actions are disabled.</span></div>}
            <div className={nativeRoute ? 'deck-and-trace native-observer' : 'deck-and-trace'}>
              <div className="device-frame" aria-label={`Creator Micro 2 screen twin with black caps and transparent ACT12${nativeRoute ? '; disabled while Codex Native owns the controls' : ''}`} aria-disabled={nativeRoute}>
                <div className="device-inner">
                  <span className="case-copy left">Work Louder | Creator Micro 2</span>
                  <span className="case-copy right">Screen legend</span>
                  <span className="case-copy bottom">Black caps + transparent ACT12</span>
                  <span className="cable-arrow">↑</span>
                  <span className="case-screw tl" /><span className="case-screw tr" /><span className="case-screw bl" /><span className="case-screw br" />
                  <div className="hardware-grid">
                    <Dial active={activeControl} onSelect={selectControl} showIds={showIds} disabled={nativeRoute} />
                    <BoardKey control="agent1" action={actions[profile.mapping.agent1]} agent={mission.agents[0]} active={activeControl === 'agent1'} onSelect={selectControl} kind="agent" showIds={showIds} disabled={nativeRoute} />
                    <BoardKey control="agent2" action={actions[profile.mapping.agent2]} agent={mission.agents[1]} active={activeControl === 'agent2'} onSelect={selectControl} kind="agent" showIds={showIds} disabled={nativeRoute} />
                    <Joystick active={activeControl} onSelect={selectControl} showIds={showIds} disabled={nativeRoute} />
                    {(['agent3', 'agent4', 'agent5', 'agent6'] as ControlId[]).map((control, index) => <BoardKey key={control} control={control} action={actions[profile.mapping[control]]} agent={mission.agents[index + 2]} active={activeControl === control} onSelect={selectControl} kind="agent" showIds={showIds} disabled={nativeRoute} />)}
                    <BoardKey control="cmd1" action={actions[profile.mapping.cmd1]} active={activeControl === 'cmd1'} onSelect={selectControl} kind="action" factoryIcon={<Zap />} showIds={showIds} disabled={nativeRoute} />
                    <BoardKey control="cmd2" action={actions[profile.mapping.cmd2]} active={activeControl === 'cmd2'} onSelect={selectControl} kind="action" factoryIcon={<CircleCheck />} showIds={showIds} disabled={nativeRoute} />
                    <BoardKey control="cmd3" action={actions[profile.mapping.cmd3]} active={activeControl === 'cmd3'} onSelect={selectControl} kind="action" factoryIcon={<CircleX />} showIds={showIds} disabled={nativeRoute} />
                    <BoardKey control="cmd4" action={actions[profile.mapping.cmd4]} active={activeControl === 'cmd4'} onSelect={selectControl} kind="action" factoryIcon={<Split />} showIds={showIds} disabled={nativeRoute} />
                    <TouchSensor showIds={showIds} />
                    <BoardKey control="cmd5" action={actions[profile.mapping.cmd5]} active={activeControl === 'cmd5'} onSelect={selectControl} kind="action" factoryIcon={<ActionIcon icon={actions[profile.mapping.cmd5].icon} size={21} />} showIds={showIds} disabled={nativeRoute} />
                    <BoardKey control="cmd6" action={actions[profile.mapping.cmd6]} active={activeControl === 'cmd6'} onSelect={selectControl} kind="action" factoryIcon={<ActionIcon icon={actions[profile.mapping.cmd6].icon} size={21} />} showIds={showIds} disabled={nativeRoute} />
                    <BoardKey control="cmd7" action={actions[profile.mapping.cmd7]} active={activeControl === 'cmd7'} onSelect={selectControl} kind="action transparent" factoryIcon={<ActionIcon icon={actions[profile.mapping.cmd7].icon} size={21} />} showIds={showIds} disabled={nativeRoute} />
                  </div>
                </div>
              </div>
              <div className="signal-path" aria-hidden="true"><span /><i /><b /></div>
            </div>
          </section>

          <ActionConsole
            activeControl={activeControl} action={activeAction} result={result} approval={approval}
            isRunning={isRunning} holdProgress={holdProgress} workspace={status.workspace}
            workspaceSnapshot={status.workspaceSnapshot}
            lastPhysicalSignal={lastPhysicalSignal}
            boardRoute={status.boardRoute}
            onRun={() => executeControl(activeControl)} onConfirm={(token) => executeAction(activeAction, token)}
            onBeginHold={beginHold} onCancelHold={cancelHold} onCancelApproval={() => setApproval(null)} onChooseWorkspace={chooseWorkspace}
          />
        </div>
      </> : view === 'flight' ? <FlightCheckView
        active={flightActive} events={flightEvents} startedAt={flightStartedAt}
        exportPath={flightExport} status={status} variant={flightVariant} phase={flightPhase}
        liveGateInvalidated={flightInvalidatedRun === flightRequest.current} onStart={startFlightCheck}
        onStop={() => void stopFlightCheck()} onRestart={() => void restartFlightCheck()} onExport={exportFlightReceipt}
        onSetup={() => void changeView('setup')} onOperate={() => void changeView('operate')}
      /> : <SetupView status={status} recoveryGuide={recoveryGuide} onRefreshRecoveryGuide={refreshRecoveryGuide} onRefreshStatus={refreshStatus} onNativeControlReceipt={setNativeControlReceipt} routeSaving={routeSaving} routeError={routeError} onRouteChange={(route) => void declareBoardRoute(route)} onOperate={() => changeView('operate')} onFlightCheck={() => void changeView('flight')} />}

      <footer className="footer-bar">
        <div><span className={status.boardConnected ? 'footer-led observed' : 'footer-led'} /> {status.boardConnected ? 'USB IDENTITY OBSERVED · CONTROLS UNPROVEN' : 'USB IDENTITY NOT OBSERVED'} · {hardware.mechanicalSwitches} SWITCHES · 1 TOUCH · 1 DIAL · 1 PLANAR STICK</div>
        <div><ShieldCheck size={14} /> Consequential actions require confirmation or hold.</div>
        <div className="build-identity" aria-label="Agent Board build identity">
          <span>AGENT BOARD {receiverIdentity ? `v${receiverIdentity.appVersion}` : 'VERSION LOADING'}</span>
          <code>{receiverIdentity?.appAsarSha256 ? `BUILD ${receiverIdentity.appAsarSha256.slice(0, 12)}` : receiverIdentity?.packaged ? 'BUILD UNAVAILABLE' : 'DEVELOPMENT BUILD'}</code>
        </div>
      </footer>
    </main>
  )
}

function StatusPill({ label, tone, icon }: { label: string; tone: 'ready' | 'observed' | 'off' | 'warn'; icon: ReactNode }) {
  return <span className={`status-pill ${tone}`}>{icon}<i />{label}</span>
}

function NativeRouteTruth({ status, receipt, onOpenSetup }: { status: SystemStatus; receipt: NativeControlCheckReceipt | null; onOpenSetup: () => void }) {
  const nativeCodexMicro = status.nativeCodexMicro ?? initialStatus.nativeCodexMicro
  const initializationObserved = nativeCodexMicro.status === 'connected' && nativeCodexMicro.fresh === true
  const possibleLayerMismatch = correctedInputProfileObserved(status.inputProfile ?? initialStatus.inputProfile)
  const receiptFresh = receipt ? nativeControlReportFresh(receipt) : false
  const physicalState = receipt?.overall === 'operator_accepted' && receiptFresh
    ? { label: 'Operator accepted · report, not HID proof', tone: 'accepted' }
    : receipt?.overall === 'reported_failure'
      ? { label: 'No response reported · recovery needed', tone: 'problem' }
      : receipt && !receiptFresh
        ? { label: 'Saved report expired · retest now', tone: 'problem' }
      : receipt
        ? { label: 'Partial operator report · acceptance incomplete', tone: 'pending' }
        : { label: 'No current physical-control report', tone: 'pending' }
  const hasProblem = possibleLayerMismatch || receipt?.overall === 'reported_failure' || Boolean(receipt && !receiptFresh)

  return <section
    className={`native-route-truth${hasProblem ? ' problem' : ''}`}
    role={hasProblem ? 'alert' : 'region'}
    aria-labelledby="native-route-truth-title"
  >
    <div className="native-truth-heading">
      <div>
        <span className="eyebrow">CODEX NATIVE / EVIDENCE CHAIN</span>
        <h2 id="native-route-truth-title">Connected is not the same as input-ready.</h2>
        <p>Codex Settings can say Connected while no board event reaches a task. Treat these four checks separately.</p>
      </div>
      <button type="button" onClick={onOpenSetup}>{hasProblem ? 'Open control recovery' : 'Open physical check'} <ChevronRight size={14} /></button>
    </div>
    <ol className="native-truth-grid">
      <li className={status.boardConnected ? 'observed' : 'problem'}>
        <span>01 · Transport</span>
        <strong>{status.boardConnected ? 'USB identity observed' : 'USB identity not observed'}</strong>
        <small>{status.boardConnected ? 'Detection only; no key event has been proven.' : 'Reconnect with a direct USB-C data cable before testing.'}</small>
      </li>
      <li className={initializationObserved ? 'observed' : 'problem'}>
        <span>02 · Native event readiness</span>
        <strong>{initializationObserved ? 'Initialization inferred' : 'Initialization unverified'}</strong>
        <small>{initializationObserved ? 'Bounded Desktop diagnostics observed; no fresh Codex control-consumption receipt is available.' : 'No fresh ordered Desktop initialization or Codex control-consumption receipt is available.'}</small>
      </li>
      <li className={possibleLayerMismatch ? 'problem' : 'pending'}>
        <span>03 · Active layer</span>
        <strong>{possibleLayerMismatch ? 'Possible native-layer mismatch' : 'Native layer still needs verification'}</strong>
        <small>{possibleLayerMismatch ? 'Do not change the existing profile. Require verified Input integrity, then follow the canonical native-layer recovery guide with rollback exports and a new candidate profile.' : 'Select white WIRED mode, then verify first-position badge 1 contains native KV_OAI bindings. A layer number alone is not content proof.'}</small>
      </li>
      <li className={physicalState.tone}>
        <span>04 · Physical acceptance</span>
        <strong>{physicalState.label}</strong>
        <small>{receipt?.overall === 'operator_accepted' && receiptFresh ? 'Saved within 30 minutes for this exact device and Codex version/build context.' : 'Test two assigned keys while watching Codex, then record what actually happened.'}</small>
      </li>
    </ol>
  </section>
}

const boardRouteOptions: Array<{ id: BoardRoute; label: string; detail: string }> = [
  { id: 'unknown', label: 'Not selected', detail: 'No physical route is inferred.' },
  { id: 'ashlr_layer', label: 'Ashlr Layer · recommended', detail: 'Codex + Claude Code/cmux; Input sends shared shortcuts.' },
  { id: 'codex_native', label: 'Codex Native', detail: 'Codex Desktop only; Codex owns keys and lighting.' },
]

function BoardRouteRail({ route, saving, error, onChange }: { route: BoardRoute; saving: boolean; error: string | null; onChange: (route: BoardRoute) => void }) {
  return <section className="board-route-rail" aria-labelledby="board-route-heading">
    <div><span className="eyebrow">BOARD ROUTE</span><h2 id="board-route-heading">Choose the expected physical behavior.</h2><p>{saving ? 'Saving local preference…' : error ?? 'Declared here — not detected. Device policy remains Observe · writes off.'}</p></div>
    <div className="board-route-options" role="radiogroup" aria-label="Expected board route">
      {boardRouteOptions.map((option, index) => <button
        id={`board-route-${option.id}`} type="button" role="radio" aria-checked={route === option.id} key={option.id}
        disabled={saving} tabIndex={route === option.id || (route === 'unknown' && index === 0) ? 0 : -1}
        className={route === option.id ? 'active' : ''} onClick={() => onChange(option.id)}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
          event.preventDefault()
          const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1
          const next = (index + delta + boardRouteOptions.length) % boardRouteOptions.length
          onChange(boardRouteOptions[next].id)
          document.getElementById(`board-route-${boardRouteOptions[next].id}`)?.focus()
        }}
      ><span>{option.label}</span><small>{option.detail}</small></button>)}
    </div>
  </section>
}

function SafetyBadge({ level }: { level: ActionDefinition['safety'] }) {
  const label = level === 'safe' ? 'One press' : level === 'confirm' ? 'Confirm' : 'Press + hold'
  return <span className={`safety-badge ${level}`}><ShieldCheck size={13} />{label}</span>
}

function ActionIcon({ icon, size = 24 }: { icon: string; size?: number }) {
  const props = { size, strokeWidth: 1.8 }
  const icons: Record<string, ReactNode> = {
    bot: <Bot {...props} />, command: <Command {...props} />, git: <GitBranch {...props} />,
    shield: <ShieldCheck {...props} />, terminal: <TerminalSquare {...props} />, mic: <Mic2 {...props} />,
    fleet: <Waypoints {...props} />, refresh: <RotateCcw {...props} />, stop: <CircleStop {...props} />,
    activity: <Activity {...props} />, sparkles: <Sparkles {...props} />,
    send: <Send {...props} />, attention: <CircleAlert {...props} />,
  }
  return icons[icon] ?? <Command {...props} />
}

function BoardKey({ control, action, agent, active, onSelect, kind, factoryIcon, showIds, disabled = false }: {
  control: ControlId; action: ActionDefinition; active: boolean; onSelect: (control: ControlId) => void
  kind: string; factoryIcon?: ReactNode; showIds: boolean; agent?: AgentSlotSummary; disabled?: boolean
}) {
  const accessibleName = agent
    ? `${hardwareIds[control]}: Agent ${agent.slot}, ${agentProviderLabel(agent)}, ${agent.title}, ${agentVisibleStateLabel(agent)}. ${action.title}.`
    : `${hardwareIds[control]}: ${action.title}`
  return <button type="button" disabled={disabled} aria-pressed={active} aria-label={accessibleName} className={`board-key ${kind} ${agent ? `provider-${agent.provider ?? 'empty'} state-${agent.state}` : ''} ${active ? 'active' : ''}`} onClick={() => onSelect(control)}>
    {showIds && <span className="hardware-id">{hardwareIds[control]}</span>}
    <span className="key-glyph">{factoryIcon ?? <span className="agent-plus">+</span>}</span>
    <strong>{agent?.provider ? agent.title : action.shortTitle}</strong>
    {kind === 'agent' && <i className="key-light" />}
  </button>
}

function Dial({ active, onSelect, showIds, disabled = false }: { active: ControlId; onSelect: (control: ControlId) => void; showIds: boolean; disabled?: boolean }) {
  return <div className="dial-module" role="group" aria-label={disabled ? 'Screen twin dial; disabled for the selected board route' : 'Screen twin dial controls'}>
    <button type="button" disabled={disabled} className="dial-zone ccw" aria-label="Turn dial counterclockwise" onClick={() => onSelect('dialLeft')}><ChevronLeft /></button>
    <button type="button" disabled={disabled} aria-pressed={active === 'dialPress'} className={active === 'dialPress' ? 'dial active' : 'dial'} onClick={() => onSelect('dialPress')} aria-label="Press rotary encoder"><span /></button>
    <button type="button" disabled={disabled} className="dial-zone cw" aria-label="Turn dial clockwise" onClick={() => onSelect('dialRight')}><ChevronRight /></button>
    {showIds && <small>{active === 'dialLeft' ? 'ENC_CC' : active === 'dialRight' ? 'ENC_CW' : 'ENC_CLK'}</small>}
  </div>
}

function Joystick({ active, onSelect, showIds, disabled = false }: { active: ControlId; onSelect: (control: ControlId) => void; showIds: boolean; disabled?: boolean }) {
  return <div className="joystick-module" role="group" aria-label={disabled ? 'Screen twin joystick; disabled for the selected board route' : 'Screen twin joystick controls'}>
    <button type="button" disabled={disabled} className={active === 'joyUp' ? 'joy-hit up active' : 'joy-hit up'} aria-label="Joystick up" onClick={() => onSelect('joyUp')}><ChevronUp /></button>
    <button type="button" disabled={disabled} className={active === 'joyLeft' ? 'joy-hit left active' : 'joy-hit left'} aria-label="Joystick left" onClick={() => onSelect('joyLeft')}><ChevronLeft /></button>
    <span className="joystick"><i /></span>
    <button type="button" disabled={disabled} className={active === 'joyRight' ? 'joy-hit right active' : 'joy-hit right'} aria-label="Joystick right" onClick={() => onSelect('joyRight')}><ChevronRight /></button>
    <button type="button" disabled={disabled} className={active === 'joyDown' ? 'joy-hit down active' : 'joy-hit down'} aria-label="Joystick down" onClick={() => onSelect('joyDown')}><ChevronDown /></button>
    {showIds && <small>JOY_4-WAY</small>}
  </div>
}

function TouchSensor({ showIds }: { showIds: boolean }) {
  return <div className="touch-module" aria-label="Physical touch control: firmware-owned layer and connection selector; not a customizable app key">
    <span className="profile-leds"><i /><i /><i /></span><span className="touch-pad" /><small>{showIds ? 'FW PROFILE' : 'LAYER / LINK'}</small>
  </div>
}

function ActionConsole({ activeControl, action, result, approval, isRunning, holdProgress, workspace, workspaceSnapshot, lastPhysicalSignal, boardRoute, onRun, onConfirm, onBeginHold, onCancelHold, onCancelApproval, onChooseWorkspace }: {
  activeControl: ControlId; action: ActionDefinition; result: ExecutionResult | null
  approval: { action: ActionDefinition; token: string } | null; isRunning: boolean; holdProgress: number; workspace: string
  workspaceSnapshot: WorkspaceSnapshot | null
  lastPhysicalSignal: Date | null
  boardRoute: BoardRoute
  onRun: () => void; onConfirm: (token: string) => void; onBeginHold: () => void; onCancelHold: () => void; onCancelApproval: () => void; onChooseWorkspace: () => void
}) {
  const snapshot = workspaceSnapshot
  const mappedActionsDisabled = boardRoute !== 'ashlr_layer'
  const mappedActionsLabel = boardRoute === 'codex_native' ? 'Disabled in Codex Native' : 'Select Ashlr Layer for mapped actions'
  return <aside className="action-console">
    <div className="console-head">
      <div><span className="eyebrow">SELECTED PHYSICAL SIGNAL</span><span className="binding">{hardwareIds[activeControl]} <i /> {controls.hotkeys[activeControl]}</span><span className="last-signal">Last hardware receipt: {lastPhysicalSignal ? formatClock(lastPhysicalSignal) : 'never'}</span></div>
      <SafetyBadge level={action.safety} />
    </div>
    <div className="action-identity">
      <div className="action-icon"><ActionIcon icon={action.icon} /></div>
      <div><span className="action-kicker">MAPPED ACTION</span><h2>{action.title}</h2><p>{action.description}</p></div>
    </div>
    <div className="flow-card">
      <div><span>01</span><strong>CONTROL</strong><small>{hardwareIds[activeControl]}</small></div><ChevronRight />
      <div><span>02</span><strong>GATE</strong><small>{action.safety === 'safe' ? 'Direct' : action.safety === 'confirm' ? 'Confirm' : 'Hold'}</small></div><ChevronRight />
      <div><span>03</span><strong>EVIDENCE</strong><small>Local result</small></div>
    </div>
    <div className="consequence-card"><span>EXACT CONSEQUENCE</span><p>{action.consequence}</p></div>

    {approval ? <div className="approval-panel">
      <ShieldCheck size={22} /><div><strong>{approval.action.safety === 'hold' ? 'Hold to authorize' : 'Confirm this action'}</strong><p>{approval.action.consequence}</p></div>
      {approval.action.safety === 'hold'
        ? <button
            type="button"
            className="hold-button"
            onPointerDown={onBeginHold}
            onPointerUp={onCancelHold}
            onPointerCancel={onCancelHold}
            onPointerLeave={onCancelHold}
            onKeyDown={(event) => {
              if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
                event.preventDefault()
                onBeginHold()
              }
            }}
            onKeyUp={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault()
                onCancelHold()
              }
            }}
            onBlur={onCancelHold}
            style={{ '--hold-progress': `${holdProgress * 100}%` } as React.CSSProperties}
          >Hold 1.6 seconds</button>
        : <button type="button" className="confirm-button" onClick={() => onConfirm(approval.token)}>Confirm</button>}
      <button type="button" className="cancel-button" onClick={onCancelApproval}><X size={14} /> Cancel</button>
    </div> : <button type="button" className="run-button" onClick={onRun} disabled={mappedActionsDisabled || isRunning || action.nativeOwned}>
      {isRunning ? <Activity className="spin" size={18} /> : mappedActionsDisabled || action.nativeOwned ? <Keyboard size={18} /> : <TerminalSquare size={18} />}
      {mappedActionsDisabled ? mappedActionsLabel : action.nativeOwned ? (action.id === 'mic_setup' ? 'Configure in Work Louder Input' : 'Owned by Codex') : isRunning ? 'Running…' : action.cta}
    </button>}

    <div className={result ? (result.ok ? 'result-panel success' : 'result-panel error') : 'result-panel empty'} aria-live="polite">
      {result ? <>
        <div className="result-title">{result.ok ? <Check size={15} /> : <CircleStop size={15} />}<strong>{result.title}</strong><time>{formatClock(new Date(result.timestamp))}</time></div>
        <p>{result.message}</p>{result.output && <pre>{result.output}</pre>}
      </> : <><Activity size={16} /><span>Run an action and its local evidence appears here.</span></>}
    </div>
    <div className="workspace-card">
      <div><FolderOpen size={16} /><span>WORKSPACE PULSE</span></div>
      <strong>{snapshot?.projectName || 'Choose a project'}</strong>
      {snapshot?.isGit ? <div className="workspace-facts">
        <span><GitBranch size={11} />{snapshot.branch}{snapshot.detached ? ' (detached)' : ''}</span>
        <span className={!snapshot.statusKnown || snapshot.dirtyFiles ? 'dirty' : 'clean'}>{!snapshot.statusKnown ? 'Status unknown' : snapshot.dirtyFiles ? `${snapshot.dirtyFiles} changed` : 'Clean tree'}</span>
        {(snapshot.conflictedFiles ?? 0) > 0 && <span className="dirty">{snapshot.conflictedFiles} conflicts</span>}
        {(snapshot.stagedFiles ?? 0) > 0 && <span>{snapshot.stagedFiles} staged</span>}
        {(snapshot.untrackedFiles ?? 0) > 0 && <span>{snapshot.untrackedFiles} untracked</span>}
        {snapshot.ahead !== null && snapshot.ahead > 0 && <span>↑{snapshot.ahead}</span>}
        {snapshot.behind !== null && snapshot.behind > 0 && <span>↓{snapshot.behind}</span>}
      </div> : <div className="workspace-facts"><span>{snapshot?.available ? 'Folder · no Git repository' : 'Unavailable'}</span></div>}
      {snapshot?.headSubject && <p className="workspace-head"><code>{snapshot.headShort}</code>{snapshot.headSubject}</p>}
      <div className="workspace-runtime"><span>{snapshot?.packageManager || 'No package manager'}</span><span>{snapshot?.testCommand ? `test: ${snapshot.testCommand}` : 'No test script detected'}</span></div>
      <code className="workspace-path" title={workspace}>{workspace}</code><button type="button" onClick={onChooseWorkspace}>Change</button>
    </div>
  </aside>
}

function FlightCheckView({ active, events, startedAt, exportPath, status, variant, phase, liveGateInvalidated, onStart, onStop, onRestart, onExport, onSetup, onOperate }: {
  active: boolean; events: FlightEvent[]; startedAt: string | null; exportPath: string | null; status: SystemStatus; variant: 'daily' | 'diagnostic'
  phase: 'inactive' | 'arming' | 'active' | 'disarming' | 'error'
  liveGateInvalidated: boolean
  onStart: (variant: 'daily' | 'diagnostic') => void; onStop: () => void; onRestart: () => void; onExport: () => void; onSetup: () => void; onOperate: () => void
}) {
  const [clock, setClock] = useState(0)
  useEffect(() => {
    if (!active || events.length > 0) return
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active, events.length, startedAt])
  const selectedSteps = stepsForVariant(variant)
  const expectedSignals = 20
  const expectedGestures = selectedSteps.length
  const completedGestures = selectedSteps.filter((step) => flightStepComplete(step, events)).length
  const completedSignals = selectedSteps.filter((step) => flightStepComplete(step, events)).reduce((count, step) => count + step.signals.length, 0)
  const acceptance = flightAcceptance(variant, events, status.boardConnected, status.shortcutCount, hardware.bindableSignals)
  const routesComplete = acceptance.routesComplete
  const nextStep = selectedSteps.find((step) => !flightStepComplete(step, events))
  const progress = Math.round((completedSignals / expectedSignals) * 100)
  const problems = events.filter((event) => !event.matched)
  const nativeRoute = status.boardRoute === 'codex_native'
  const currentInputProfile = status.inputProfile ?? initialStatus.inputProfile
  const inputInstallation = status.inputInstallation ?? initialStatus.inputInstallation
  const receiverRuntime = status.receiverRuntime ?? initialStatus.receiverRuntime
  const inputInstallationDescription = describeInputInstallation(inputInstallation)
  const inputInstallationReady = verifiedInputInstallation(inputInstallation)
  const receiverExclusive = exclusiveReceiverRuntime(receiverRuntime)
  const hardwareReady = status.boardRoute === 'ashlr_layer' && status.boardConnected && inputInstallationReady && receiverExclusive && status.shortcutCount === hardware.bindableSignals
  const dailyPreflightReady = hardwareReady && correctedInputProfileObservedForVariant(currentInputProfile, 'daily')
  const diagnosticPreflightReady = hardwareReady && correctedInputProfileObservedForVariant(currentInputProfile, 'diagnostic')
  const preflightReady = dailyPreflightReady || diagnosticPreflightReady
  const selectedVariantReady = variant === 'daily' ? dailyPreflightReady : diagnosticPreflightReady
  const runUnderTest = phase !== 'inactive' || startedAt !== null || events.length > 0
  const currentGateFailure = runUnderTest && !selectedVariantReady
  const runInvalidated = liveGateInvalidated || currentGateFailure
  const complete = phase === 'active' && acceptance.passed && selectedVariantReady && !runInvalidated
  const profileBlocked = !correctedInputProfileObservedForVariant(currentInputProfile, variant)
  const runCannotPass = problems.length > 0 || runInvalidated
  const concurrentCodexTraffic = status.inputRuntime?.codexProtocolTraffic?.status === 'recurring_unresolved_response'
    && status.inputRuntime.codexProtocolTraffic.fresh
  const phaseLabel = active ? 'ACTIONS SUPPRESSED' : phase === 'arming' ? 'ARMING INTERLOCK' : phase === 'disarming' ? 'RELEASING INTERLOCK' : phase === 'error' ? 'INTERLOCK UNVERIFIED' : 'ACTIONS ENABLED'
  const blockedCompletion = routesComplete && !complete
  const showNoSignalRecovery = noSignalRecoveryNeeded(active, startedAt, events, clock)
  return <section className="flight-view">
    <div className="flight-hero">
      <div><span className="eyebrow">HARDWARE ACCEPTANCE / {phaseLabel}</span><h2>{nativeRoute ? 'Flight Check belongs to Ashlr Layer.' : complete ? 'Every signal is accounted for.' : blockedCompletion ? 'Acceptance is blocked by evidence.' : active ? 'Prove the physical path.' : phase === 'arming' ? 'Establishing the safety barrier…' : 'Run a safe Flight Check.'}</h2><p>{nativeRoute ? 'This receipt validates Work Louder Input shortcuts, not Codex’s native keys or lighting. Keep Codex Native declared so Agent Board remains passive, quit Work Louder Input, restart ChatGPT Desktop, then verify Settings → Creator Micro.' : 'Press the real board controls only after the app confirms Actions Suppressed. The board twin and mouse clicks do not count; ordinary keyboard use can generate the same shortcuts, so keep your hands on the board during acceptance.'}</p></div>
      <div className={complete ? 'flight-score complete' : 'flight-score'} role="progressbar" aria-label="Physical Flight Check progress" aria-valuemin={0} aria-valuemax={expectedSignals} aria-valuenow={completedSignals} aria-valuetext={`${completedSignals} of ${expectedSignals} routed signals; ${completedGestures} of ${expectedGestures} gestures complete`}><strong>{completedSignals}<small>/{expectedSignals}</small></strong><span>{completedGestures}/{expectedGestures} gestures</span><i aria-hidden="true" style={{ '--flight-progress': `${progress}%` } as React.CSSProperties} /></div>
    </div>

    <div className="flight-layout">
      <div className="flight-sequence">
        <div className="flight-prompt">
          <div className={complete ? 'prompt-icon complete' : active ? 'prompt-icon live' : 'prompt-icon'}>{complete ? <Check /> : active ? <Activity /> : <Keyboard />}</div>
          <div><span className="eyebrow">{complete ? 'ACCEPTANCE PASSED' : runCannotPass ? 'THIS RUN CANNOT PASS' : blockedCompletion ? 'ACCEPTANCE FAILED' : active ? 'NEXT PHYSICAL GESTURE' : phase === 'arming' ? 'WAIT FOR INTERLOCK' : 'READY WHEN YOU ARE'}</span><h3>{complete ? `${expectedSignals} routed signals received` : runInvalidated ? 'A live acceptance gate changed' : runCannotPass ? 'A signal arrived out of order' : blockedCompletion ? 'Resolve the recorded blockers and restart' : active && nextStep ? nextStep.label : preflightReady ? 'Start a clean receipt' : 'Complete preflight first'}</h3><p>{complete ? 'ACT10 and ACT11 each reported from their own physical key.' : runInvalidated ? 'USB, Input trust, receiver ownership, the declared route, the exact selected profile, or desktop endpoint readiness changed during this run. Recover every gate, then end and restart; this run cannot become passing.' : runCannotPass ? `${problems.length} misroute recorded. Restart to clear this failed evidence; continuing cannot produce a passing receipt.` : blockedCompletion ? `${problems.length} misroutes; USB ${status.boardConnected ? 'present' : 'absent'}; shortcuts ${status.shortcutCount}/${hardware.bindableSignals}.` : active && nextStep ? nextStep.instruction : phase === 'arming' ? 'Do not touch the board until the main process acknowledges action suppression.' : preflightReady ? 'This clears prior observations and temporarily turns every shortcut into a no-op test signal.' : receiverRuntime.status === 'unavailable' ? 'Agent Board could not verify shortcut receiver ownership, so Flight Check is disabled. Refresh Setup; do not assume this copy owns the shortcuts.' : !receiverExclusive ? 'Multiple Agent Board receivers are running, so shortcut ownership is disabled. Fully quit every copy manually, then reopen one exact build.' : !inputInstallationReady ? inputInstallationDescription.guidance : profileBlocked ? status.inputProfile?.encoderDirection === 'reversed' ? 'The active Input receipt has clockwise and counterclockwise reversed. Open Setup and create the corrected profile before Flight Check.' : 'Flight Check requires Ashlr Agent Board Corrected, Ashlr Daily, and a corrected encoder receipt. Open Setup to finish profile recovery.' : `USB must be present and all ${hardware.bindableSignals} desktop endpoints must be registered before physical acceptance starts.`}</p></div>
          {phase === 'inactive' && !complete && <div className="flight-start-actions"><button type="button" disabled={!dailyPreflightReady} onClick={() => onStart('daily')}><Play size={15} /> Daily profile</button><button type="button" disabled={!diagnosticPreflightReady} onClick={() => onStart('diagnostic')}>20-signal diagnostic</button></div>}
          {active && runCannotPass && <div className="flight-start-actions"><button type="button" className="stop-flight" disabled={!selectedVariantReady} onClick={onRestart}><RotateCcw size={15} /> {selectedVariantReady ? 'End and restart' : 'Recover gates to restart'}</button><button type="button" className="stop-flight" onClick={onStop}><CircleStop size={15} /> End invalidated check</button></div>}
          {active && !complete && !runCannotPass && <button type="button" className="stop-flight" onClick={onStop}><CircleStop size={15} /> End check</button>}
          {phase === 'error' && <button type="button" className="stop-flight" onClick={onStop}><CircleStop size={15} /> Restore safe state</button>}
          {complete && <button type="button" onClick={onExport}><Download size={15} /> Export receipt</button>}
        </div>

        <div className="signal-grid" aria-label="Flight Check signals">
          {selectedSteps.map((step, index) => {
            const stepComplete = flightStepComplete(step, events)
            const current = active && nextStep === step
            const stepState = stepComplete ? 'Complete' : current ? 'Current gesture' : 'Not tested'
            return <article key={step.label} className={stepComplete ? 'signal-card complete' : current ? 'signal-card current' : 'signal-card'} aria-label={`${step.label}: ${stepState}`}>
              <span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.label}</strong><small>{step.signals.map((signal) => hardwareIds[signal]).join(' + ')}{step.requiredCount ? ` · ×${step.requiredCount}` : ''}</small></div>
              <i aria-hidden="true">{stepComplete ? <Check size={13} /> : current ? <Activity size={13} /> : null}</i><span className="sr-only">{stepState}</span>
            </article>
          })}
        </div>
      </div>

      <aside className="flight-evidence">
        <span className="eyebrow">LIVE RECEIPT</span><h3>{status.boardConnected ? 'USB identity observed — controls unproven' : 'USB identity not observed'}</h3>
        <dl>
          <div><dt>USB</dt><dd className={status.boardConnected ? 'observed' : ''}>{status.boardConnected ? 'Identity observed' : 'Not observed'}</dd></div>
          <div><dt>Shortcuts</dt><dd className={status.shortcutCount === hardware.bindableSignals ? 'ready' : ''}>{status.shortcutCount}/20</dd></div>
          <div><dt>Receiver</dt><dd className={receiverExclusive ? 'ready' : 'problem'}>{receiverExclusive ? 'Exclusive' : receiverRuntime.status === 'unavailable' ? 'Unavailable' : 'Contended'}</dd></div>
          <div><dt>Started</dt><dd>{startedAt ? formatClock(new Date(startedAt)) : 'Not started'}</dd></div>
          <div><dt>Actions</dt><dd className={active ? 'safe' : phase === 'error' ? 'problem' : ''}>{active ? 'Suppressed' : phase === 'arming' ? 'Arming' : phase === 'disarming' ? 'Releasing' : phase === 'error' ? 'Unverified' : 'Enabled'}</dd></div>
          <div><dt>Raw receipts</dt><dd className={events.length ? 'ready' : ''}>{events.length}</dd></div>
          <div><dt>Misroutes</dt><dd className={problems.length ? 'problem' : 'ready'}>{problems.length}</dd></div>
        </dl>
        <div className="event-stream">
          <span className="eyebrow">LATEST RAW SIGNALS</span>
          {events.length ? [...events].reverse().slice(0, 8).map((event, index) => <div className={event.matched ? '' : 'misroute'} key={`${event.receivedAt}-${index}`}><code>{hardwareIds[event.signal]}</code><span>{event.matched ? controls.hotkeys[event.signal] : `Expected ${event.expectedSignals.map((signal) => hardwareIds[signal]).join(' + ')}`}</span><time>{formatClock(new Date(event.receivedAt))}</time></div>) : <p>{active ? '0 raw desktop receipts since Flight Check started.' : 'No shortcut signals received yet.'}</p>}
        </div>
        {showNoSignalRecovery && <div className="no-signal-recovery" role="status">
          <strong>No physical shortcut arrived</strong>
          <p>{concurrentCodexTraffic
            ? <>Input is currently receiving recurring Codex-protocol responses, so this check is not an exclusive Input-only window. This proves co-presence, not ownership or cause. End the check, then follow the recovery checklist; no application was automatically quit.</>
            : <>Use the top-left rotary dial—not the bottom-left layer and connection selector. End this check, quit competing board controllers, then open Work Louder Input alone. Use <b>Set as current profile</b> for <b>Ashlr Agent Board Corrected</b>, verify <b>Ashlr Daily</b>, fully relaunch Input, and run a fresh check. Do not jump to firmware from one zero-signal receipt.</>}</p>
          <button type="button" onClick={onSetup}>Open recovery checklist</button>
        </div>}
        {exportPath && !runInvalidated && <div className="exported-receipt"><Check size={14} /><span>Receipt saved</span><code title={exportPath}>{exportPath}</code></div>}
        {!status.boardConnected && <button type="button" className="flight-secondary" onClick={onSetup}>Open connection setup</button>}
        {complete && <button type="button" className="flight-secondary" onClick={onOperate}>Start operating</button>}
        <p className="flight-caveat"><ShieldCheck size={13} /> Both profiles expect separate ACT10 and ACT11 key presses. A passing receipt does not validate native Codex RGB or authorize consequential actions.</p>
      </aside>
    </div>
  </section>
}

function SetupView({ status, recoveryGuide, onRefreshRecoveryGuide, onRefreshStatus, onNativeControlReceipt, routeSaving, routeError, onRouteChange, onOperate, onFlightCheck }: { status: SystemStatus; recoveryGuide: AgentBoardRecoveryGuide; onRefreshRecoveryGuide: () => Promise<AgentBoardRecoveryGuide | null>; onRefreshStatus: () => Promise<SystemStatus | null>; onNativeControlReceipt: (receipt: NativeControlCheckReceipt | null) => void; routeSaving: boolean; routeError: string | null; onRouteChange: (route: BoardRoute) => void; onOperate: () => void; onFlightCheck: () => void }) {
  const [repairBusy, setRepairBusy] = useState(false)
  const [repairResult, setRepairResult] = useState<ProfileRepairResult | null>(null)
  const [recoveryAction, setRecoveryAction] = useState<AgentBoardRecoveryActionResult | null>(null)
  const [dismissConfirm, setDismissConfirm] = useState(false)
  const [nativeAcceptanceRecord, setNativeAcceptanceRecord] = useState<{ evidenceKey: string; snapshot: NativeAcceptanceSnapshot | null } | null>(null)
  const [nativeAttestations, setNativeAttestations] = useState<NativeAcceptanceAttestations>(emptyNativeAttestations)
  const [nativeOperation, setNativeOperation] = useState<'prepare' | 'refresh' | 'accept' | 'clear' | null>(null)
  const [nativePrepareConfirm, setNativePrepareConfirm] = useState(false)
  const [nativeActionResult, setNativeActionResult] = useState<{ ok: boolean; neutral?: boolean; message: string } | null>(null)
  const [nativeControlReceipt, setNativeControlReceipt] = useState<NativeControlCheckReceipt | null>(null)
  const [nativeControlBusy, setNativeControlBusy] = useState(false)
  const [nativeControlError, setNativeControlError] = useState<string | null>(null)
  const recoveryFocus = useRef<HTMLElement | null>(null)
  const nativeCodexMicro = status.nativeCodexMicro ?? initialStatus.nativeCodexMicro
  const chatgptDesktop = status.chatgptDesktop ?? initialStatus.chatgptDesktop
  const nativeEvidenceKey = JSON.stringify([
    status.boardRoute,
    status.boardConnected,
    status.boardVidPid,
    chatgptDesktop.status,
    chatgptDesktop.version,
    chatgptDesktop.build,
    nativeCodexMicro.status,
    nativeCodexMicro.observedAt,
    nativeCodexMicro.fresh,
  ])
  const nativeAcceptance = nativeAcceptanceRecord?.evidenceKey === nativeEvidenceKey
    ? nativeAcceptanceRecord.snapshot
    : null
  const nativeAcceptanceChecking = status.boardRoute === 'codex_native'
    && nativeAcceptanceRecord?.evidenceKey !== nativeEvidenceKey
  const displayedNativeAttestations = nativeAcceptanceChecking
    ? emptyNativeAttestations
    : nativeAttestations
  const inputProfile = status.inputProfile ?? initialStatus.inputProfile
  const inputRuntime = status.inputRuntime ?? initialStatus.inputRuntime
  const inputInstallation = status.inputInstallation ?? initialStatus.inputInstallation
  const inputInstallationDescription = describeInputInstallation(inputInstallation)
  const inputInstallationReady = verifiedInputInstallation(inputInstallation)
  const receiverRuntime = status.receiverRuntime ?? initialStatus.receiverRuntime
  const receiverExclusive = exclusiveReceiverRuntime(receiverRuntime)
  const recentRuntimeEvidence = inputRuntime.status === 'unresolved_profile_layer' && inputRuntime.fresh
  const recentCodexTraffic = inputRuntime.codexProtocolTraffic?.status === 'recurring_unresolved_response'
    && inputRuntime.codexProtocolTraffic.fresh
  const observedInputProfile = inputProfile.activeProfile && inputProfile.activeLayer
    ? `${inputProfile.activeProfile} · ${inputProfile.activeLayer}`
    : inputProfile.activeProfile
  const profileState = inputProfile.encoderDirection === 'correct'
    ? `${observedInputProfile ?? 'Input profile'} · cached mapping observed`
    : inputProfile.encoderDirection === 'reversed'
      ? `${observedInputProfile ?? 'Input profile'} · dial directions reversed`
      : observedInputProfile
        ? `${observedInputProfile} · dial mapping unverified`
        : 'Current keyboard profile requires physical verification'
  const correctedProfileObserved = correctedInputProfileObserved(inputProfile)
  const nativeShortcutProfileObserved = status.boardRoute === 'codex_native' && correctedProfileObserved
  const inputRecoveryState = status.boardRoute !== 'ashlr_layer'
    ? 'none'
    : correctedProfileObserved
      ? recentRuntimeEvidence ? 'runtime_log_advisory' : 'cache_observed'
      : 'profile_repair'
  const ashlrSteps: Array<{ number: string; title: string; detail: string; state: string; ready: boolean; observed?: boolean }> = [
    { number: '01', title: 'Observe the USB identity', detail: 'USB-C is the best commissioning path. Bluetooth keyboard and trackpad can remain connected. USB identity alone does not prove HID access or working controls.', state: status.boardConnected ? 'Creator Micro 2 identity observed · no control receipt' : 'USB identity not observed', ready: false, observed: status.boardConnected },
    { number: '02', title: 'Declare the expected board route', detail: 'Codex Native and the Ashlr shortcut layer are separate operating contracts. The declaration never changes the device.', state: status.boardRoute === 'ashlr_layer' ? 'Ashlr Layer declared · physical acceptance pending' : 'No Ashlr route selected', ready: status.boardRoute === 'ashlr_layer' },
    { number: '03', title: 'Verify Work Louder Input', detail: inputInstallationDescription.guidance, state: inputInstallationDescription.state, ready: inputInstallationReady },
    { number: '04', title: 'Prove one shortcut receiver', detail: 'Only one exact Agent Board build may own the 20 global shortcuts. The app detects conflicts but never kills another process.', state: receiverExclusive ? 'One receiver · shortcut ownership available' : receiverRuntime?.status === 'unavailable' ? 'Receiver ownership unavailable · shortcuts disabled' : `${receiverRuntime?.instanceCount ?? 0} receivers / ${receiverRuntime?.distinctBuildCount ?? 0} builds · shortcuts disabled`, ready: receiverExclusive },
    { number: '05', title: 'Verify Input Monitoring', detail: 'In System Settings → Privacy & Security → Input Monitoring, allow the app that should receive board events. Only you can grant this.', state: 'Human verification required', ready: false },
    { number: '06', title: "Inspect Input's cached profile", detail: !inputInstallationReady ? 'Profile repair, import, activation, and synchronization stay paused until the installed Input copy passes publisher, signature, and Gatekeeper verification.' : inputProfile.encoderDirection === 'reversed' ? 'The read-only Input cache shows the known clockwise/counterclockwise inversion. Import and activate the uniquely named corrected profile through Input before restarting Flight Check.' : correctedProfileObserved ? 'Input’s header is only the profile being edited. The cache-current profile and the profile physically emitting are separate states; a fresh physical Flight Check may supersede older log evidence.' : 'In Input, choose Ashlr Agent Board Corrected, use Set as current profile, and verify Ashlr Daily. A correct encoder-only receipt under another profile name is not enough; cache observation does not prove the board write or physical route.', state: !inputInstallationReady ? 'Blocked by Input integrity' : correctedProfileObserved ? 'Cache observed · Ashlr Agent Board Corrected · Ashlr Daily · device sync unproven' : profileState, ready: false, observed: inputInstallationReady && correctedProfileObserved },
    { number: '07', title: 'Verify the declared physical route', detail: 'Run all 20 gestures. The first gesture uses the top-left rotary dial; the bottom-left circle selects layers and the wired/Bluetooth connection.', state: `${status.shortcutCount}/${hardware.bindableSignals} desktop endpoints registered · physical layer unverified`, ready: false },
  ]
  const nativeInitializationObserved = nativeCodexMicro.status === 'connected' && nativeCodexMicro.fresh === true
  const handoffInitializationObserved = nativeAcceptance?.evaluation.status === 'initialization_observed'
    || nativeAcceptance?.evaluation.status === 'accepted'
  const nativeAccepted = nativeAcceptance?.evaluation.status === 'accepted'
  const nativeAcceptanceInterrupted = nativeAcceptance?.receipt?.state === 'accepting'
  const acceptedReceiptRevoked = nativeAcceptance?.receipt?.state === 'accepted' && !nativeAccepted
  const attestationState = (key: keyof NativeAcceptanceAttestations) => displayedNativeAttestations[key]
    ? 'Operator attestation recorded'
    : 'Operator observation pending'
  const nativeSteps: Array<{ number: string; title: string; detail: string; state: string; ready: boolean; observed?: boolean }> = [
    { number: '01', title: 'Observe the USB identity', detail: 'Use a direct USB-C data connection for commissioning. On Creator Micro 2 Pro, hold the bottom-left sensor for three seconds and select the fourth communication channel until the underglow is white for WIRED mode. Let that communication selector exit. Bluetooth keyboard and trackpad can remain connected. White underglow and USB identity still do not prove native HID access or working controls.', state: status.boardConnected ? 'Creator Micro 2 identity observed · controls unproven' : 'USB identity not observed', ready: false, observed: status.boardConnected },
    { number: '02', title: 'Observe ChatGPT Desktop metadata', detail: 'The native route belongs to ChatGPT Desktop. Agent Board reads only fixed-path version/build metadata; it does not prove bundle identity, signature, Gatekeeper status, or the running process. Work Louder Input, its profile, Input Monitoring for Agent Board, and Agent Board shortcut ownership are not native-route prerequisites. ChatGPT Desktop’s displayed Input Monitoring state remains part of the Codex Settings observation.', state: chatgptDesktop.status === 'metadata_observed' ? `ChatGPT Desktop${chatgptDesktop.version ? ` ${chatgptDesktop.version}` : ''}${chatgptDesktop.build ? ` · build ${chatgptDesktop.build}` : ''} metadata observed` : chatgptDesktop.status === 'missing' ? 'ChatGPT Desktop not found' : 'ChatGPT Desktop metadata unavailable', ready: false, observed: chatgptDesktop.status === 'metadata_observed' },
    { number: '03', title: 'Declare Codex Native', detail: 'This local declaration changes only the expected verification route; it does not configure or claim the board.', state: status.boardRoute === 'codex_native' ? 'Codex Native declared' : 'Codex Native not declared', ready: false, observed: status.boardRoute === 'codex_native' },
    { number: '04', title: 'Infer native initialization', detail: 'Agent Board may infer an ordered native initialization from fresh, bounded ChatGPT Desktop diagnostics. This observation is not a Settings result, physical-control result, or readiness decision.', state: nativeInitializationObserved ? 'Ordered native initialization inferred' : nativeCodexMicro.status === 'firmware_rpc_missing' ? `Native RPC qualification required${nativeCodexMicro.fresh ? '' : ' · historical evidence only'}` : 'Fresh native initialization not observed', ready: false, observed: nativeInitializationObserved },
    { number: '05', title: 'Observe Creator Micro in Codex Settings', detail: 'After the isolated Codex retry, open Settings → Creator Micro and personally observe both Connection: Connected and Input Monitoring: Granted. Detected-only or Connection failed does not count. Record only what you see; Agent Board does not prove a new process generation or permission grant.', state: attestationState('settingsConnected'), ready: false, observed: displayedNativeAttestations.settingsConnected },
    { number: '06', title: 'Exercise the dial', detail: 'Turn the top-left dial left and right, then press it. Confirm each configured Codex response yourself.', state: attestationState('dial'), ready: false, observed: displayedNativeAttestations.dial },
    { number: '07', title: 'Exercise the joystick', detail: 'Move the top-right planar stick up, right, down, and left. The bottom-left circle is not the joystick.', state: attestationState('joystick'), ready: false, observed: displayedNativeAttestations.joystick },
    { number: '08', title: 'Exercise all six agent keys', detail: 'Press each top-row agent key once and observe its configured Codex behavior.', state: attestationState('agentKeys'), ready: false, observed: displayedNativeAttestations.agentKeys },
    { number: '09', title: 'Exercise all seven action keys', detail: 'Press each action switch once. Do not treat a mouse click or ordinary keyboard shortcut as board evidence.', state: attestationState('actionKeys'), ready: false, observed: displayedNativeAttestations.actionKeys },
    { number: '10', title: 'Exercise the bottom keys', detail: 'Press ACT10 and ACT11 separately and observe each configured response.', state: attestationState('microphone'), ready: false, observed: displayedNativeAttestations.microphone },
    { number: '11', title: 'Observe lighting', detail: 'Inspect the black-opaque caps and edge glow in the room lighting you normally use. The on-screen legend remains authoritative.', state: attestationState('lighting'), ready: false, observed: displayedNativeAttestations.lighting },
  ]
  const steps = status.boardRoute === 'codex_native' ? nativeSteps : ashlrSteps
  const repairNeeded = inputInstallationReady && inputRecoveryState === 'profile_repair'
  const handoffPersistenceFailed = repairResult?.status === 'saved' && repairResult.handoffPersisted === false
  const recoveryHandoff = handoffPersistenceFailed ? null : recoveryGuide.handoff
  const recoverySteps = handoffPersistenceFailed ? repairResult.recoverySteps ?? [] : recoveryGuide.steps
  const artifactAvailable = !handoffPersistenceFailed && recoveryGuide.artifact?.available === true
  const showRecoveryGuide = inputInstallationReady && (status.boardRoute === 'ashlr_layer' || Boolean(recoveryHandoff))
  const nativeHandoffPrepared = nativeAcceptance?.receipt?.state === 'prepared'
    && ['pending', 'initialization_observed'].includes(nativeAcceptance.evaluation.status)
  const nativeBusy = nativeOperation !== null
  const nativeOperationMessage = nativeOperation === 'prepare'
    ? 'Preparing a new private handoff…'
    : nativeOperation === 'refresh'
      ? 'Refreshing current USB, Desktop, and initialization evidence…'
      : nativeOperation === 'accept'
        ? 'Validating and saving the operator attestation…'
        : nativeOperation === 'clear'
          ? 'Clearing the local native handoff…'
          : null
  const allNativeAttested = Object.values(displayedNativeAttestations).every(Boolean)
  const applyNativeSnapshot = (snapshot: NativeAcceptanceSnapshot) => {
    setNativeAcceptanceRecord({ evidenceKey: nativeEvidenceKey, snapshot })
    setNativePrepareConfirm(false)
    const attestations = snapshot.evaluation.attestations ?? snapshot.receipt?.attestations
    setNativeAttestations(attestations ? { ...emptyNativeAttestations, ...attestations } : emptyNativeAttestations)
  }
  useEffect(() => {
    if (recoveryHandoff && showRecoveryGuide) recoveryFocus.current?.focus()
  }, [recoveryHandoff, showRecoveryGuide])
  useEffect(() => {
    let current = true
    if (status.boardRoute !== 'codex_native') return () => { current = false }
    const load = async () => {
      try {
        const snapshot = await window.agentBoard?.getNativeAcceptance?.()
        if (current && snapshot) {
          setNativeAcceptanceRecord({ evidenceKey: nativeEvidenceKey, snapshot })
          setNativePrepareConfirm(false)
          const attestations = snapshot.evaluation.attestations ?? snapshot.receipt?.attestations
          setNativeAttestations(attestations ? { ...emptyNativeAttestations, ...attestations } : emptyNativeAttestations)
          setNativeActionResult(null)
        } else if (current) {
          setNativeAcceptanceRecord({ evidenceKey: nativeEvidenceKey, snapshot: null })
          setNativeAttestations(emptyNativeAttestations)
          setNativePrepareConfirm(false)
        }
      } catch {
        if (current) {
          setNativeAcceptanceRecord({ evidenceKey: nativeEvidenceKey, snapshot: null })
          setNativeAttestations(emptyNativeAttestations)
          setNativePrepareConfirm(false)
          setNativeActionResult({ ok: false, message: 'The local native handoff could not be read. No acceptance was recorded.' })
        }
      }
    }
    void load()
    return () => { current = false }
  }, [nativeEvidenceKey, status.boardRoute])
  useEffect(() => {
    let current = true
    if (status.boardRoute !== 'codex_native') {
      return () => { current = false }
    }
    const load = async () => {
      try {
        const receipt = await window.agentBoard?.getNativeControlCheck?.()
        if (current) {
          setNativeControlReceipt(receipt ?? null)
          onNativeControlReceipt(receipt ?? null)
        }
      } catch {
        if (current) {
          setNativeControlError('The private control report could not be read. Existing local state was not changed.')
        }
      }
    }
    void load()
    return () => { current = false }
  }, [nativeEvidenceKey, onNativeControlReceipt, status.boardRoute])
  useEffect(() => {
    const read = window.agentBoard?.getNativeAcceptance
    if (
      status.boardRoute !== 'codex_native'
      || !nativeHandoffPrepared
      || handoffInitializationObserved
      || nativeBusy
      || !read
    ) return
    let current = true
    let inFlight = false
    const poll = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const snapshot = await read()
        if (!current) return
        setNativeAcceptanceRecord({ evidenceKey: nativeEvidenceKey, snapshot })
      } catch {
        // The manual refresh remains available; a transient watcher failure never changes evidence.
      } finally {
        inFlight = false
      }
    }
    const interval = window.setInterval(() => { void poll() }, NATIVE_ACCEPTANCE_POLL_MS)
    return () => { current = false; window.clearInterval(interval) }
  }, [handoffInitializationObserved, nativeBusy, nativeEvidenceKey, nativeHandoffPrepared, status.boardRoute])
  const changeBoardRoute = (route: BoardRoute) => {
    if (route !== status.boardRoute) {
      setNativeAcceptanceRecord(null)
      setNativeControlReceipt(null)
      setNativeControlError(null)
      setNativeAttestations(emptyNativeAttestations)
      setNativePrepareConfirm(false)
      setNativeActionResult(null)
    }
    onRouteChange(route)
  }
  const saveNativeControlCheck = async (report: NativeControlCheckReport) => {
    const save = window.agentBoard?.saveNativeControlCheck
    if (!save) {
      setNativeControlError('This build does not include the native control-report bridge. No report was saved.')
      throw new Error('native control-report bridge unavailable')
    }
    setNativeControlBusy(true)
    setNativeControlError(null)
    try {
      const receipt = await save(report)
      setNativeControlReceipt(receipt)
      onNativeControlReceipt(receipt)
    } catch (error) {
      setNativeControlError('The report could not be saved for the current passive Codex Native context. Refresh Setup and try again.')
      throw error
    } finally {
      setNativeControlBusy(false)
    }
  }
  const prepareNativeHandoff = async () => {
    const prepare = window.agentBoard?.prepareNativeAcceptance
    if (!prepare) return setNativeActionResult({ ok: false, message: 'This build does not include the native handoff bridge. No acceptance was recorded.' })
    if (nativeAcceptance?.receipt && !nativeAcceptanceInterrupted && !nativePrepareConfirm) {
      setNativePrepareConfirm(true)
      setNativeActionResult({ ok: false, neutral: true, message: 'Confirm once more to start a fresh handoff. This replaces only the local receipt and clears its recorded observations.' })
      return
    }
    setNativeOperation('prepare')
    setNativeActionResult(null)
    try {
      const result = await prepare()
      applyNativeSnapshot(result.snapshot)
      if (result.ok) setNativePrepareConfirm(false)
      setNativeActionResult(result.ok
        ? { ok: true, message: 'Handoff prepared locally. Leave Agent Board open in passive Codex Native mode, quit Work Louder Input, then Command-Q and reopen ChatGPT Desktop.' }
        : { ok: false, message: 'The native handoff could not be prepared. No acceptance was recorded.' })
    } catch {
      setNativeActionResult({ ok: false, message: 'The native handoff could not be prepared. No acceptance was recorded.' })
    } finally {
      setNativeOperation(null)
    }
  }
  const refreshNativeHandoff = async () => {
    const read = window.agentBoard?.getNativeAcceptance
    if (!read) return setNativeActionResult({ ok: false, message: 'This build does not include the native handoff bridge. No acceptance was recorded.' })
    setNativeOperation('refresh')
    setNativeActionResult(null)
    try {
      await onRefreshStatus()
      const snapshot = await read()
      applyNativeSnapshot(snapshot)
      setNativeActionResult({ ok: true, message: snapshot.evaluation.status === 'initialization_observed' || snapshot.evaluation.status === 'accepted' ? 'Native initialization observation refreshed. Record only the checks you performed.' : 'Handoff refreshed. Fresh native initialization has not been observed.' })
    } catch {
      setNativeActionResult({ ok: false, message: 'The native handoff could not be refreshed. Existing local state was left unchanged.' })
    } finally {
      setNativeOperation(null)
    }
  }
  const acceptNativeHandoff = async () => {
    if (!allNativeAttested || nativeBusy) return
    const accept = window.agentBoard?.acceptNativeAcceptance
    if (!accept) return setNativeActionResult({ ok: false, message: 'This build does not include the native handoff bridge. No acceptance was recorded.' })
    setNativeOperation('accept')
    setNativeActionResult(null)
    try {
      const result = await accept({ ...nativeAttestations })
      applyNativeSnapshot(result.snapshot)
      setNativeActionResult(result.ok
        ? { ok: true, message: 'Operator attestation saved for this prepared context.' }
        : { ok: false, message: 'The operator attestation was not accepted. Refresh the handoff and repeat the physical observations.' })
    } catch {
      setNativeActionResult({ ok: false, message: 'The operator attestation was not accepted. Existing local state was left unchanged.' })
    } finally {
      setNativeOperation(null)
    }
  }
  const clearNativeHandoff = async () => {
    const clear = window.agentBoard?.clearNativeAcceptance
    if (!clear) return setNativeActionResult({ ok: false, message: 'This build does not include the native handoff bridge. Existing local state was left unchanged.' })
    setNativeOperation('clear')
    setNativeActionResult(null)
    try {
      const result = await clear()
      applyNativeSnapshot(result.snapshot)
      if (result.ok) setNativePrepareConfirm(false)
      setNativeActionResult(result.ok
        ? { ok: true, message: 'Local native handoff cleared. No device, Desktop setting, or firmware was changed.' }
        : { ok: false, message: 'The local native handoff could not be cleared. Existing local state was left unchanged.' })
    } catch {
      setNativeActionResult({ ok: false, message: 'The local native handoff could not be cleared. Existing local state was left unchanged.' })
    } finally {
      setNativeOperation(null)
    }
  }
  const createRepairProfile = async () => {
    if (repairBusy) return
    if (!window.agentBoard?.createCorrectedInputProfile) {
      setRepairResult({ status: 'failed', message: 'This build does not include the offline profile repair flow. No setting changed.' })
      return
    }
    setRepairBusy(true)
    setRepairResult(null)
    setRecoveryAction(null)
    try {
      const nextResult = await window.agentBoard.createCorrectedInputProfile()
      setRepairResult(nextResult)
      if (nextResult.status === 'saved' && nextResult.handoffPersisted !== false) await onRefreshRecoveryGuide()
    } catch {
      setRepairResult({ status: 'failed', message: 'Profile repair could not start. No file, Input setting, or device setting changed.' })
    } finally {
      setRepairBusy(false)
    }
  }
  const revealRecoveryArtifact = async () => {
    const action = window.agentBoard?.revealRecoveryArtifact
    if (!action) return setRecoveryAction({ ok: false, message: 'This build cannot reveal the saved artifact. Use the full path shown above.' })
    try { setRecoveryAction(await action()) } catch { setRecoveryAction({ ok: false, message: 'Finder could not be opened. Use the full artifact path shown above.' }) }
  }
  const copyRecoveryChecklist = async () => {
    const action = window.agentBoard?.copyRecoveryChecklist
    if (!action) return setRecoveryAction({ ok: false, message: 'This build cannot copy the checklist. Keep this recovery card open.' })
    try { setRecoveryAction(await action()) } catch { setRecoveryAction({ ok: false, message: 'The checklist could not be copied. Keep this recovery card open.' }) }
  }
  const openInputMonitoringSettings = async () => {
    const action = window.agentBoard?.openInputMonitoringSettings
    if (!action) return setRecoveryAction({ ok: false, message: 'Open System Settings → Privacy & Security → Input Monitoring manually.' })
    try { setRecoveryAction(await action()) } catch { setRecoveryAction({ ok: false, message: 'Open System Settings → Privacy & Security → Input Monitoring manually.' }) }
  }
  const dismissRecoveryHandoff = async () => {
    if (!dismissConfirm) {
      setDismissConfirm(true)
      setRecoveryAction({ ok: false, message: 'Confirm once more to dismiss only the saved startup reminder. The profile artifact and Input configuration will remain unchanged.' })
      return
    }
    const action = window.agentBoard?.dismissRecoveryHandoff
    if (!action) return setRecoveryAction({ ok: false, message: 'This build cannot dismiss the saved reminder safely.' })
    try {
      const result = await action()
      setRecoveryAction(result)
      if (result.ok) {
        setDismissConfirm(false)
        await onRefreshRecoveryGuide()
      }
    } catch {
      setRecoveryAction({ ok: false, message: 'The saved reminder could not be dismissed. No artifact or Input setting changed.' })
    }
  }
  return <section className="setup-view">
    <div className="setup-intro"><span className="eyebrow">COMMISSIONING / TRUTHFUL READINESS</span><h2>Make every layer observable.</h2><p>USB identity observation, macOS authority, Input configuration, and native Codex integration are separate states. This checklist keeps them separate so “connected” never means more than we proved.</p></div>
    <BoardRouteRail route={status.boardRoute} saving={routeSaving} error={routeError} onChange={changeBoardRoute} />
    <div className="setup-grid">
      <div className="setup-steps">
        {steps.map((step) => <article key={step.number} className={step.ready ? 'setup-step ready' : step.observed ? 'setup-step observed' : 'setup-step'}>
          <span className="step-number">{step.number}</span><div><h3>{step.title}</h3><p>{step.detail}</p><strong><i />{step.state}</strong></div>
        </article>)}
        {nativeShortcutProfileObserved && <div className="native-profile-warning" role="alert" aria-labelledby="native-profile-warning-title">
          <CircleX size={18} />
          <div><strong id="native-profile-warning-title">Possible native-layer mismatch</strong><p>Do not import into or alter <b>Ashlr Agent Board Corrected · Ashlr Daily</b>. Recovery stays blocked until Setup verifies Input’s publisher, strict signature, and Gatekeeper result. Preserve rollback exports, then follow <b>app/docs/codex-native-layer-recovery.md</b>: create a new candidate profile, manually import and move the native layer to first position, verify the post-import export and first-position content, and only then activate the candidate yourself. Return here for physical acceptance with Input quit and white <b>WIRED</b> mode. A badge number, validator match, or activation message is not acceptance. Never Reset settings or let Agent Board import, reorder, activate, or write the device.</p></div>
        </div>}
        {status.boardRoute === 'codex_native' && <NativeControlCheck key={nativeControlReceipt?.reportedAt ?? 'new'} receipt={nativeControlReceipt} busy={nativeControlBusy} error={nativeControlError} onSave={saveNativeControlCheck} />}
        {status.boardRoute === 'codex_native' && <section className="native-acceptance legacy-native-acceptance" aria-labelledby="native-acceptance-title" aria-busy={nativeBusy}>
          <div className="native-acceptance-heading">
            <span className="eyebrow">RESTART-SAFE NATIVE HANDOFF</span>
            <h3 id="native-acceptance-title">Carry the physical check across the restart.</h3>
            <p>Prepare a private local handoff, leave Agent Board open in passive Codex Native mode, quit Work Louder Input, then Command-Q and reopen ChatGPT Desktop. Agent Board watches bounded native evidence without owning shortcuts.</p>
          </div>
          <div className="native-evidence-ladder" role="list" aria-label="Native evidence ladder">
            <div role="listitem" className={status.boardConnected ? 'native-evidence-node observed' : 'native-evidence-node'}><span>1</span><strong>USB</strong><small>{status.boardConnected ? 'Observed' : 'Not observed'}</small></div>
            <div role="listitem" className={chatgptDesktop.status === 'metadata_observed' ? 'native-evidence-node observed' : 'native-evidence-node'}><span>2</span><strong>Desktop</strong><small>{chatgptDesktop.status === 'metadata_observed' ? 'Metadata observed' : chatgptDesktop.status === 'missing' ? 'Not found' : 'Unavailable'}</small></div>
            <div role="listitem" className={handoffInitializationObserved ? 'native-evidence-node observed' : 'native-evidence-node'}><span>3</span><strong>Initialization</strong><small>{handoffInitializationObserved ? 'Inferred after prepare' : 'Awaiting post-prepare observation'}</small></div>
            <div role="listitem" className={nativeAccepted ? 'native-evidence-node accepted' : 'native-evidence-node'}><span>4</span><strong>Operator</strong><small>{nativeAccepted ? 'Accepted' : 'Pending'}</small></div>
          </div>
          <div className="native-handoff-status" role="status" aria-live="polite">
            <ShieldCheck size={16} />
            <span><strong>{nativeAcceptanceChecking ? 'Checking current handoff' : nativeAccepted ? 'Operator attestation saved' : nativeAcceptanceInterrupted ? 'Acceptance interrupted before completion' : acceptedReceiptRevoked ? 'Prior acceptance is no longer current' : nativeHandoffPrepared ? nativeAcceptance?.evaluation.status === 'initialization_observed' ? 'Initialization observed after preparation' : 'Handoff prepared' : nativeAcceptance?.evaluation.status === 'invalid' ? 'Fresh handoff required' : 'Handoff not prepared'}</strong>{nativeAcceptanceChecking ? ' Accepted state stays hidden until the live USB, Desktop metadata, and initialization evidence are re-evaluated.' : nativeAccepted ? ' This receipt belongs only to the recorded VID:PID class and fixed-path Desktop metadata.' : nativeAcceptanceInterrupted ? ' The two-phase save stopped before final promotion, so no acceptance was recorded. Start a fresh handoff to discard the staged observations safely, or clear it.' : acceptedReceiptRevoked ? ' Current evidence no longer matches the accepted receipt. Start a fresh handoff and repeat every observation.' : nativeHandoffPrepared ? nativeAcceptance?.evaluation.status === 'initialization_observed' ? ' The passive watcher found bounded post-prepare evidence. Record only observations you personally perform.' : ' The passive watcher checks bounded native evidence periodically, targeting five-second intervals while Agent Board is active. Refresh now is the authoritative manual check; neither path runs Input integrity work, owns shortcuts, or records operator observations.' : ' Preparation records bounded model identity and Desktop metadata needed to reject stale acceptance; it does not identify a unique board or running process.'}</span>
          </div>
          <div className="native-handoff-actions">
            <button type="button" onClick={() => void prepareNativeHandoff()} disabled={nativeBusy || nativeAcceptanceChecking}>{nativeOperation === 'prepare' ? 'Preparing handoff…' : nativeAcceptanceInterrupted ? 'Start fresh handoff' : nativeAcceptance?.receipt ? nativePrepareConfirm ? 'Confirm fresh handoff' : 'Prepare fresh handoff' : 'Prepare handoff'}</button>
            <button type="button" onClick={() => void refreshNativeHandoff()} disabled={nativeBusy || nativeAcceptanceChecking || !nativeHandoffPrepared}>{nativeOperation === 'refresh' ? 'Refreshing evidence…' : 'Refresh now'}</button>
            {!nativeAcceptanceChecking && nativePrepareConfirm && <button type="button" className="quiet" onClick={() => { setNativePrepareConfirm(false); setNativeActionResult(null) }} disabled={nativeBusy}>Cancel fresh handoff</button>}
            {nativeAcceptance?.receipt && <button type="button" className="quiet" onClick={() => void clearNativeHandoff()} disabled={nativeBusy}>{nativeOperation === 'clear' ? 'Clearing handoff…' : 'Clear handoff'}</button>}
          </div>
          {(nativeHandoffPrepared || nativeAccepted) && <fieldset className="native-attestations" disabled={nativeBusy || nativeAccepted || !handoffInitializationObserved}>
            <legend>Operator observations</legend>
            {([
              ['settingsConnected', 'Codex Settings shows Connection: Connected and Input Monitoring: Granted'],
              ['dial', 'Dial left, right, and press observed'],
              ['joystick', 'Joystick up, right, down, and left observed'],
              ['agentKeys', 'All six agent keys observed'],
              ['actionKeys', 'All seven action keys observed'],
              ['microphone', 'Microphone key observed'],
              ['lighting', 'Black-cap lighting observed'],
            ] as Array<[keyof NativeAcceptanceAttestations, string]>).map(([key, label]) => <label key={key}>
              <input type="checkbox" checked={displayedNativeAttestations[key]} disabled={nativeBusy || nativeAccepted || !handoffInitializationObserved} onChange={(event) => setNativeAttestations((current) => ({ ...current, [key]: event.target.checked }))} />
              <span><Check size={12} />{label}</span>
            </label>)}
          </fieldset>}
          {nativeHandoffPrepared && <button type="button" className="native-accept-button" onClick={() => void acceptNativeHandoff()} disabled={nativeBusy || !handoffInitializationObserved || !allNativeAttested}>{nativeOperation === 'accept' ? 'Saving attestation…' : 'Accept operator attestation'}</button>}
          {nativeOperationMessage && <p className="native-action-result" role="status" aria-live="polite">{nativeOperationMessage}</p>}
          {!nativeAcceptanceChecking && nativeActionResult && <p className={nativeActionResult.ok || nativeActionResult.neutral ? 'native-action-result' : 'native-action-result failed'} role={nativeActionResult.ok || nativeActionResult.neutral ? 'status' : 'alert'}>{nativeActionResult.message}</p>}
          <p className="native-proof-boundary"><ShieldCheck size={14} /><span><strong>Operator attestation—not device proof.</strong> Checked items mean the operator reports seeing those outcomes. They do not prove native thread ownership, RGB transport, firmware safety, or authorization for consequential actions.</span></p>
        </section>}
        {repairNeeded && <section className="profile-repair" aria-labelledby="profile-repair-title">
          <div><span className="eyebrow">OFFLINE REPAIR / NO DEVICE WRITE</span><h3 id="profile-repair-title">Create the corrected profile here.</h3></div>
          <p>Select an ordinary US Creator Micro 2 profile exported from Work Louder Input. Agent Board will validate it and save a new <b>Ashlr Daily</b> import with the clockwise/counterclockwise order corrected. It never opens Input, edits Input's cache, or writes to the board.</p>
          {recentRuntimeEvidence && <p><b>Advisory:</b> Input also logged profile {inputRuntime.profileIndex} / layer {inputRuntime.layerIndex} as unresolved recently. That event may predate the cache and does not replace this deterministic profile repair.</p>}
          <button type="button" onClick={() => void createRepairProfile()} disabled={repairBusy}><Download size={14} />{repairBusy ? 'Creating…' : 'Create corrected Input profile'}</button>
          {repairResult?.status === 'saved' && <div className="profile-repair-result saved" role="status">
            <strong>Repair artifact ready—nothing activated yet.</strong>
            <code title={repairResult.filePath}>{repairResult.filePath}</code>
            <small>SHA-256 {repairResult.sha256}</small>
            <p>{repairResult.message}</p>
            <p>In Input alone, choose <b>Import Profile</b> for this file, choose <b>Set as current profile</b> on <b>Ashlr Agent Board Corrected</b>, select <b>Ashlr Daily</b>, then fully quit and relaunch Input. “layout updated” alone is not acceptance.</p>
          </div>}
          {repairResult?.status === 'failed' && <div className="profile-repair-result failed" role="alert"><strong>Repair not created.</strong><p>{repairResult.message}</p></div>}
          {repairResult?.status === 'canceled' && <div className="profile-repair-result" role="status"><p>{repairResult.message}</p></div>}
        </section>}
        {showRecoveryGuide && <section className="recovery-handoff" aria-labelledby="input-reconciliation-title" tabIndex={-1} ref={recoveryFocus}>
          <div className="recovery-handoff-heading"><span className="eyebrow">INPUT-ONLY RECONCILIATION / HUMAN-GUIDED</span><h3 id="input-reconciliation-title">{recoveryHandoff ? artifactAvailable ? 'Resume the saved recovery handoff.' : 'The saved artifact needs attention.' : 'Keep these steps visible before you quit.'}</h3><p>{recoveryHandoff ? 'This private receipt does not prove import, activation, synchronization, permission, or physical acceptance.' : 'This is the complete safe sequence. Agent Board never quits apps, changes Input, grants permission, writes the board, or updates firmware for you.'}</p></div>
          {recentRuntimeEvidence && <p className="recovery-advisory"><b>Advisory only:</b> Input logged profile {inputRuntime.profileIndex} / layer {inputRuntime.layerIndex} as unresolved at {inputRuntime.observedAt ? formatClock(new Date(inputRuntime.observedAt)) : 'an unknown time'}. It may predate the current cache and does not replace these steps.</p>}
          {recentCodexTraffic && <p className="recovery-advisory"><b>Input-only window is not exclusive:</b> recurring Codex-protocol responses are currently reaching Input. This is co-presence evidence, not an ownership or root-cause claim. No application was automatically quit.</p>}
          {recoveryHandoff && <div className={artifactAvailable ? 'recovery-artifact' : 'recovery-artifact missing'}>
            <span>{artifactAvailable ? 'Corrected artifact verified' : `Artifact ${recoveryGuide.artifact?.status?.replaceAll('_', ' ') ?? 'unavailable'}`}</span><code title={recoveryHandoff.artifactPath}>{recoveryHandoff.artifactPath}</code><small>SHA-256 {recoveryHandoff.sha256}</small>
          </div>}
          {recoverySteps.length > 0
            ? <ol className="recovery-checklist">{recoverySteps.map((step, index) => <li key={`${index}-${step}`}><span>{step}</span></li>)}</ol>
            : <p className="recovery-advisory" role="status">Loading the local recovery checklist…</p>}
          <div className="recovery-actions">
            {recoveryHandoff && artifactAvailable && <button type="button" onClick={() => void revealRecoveryArtifact()}><FolderOpen size={15} /> Reveal artifact in Finder</button>}
            <button type="button" onClick={() => void copyRecoveryChecklist()}><Command size={15} /> Copy recovery checklist</button>
            <button type="button" onClick={() => void openInputMonitoringSettings()}><ShieldCheck size={15} /> Open Input Monitoring settings</button>
            {recoveryHandoff && <button type="button" className="dismiss-handoff" onClick={() => void dismissRecoveryHandoff()}><X size={15} /> {dismissConfirm ? 'Confirm dismiss reminder' : 'Dismiss saved handoff'}</button>}
          </div>
          {recoveryAction && <p className={recoveryAction.ok ? 'recovery-action-result' : 'recovery-action-result failed'} role={recoveryAction.ok ? 'status' : 'alert'}>{recoveryAction.message}</p>}
          <p className="recovery-proof-boundary"><ShieldCheck size={14} /> Permission remains manually verified. Cache observation is not device synchronization, and only a fresh physical Flight Check accepts the shortcut route.</p>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{recoveryHandoff ? artifactAvailable ? 'A private Input recovery handoff is ready to resume.' : 'The saved Input recovery artifact is missing or changed. Verify it or create a new corrected artifact before import.' : ''}</p>
        </section>}
      </div>
      <aside className="hardware-truth">
        <span className="eyebrow">PHYSICAL CONTRACT</span><h3>{hardware.name}</h3>
        <dl><div><dt>13</dt><dd>Mechanical switches</dd></div><div><dt>06</dt><dd>Live Agent positions</dd></div><div><dt>07</dt><dd>Action switches</dd></div><div><dt>20</dt><dd>Bindable signals</dd></div></dl>
        <div className="hardware-note"><Mic2 size={18} /><p><strong>ACT10 and ACT11 are two separate keys.</strong> The Ashlr Daily map assigns Voice and guarded Continue independently; native Codex assignments remain visible in Codex settings.</p></div>
        <div className="hardware-note"><ShieldCheck size={18} /><p>{status.boardRoute === 'codex_native' ? <><strong>Native firmware changes require a guarded qualification.</strong> Back up Input, quit Codex, use only the exact reviewed vendor-published candidate, then re-prove both native RPCs and every control.</> : <><strong>Freeze firmware during acceptance for Ashlr Layer.</strong> Defer it until the active profile is backed up and a separate qualification is planned.</>}</p></div>
        <div className="hardware-note"><RotateCcw size={18} /><p><strong>The bottom-left circle is not a bindable key.</strong> A short tap changes layer; a three-second hold opens the selector for three Bluetooth channels and wired mode.</p></div>
        <div className="rgb-legend" aria-label="Black-opaque state language"><span className="eyebrow">BLACK-OPAQUE STATE LANGUAGE</span><div>{agentStateLegendOrder.map((state) => <span key={state}><i className={agentStateClassName(state)} />{agentStateLabels[state]}{' '}</span>)}</div><small>The screen is the complete legend. Black caps use edge and underglow only after lighting transport is qualified; a frosted hero cap is optional.</small></div>
        {status.receiverIdentity && <div className="receiver-identity"><span className="eyebrow">CURRENT RECEIVER BUILD</span><strong>{status.receiverIdentity.packaged ? 'Packaged' : 'Development'} · v{status.receiverIdentity.appVersion}</strong>{status.receiverIdentity.appAsarSha256 && <code title={status.receiverIdentity.appAsarSha256}>app.asar {status.receiverIdentity.appAsarSha256.slice(0, 12)}</code>}<p>{status.boardRoute === 'codex_native' ? 'Agent Board is observing this build in passive native mode; it is not claiming the native HID route.' : receiverExclusive ? 'This is the only observed Agent Board receiver.' : `${receiverRuntime?.instanceCount ?? 0} receivers across ${receiverRuntime?.distinctBuildCount ?? 0} builds are contending. Fully quit every copy manually, then reopen one exact build. No process was quit automatically.`} Build identity does not prove macOS permission, shortcut receipt, signing, or physical acceptance.</p></div>}
        {status.boardRoute === 'codex_native'
          ? <div className="native-manual-gate"><ShieldCheck size={16} /><span><strong>Operator acceptance handoff</strong> Prepare the handoff at left. Agent Board unregisters its shortcuts and may remain open in passive Codex Native mode; quit Work Louder Input, Command-Q and reopen ChatGPT Desktop, then record the checks you personally perform. Automatic evidence watching never checks a box or accepts for you.</span></div>
          : <button type="button" className="operate-button" onClick={onFlightCheck}>Run Ashlr Flight Check <ChevronRight size={16} /></button>}
        <button type="button" className="operate-button secondary" onClick={onOperate}>Return to board</button>
      </aside>
    </div>
  </section>
}

export default App
