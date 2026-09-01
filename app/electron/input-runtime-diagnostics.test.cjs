const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const {
  FRESHNESS_MS,
  MAX_LOG_TAIL_BYTES,
  classifyInputRuntimeLog,
  inspectInputRuntime,
} = require('./input-runtime-diagnostics.cjs')

const signal = (timestamp, profile = 2, layer = 1, suffix = '') =>
  `[${timestamp}] [error] |window_service| cannot find specific profile index: ${profile} and layer index: ${layer} combination${suffix}`

function writeFixedLog(home, text) {
  const directory = path.join(home, 'Library', 'Logs', 'input')
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'main.log'), text)
}

test('returns only bounded indexes and sanitized timing for the newest exact signal', () => {
  const now = new Date(2026, 8, 1, 18, 40, 0, 0)
  const newest = new Date(2026, 8, 1, 18, 39, 25, 111)
  const classified = classifyInputRuntimeLog([
    signal('2026-09-01 18:20:00.000', 1, 3),
    'private path /Users/example/secret',
    signal('2026-09-01 18:39:25.111'),
  ].join('\n'), now)

  assert.deepEqual(classified, {
    status: 'profile_layer_mismatch',
    profileIndex: 2,
    layerIndex: 1,
    observedAt: newest.toISOString(),
    fresh: true,
  })
  assert.equal(JSON.stringify(classified).includes('/Users/example/secret'), false)
})

test('rejects near matches, invalid dates, and unbounded indexes', () => {
  const text = [
    '[2026-09-01 18:39:25.111] [info] |window_service| cannot find specific profile index: 2 and layer index: 1 combination',
    '[2026-09-01 18:39:25.111] [error] |other_service| cannot find specific profile index: 2 and layer index: 1 combination',
    signal('2026-02-31 18:39:25.111'),
    signal('2026-09-01 18:39:25.111', 999, 999),
  ].join('\n')
  assert.deepEqual(classifyInputRuntimeLog(text), {
    status: 'not_observed', profileIndex: null, layerIndex: null, observedAt: null, fresh: false,
  })
})

test('marks historical and implausibly future signals as not fresh', () => {
  const observed = new Date(2026, 8, 1, 18, 0, 0, 0)
  assert.equal(
    classifyInputRuntimeLog(signal('2026-09-01 18:00:00.000'), new Date(observed.getTime() + FRESHNESS_MS + 1)).fresh,
    false,
  )
  assert.equal(
    classifyInputRuntimeLog(signal('2026-09-01 18:00:00.000'), new Date(observed.getTime() - 60_001)).fresh,
    false,
  )
})

test('reads only the bounded tail of the fixed Input main log', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'input-runtime-diagnostics-'))
  try {
    const oldSignal = signal('2026-09-01 17:00:00.000')
    writeFixedLog(home, `${oldSignal}\n${'x'.repeat(MAX_LOG_TAIL_BYTES + 100)}\n`)
    assert.equal(inspectInputRuntime(home).status, 'not_observed')

    const recentSignal = signal('2026-09-01 18:39:25.111')
    writeFixedLog(home, `${'x'.repeat(MAX_LOG_TAIL_BYTES + 100)}\n${recentSignal}\n`)
    const now = new Date(2026, 8, 1, 18, 40, 0, 0)
    assert.equal(inspectInputRuntime(home, now).status, 'profile_layer_mismatch')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('rejects a symlinked Input log', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'input-runtime-diagnostics-'))
  const outside = mkdtempSync(path.join(tmpdir(), 'input-runtime-outside-'))
  try {
    const directory = path.join(home, 'Library', 'Logs', 'input')
    mkdirSync(directory, { recursive: true })
    const target = path.join(outside, 'main.log')
    writeFileSync(target, signal('2026-09-01 18:39:25.111'))
    symlinkSync(target, path.join(directory, 'main.log'))
    assert.equal(inspectInputRuntime(home).status, 'log_unsafe')
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('distinguishes a missing fixed log without exposing its path', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'input-runtime-diagnostics-'))
  try {
    assert.deepEqual(inspectInputRuntime(home), {
      status: 'log_missing', profileIndex: null, layerIndex: null, observedAt: null, fresh: false,
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
