import type { AgentSlotSummary } from './board'

export const agentStateLabels: Record<AgentSlotSummary['state'], string> = {
  off: 'Available', idle: 'Idle', unread: 'Ready to review', working: 'Working', needs_input: 'Needs you', error: 'Error',
}

export const agentStateLegendOrder: AgentSlotSummary['state'][] = [
  'error', 'needs_input', 'working', 'unread', 'idle', 'off',
]

export const agentStateClassName = (state: AgentSlotSummary['state']) => state.replace('_', '-')

export function agentProviderLabel(agent: AgentSlotSummary) {
  if (agent.provider === 'claude') return 'Claude Code'
  if (agent.provider === 'codex') return 'Codex'
  if (agent.provider === 'manual') return 'Local agent'
  return agent.provider === 'unknown' ? 'Unknown provider' : 'Open slot'
}

export function agentVisibleStateLabel(agent: AgentSlotSummary) {
  return agent.state === 'off' && agent.provider ? 'Inactive' : agentStateLabels[agent.state]
}
