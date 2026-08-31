import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Activity, Bot, BrainCircuit, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CircleCheck, CircleStop, CircleX, Command, Download, FolderOpen, Gauge, GitBranch, Keyboard,
  Mic2, Play, RotateCcw, ShieldCheck, Sparkles, Split, TerminalSquare, Waypoints, X, Zap,
} from 'lucide-react'
import {
  actions, controls, effortLevels, hardware, profileOrder, profiles,
  type ActionDefinition, type AgentSlotSummary, type ControlId, type ExecutionResult, type MissionControlSnapshot, type PhysicalSignalEnvelope, type ProfileId, type SystemStatus, type WorkspaceSnapshot,
} from './board'
import { agentProviderLabel, agentVisibleStateLabel } from './agent-accessibility'
import AttentionDeck from './components/AttentionDeck'
import FleetBrief from './components/FleetBrief'
import { expectedSignalsAfter, flightAcceptance, flightStepComplete, stepsForVariant, type FlightEvent, type FlightVariant } from './flight-check'
import './App.css'

const initialStatus: SystemStatus = {
  boardConnected: false, inputInstalled: false, inputMonitoring: 'unverified',
  codex: false, claude: false, ashlr: false,
  workspace: '/Choose a working directory', shortcutCount: 0, shortcutRegistrations: [], workspaceSnapshot: null,
}
const initialMission: MissionControlSnapshot = {
  schemaVersion: 1, observedAt: new Date(0).toISOString(), agentSource: 'unavailable', fleetSource: 'unavailable',
  agents: Array.from({ length: 6 }, (_, index) => ({ slot: index + 1, provider: null, state: 'off', title: 'Available slot', updatedAt: null })),
  fleet: null, unassignedActiveSessions: 0, operatorNotices: [],
}
const formatClock = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const normalizeControl = (control: ControlId): ControlId => control === 'cmd6' ? 'cmd5' : control

