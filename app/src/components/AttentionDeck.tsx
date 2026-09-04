import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Bot, CheckCircle2, Circle, CircleAlert, CircleX, Command, Pause, Radio } from 'lucide-react'
import { agentProviderLabel, agentStateClassName, agentStateLabels, agentStateLegendOrder, agentVisibleStateLabel } from '../agent-accessibility'
import type { AgentSlotSummary, BoardRoute } from '../board'

type ProviderLens = 'mixed' | 'codex' | 'claude'

function isUrgent(state: AgentSlotSummary['state']) {
  return state === 'needs_input' || state === 'error'
}

function StateIcon({ state }: { state: AgentSlotSummary['state'] }) {
  if (state === 'error') return <CircleX size={13} />
  if (state === 'needs_input') return <CircleAlert size={13} />
  if (state === 'working') return <Activity size={13} />
  if (state === 'unread') return <CheckCircle2 size={13} />
  if (state === 'idle') return <Pause size={13} />
  return <Circle size={13} />
}

function Slot({ agent, selected, outsideLens, onSelect, onFocus }: {
  agent: AgentSlotSummary
  selected: boolean
  outsideLens: boolean
  onSelect: (slot: number) => void
  onFocus: (slot: number) => void
}) {
  const ProviderIcon = agent.provider === 'claude' ? Bot : agent.provider === 'codex' ? Command : Radio
  const visibleState = agentVisibleStateLabel(agent)
  const providerLabel = agentProviderLabel(agent)
  const consequence = agent.provider && agent.state !== 'off' ? 'Activate to open its provider app.' : 'Activate to select this slot.'
  return <button
    type="button"
    className={`attention-slot ${agent.provider ?? 'empty'} state-${agent.state} ${selected ? 'selected' : ''} ${outsideLens ? 'outside-lens' : ''}`}
    onClick={() => { onSelect(agent.slot); if (agent.provider && agent.state !== 'off') onFocus(agent.slot) }}
    aria-pressed={selected}
    aria-label={`Agent ${agent.slot}, AG0${agent.slot - 1}, ${providerLabel}, ${agent.title}, ${visibleState}. ${outsideLens ? 'Outside the current screen lens; slot position is unchanged. ' : ''}${consequence}`}
  >
    <span className="slot-index">AG0{agent.slot - 1}</span>
    <span className="slot-provider"><ProviderIcon size={13} />{agent.provider === 'claude' ? 'CLAUDE' : agent.provider === 'codex' ? 'CODEX' : agent.provider === 'manual' ? 'LOCAL' : 'OPEN'}</span>
    <strong>{agent.title}</strong>
    <span className="slot-state"><StateIcon state={agent.state} />{visibleState}</span>
  </button>
}

