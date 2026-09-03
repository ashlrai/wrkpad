const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateFlightSignals } = require('./flight-receipt.cjs')

const event = (signalId, time) => ({ signalId, receivedAt: new Date(time).toISOString(), sequence: time, source: 'global-shortcut' })

test('main receipt evaluator does not bank out-of-order signals', () => {
  const result = evaluateFlightSignals('daily', [event('agent1', 1), event('dialLeft', 2)])
  assert.equal(result.completedGestures, 0)
  assert.equal(result.problems[0].kind, 'misroute')
  assert.equal(result.missingSignals[0], 'dialLeft')
})

test('both profiles require ACT10 and ACT11 as separate ordered gestures', () => {
  const prefix = ['dialLeft','dialLeft','dialLeft','dialRight','dialRight','dialRight','dialPress','agent1','agent2','joyUp','joyRight','joyDown','joyLeft','agent3','agent4','agent5','agent6','cmd1','cmd2','cmd3','cmd4']
  const daily = [...prefix, 'cmd5', 'cmd6', 'cmd7'].map((signal, index) => event(signal, index * 10))
  assert.equal(evaluateFlightSignals('daily', daily).status, 'passed')
  const diagnostic = [...prefix.map((signal, index) => event(signal, index * 10)), event('cmd5', 220), event('cmd6', 225), event('cmd7', 230)]
  assert.equal(evaluateFlightSignals('diagnostic', diagnostic).status, 'passed')
  const reversed = [...prefix.map((signal, index) => event(signal, index * 10)), event('cmd6', 220), event('cmd5', 225), event('cmd7', 230)]
  assert.notEqual(evaluateFlightSignals('diagnostic', reversed).status, 'passed')
})
