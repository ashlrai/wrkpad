import { describe, expect, it } from 'vitest'
import { allControlIds, type ControlId } from './board'
import { dailyFlightSteps, diagnosticFlightSteps, expectedSignalsAfter, flightAcceptance, flightStepComplete, hybridNativeFlightSteps, noSignalRecoveryNeeded, type FlightEvent } from './flight-check'

const event = (signal: ControlId, expectedSignals: ControlId[], at: number, matched = expectedSignals.includes(signal)): FlightEvent => ({
  signal, expectedSignals, matched, sequence: at, receivedAt: new Date(at).toISOString(), accelerator: 'test', monotonicNs: String(at),
})

describe('Flight Check model', () => {
  it('models all 20 physical gestures and routed signals in both profiles', () => {
    expect(dailyFlightSteps).toHaveLength(20)
    expect(dailyFlightSteps.flatMap((step) => step.signals)).toHaveLength(20)
    expect(new Set(diagnosticFlightSteps.flatMap((step) => step.signals))).toEqual(new Set(allControlIds))
  })
  it('models exactly the 14 Ashlr-owned Hybrid Native gestures', () => {
    expect(hybridNativeFlightSteps).toHaveLength(14)
    const signals = hybridNativeFlightSteps.flatMap((step) => step.signals)
    expect(new Set(signals).size).toBe(14)
    expect(signals).not.toEqual(expect.arrayContaining(['agent1', 'agent6']))
    expect(expectedSignalsAfter('daily', [], 'hybrid_native')).toEqual(['cmd1'])
    const events = hybridNativeFlightSteps.map((step, index) => event(step.signals[0], step.signals, index))
    expect(flightAcceptance('daily', events, true, 14, 14, 'hybrid_native').passed).toBe(true)
    expect(flightAcceptance('daily', events, true, 20, 14, 'hybrid_native').passed).toBe(false)
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
    expect(diagnosticFlightSteps[0].instruction).toContain('top-left rotary dial')
    expect(diagnosticFlightSteps[0].instruction).toContain('layer and connection selector')
    expect(diagnosticFlightSteps.find((step) => step.label === 'Agent 1')?.instruction).toContain('right of the dial')
    expect(diagnosticFlightSteps.find((step) => step.label === 'Agent 2')?.instruction).toContain('left of the planar stick')
    const startedAt = '2026-09-01T18:00:00.000Z'
    expect(noSignalRecoveryNeeded(true, startedAt, [], Date.parse(startedAt) + 11_999)).toBe(false)
    expect(noSignalRecoveryNeeded(true, startedAt, [], Date.parse(startedAt) + 12_000)).toBe(true)
    expect(noSignalRecoveryNeeded(true, startedAt, [event('dialLeft', ['dialLeft'], 1)], Date.parse(startedAt) + 30_000)).toBe(false)
    expect(noSignalRecoveryNeeded(false, startedAt, [], Date.parse(startedAt) + 30_000)).toBe(false)
    expect(noSignalRecoveryNeeded(true, 'not-a-timestamp', [], Date.parse(startedAt) + 30_000)).toBe(false)
  })
  it('accepts ACT10 and ACT11 only as their own physical steps', () => {
    const act10 = diagnosticFlightSteps.find((candidate) => candidate.label === 'Action 5')!
    const act11 = diagnosticFlightSteps.find((candidate) => candidate.label === 'Action 6')!
    expect(flightStepComplete(act10, [event('cmd5', act10.signals, 1000)])).toBe(true)
    expect(flightStepComplete(act10, [event('cmd6', act10.signals, 1000, false)])).toBe(false)
    expect(flightStepComplete(act11, [event('cmd6', act11.signals, 1000)])).toBe(true)
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
