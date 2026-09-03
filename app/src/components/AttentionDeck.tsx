import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Bot, CheckCircle2, Circle, CircleAlert, CircleX, Command, Pause, Radio } from 'lucide-react'
import { agentProviderLabel, agentStateClassName, agentStateLabels, agentStateLegendOrder, agentVisibleStateLabel } from '../agent-accessibility'
import type { AgentSlotSummary } from '../board'

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

function Slot({ agent, selected, onSelect, onFocus }: {
  agent: AgentSlotSummary
  selected: boolean
  onSelect: (slot: number) => void
  onFocus: (slot: number) => void
}) {
  const ProviderIcon = agent.provider === 'claude' ? Bot : agent.provider === 'codex' ? Command : Radio
  const visibleState = agentVisibleStateLabel(agent)
  const providerLabel = agentProviderLabel(agent)
  const consequence = agent.provider && agent.state !== 'off' ? 'Activate to open its provider app.' : 'Activate to select this slot.'
  return <button
    type="button"
    className={`attention-slot ${agent.provider ?? 'empty'} state-${agent.state} ${selected ? 'selected' : ''}`}
    onClick={() => { onSelect(agent.slot); if (agent.provider && agent.state !== 'off') onFocus(agent.slot) }}
    aria-pressed={selected}
    aria-label={`Agent ${agent.slot}, AG0${agent.slot - 1}, ${providerLabel}, ${agent.title}, ${visibleState}. ${consequence}`}
  >
    <span className="slot-index">AG0{agent.slot - 1}</span>
    <span className="slot-provider"><ProviderIcon size={13} />{agent.provider === 'claude' ? 'CLAUDE' : agent.provider === 'codex' ? 'CODEX' : agent.provider === 'manual' ? 'LOCAL' : 'OPEN'}</span>
    <strong>{agent.title}</strong>
    <span className="slot-state"><StateIcon state={agent.state} />{visibleState}</span>
  </button>
}

export default function AttentionDeck({ agents, selectedSlot, source, onSelect, onFocus }: {
  agents: AgentSlotSummary[]
  selectedSlot: number
  source: 'observer_online' | 'invalid' | 'unavailable'
  onSelect: (slot: number) => void
  onFocus: (slot: number) => void
}) {
  const slots = useMemo(
    () => Array.from({ length: 6 }, (_, index) => agents[index] ?? ({ slot: index + 1, provider: null, state: 'off', title: 'Available slot', updatedAt: null } satisfies AgentSlotSummary)),
    [agents],
  )
  const previousStates = useRef<Map<number, AgentSlotSummary['state']> | null>(null)
  const [urgentAnnouncement, setUrgentAnnouncement] = useState('')

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
      <div><span className="eyebrow">LIVE ATTENTION RUNWAY</span><h2 id="attention-title">Your agents, one stable map.</h2></div>
      <span className={`source-receipt ${source}`}>{source === 'observer_online' ? 'OBSERVER ONLINE' : source === 'invalid' ? 'OBSERVER INVALID' : 'OBSERVER UNAVAILABLE'}</span>
    </div>
    <div className="slot-geometry">
      <div className="slot-row top"><span className="slot-anchor" aria-hidden="true">DIAL</span>{slots.slice(0, 2).map((agent) => <Slot key={agent.slot} agent={agent} selected={agent.slot === selectedSlot} onSelect={onSelect} onFocus={onFocus} />)}<span className="slot-anchor" aria-hidden="true">STICK</span></div>
      <div className="slot-row bottom">{slots.slice(2).map((agent) => <Slot key={agent.slot} agent={agent} selected={agent.slot === selectedSlot} onSelect={onSelect} onFocus={onFocus} />)}</div>
    </div>
    <div className="screen-legend" aria-label="Agent state legend for opaque keycaps">
      <span className="legend-title">BLACK-CAP LEGEND</span>
      {agentStateLegendOrder.map((state) => <span key={state}><i className={agentStateClassName(state)} />{agentStateLabels[state]}</span>)}
      <small>Screen is authoritative now; edge lighting follows only after hardware qualification.</small>
    </div>
  </section>
}
