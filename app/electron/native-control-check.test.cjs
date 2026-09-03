const test = require('node:test')
const assert = require('node:assert/strict')
const {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const {
  ACTION_KEYS,
  AGENT_KEYS,
  MAX_NATIVE_CONTROL_CHECK_BYTES,
  NATIVE_CONTROL_CHECK_FILENAME,
  NATIVE_CONTROL_CHECK_SCHEMA,
  createNativeControlCheck,
  deriveNativeControlCheckOverall,
  nativeControlCheckPath,
  readNativeControlCheck,
  sanitizeNativeControlCheck,
  writeNativeControlCheck,
} = require('./native-control-check.cjs')

const reportedAt = '2026-09-02T16:00:00.000Z'
const afterReport = '2026-09-02T16:01:00.000Z'
const context = {
  route: 'codex_native',
  device: { vidPid: '303A:8298' },
  codex: { version: '26.818.61809', build: '7019' },
}

function outcomes(value = 'observed_response') {
  return {
    dial: value,
    joystick: value,
    agentKeys: Object.fromEntries(AGENT_KEYS.map((key) => [key, value])),
    actionKeys: Object.fromEntries(ACTION_KEYS.map((key) => [key, value])),
    lighting: value,
  }
}

test('creates an operator-accepted receipt only from every successful physical control outcome', () => {
  const receipt = createNativeControlCheck({
    context,
    settings: 'connected_granted',
    outcomes: outcomes(),
    reportedAt,
  })
  assert.deepEqual(receipt, {
    schema: NATIVE_CONTROL_CHECK_SCHEMA,
    overall: 'operator_accepted',
    reportedAt,
    context,
    settings: 'connected_granted',
    outcomes: outcomes(),
  })
  assert.deepEqual(Object.keys(receipt.outcomes.agentKeys), AGENT_KEYS)
})

test('derives incomplete and failure states conservatively', () => {
  assert.equal(deriveNativeControlCheckOverall('not_checked', outcomes()), 'incomplete')
  assert.equal(deriveNativeControlCheckOverall('connected_granted', {
    ...outcomes(),
    lighting: 'skipped',
  }), 'incomplete')
  assert.equal(deriveNativeControlCheckOverall('failed_or_ungranted', outcomes('skipped')), 'reported_failure')
  for (const failure of ['no_response', 'unexpected_target']) {
    assert.equal(deriveNativeControlCheckOverall('connected_granted', {
      ...outcomes(),
      dial: failure,
    }), 'reported_failure')
  }
  assert.equal(deriveNativeControlCheckOverall('connected_granted', { ...outcomes(), actionKeys: { ...outcomes().actionKeys, ACT10: 'not_configured' } }), 'incomplete')
})

test('rejects unknown fields, missing agent keys, unknown enums, and false-green overall values', () => {
  const valid = createNativeControlCheck({ context, settings: 'connected_granted', outcomes: outcomes(), reportedAt })
  const hostile = [
    { ...valid, prompt: 'private prompt' },
    { ...valid, context: { ...context, workspace: '/Users/private/repo' } },
    { ...valid, context: { ...context, device: { ...context.device, serial: 'private-serial' } } },
    { ...valid, outcomes: { ...valid.outcomes, title: 'private title' } },
    { ...valid, outcomes: { ...valid.outcomes, dial: 'clicked' } },
    { ...valid, outcomes: { ...valid.outcomes, agentKeys: { ...valid.outcomes.agentKeys, AG06: 'observed_response' } } },
    { ...valid, outcomes: { ...valid.outcomes, actionKeys: { ...valid.outcomes.actionKeys, ACT13: 'observed_response' } } },
    { ...valid, outcomes: { ...valid.outcomes, agentKeys: { ...valid.outcomes.agentKeys, AG05: undefined } } },
    { ...valid, settings: 'granted' },
    { ...valid, overall: 'reported_failure' },
  ]
  for (const value of hostile) assert.equal(sanitizeNativeControlCheck(value, { now: afterReport }), null)
})

test('rejects future timestamps, malformed time, invalid current time, and context drift', () => {
  const valid = createNativeControlCheck({ context, settings: 'connected_granted', outcomes: outcomes(), reportedAt })
  assert.throws(() => createNativeControlCheck({
    context,
    settings: 'connected_granted',
    outcomes: outcomes(),
    reportedAt: '2099-01-01T00:00:00.000Z',
  }), /invalid/)
  assert.equal(sanitizeNativeControlCheck(valid, { now: '2026-09-02T15:59:59.999Z' }), null)
  assert.equal(sanitizeNativeControlCheck({ ...valid, reportedAt: '2026-09-02' }, { now: afterReport }), null)
  assert.equal(sanitizeNativeControlCheck(valid, { now: 'not-a-time' }), null)
  for (const currentContext of [
    { ...context, route: 'ashlr_layer' },
    { ...context, device: { vidPid: '303A:8297' } },
    { ...context, codex: { ...context.codex, version: '26.818.70000' } },
    { ...context, codex: { ...context.codex, build: '7020' } },
  ]) {
    assert.equal(sanitizeNativeControlCheck(valid, { currentContext, now: afterReport }), null)
  }
})

test('bounds route, VID:PID, Codex version, and Codex build', () => {
  for (const invalidContext of [
    { ...context, route: 'ashlr_layer' },
    { ...context, device: { vidPid: '303a:8298' } },
    { ...context, device: { vidPid: '303A:8298', firmwareVersion: '0.6.2' } },
    { ...context, codex: { ...context.codex, version: 'x'.repeat(65) } },
    { ...context, codex: { ...context.codex, build: '7019\nprivate' } },
  ]) {
    assert.throws(() => createNativeControlCheck({
      context: invalidContext,
      settings: 'connected_granted',
      outcomes: outcomes(),
      reportedAt,
    }), /invalid/)
  }
  assert.throws(() => nativeControlCheckPath('relative/settings.json'), /absolute local path/)
  assert.throws(() => nativeControlCheckPath('/tmp/settings\nprivate.json'), /absolute local path/)
})

test('persists and reads a bounded private atomic receipt beside settings', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'native-control-check-'))
  try {
    const settingsFilePath = path.join(root, 'settings', 'settings.json')
    const receiptPath = nativeControlCheckPath(settingsFilePath)
    const receipt = createNativeControlCheck({ context, settings: 'connected_granted', outcomes: outcomes(), reportedAt })
    assert.equal(receiptPath, path.join(root, 'settings', NATIVE_CONTROL_CHECK_FILENAME))
    assert.deepEqual(writeNativeControlCheck(settingsFilePath, receipt, { currentContext: context, now: afterReport }), receipt)
    assert.equal(statSync(receiptPath).mode & 0o777, 0o600)
    assert.deepEqual(readNativeControlCheck(settingsFilePath, { currentContext: context, now: afterReport }), receipt)
    const serialized = readFileSync(receiptPath, 'utf8')
    assert.ok(Buffer.byteLength(serialized, 'utf8') <= MAX_NATIVE_CONTROL_CHECK_BYTES)
    assert.doesNotMatch(serialized, /Users|session|prompt|title|serial|raw|workspace/i)

    const failed = createNativeControlCheck({
      context,
      settings: 'connected_granted',
      outcomes: { ...outcomes(), joystick: 'no_response' },
      reportedAt,
    })
    assert.deepEqual(writeNativeControlCheck(settingsFilePath, failed, { currentContext: context, now: afterReport }), failed)
    assert.deepEqual(readNativeControlCheck(settingsFilePath, { currentContext: context, now: afterReport }), failed)
    assert.equal(readNativeControlCheck(settingsFilePath, {
      currentContext: { ...context, codex: { ...context.codex, build: '7020' } },
      now: afterReport,
    }), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fails closed on oversized, public, symlinked, and non-regular receipt paths', (t) => {
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')
  const root = mkdtempSync(path.join(tmpdir(), 'native-control-check-unsafe-'))
  try {
    const settingsFilePath = path.join(root, 'settings.json')
    const receiptPath = nativeControlCheckPath(settingsFilePath)
    const receipt = createNativeControlCheck({ context, settings: 'connected_granted', outcomes: outcomes(), reportedAt })

    writeFileSync(receiptPath, 'x'.repeat(MAX_NATIVE_CONTROL_CHECK_BYTES + 1), { mode: 0o600 })
    assert.equal(readNativeControlCheck(settingsFilePath, { now: afterReport }), null)

    writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o644 })
    chmodSync(receiptPath, 0o644)
    assert.equal(readNativeControlCheck(settingsFilePath, { now: afterReport }), null)

    const target = path.join(root, 'target.json')
    writeFileSync(target, `${JSON.stringify(receipt)}\n`, { mode: 0o600 })
    rmSync(receiptPath)
    symlinkSync(target, receiptPath)
    assert.equal(readNativeControlCheck(settingsFilePath, { now: afterReport }), null)
    assert.throws(() => writeNativeControlCheck(settingsFilePath, receipt, { now: afterReport }), /unsafe/)

    rmSync(receiptPath)
    mkdirSync(receiptPath)
    assert.equal(readNativeControlCheck(settingsFilePath, { now: afterReport }), null)
    assert.throws(() => writeNativeControlCheck(settingsFilePath, receipt, { now: afterReport }), /unsafe/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses a symlinked settings directory and never persists caller-only data', (t) => {
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')
  const root = mkdtempSync(path.join(tmpdir(), 'native-control-check-directory-'))
  try {
    const target = path.join(root, 'target')
    const linked = path.join(root, 'linked')
    mkdirSync(target)
    symlinkSync(target, linked)
    const receipt = createNativeControlCheck({ context, settings: 'connected_granted', outcomes: outcomes(), reportedAt })
    assert.throws(
      () => writeNativeControlCheck(path.join(linked, 'settings.json'), receipt, { now: afterReport }),
      /unsafe/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
