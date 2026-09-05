import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  AudioLines,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Command,
  Eye,
  EyeOff,
  Gauge,
  Minus,
  PanelTopClose,
  Play,
  SearchCheck,
  Send,
  Settings2,
  Sparkles,
  WandSparkles,
} from 'lucide-react'

export type CompactAgentState = 'off' | 'idle' | 'unread' | 'working' | 'needs_input' | 'error'
export type CompactAgentProvider = 'codex' | 'claude' | 'manual' | 'unknown' | null

export interface CompactAgent {
  slot: number
  provider: CompactAgentProvider
  state: CompactAgentState
  title?: string
}

export interface CompactSnapshot {
  schema: 'ai.ashlr.agent-board.compact-snapshot/v1'
  observedAt: string
  agentSource: 'observer_online' | 'invalid' | 'unavailable'
  agents: CompactAgent[]
  attentionSlot: number | null
}

export interface CompactChord {
  code: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export type CompactShortcutTarget =
  | { kind: 'slot'; slot: number }
  | { kind: 'skill'; actionId: CompactSkillActionId }
  | { kind: 'attention' }
  | { kind: 'privacy' }

export interface CompactPreferences {
  schema: 'ai.ashlr.agent-board.compact-deck/v1'
  openAtLaunch: boolean
  alwaysOnTop: boolean
  showTitles: boolean
  bounds: { x: number; y: number; width: number; height: number }
  shortcuts: Array<{ scope: 'window'; chord: CompactChord; target: CompactShortcutTarget }>
}

export type CompactSkillActionId =
  | 'copy_amplify_skill'
  | 'copy_verify_skill'
  | 'copy_polish_skill'
  | 'copy_advance_skill'

export type CompactWorkflowActionId = 'stage_voice' | 'copy_guarded_continue' | 'stage_attention'

interface CompactActionResult {
  ok: boolean
  message: string
}

interface CompactDeckBridge {
  getSnapshot(): Promise<CompactSnapshot>
  focusAgentSlot(slot: number): Promise<CompactActionResult>
  focusAttention(): Promise<CompactActionResult>
  runSkillAction(actionId: CompactSkillActionId): Promise<CompactActionResult>
  runWorkflowAction(actionId: CompactWorkflowActionId): Promise<CompactActionResult>
  getPreferences(): Promise<CompactPreferences>
  savePreferences(preferences: CompactPreferences): Promise<CompactPreferences>
  hide(): Promise<void>
  onSnapshot(callback: (snapshot: CompactSnapshot) => void): () => void
}

const emptyAgents: CompactAgent[] = Array.from({ length: 6 }, (_, index) => ({
  slot: index + 1,
  provider: null,
  state: 'off',
}))

const fallbackSnapshot: CompactSnapshot = {
  schema: 'ai.ashlr.agent-board.compact-snapshot/v1',
  observedAt: new Date(0).toISOString(),
  agentSource: 'unavailable',
  agents: emptyAgents,
  attentionSlot: null,
}

const fallbackPreferences: CompactPreferences = {
  schema: 'ai.ashlr.agent-board.compact-deck/v1',
  openAtLaunch: false,
  alwaysOnTop: true,
  showTitles: false,
  bounds: { x: 0, y: 0, width: 390, height: 286 },
  shortcuts: [],
}

const skillActions: Array<{
  actionId: CompactSkillActionId
  label: string
  keyHint: string
  Icon: typeof Sparkles
}> = [
  { actionId: 'copy_amplify_skill', label: 'Amplify', keyHint: '7', Icon: Sparkles },
  { actionId: 'copy_verify_skill', label: 'Verify', keyHint: '8', Icon: SearchCheck },
  { actionId: 'copy_polish_skill', label: 'Polish', keyHint: '9', Icon: WandSparkles },
  { actionId: 'copy_advance_skill', label: 'Advance', keyHint: '0', Icon: Play },
]

const stateLabels: Record<CompactAgentState, string> = {
  off: 'Available',
  idle: 'Idle',
  unread: 'Ready',
  working: 'Working',
  needs_input: 'Needs you',
  error: 'Error',
}

const providerLabels: Record<Exclude<CompactAgentProvider, null>, string> = {
  codex: 'Codex',
  claude: 'Claude',
  manual: 'Local',
  unknown: 'Agent',
}

function compactBridge(): CompactDeckBridge | undefined {
  return (window as Window & { compactDeck?: CompactDeckBridge }).compactDeck
}

function shortcutMatches(event: KeyboardEvent, chord: CompactChord) {
  return event.code === chord.code
    && event.ctrlKey === chord.ctrl
    && event.altKey === chord.alt
    && event.shiftKey === chord.shift
    && event.metaKey === chord.meta
}

function normalizedAgents(snapshot: CompactSnapshot) {
  return Array.from({ length: 6 }, (_, index) => (
    snapshot.agents.find((agent) => agent.slot === index + 1) ?? emptyAgents[index]
  ))
}

function AgentKey({ agent, selected, showTitle, onActivate }: {
  agent: CompactAgent
  selected: boolean
  showTitle: boolean
  onActivate: (slot: number) => void
}) {
  const provider = agent.provider ? providerLabels[agent.provider] : 'Open'
  const title = showTitle && agent.title ? agent.title : provider
  const ProviderIcon = agent.provider === 'claude' ? Bot : Command
  return <button
    type="button"
    data-cap="black-opaque"
    className={`deck-key agent-key state-${agent.state} ${selected ? 'selected' : ''}`}
    aria-label={`Agent ${agent.slot}, ${provider}, ${stateLabels[agent.state]}${showTitle && agent.title ? `, ${agent.title}` : ''}`}
    aria-pressed={selected}
    onClick={() => onActivate(agent.slot)}
  >
    <span className="agent-key-top"><small>{agent.slot}</small><i aria-hidden="true" /></span>
    <ProviderIcon aria-hidden="true" size={13} strokeWidth={1.8} />
    <strong>{title}</strong>
    <span>{stateLabels[agent.state]}</span>
  </button>
}

export default function CompactDeckApp() {
  const bridge = compactBridge()
  const [snapshot, setSnapshot] = useState(fallbackSnapshot)
  const [preferences, setPreferences] = useState(fallbackPreferences)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState(1)
  const [loading, setLoading] = useState(Boolean(bridge))
  const [receipt, setReceipt] = useState(bridge ? 'Compact Deck is starting…' : 'Open Agent Board to connect the local bridge.')
  const [failed, setFailed] = useState(!bridge)

  const agents = useMemo(() => normalizedAgents(snapshot), [snapshot])
  const occupiedSlots = useMemo(() => agents.filter((agent) => agent.state !== 'off').map((agent) => agent.slot), [agents])
  const attentionAgent = agents.find((agent) => agent.slot === snapshot.attentionSlot)
  const attentionUrgent = attentionAgent?.state === 'error' || attentionAgent?.state === 'needs_input'

  const run = useCallback(async (operation: () => Promise<CompactActionResult>, pending: string) => {
    setFailed(false)
    setReceipt(pending)
    try {
      const result = await operation()
      setFailed(!result.ok)
      setReceipt(result.message)
      return result.ok
    } catch {
      setFailed(true)
      setReceipt('The local bridge did not complete that action.')
      return false
    }
  }, [])

  const focusSlot = useCallback(async (slot: number) => {
    if (!bridge) {
      setFailed(true)
      setReceipt('Open Agent Board to connect the local bridge.')
      return
    }
    setSelectedSlot(slot)
    await run(() => bridge.focusAgentSlot(slot), 'Foregrounding provider app…')
  }, [bridge, run])

  const moveSelection = useCallback((direction: -1 | 1) => {
    const candidates = occupiedSlots.length > 0 ? occupiedSlots : agents.map((agent) => agent.slot)
    const currentIndex = candidates.indexOf(selectedSlot)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const nextSlot = candidates[(baseIndex + direction + candidates.length) % candidates.length]
    setSelectedSlot(nextSlot)
    setFailed(false)
    setReceipt(`Agent ${nextSlot} selected. Press the dial or agent key to open.`)
  }, [agents, occupiedSlots, selectedSlot])

  const runSkill = useCallback(async (actionId: CompactSkillActionId) => {
    if (!bridge) {
      setFailed(true)
      setReceipt('Open Agent Board to copy a delivery skill.')
      return
    }
    await run(() => bridge.runSkillAction(actionId), 'Copying skill instruction…')
  }, [bridge, run])

  const runWorkflow = useCallback(async (actionId: CompactWorkflowActionId) => {
    if (!bridge) {
      setFailed(true)
      setReceipt('Open Agent Board to use workflow controls.')
      return false
    }
    return run(() => bridge.runWorkflowAction(actionId), actionId === 'stage_voice'
      ? 'Preparing voice capture…'
      : actionId === 'copy_guarded_continue'
        ? 'Copying guarded continuation…'
        : 'Finding the highest-priority agent…')
  }, [bridge, run])

  const focusAttention = useCallback(async () => {
    if (!bridge) {
      setFailed(true)
      setReceipt('Open Agent Board to find the highest-priority agent.')
      return
    }
    await run(() => bridge.focusAttention(), 'Resolving attention, then foregrounding its provider app…')
  }, [bridge, run])

  const savePreferences = useCallback(async (change: Partial<Pick<CompactPreferences, 'alwaysOnTop' | 'openAtLaunch' | 'showTitles'>>) => {
    const next = { ...preferences, ...change }
    setPreferences(next)
    if (!bridge) return
    try {
      const saved = await bridge.savePreferences(next)
      setPreferences(saved)
      setFailed(false)
      setReceipt(change.showTitles === undefined ? 'Compact Deck preferences saved.' : saved.showTitles ? 'Session titles are visible.' : 'Privacy mode hides session titles.')
    } catch {
      setPreferences(preferences)
      setFailed(true)
      setReceipt('Preferences were not saved. Your previous settings are unchanged.')
    }
  }, [bridge, preferences])

  const hideDeck = useCallback(async () => {
    if (!bridge) return
    try {
      await bridge.hide()
    } catch {
      setFailed(true)
      setReceipt('Compact Deck could not be hidden. Use the app window controls instead.')
    }
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    let active = true
    void Promise.all([bridge.getSnapshot(), bridge.getPreferences()])
      .then(([nextSnapshot, nextPreferences]) => {
        if (!active) return
        setSnapshot(nextSnapshot)
        setPreferences(nextPreferences)
        setSelectedSlot(nextSnapshot.attentionSlot ?? nextSnapshot.agents.find((agent) => agent.state !== 'off')?.slot ?? 1)
        setFailed(false)
        setReceipt(nextSnapshot.agentSource === 'observer_online' ? 'Session feed live; hardware control unproven.' : 'Agent session feed is not available yet.')
      })
      .catch(() => {
        if (!active) return
        setFailed(true)
        setReceipt('The local bridge is unavailable. Reopen Agent Board.')
      })
      .finally(() => { if (active) setLoading(false) })
    const unsubscribe = bridge.onSnapshot((nextSnapshot) => {
      if (active) setSnapshot(nextSnapshot)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [bridge])

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return
      const binding = preferences.shortcuts.find((candidate) => shortcutMatches(event, candidate.chord))
      if (!binding) return
      event.preventDefault()
      if (binding.target.kind === 'slot') void focusSlot(binding.target.slot)
      if (binding.target.kind === 'skill') void runSkill(binding.target.actionId)
      if (binding.target.kind === 'attention') void focusAttention()
      if (binding.target.kind === 'privacy') void savePreferences({ showTitles: !preferences.showTitles })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusAttention, focusSlot, preferences, runSkill, savePreferences])

  return <main className="compact-deck-shell" aria-busy={loading}>
    <header className="compact-titlebar">
      <strong>Virtual Deck — Creator Micro 2 layout</strong>
      <span className={`route-label session-feed-label ${snapshot.agentSource}`} role="status">
        <i className={`bridge-light ${snapshot.agentSource}`} aria-hidden="true" />
        {snapshot.agentSource === 'observer_online' ? 'session feed live' : snapshot.agentSource === 'invalid' ? 'session feed invalid' : 'session feed unavailable'}
      </span>
      <button type="button" className="chrome-button" aria-label="Compact Deck settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={13} /></button>
      <button type="button" className="chrome-button" aria-label="Hide Compact Deck" onClick={() => { void hideDeck() }}><Minus size={15} /></button>
    </header>

    {settingsOpen && <section className="compact-settings" aria-label="Compact Deck settings">
      <label><span>{preferences.showTitles ? <Eye size={13} /> : <EyeOff size={13} />}Show session titles</span><input type="checkbox" checked={preferences.showTitles} onChange={(event) => { void savePreferences({ showTitles: event.target.checked }) }} /></label>
      <label><span><PanelTopClose size={13} />Keep above other windows</span><input type="checkbox" checked={preferences.alwaysOnTop} onChange={(event) => { void savePreferences({ alwaysOnTop: event.target.checked }) }} /></label>
      <label><span><Gauge size={13} />Open at login</span><input type="checkbox" checked={preferences.openAtLaunch} onChange={(event) => { void savePreferences({ openAtLaunch: event.target.checked }) }} /></label>
      <p>Shortcuts work only while this window is active. No prompts or terminal text are read.</p>
    </section>}

    <section className="physical-deck" aria-label="Creator Micro 2 control layout">
      <div className="deck-row deck-row-top">
        <div className="dial-control" role="group" aria-label="Dial: select and open agents">
          <button type="button" aria-label="Dial left: select previous agent" onClick={() => moveSelection(-1)}>−</button>
          <button type="button" className="dial-knob" aria-label={`Dial press: open selected agent ${selectedSlot}`} onClick={() => { void focusSlot(selectedSlot) }} />
          <button type="button" aria-label="Dial right: select next agent" onClick={() => moveSelection(1)}>+</button>
        </div>
        {agents.slice(0, 2).map((agent) => <AgentKey key={agent.slot} agent={agent} selected={selectedSlot === agent.slot} showTitle={preferences.showTitles} onActivate={(slot) => { void focusSlot(slot) }} />)}
        <div className="joystick-control" role="group" aria-label="Planar joystick: four-direction agent selection">
          <button type="button" aria-label="Joystick up: select previous agent" onClick={() => moveSelection(-1)}><ChevronUp size={11} /></button>
          <button type="button" aria-label="Joystick left: select previous agent" onClick={() => moveSelection(-1)}><ChevronLeft size={11} /></button>
          <span className="stick-cap" role="img" aria-label="Planar joystick center; not a press control" />
          <button type="button" aria-label="Joystick right: select next agent" onClick={() => moveSelection(1)}><ChevronRight size={11} /></button>
          <button type="button" aria-label="Joystick down: select next agent" onClick={() => moveSelection(1)}><ChevronDown size={11} /></button>
        </div>
      </div>
      <div className="deck-row deck-row-agents">
        {agents.slice(2).map((agent) => <AgentKey key={agent.slot} agent={agent} selected={selectedSlot === agent.slot} showTitle={preferences.showTitles} onActivate={(slot) => { void focusSlot(slot) }} />)}
      </div>
      <div className="deck-row deck-row-actions">
        {skillActions.map(({ actionId, label, keyHint, Icon }) => <button type="button" data-cap="black-opaque" className="deck-key skill-key" key={actionId} onClick={() => { void runSkill(actionId) }} aria-label={`${label}: copy provider-neutral delivery instruction`}>
          <small>{keyHint}</small><Icon size={14} aria-hidden="true" /><strong>{label}</strong>
        </button>)}
      </div>
      <div className="deck-row deck-row-workflow">
        <button type="button" className="deck-key utility-key touch-key" aria-label={`Privacy, virtual deck screen-only control: session titles are ${preferences.showTitles ? 'visible' : 'hidden'}`} onClick={() => { void savePreferences({ showTitles: !preferences.showTitles }) }}>
          {preferences.showTitles ? <Eye size={14} /> : <EyeOff size={14} />}<strong>Privacy</strong><small>screen</small>
        </button>
        <button type="button" data-cap="black-opaque" className="deck-key utility-key" aria-label="Voice: prepare voice capture" onClick={() => { void runWorkflow('stage_voice') }}><AudioLines size={14} /><strong>Voice</strong></button>
        <button type="button" data-cap="black-opaque" className="deck-key utility-key continue-key" aria-label="Continue: copy a guarded continuation without submitting it" onClick={() => { void runWorkflow('copy_guarded_continue') }}><Send size={14} /><strong>Continue</strong></button>
        <button type="button" data-cap="transparent" className={`deck-key utility-key attention-key transparent-key ${attentionUrgent ? 'urgent' : snapshot.attentionSlot === null ? 'quiet' : 'active'}`} aria-label={snapshot.attentionSlot === null ? 'Attention: no agent needs attention' : `Attention: open highest-priority agent ${snapshot.attentionSlot}`} onClick={() => { void focusAttention() }}>
          {attentionUrgent ? <CircleAlert size={15} /> : snapshot.attentionSlot === null ? <Check size={15} /> : <Play size={15} />}<strong>Attention</strong><small>↵</small>
        </button>
      </div>
    </section>

    <footer className={`compact-receipt ${failed ? 'failed' : ''}`} aria-live="polite" aria-atomic="true">
      <i aria-hidden="true" />
      <span>{receipt}</span>
      <kbd>NUM</kbd>
    </footer>
  </main>
}
