import { describe, expect, it } from 'vitest'
import { allControlIds, type ControlId } from './board'
import { dailyFlightSteps, diagnosticFlightSteps, expectedSignalsAfter, flightAcceptance, flightStepComplete, noSignalRecoveryNeeded, type FlightEvent } from './flight-check'

const event = (signal: ControlId, expectedSignals: ControlId[], at: number, matched = expectedSignals.includes(signal)): FlightEvent => ({
  signal, expectedSignals, matched, sequence: at, receivedAt: new Date(at).toISOString(), accelerator: 'test', monotonicNs: String(at),
})

describe('Flight Check model', () => {
  it('models 19 gestures, 19 daily signals, and all 20 diagnostic signals', () => {
    expect(dailyFlightSteps).toHaveLength(19)
    expect(dailyFlightSteps.flatMap((step) => step.signals)).toHaveLength(19)
    expect(new Set(diagnosticFlightSteps.flatMap((step) => step.signals))).toEqual(new Set(allControlIds))
  })
  it('does not bank an out-of-order signal for a later step', () => {
    const wrong = event('agent1', ['dialLeft'], 1, false)
    expect(flightStepComplete(diagnosticFlightSteps[3], [wrong])).toBe(false)
    expect(expectedSignalsAfter('diagnostic', [wrong])).toEqual(['dialLeft'])
  })
  it('requires three matched dial detents', () => {
    const step = diagnosticFlightSteps[0]
    expect(flightStepComplete(step, [event('dialLeft', step.signals, 1), event('dialLeft', step.signals, 2)])).toBe(false)
    expect(flightStepComplete(step, [1, 2, 3].map((time) => event('dialLeft', step.signals, time)))).toBe(true)
  })
  it('identifies the physical dial and reveals recovery only after a silent grace period', () => {
    expect(diagnosticFlightSteps[0].instruction).toContain('top-right rotary dial')
    expect(diagnosticFlightSteps[0].instruction).toContain('Bluetooth host selector')
    expect(diagnosticFlightSteps.find((step) => step.label === 'Agent 1')?.instruction).toContain('white joystick')
    expect(diagnosticFlightSteps.find((step) => step.label === 'Agent 2')?.instruction).toContain('black dial')
    const startedAt = '2026-09-01T18:00:00.000Z'
    expect(noSignalRecoveryNeeded(true, startedAt, [], Date.parse(startedAt) + 11_999)).toBe(false)
    expect(noSignalRecoveryNeeded(true, startedAt, [], Date.parse(startedAt) + 12_000)).toBe(true)
    expect(noSignalRecoveryNeeded(true, startedAt, [event('dialLeft', ['dialLeft'], 1)], Date.parse(startedAt) + 30_000)).toBe(false)
    expect(noSignalRecoveryNeeded(false, startedAt, [], Date.parse(startedAt) + 30_000)).toBe(false)
    expect(noSignalRecoveryNeeded(true, 'not-a-timestamp', [], Date.parse(startedAt) + 30_000)).toBe(false)
  })
  it('accepts both diagnostic Mic halves only inside the paired window', () => {
    const step = diagnosticFlightSteps.find((candidate) => candidate.label === 'Mic cap')!
    expect(flightStepComplete(step, [event('cmd6', step.signals, 1000), event('cmd5', step.signals, 1100)])).toBe(true)
    expect(flightStepComplete(step, [event('cmd6', step.signals, 1000), event('cmd5', step.signals, 1300)])).toBe(false)
  })

  it('requires clean routes, live USB, and every shortcut registration', () => {
    const events = dailyFlightSteps.flatMap((step, stepIndex) =>
      Array.from({ length: step.requiredCount ?? 1 }, (_, eventIndex) =>
        event(step.signals[0], step.signals, stepIndex * 1000 + eventIndex),
      ),
    )
    expect(flightAcceptance('daily', events, true, 20, 20).passed).toBe(true)
    expect(flightAcceptance('daily', events, false, 20, 20).passed).toBe(false)
    expect(flightAcceptance('daily', events, true, 19, 20).passed).toBe(false)

    const misroute = event('cmd7', ['dialLeft'], -1, false)
    const result = flightAcceptance('daily', [misroute, ...events], true, 20, 20)
    expect(result.routesComplete).toBe(true)
    expect(result.problemCount).toBe(1)
    expect(result.passed).toBe(false)
  })
})