const hardwareIds: Partial<Record<ControlId, string>> = {
  agent1: 'AG00', agent2: 'AG01', agent3: 'AG02', agent4: 'AG03', agent5: 'AG04', agent6: 'AG05',
  cmd1: 'ACT06', cmd2: 'ACT07', cmd3: 'ACT08', cmd4: 'ACT09', cmd5: 'ACT10', cmd6: 'ACT11', cmd7: 'ACT12',
  dialLeft: 'ENC_CC', dialRight: 'ENC_CW', dialPress: 'ENC_CLK',
  joyUp: 'JOY_UP', joyRight: 'JOY_RIGHT', joyDown: 'JOY_DOWN', joyLeft: 'JOY_LEFT',
}

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
  const holdTimer = useRef<number | null>(null)
  const holdAttempt = useRef(0)
  const holdPending = useRef(false)
  const lastMicSignal = useRef(0)
  const lastSignal = useRef<Partial<Record<ControlId, number>>>({})
  const flightExpected = useRef<ControlId[]>([])
  const flightRequest = useRef(0)
  const flightActive = flightPhase === 'active'

  const profile = profiles[profileId]
  const activeAction = actions[profile.mapping[activeControl]]
  const effort = effortLevels[effortIndex]

  const refreshStatus = useCallback(async () => {
    if (bridge) setStatus(await bridge.getStatus())
  }, [bridge])
  const refreshMission = useCallback(async () => {
    if (bridge?.getMissionControl) setMission(await bridge.getMissionControl())
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
      const response = focusedSlot
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
  }, [bridge, profileId, refreshMission, refreshStatus])

  const executeControl = useCallback((rawControl: ControlId) => {
    const control = normalizeControl(rawControl)
    const signalTime = Date.now()
    if (signalTime - (lastSignal.current[control] ?? 0) < 140) return
    lastSignal.current[control] = signalTime
    if (isRunning) {
      internalResult('Action already running', 'Wait for the current local action to finish before sending another signal.')
      return
    }
    if (control === 'cmd5') {
      const now = Date.now()
      if (now - lastMicSignal.current < 90) return
      lastMicSignal.current = now
    }
    const selected = actions[profiles[profileId].mapping[control]]
    if (selected.nativeOwned) {
      internalResult(
        selected.id === 'mic_setup' ? 'Voice key needs one-time setup' : 'Codex owns this control',
        selected.id === 'mic_setup'
          ? 'Map push-to-talk to ACT10 and set ACT11 to None in the daily Work Louder Input layer.'
          : 'Use the physical control in Codex for native thread focus and live RGB status.',
      )
      return
    }
    executeAction(selected)
  }, [executeAction, isRunning, profileId])

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

  const startFlightCheck = async (variant: 'daily' | 'diagnostic' = 'daily') => {
    const request = ++flightRequest.current
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
      if (request === flightRequest.current) setFlightPhase('error')
      return
    }
    try {
      const acknowledgement = await bridge.setFlightCheck(true)
      if (request !== flightRequest.current) return
      if (!acknowledgement.acknowledged || !acknowledgement.active) {
        setFlightPhase('error')
        return
      }
      setFlightStartedAt(acknowledgement.startedAt)
      setFlightPhase('active')
    } catch {
      if (request === flightRequest.current) setFlightPhase('error')
    }
  }

  const stopFlightCheck = async () => {
    const request = ++flightRequest.current
    if (!bridge) { setFlightPhase('error'); return false }
    setFlightPhase('disarming')
    try {
      const acknowledgement = await bridge.setFlightCheck(false)
      if (request !== flightRequest.current) return false
      if (!acknowledgement.acknowledged || acknowledgement.active) {
        setFlightPhase('active')
        return false
      }
      setFlightSignals([])
      setFlightEvents([])
      setFlightStartedAt(null)
      setFlightExport(null)
      flightExpected.current = []
      setFlightPhase('inactive')
      return true
    } catch {
      if (request === flightRequest.current) setFlightPhase('active')
      return false
    }
  }

  const changeView = async (nextView: 'operate' | 'flight' | 'setup') => {
    if (nextView !== 'flight' && flightPhase !== 'inactive') {
      if (!await stopFlightCheck()) return
    }
    setView(nextView)
  }

  const exportFlightReceipt = async () => {
    if (!bridge || !flightStartedAt) return
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
        kind: event.expectedSignals.length === 2 && (event.signal === 'cmd5' || event.signal === 'cmd6') ? 'mic_pair_mismatch' : 'misroute',
        observed: event.signal,
        expected: event.expectedSignals,
        receivedAt: event.receivedAt,
      })),
      events: flightEvents,
    })
    if (response) setFlightExport(response)
  }

  useEffect(() => cancelHold, [activeControl, cancelHold, profileId, view])
  useEffect(() => {
    window.addEventListener('blur', cancelHold)
    return () => window.removeEventListener('blur', cancelHold)
  }, [cancelHold])
  useEffect(() => () => cancelHold(), [cancelHold])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><Waypoints size={18} /></div>
          <div><span className="eyebrow">ASHLR // TACTILE AGENT OPERATIONS</span><h1>Agent Board</h1></div>
        </div>
        <div className="view-switch" role="tablist" aria-label="Agent Board view">
          <button type="button" role="tab" aria-selected={view === 'operate'} className={view === 'operate' ? 'active' : ''} onClick={() => void changeView('operate')}>Operate</button>
          <button type="button" role="tab" aria-selected={view === 'flight'} className={view === 'flight' ? 'active' : ''} onClick={() => void changeView('flight')}>Flight Check</button>
          <button type="button" role="tab" aria-selected={view === 'setup'} className={view === 'setup' ? 'active' : ''} onClick={() => void changeView('setup')}>Setup</button>
        </div>
        <div className="system-strip" aria-label="System status">
          <StatusPill label={status.boardConnected ? 'USB linked' : 'USB absent'} tone={status.boardConnected ? 'ready' : 'off'} icon={<Keyboard size={14} />} />
          <StatusPill label="Codex local" tone={status.codex ? 'ready' : 'off'} icon={<Sparkles size={14} />} />
          <StatusPill label="Claude local" tone={status.claude ? 'ready' : 'off'} icon={<Bot size={14} />} />
          <StatusPill
            label={mission.fleetSource === 'status_receipt' ? (mission.fleet?.daemonRunning ? `Fleet ${mission.fleet.daemonPhase}` : 'Fleet offline') : mission.fleetSource === 'invalid' ? 'Fleet invalid' : 'Fleet unavailable'}
            tone={mission.fleet?.daemonRunning ? (mission.fleet.blocker || mission.fleet.guardBlocked || mission.fleet.killed ? 'warn' : 'ready') : 'off'}
            icon={<Waypoints size={14} />}
          />
        </div>
      </header>

      {view === 'operate' ? <>
        <nav className="profile-rail" aria-label="Software lenses">
          {profileOrder.map((id, index) => {
            const candidate = profiles[id]
            return <button type="button" key={id} onClick={() => setProfileId(id)} className={id === profileId ? 'profile-tab active' : 'profile-tab'}>
              <span className="profile-number">0{index + 1}</span><span className="profile-signal" style={{ background: candidate.color }} />
              <span>{candidate.name}</span><small>{candidate.shortLabel}</small>
            </button>
          })}
          <div className="profile-rail-note">JOYSTICK ← → CHANGES LENS · AGENT KEYS NEVER MOVE</div>
        </nav>

        <div className="readiness-ribbon">
          <span className={status.boardConnected ? 'check ready' : 'check'}><Check size={12} /> USB device</span>
          <span className={status.shortcutCount === hardware.bindableSignals ? 'check ready' : 'check'}><Check size={12} /> {status.shortcutCount}/{hardware.bindableSignals} shortcuts claimed</span>
          <span className={status.inputInstalled ? 'check ready' : 'check'}><Check size={12} /> Work Louder Input</span>
          {status.workspaceSnapshot?.isGit && <span className={!status.workspaceSnapshot.statusKnown || status.workspaceSnapshot.dirtyFiles ? 'check warn' : 'check ready'}><GitBranch size={12} /> {status.workspaceSnapshot.branch} · {!status.workspaceSnapshot.statusKnown ? 'status unknown' : status.workspaceSnapshot.dirtyFiles ? `${status.workspaceSnapshot.dirtyFiles} changed` : 'clean'}</span>}
          <span className="check"><Keyboard size={12} /> Physical layer: Ashlr Daily shortcuts · unverified</span>
          <button type="button" onClick={() => changeView('setup')}><span className="attention-dot" /> Input Monitoring needs human verification <ChevronRight size={13} /></button>
        </div>

        <div className="mission-control-grid">
          <AttentionDeck agents={mission.agents} selectedSlot={selectedAgentSlot} source={mission.agentSource} onSelect={setSelectedAgentSlot} onFocus={(slot) => void focusAgentSlot(slot)} />
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

            <div className="deck-and-trace">
              <div className="device-frame" aria-label="Accurate top view of the Codex Micro">
                <div className="device-inner">
                  <span className="case-copy left">Work Louder | OpenAI 2026</span>
                  <span className="case-copy right">You can just build things</span>
                  <span className="case-copy bottom">Let's build</span>
                  <span className="cable-arrow">↑</span>
                  <span className="case-screw tl" /><span className="case-screw tr" /><span className="case-screw bl" /><span className="case-screw br" />
                  <div className="hardware-grid">
                    <Dial active={activeControl} onSelect={selectControl} showIds={showIds} />
                    <BoardKey control="agent1" action={actions[profile.mapping.agent1]} agent={mission.agents[0]} active={activeControl === 'agent1'} onSelect={selectControl} kind="agent" showIds={showIds} />
                    <BoardKey control="agent2" action={actions[profile.mapping.agent2]} agent={mission.agents[1]} active={activeControl === 'agent2'} onSelect={selectControl} kind="agent" showIds={showIds} />
                    <Joystick active={activeControl} onSelect={selectControl} showIds={showIds} />
                    {(['agent3', 'agent4', 'agent5', 'agent6'] as ControlId[]).map((control, index) => <BoardKey key={control} control={control} action={actions[profile.mapping[control]]} agent={mission.agents[index + 2]} active={activeControl === control} onSelect={selectControl} kind="agent" showIds={showIds} />)}
                    <BoardKey control="cmd1" action={actions[profile.mapping.cmd1]} active={activeControl === 'cmd1'} onSelect={selectControl} kind="action" factoryIcon={<Zap />} showIds={showIds} />
                    <BoardKey control="cmd2" action={actions[profile.mapping.cmd2]} active={activeControl === 'cmd2'} onSelect={selectControl} kind="action" factoryIcon={<CircleCheck />} showIds={showIds} />
                    <BoardKey control="cmd3" action={actions[profile.mapping.cmd3]} active={activeControl === 'cmd3'} onSelect={selectControl} kind="action" factoryIcon={<CircleX />} showIds={showIds} />
                    <BoardKey control="cmd4" action={actions[profile.mapping.cmd4]} active={activeControl === 'cmd4'} onSelect={selectControl} kind="action" factoryIcon={<Split />} showIds={showIds} />
                    <TouchSensor showIds={showIds} />
                    <BoardKey control="cmd5" action={actions[profile.mapping.cmd5]} active={activeControl === 'cmd5'} onSelect={selectControl} kind="action wide" factoryIcon={<Mic2 />} showIds={showIds} />
                    <BoardKey control="cmd7" action={actions[profile.mapping.cmd7]} active={activeControl === 'cmd7'} onSelect={selectControl} kind="action" factoryIcon={<BrainCircuit />} showIds={showIds} />
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
            onRun={() => executeControl(activeControl)} onConfirm={(token) => executeAction(activeAction, token)}
            onBeginHold={beginHold} onCancelHold={cancelHold} onCancelApproval={() => setApproval(null)} onChooseWorkspace={chooseWorkspace}
          />
        </div>
      </> : view === 'flight' ? <FlightCheckView
        active={flightActive} events={flightEvents} startedAt={flightStartedAt}
        exportPath={flightExport} status={status} variant={flightVariant} phase={flightPhase} onStart={startFlightCheck}
        onStop={() => void stopFlightCheck()} onExport={exportFlightReceipt}
        onSetup={() => void changeView('setup')} onOperate={() => void changeView('operate')}
      /> : <SetupView status={status} onOperate={() => changeView('operate')} onFlightCheck={startFlightCheck} />}

      <footer className="footer-bar">
        <div><span className={status.boardConnected ? 'footer-led ready' : 'footer-led'} /> {hardware.mechanicalSwitches} SWITCHES · 1 TOUCH · 1 DIAL · 1 PLANAR STICK</div>
        <div><ShieldCheck size={14} /> Consequential actions require confirmation or hold.</div>
        <div>ASHLR BOARD OS · LOCAL FIRST</div>
      </footer>
    </main>
  )
}

