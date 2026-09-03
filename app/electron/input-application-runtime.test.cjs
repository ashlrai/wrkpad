const test = require('node:test')
const assert = require('node:assert/strict')
const { INPUT_PROCESS_PATTERN, inspectInputApplicationRuntime } = require('./input-application-runtime.cjs')

const result = (status, stdout = '', overrides = {}) => ({ status, stdout, stderr: '', signal: null, ...overrides })

test('uses a fixed bounded pgrep probe and reports only a projected state', () => {
  let invocation
  const observed = inspectInputApplicationRuntime({
    run(executable, args, options) {
      invocation = { executable, args, options }
      return result(0, '123 /Applications/Input.app/Contents/MacOS/Input\n')
    },
  })
  assert.deepEqual(observed, { status: 'running' })
  assert.equal(invocation.executable, '/usr/bin/pgrep')
  assert.deepEqual(invocation.args, ['-fl', INPUT_PROCESS_PATTERN])
  assert.equal(invocation.options.timeout, 2_500)
  assert.equal(JSON.stringify(observed).includes('/Applications'), false)
})

test('accepts exact uppercase and lowercase bundle paths but rejects near matches', () => {
  for (const stdout of [
    '123 /Applications/Input.app/Contents/MacOS/Input\n',
    '456 /Applications/input.app/Contents/MacOS/Input\n',
    '789 /Users/example/Applications/input.app/Contents/MacOS/Input --hidden\n',
  ]) {
    assert.deepEqual(inspectInputApplicationRuntime({ run: () => result(0, stdout) }), { status: 'running' })
  }
  for (const stdout of [
    '123 /Applications/InputBeta.app/Contents/MacOS/Input\n',
    '123 /Applications/input.app/Contents/MacOS/InputHelper\n',
    '123 /tmp/input.app/Contents/MacOS/Input\n',
    '123 /Applications/INPUT.app/Contents/MacOS/Input\n',
  ]) {
    assert.deepEqual(inspectInputApplicationRuntime({ run: () => result(0, stdout) }), { status: 'unavailable' })
  }
})

test('distinguishes an exact no-match exit from an unavailable probe', () => {
  assert.deepEqual(inspectInputApplicationRuntime({ run: () => result(1) }), { status: 'not_running' })
  for (const candidate of [
    result(2),
    result(1, 'unexpected'),
    result(0),
    result(0, 'malformed'),
    result(null, '', { error: new Error('missing') }),
    result(null, '', { signal: 'SIGTERM' }),
  ]) {
    assert.deepEqual(inspectInputApplicationRuntime({ run: () => candidate }), { status: 'unavailable' })
  }
})

test('fails closed on thrown and oversized output', () => {
  assert.deepEqual(inspectInputApplicationRuntime({ run: () => { throw new Error('private') } }), { status: 'unavailable' })
  assert.deepEqual(inspectInputApplicationRuntime({ run: () => result(0, `123 ${'x'.repeat(70_000)}`) }), { status: 'unavailable' })
})
