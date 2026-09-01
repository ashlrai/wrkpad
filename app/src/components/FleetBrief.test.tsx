// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import FleetBrief from './FleetBrief'

afterEach(cleanup)

describe('operator notices', () => {
  it('keeps high-severity notices visible when fleet evidence is unavailable', () => {
    render(<FleetBrief
      fleet={null}
      source="unavailable"
      notices={[{
        code: 'claude_session_start_repo_mutation',
        severity: 'high',
        label: 'Claude startup can mutate repositories',
        detail: 'Review the unrelated startup hook separately.',
      }]}
    />)

    expect(screen.getByRole('heading', { name: 'Fleet evidence unavailable.' })).toBeTruthy()
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
    expect(screen.getByText('Claude startup can mutate repositories')).toBeTruthy()
    expect(screen.getByText('Review the unrelated startup hook separately.')).toBeTruthy()
  })
})