function StatusPill({ label, tone, icon }: { label: string; tone: 'ready' | 'off' | 'warn'; icon: ReactNode }) {
  return <span className={`status-pill ${tone}`}>{icon}<i />{label}</span>
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
  }
  return icons[icon] ?? <Command {...props} />
}

function BoardKey({ control, action, agent, active, onSelect, kind, factoryIcon, showIds }: {
  control: ControlId; action: ActionDefinition; active: boolean; onSelect: (control: ControlId) => void
  kind: string; factoryIcon?: ReactNode; showIds: boolean; agent?: AgentSlotSummary
}) {
  const accessibleName = agent
    ? `${hardwareIds[control]}: Agent ${agent.slot}, ${agentProviderLabel(agent)}, ${agent.title}, ${agentVisibleStateLabel(agent)}. ${action.title}.`
    : `${hardwareIds[control]}: ${action.title}`
  return <button type="button" aria-pressed={active} aria-label={accessibleName} className={`board-key ${kind} ${agent ? `provider-${agent.provider ?? 'empty'} state-${agent.state}` : ''} ${active ? 'active' : ''}`} onClick={() => onSelect(control)}>
    {showIds && <span className="hardware-id">{hardwareIds[control]}</span>}
    <span className="key-glyph">{factoryIcon ?? <span className="agent-plus">+</span>}</span>
    <strong>{agent?.provider ? agent.title : action.shortTitle}</strong>
    {kind === 'agent' && <i className="key-light" />}
    {kind.includes('wide') && <span className="switch-seam" aria-hidden="true" />}
  </button>
}

