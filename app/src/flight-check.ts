import type { ControlId } from './board'

export type FlightVariant = 'daily' | 'diagnostic'
export interface FlightStep { label: string; instruction: string; signals: ControlId[]; requiredCount?: number }
export interface FlightEvent { signal: ControlId; receivedAt: string; sequence: number; accelerator: string; monotonicNs: string; expectedSignals: ControlId[]; matched: boolean }

export const diagnosticFlightSteps: FlightStep[] = [
  { label: 'Dial left', instruction: 'Turn the dial three slow detents counterclockwise.', signals: ['dialLeft'], requiredCount: 3 },
  { label: 'Dial right', instruction: 'Turn the dial three slow detents clockwise.', signals: ['dialRight'], requiredCount: 3 },
  { label: 'Dial press', instruction: 'Press the dial once.', signals: ['dialPress'] },
  { label: 'Agent 1', instruction: 'Press the upper Agent key beside the dial.', signals: ['agent1'] },
  { label: 'Agent 2', instruction: 'Press the upper Agent key beside the joystick.', signals: ['agent2'] },
  { label: 'Joystick up', instruction: 'Push the joystick upward, then return it to center.', signals: ['joyUp'] },
  { label: 'Joystick right', instruction: 'Push the joystick right, then return it to center.', signals: ['joyRight'] },
  { label: 'Joystick down', instruction: 'Push the joystick downward, then return it to center.', signals: ['joyDown'] },
  { label: 'Joystick left', instruction: 'Push the joystick left, then return it to center.', signals: ['joyLeft'] },
  { label: 'Agent 3', instruction: 'Press the left Agent key on row two.', signals: ['agent3'] },
  { label: 'Agent 4', instruction: 'Press the second Agent key on row two.', signals: ['agent4'] },
  { label: 'Agent 5', instruction: 'Press the third Agent key on row two.', signals: ['agent5'] },
  { label: 'Agent 6', instruction: 'Press the right Agent key on row two.', signals: ['agent6'] },
  { label: 'Action 1', instruction: 'Press the lightning key.', signals: ['cmd1'] },
  { label: 'Action 2', instruction: 'Press the check key.', signals: ['cmd2'] },
  { label: 'Action 3', instruction: 'Press the X key.', signals: ['cmd3'] },
  { label: 'Action 4', instruction: 'Press the split key.', signals: ['cmd4'] },
  { label: 'Mic cap', instruction: 'Press the wide Mic cap once; both hidden switches must report.', signals: ['cmd5', 'cmd6'] },
  { label: 'Action 7', instruction: 'Press the brain key.', signals: ['cmd7'] },
]

export const dailyFlightSteps: FlightStep[] = diagnosticFlightSteps.map((step) => step.label === 'Mic cap'
  ? { ...step, instruction: 'Press the wide Mic cap once; the daily profile should report ACT10 only.', signals: ['cmd5'] }
  : step)

export const stepsForVariant = (variant: FlightVariant) => variant === 'diagnostic' ? diagnosticFlightSteps : dailyFlightSteps

export const flightStepComplete = (step: FlightStep, events: FlightEvent[]) => {
  const matched = events.filter((event) => event.matched && event.expectedSignals.join('|') === step.signals.join('|'))
  if (step.signals.length === 1) return matched.filter((event) => event.signal === step.signals[0]).length >= (step.requiredCount ?? 1)
  const first = matched.filter((event) => event.signal === step.signals[0])
  const second = matched.filter((event) => event.signal === step.signals[1])
  return first.some((left) => second.some((right) => Math.abs(new Date(left.receivedAt).getTime() - new Date(right.receivedAt).getTime()) <= 250))
}

export const expectedSignalsAfter = (variant: FlightVariant, events: FlightEvent[]) =>
  stepsForVariant(variant).find((step) => !flightStepComplete(step, events))?.signals ?? []

export const flightAcceptance = (
  variant: FlightVariant,
  events: FlightEvent[],
  boardConnected: boolean,
  shortcutCount: number,
  requiredShortcuts: number,
) => {
  const steps = stepsForVariant(variant)
  const routesComplete = steps.every((step) => flightStepComplete(step, events))
  const problemCount = events.filter((event) => !event.matched).length
  const preflightReady = boardConnected && shortcutCount === requiredShortcuts
  return {
    routesComplete,
    problemCount,
    preflightReady,
    passed: routesComplete && problemCount === 0 && preflightReady,
  }
}
