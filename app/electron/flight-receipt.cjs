const { HYBRID_NATIVE_ROUTE, HYBRID_NATIVE_SIGNAL_IDS } = require('./board-route-policy.cjs')

const diagnosticSteps = [
  { signals: ['dialLeft'], required: 3 }, { signals: ['dialRight'], required: 3 }, { signals: ['dialPress'] },
  { signals: ['agent1'] }, { signals: ['agent2'] },
  { signals: ['joyUp'] }, { signals: ['joyRight'] }, { signals: ['joyDown'] }, { signals: ['joyLeft'] },
  { signals: ['agent3'] }, { signals: ['agent4'] }, { signals: ['agent5'] }, { signals: ['agent6'] },
  { signals: ['cmd1'] }, { signals: ['cmd2'] }, { signals: ['cmd3'] }, { signals: ['cmd4'] },
  { signals: ['cmd5'] }, { signals: ['cmd6'] }, { signals: ['cmd7'] },
]
const dailySteps = diagnosticSteps
const hybridNativeSteps = Object.freeze(HYBRID_NATIVE_SIGNAL_IDS.map((signal) => Object.freeze({ signals: Object.freeze([signal]) })))

function evaluateFlightSignals(variant, rawEvents, boardRoute = 'ashlr_layer') {
  const steps = boardRoute === HYBRID_NATIVE_ROUTE
    ? hybridNativeSteps
    : boardRoute === 'ashlr_layer'
      ? variant === 'diagnostic' ? diagnosticSteps : dailySteps
      : []
  let stepIndex = 0; let captured = []
  const problems = []; const acceptedEvents = []
  for (const event of rawEvents) {
    const step = steps[stepIndex]
    if (!step) { problems.push({ kind: 'noise_after_completion', observed: event.signalId, receivedAt: event.receivedAt }); continue }
    if (!step.signals.includes(event.signalId)) {
      problems.push({ kind: 'misroute', observed: event.signalId, expected: step.signals, receivedAt: event.receivedAt })
      continue
    }
    captured.push(event); acceptedEvents.push(event)
    let complete = false
    if (step.pairWindowMs) {
      const first = captured.find((item) => item.signalId === step.signals[0])
      const second = captured.find((item) => item.signalId === step.signals[1])
      complete = Boolean(first && second && Math.abs(Date.parse(first.receivedAt) - Date.parse(second.receivedAt)) <= step.pairWindowMs)
    } else complete = captured.filter((item) => item.signalId === step.signals[0]).length >= (step.required || 1)
    if (complete) { stepIndex++; captured = [] }
  }
  const missingSignals = steps.slice(stepIndex).flatMap((step) => step.signals)
  return {
    status: steps.length > 0 && stepIndex === steps.length && problems.length === 0 ? 'passed' : stepIndex === 0 && rawEvents.length === 0 ? 'incomplete' : 'failed',
    completedGestures: stepIndex,
    expectedGestures: steps.length,
    expectedSignals: new Set(steps.flatMap((step) => step.signals)).size,
    receivedSignals: [...new Set(acceptedEvents.map((event) => event.signalId))],
    missingSignals,
    problems,
  }
}

module.exports = { dailySteps, diagnosticSteps, evaluateFlightSignals, hybridNativeSteps }