function Dial({ active, onSelect, showIds }: { active: ControlId; onSelect: (control: ControlId) => void; showIds: boolean }) {
  return <div className="dial-module">
    <button type="button" className="dial-zone ccw" aria-label="Turn dial counterclockwise" onClick={() => onSelect('dialLeft')}><ChevronLeft /></button>
    <button type="button" aria-pressed={active === 'dialPress'} className={active === 'dialPress' ? 'dial active' : 'dial'} onClick={() => onSelect('dialPress')} aria-label="Press rotary encoder"><span /></button>
    <button type="button" className="dial-zone cw" aria-label="Turn dial clockwise" onClick={() => onSelect('dialRight')}><ChevronRight /></button>
    {showIds && <small>{active === 'dialLeft' ? 'ENC_CC' : active === 'dialRight' ? 'ENC_CW' : 'ENC_CLK'}</small>}
  </div>
}

function Joystick({ active, onSelect, showIds }: { active: ControlId; onSelect: (control: ControlId) => void; showIds: boolean }) {
  return <div className="joystick-module">
    <button type="button" className={active === 'joyUp' ? 'joy-hit up active' : 'joy-hit up'} aria-label="Joystick up" onClick={() => onSelect('joyUp')}><ChevronUp /></button>
    <button type="button" className={active === 'joyLeft' ? 'joy-hit left active' : 'joy-hit left'} aria-label="Joystick left" onClick={() => onSelect('joyLeft')}><ChevronLeft /></button>
    <span className="joystick"><i /></span>
    <button type="button" className={active === 'joyRight' ? 'joy-hit right active' : 'joy-hit right'} aria-label="Joystick right" onClick={() => onSelect('joyRight')}><ChevronRight /></button>
    <button type="button" className={active === 'joyDown' ? 'joy-hit down active' : 'joy-hit down'} aria-label="Joystick down" onClick={() => onSelect('joyDown')}><ChevronDown /></button>
    {showIds && <small>JOY_4-WAY</small>}
  </div>
}

