// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSlotSummary } from '../board'
import AttentionDeck from './AttentionDeck'

afterEach(cleanup)

const agents: AgentSlotSummary[] = [
  { slot: 1, provider: 'codex', state: 'error', title: 'gateway', updatedAt: null },
  { slot: 2, provider: 'claude', state: 'needs_input', title: 'ashlr-hub', updatedAt: null },
  { slot: 3, provider: 'codex', state: 'working', title: 'wrkpad', updatedAt: null },
  { slot: 4, provider: 'claude', state: 'unread', title: 'landing', updatedAt: null },
  { slot: 5, provider: 'manual', state: 'idle', title: 'fleet', updatedAt: null },
  { slot: 6, provider: null, state: 'off', title: 'Available slot', updatedAt: null },
]

describe('black-cap attention runway', () => {
  it('mirrors the physical anchors and exposes every state without relying on color', () => {
    render(<AttentionDeck agents={agents} selectedSlot={2} source="observer_online" onSelect={() => {}} onFocus={() => {}} />)
    expect(screen.getByText('DIAL')).toBeTruthy()
    expect(screen.getByText('STICK')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Agent 2, AG01, Claude Code, ashlr-hub, Needs you/i }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /Agent 4.*Ready to review/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Agent 5.*Local agent.*Idle/i })).toBeTruthy()
    expect(screen.getByLabelText('Agent state legend for opaque keycaps').textContent).toContain('ErrorNeeds youWorkingReady to reviewIdleAvailable')
  })

  it('selects an empty key without inventing a focus target', () => {
    const onSelect = vi.fn(); const onFocus = vi.fn()
    render(<AttentionDeck agents={agents} selectedSlot={1} source="observer_online" onSelect={onSelect} onFocus={onFocus} />)
    fireEvent.click(screen.getByRole('button', { name: /Agent 6.*Available/i }))
    expect(onSelect).toHaveBeenCalledWith(6)
    expect(onFocus).not.toHaveBeenCalled()
  })

  it('announces only new urgent transitions through one polite status region', async () => {
    const calm = agents.map((agent) => ({ ...agent, state: agent.state === 'error' || agent.state === 'needs_input' ? 'idle' as const : agent.state }))
    const { rerender } = render(<AttentionDeck agents={calm} selectedSlot={1} source="observer_online" onSelect={() => {}} onFocus={() => {}} />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe('')

    rerender(<AttentionDeck agents={agents} selectedSlot={1} source="observer_online" onSelect={() => {}} onFocus={() => {}} />)
    await waitFor(() => expect(status.textContent).toBe('Agent 1, Codex, gateway, error. Agent 2, Claude Code, ashlr-hub, needs you.'))

    rerender(<AttentionDeck agents={agents.map((agent) => agent.slot === 2 ? { ...agent, state: 'error' as const } : agent)} selectedSlot={1} source="observer_online" onSelect={() => {}} onFocus={() => {}} />)
    await waitFor(() => expect(status.textContent).toBe('Agent 2, Claude Code, ashlr-hub, error.'))
  })
})