export default function AttentionDeck({ agents, selectedSlot, source, boardRoute, onSelect, onFocus }: {
  agents: AgentSlotSummary[]
  selectedSlot: number
  source: 'observer_online' | 'invalid' | 'unavailable'
  boardRoute: BoardRoute
  onSelect: (slot: number) => void
  onFocus: (slot: number) => void
}) {
  const slots = useMemo(
    () => Array.from({ length: 6 }, (_, index) => agents[index] ?? ({ slot: index + 1, provider: null, state: 'off', title: 'Available slot', updatedAt: null } satisfies AgentSlotSummary)),
    [agents],
  )
  const previousStates = useRef<Map<number, AgentSlotSummary['state']> | null>(null)
  const [urgentAnnouncement, setUrgentAnnouncement] = useState('')
  const [providerLens, setProviderLens] = useState<ProviderLens>('mixed')
  const outsideLens = (agent: AgentSlotSummary) => providerLens !== 'mixed' && agent.provider !== providerLens

  useEffect(() => {
    const previous = previousStates.current
    const newlyUrgent = slots.filter((agent) => isUrgent(agent.state) && previous?.get(agent.slot) !== agent.state)
    const urgencyCleared = previous !== null && slots.some((agent) => isUrgent(previous.get(agent.slot) ?? 'off') && !isUrgent(agent.state))
    previousStates.current = new Map(slots.map((agent) => [agent.slot, agent.state]))

    if (newlyUrgent.length > 0) {
      setUrgentAnnouncement(newlyUrgent.map((agent) => (
        `Agent ${agent.slot}, ${agentProviderLabel(agent)}, ${agent.title}, ${agentVisibleStateLabel(agent).toLowerCase()}.`
      )).join(' '))
    } else if (urgencyCleared) {
      setUrgentAnnouncement('')
    }
  }, [slots])

  return <section className="attention-deck" aria-labelledby="attention-title">
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{urgentAnnouncement}</div>
    <div className="attention-heading">
      <div><span className="eyebrow">LIVE ATTENTION RUNWAY</span><h2 id="attention-title">One stable screen and Ashlr-layer map.</h2></div>
      <span className={`source-receipt ${source}`}>{source === 'observer_online' ? 'CURRENT SNAPSHOT' : source === 'invalid' ? 'SESSION SNAPSHOT INVALID' : 'SESSION SNAPSHOT UNAVAILABLE'}</span>
    </div>
    <div className="provider-routing-row">
      <div className={`provider-contract route-${boardRoute}`} role="note">
        <strong>{boardRoute === 'ashlr_layer' ? 'Unified physical map' : boardRoute === 'hybrid_native' ? 'Mixed screen map · split physical ownership' : boardRoute === 'codex_native' ? 'Mixed screen map · Codex-only physical route' : 'Mixed screen map · physical route undeclared'}</strong>
        <span>{boardRoute === 'ashlr_layer'
          ? 'AG00–AG05 keep the same mixed Codex + Claude Code slots in every workflow lens.'
          : boardRoute === 'hybrid_native'
            ? 'Physical AG00–AG05 remain Codex-native; they do not focus Claude sessions. The other 14 gestures use Ashlr shortcuts, while exact Claude task or cmux pane focus remains unavailable.'
          : boardRoute === 'codex_native'
            ? 'These screen slots remain mixed, but physical AG00–AG05 are owned by Codex. Choose Ashlr Layer for shared physical semantics.'
            : 'Declare Ashlr Layer for shared physical semantics; the screen runway remains usable without remapping slots.'}</span>
      </div>
      <div className="provider-lens-row">
        <span>Screen lens · slots stay fixed</span>
        <div role="group" aria-label="Agent provider screen lens">
          {([['mixed', 'Mixed'], ['codex', 'Codex'], ['claude', 'Claude']] as Array<[ProviderLens, string]>).map(([id, label]) => <button type="button" key={id} aria-pressed={providerLens === id} onClick={() => setProviderLens(id)}>{label}</button>)}
        </div>
      </div>
    </div>
    <div className="slot-geometry">
      <div className="slot-row top"><span className="slot-anchor" aria-hidden="true">DIAL</span>{slots.slice(0, 2).map((agent) => <Slot key={agent.slot} agent={agent} selected={agent.slot === selectedSlot} outsideLens={outsideLens(agent)} onSelect={onSelect} onFocus={onFocus} />)}<span className="slot-anchor" aria-hidden="true">STICK</span></div>
      <div className="slot-row bottom">{slots.slice(2).map((agent) => <Slot key={agent.slot} agent={agent} selected={agent.slot === selectedSlot} outsideLens={outsideLens(agent)} onSelect={onSelect} onFocus={onFocus} />)}</div>
    </div>
    <p className="appsense-handoff"><strong>Provider handoff:</strong> an occupied slot uses observed provider metadata to foreground ChatGPT or cmux. Exact Codex task focus is unavailable; cmux pane focus is upgradeable only after capability negotiation and human-enabled access. No prompt, terminal input, or key is sent.</p>
    <div className="screen-legend" aria-label="Agent state legend for opaque keycaps">
      <span className="legend-title">BLACK-CAP LEGEND</span>
      {agentStateLegendOrder.map((state) => <span key={state}><i className={agentStateClassName(state)} />{agentStateLabels[state]}</span>)}
      <small>Screen is authoritative now; edge lighting follows only after hardware qualification.</small>
    </div>
  </section>
}