function TouchSensor({ showIds }: { showIds: boolean }) {
  return <div className="touch-module" aria-label="Firmware-owned Bluetooth profile touch sensor">
    <span className="profile-leds"><i /><i /><i /></span><span className="touch-pad" /><small>{showIds ? 'FW PROFILE' : 'BT HOST'}</small>
  </div>
}

function ActionConsole({ activeControl, action, result, approval, isRunning, holdProgress, workspace, workspaceSnapshot, lastPhysicalSignal, onRun, onConfirm, onBeginHold, onCancelHold, onCancelApproval, onChooseWorkspace }: {
  activeControl: ControlId; action: ActionDefinition; result: ExecutionResult | null
  approval: { action: ActionDefinition; token: string } | null; isRunning: boolean; holdProgress: number; workspace: string
  workspaceSnapshot: WorkspaceSnapshot | null
  lastPhysicalSignal: Date | null
  onRun: () => void; onConfirm: (token: string) => void; onBeginHold: () => void; onCancelHold: () => void; onCancelApproval: () => void; onChooseWorkspace: () => void
}) {
  const snapshot = workspaceSnapshot
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
    </div> : <button type="button" className="run-button" onClick={onRun} disabled={isRunning || action.nativeOwned}>
      {isRunning ? <Activity className="spin" size={18} /> : action.nativeOwned ? <Keyboard size={18} /> : <TerminalSquare size={18} />}
      {action.nativeOwned ? (action.id === 'mic_setup' ? 'Configure in Work Louder Input' : 'Owned by Codex') : isRunning ? 'Running…' : action.cta}
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

function FlightCheckView({ active, events, startedAt, exportPath, status, variant, phase, onStart, onStop, onExport, onSetup, onOperate }: {
  active: boolean; events: FlightEvent[]; startedAt: string | null; exportPath: string | null; status: SystemStatus; variant: 'daily' | 'diagnostic'
  phase: 'inactive' | 'arming' | 'active' | 'disarming' | 'error'
  onStart: (variant: 'daily' | 'diagnostic') => void; onStop: () => void; onExport: () => void; onSetup: () => void; onOperate: () => void
}) {
  const selectedSteps = stepsForVariant(variant)
  const expectedSignals = variant === 'diagnostic' ? 20 : 19
  const completedGestures = selectedSteps.filter((step) => flightStepComplete(step, events)).length
  const completedSignals = selectedSteps.filter((step) => flightStepComplete(step, events)).reduce((count, step) => count + step.signals.length, 0)
  const acceptance = flightAcceptance(variant, events, status.boardConnected, status.shortcutCount, hardware.bindableSignals)
  const complete = acceptance.passed
  const routesComplete = acceptance.routesComplete
  const nextStep = selectedSteps.find((step) => !flightStepComplete(step, events))
  const progress = Math.round((completedSignals / expectedSignals) * 100)
  const problems = events.filter((event) => !event.matched)
  const phaseLabel = active ? 'ACTIONS SUPPRESSED' : phase === 'arming' ? 'ARMING INTERLOCK' : phase === 'disarming' ? 'RELEASING INTERLOCK' : phase === 'error' ? 'INTERLOCK UNVERIFIED' : 'ACTIONS ENABLED'
  const blockedCompletion = routesComplete && !complete
  return <section className="flight-view">
    <div className="flight-hero">
      <div><span className="eyebrow">HARDWARE ACCEPTANCE / {phaseLabel}</span><h2>{complete ? 'Every signal is accounted for.' : blockedCompletion ? 'Acceptance is blocked by evidence.' : active ? 'Prove the physical path.' : phase === 'arming' ? 'Establishing the safety barrier…' : 'Run a safe Flight Check.'}</h2><p>Press the real board controls only after the app confirms Actions Suppressed. The board twin and mouse clicks do not count; ordinary keyboard use can generate the same shortcuts, so keep your hands on the board during acceptance.</p></div>
      <div className={complete ? 'flight-score complete' : 'flight-score'}><strong>{completedSignals}<small>/{expectedSignals}</small></strong><span>{completedGestures}/19 gestures</span><i style={{ '--flight-progress': `${progress}%` } as React.CSSProperties} /></div>
    </div>

    <div className="flight-layout">
      <div className="flight-sequence">
        <div className="flight-prompt">
          <div className={complete ? 'prompt-icon complete' : active ? 'prompt-icon live' : 'prompt-icon'}>{complete ? <Check /> : active ? <Activity /> : <Keyboard />}</div>
          <div><span className="eyebrow">{complete ? 'ACCEPTANCE PASSED' : blockedCompletion ? 'ACCEPTANCE FAILED' : active ? 'NEXT PHYSICAL GESTURE' : phase === 'arming' ? 'WAIT FOR INTERLOCK' : 'READY WHEN YOU ARE'}</span><h3>{complete ? `${expectedSignals} routed signals received` : blockedCompletion ? 'Resolve the recorded blockers and restart' : active && nextStep ? nextStep.label : 'Start a clean receipt'}</h3><p>{complete ? (variant === 'diagnostic' ? 'The disposable diagnostic path reported ACT10 and ACT11 inside one paired Mic gesture.' : 'The daily path reported one ACT10 Mic event while ACT11 remained silent.') : blockedCompletion ? `${problems.length} misroutes; USB ${status.boardConnected ? 'linked' : 'absent'}; shortcuts ${status.shortcutCount}/${hardware.bindableSignals}.` : active && nextStep ? nextStep.instruction : phase === 'arming' ? 'Do not touch the board until the main process acknowledges action suppression.' : 'This clears prior observations and temporarily turns every shortcut into a no-op test signal.'}</p></div>
          {phase === 'inactive' && !complete && <div className="flight-start-actions"><button type="button" onClick={() => onStart('daily')}><Play size={15} /> Daily profile</button><button type="button" onClick={() => onStart('diagnostic')}>20-signal diagnostic</button></div>}
          {active && !complete && <button type="button" className="stop-flight" onClick={onStop}><CircleStop size={15} /> Pause check</button>}
          {phase === 'error' && <button type="button" className="stop-flight" onClick={onStop}><CircleStop size={15} /> Restore safe state</button>}
          {complete && <button type="button" onClick={onExport}><Download size={15} /> Export receipt</button>}
        </div>

        <div className="signal-grid" aria-label="Flight Check signals">
          {selectedSteps.map((step, index) => {
            const stepComplete = flightStepComplete(step, events)
            const current = active && nextStep === step
            return <article key={step.label} className={stepComplete ? 'signal-card complete' : current ? 'signal-card current' : 'signal-card'}>
              <span>{String(index + 1).padStart(2, '0')}</span><div><strong>{step.label}</strong><small>{step.signals.map((signal) => hardwareIds[signal]).join(' + ')}{step.requiredCount ? ` · ×${step.requiredCount}` : ''}</small></div>
              <i>{stepComplete ? <Check size={13} /> : current ? <Activity size={13} /> : null}</i>
            </article>
          })}
        </div>
      </div>

      <aside className="flight-evidence">
        <span className="eyebrow">LIVE RECEIPT</span><h3>{status.boardConnected ? 'Creator Micro 2 detected' : 'USB device not detected'}</h3>
        <dl>
          <div><dt>USB</dt><dd className={status.boardConnected ? 'ready' : ''}>{status.boardConnected ? 'Linked' : 'Absent'}</dd></div>
          <div><dt>Shortcuts</dt><dd className={status.shortcutCount === hardware.bindableSignals ? 'ready' : ''}>{status.shortcutCount}/20</dd></div>
          <div><dt>Started</dt><dd>{startedAt ? formatClock(new Date(startedAt)) : 'Not started'}</dd></div>
          <div><dt>Actions</dt><dd className={active ? 'safe' : phase === 'error' ? 'problem' : ''}>{active ? 'Suppressed' : phase === 'arming' ? 'Arming' : phase === 'disarming' ? 'Releasing' : phase === 'error' ? 'Unverified' : 'Enabled'}</dd></div>
          <div><dt>Misroutes</dt><dd className={problems.length ? 'problem' : 'ready'}>{problems.length}</dd></div>
        </dl>
        <div className="event-stream">
          <span className="eyebrow">LATEST RAW SIGNALS</span>
          {events.length ? [...events].reverse().slice(0, 8).map((event, index) => <div className={event.matched ? '' : 'misroute'} key={`${event.receivedAt}-${index}`}><code>{hardwareIds[event.signal]}</code><span>{event.matched ? controls.hotkeys[event.signal] : `Expected ${event.expectedSignals.map((signal) => hardwareIds[signal]).join(' + ')}`}</span><time>{formatClock(new Date(event.receivedAt))}</time></div>) : <p>No shortcut signals received yet.</p>}
        </div>
        {exportPath && <div className="exported-receipt"><Check size={14} /><span>Receipt saved</span><code title={exportPath}>{exportPath}</code></div>}
        {!status.boardConnected && <button type="button" className="flight-secondary" onClick={onSetup}>Open connection setup</button>}
        {complete && <button type="button" className="flight-secondary" onClick={onOperate}>Start operating</button>}
        <p className="flight-caveat"><ShieldCheck size={13} /> {variant === 'diagnostic' ? 'Diagnostic mode requires a disposable layer with ACT10 and ACT11 mapped separately; deactivate it afterward.' : 'Daily mode expects ACT10 once and ACT11 silenced.'} A passing receipt does not validate native Codex RGB or authorize consequential actions.</p>
      </aside>
    </div>
  </section>
}

function SetupView({ status, onOperate, onFlightCheck }: { status: SystemStatus; onOperate: () => void; onFlightCheck: () => void }) {
  const steps = [
    { number: '01', title: 'Connect the board', detail: 'USB-C is the best commissioning path. Bluetooth keyboard and trackpad can remain connected.', state: status.boardConnected ? 'Detected as Creator Micro 2' : 'Waiting for USB device', ready: status.boardConnected },
    { number: '02', title: 'Install Work Louder Input', detail: 'The signed vendor app owns profiles, layers, shortcuts, firmware updates, and the radial menu.', state: status.inputInstalled ? 'Input.app installed' : 'Input.app not found', ready: status.inputInstalled },
    { number: '03', title: 'Verify Input Monitoring', detail: 'In System Settings → Privacy & Security → Input Monitoring, allow the app that should receive board events. Only you can grant this.', state: 'Human verification required', ready: false },
    { number: '04', title: 'Load the Ashlr layer', detail: 'Map 19 daily gestures. The wide cap fires two switches, so assign Mic to ACT10 and set ACT11 to None. Keep the separate 20-signal mapping diagnostic-only.', state: `${status.shortcutCount}/${hardware.bindableSignals} desktop endpoints claimed`, ready: status.shortcutCount === hardware.bindableSignals },
  ]
  return <section className="setup-view">
    <div className="setup-intro"><span className="eyebrow">COMMISSIONING / TRUTHFUL READINESS</span><h2>Make every layer observable.</h2><p>USB presence, macOS authority, Input configuration, and native Codex integration are separate states. This checklist keeps them separate so “connected” never means more than we proved.</p></div>
    <div className="setup-grid">
      <div className="setup-steps">
        {steps.map((step) => <article key={step.number} className={step.ready ? 'setup-step ready' : 'setup-step'}>
          <span className="step-number">{step.number}</span><div><h3>{step.title}</h3><p>{step.detail}</p><strong><i />{step.state}</strong></div>
        </article>)}
      </div>
      <aside className="hardware-truth">
        <span className="eyebrow">PHYSICAL CONTRACT</span><h3>{hardware.name}</h3>
        <dl><div><dt>13</dt><dd>Mechanical switches</dd></div><div><dt>06</dt><dd>Live Agent positions</dd></div><div><dt>07</dt><dd>Action switches</dd></div><div><dt>20</dt><dd>Bindable signals</dd></div></dl>
        <div className="hardware-note"><Mic2 size={18} /><p><strong>Mic is one cap, two switches.</strong> The visible wide key spans ACT10 + ACT11. Never give its halves different actions.</p></div>
        <div className="hardware-note"><RotateCcw size={18} /><p><strong>The bottom-left circle is not a key.</strong> It is the firmware-owned haptic selector for three Bluetooth host profiles.</p></div>
        <div className="rgb-legend"><span className="eyebrow">BLACK-OPAQUE STATE LANGUAGE</span><div><i className="error" />Error <i className="waiting" />Needs you <i className="thinking" />Working <i className="done" />Completed <i className="idle" />Idle <i className="off" />Off</div><small>The screen is the complete legend. Black caps use edge and underglow only after lighting transport is qualified; a frosted hero cap is optional.</small></div>
        <button type="button" className="operate-button" onClick={onFlightCheck}>Run Flight Check <ChevronRight size={16} /></button>
        <button type="button" className="operate-button secondary" onClick={onOperate}>Return to board</button>
      </aside>
    </div>
  </section>
}

export default App
