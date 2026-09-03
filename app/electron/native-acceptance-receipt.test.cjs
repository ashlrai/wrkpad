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
  ATTESTATION_KEYS,
  MAX_INITIALIZATION_AGE_MS,
  MAX_NATIVE_ACCEPTANCE_RECEIPT_BYTES,
  NATIVE_ACCEPTANCE_FILENAME,
  NATIVE_ACCEPTANCE_SCHEMA,
  acceptNativeAcceptance,
  evaluateNativeAcceptance,
  nativeAcceptanceReceiptPath,
  prepareNativeAcceptance,
  readNativeAcceptanceReceipt,
  removeNativeAcceptanceReceipt,
  sanitizeNativeAcceptanceReceipt,
  writeNativeAcceptanceReceipt,
} = require('./native-acceptance-receipt.cjs')

const context = {
  route: 'codex_native',
  device: { vidPid: '303A:8298' },
  codex: { version: '26.818.61809', build: '7019' },
}
const preparedAt = '2026-09-03T00:00:00.000Z'
const initialization = {
  status: 'connected',
  observedAt: '2026-09-03T00:01:00.000Z',
  fresh: true,
  detail: 'raw diagnostic detail is ignored',
}
const acceptedAt = '2026-09-03T00:02:00.000Z'
const allAccepted = Object.fromEntries(ATTESTATION_KEYS.map((key) => [key, true]))

test('prepares a strict privacy-bounded native acceptance receipt', () => {
  const receipt = prepareNativeAcceptance(context, preparedAt)
  assert.deepEqual(receipt, {
    schema: NATIVE_ACCEPTANCE_SCHEMA,
    state: 'prepared',
    preparedAt,
    initializationObservedAt: null,
    acceptedAt: null,
    context,
    attestations: Object.fromEntries(ATTESTATION_KEYS.map((key) => [key, false])),
  })
  const serialized = JSON.stringify(receipt)
  assert.doesNotMatch(serialized, /Users|session|prompt|title|raw diagnostic/)
})

test('writes and replaces one atomic private receipt beside settings', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'native-acceptance-'))
  try {
    const settingsFilePath = path.join(root, 'settings', 'settings.json')
    const receiptPath = nativeAcceptanceReceiptPath(settingsFilePath)
    assert.equal(receiptPath, path.join(root, 'settings', NATIVE_ACCEPTANCE_FILENAME))
    const prepared = prepareNativeAcceptance(context, preparedAt)
    assert.deepEqual(writeNativeAcceptanceReceipt(settingsFilePath, prepared), prepared)
    assert.equal(statSync(receiptPath).mode & 0o777, 0o600)
    assert.deepEqual(readNativeAcceptanceReceipt(settingsFilePath), prepared)

    const accepted = acceptNativeAcceptance(prepared, {
      currentContext: context,
      nativeInitialization: initialization,
      attestations: allAccepted,
      acceptedAt,
    })
    assert.deepEqual(writeNativeAcceptanceReceipt(settingsFilePath, accepted), accepted)
    assert.deepEqual(readNativeAcceptanceReceipt(settingsFilePath), accepted)
    assert.equal(removeNativeAcceptanceReceipt(settingsFilePath), true)
    assert.equal(readNativeAcceptanceReceipt(settingsFilePath), null)
    assert.equal(removeNativeAcceptanceReceipt(settingsFilePath), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects oversized, public, symlinked, and non-regular receipt files', (t) => {
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')
  const root = mkdtempSync(path.join(tmpdir(), 'native-acceptance-unsafe-'))
  try {
    const settingsFilePath = path.join(root, 'settings.json')
    const receiptPath = nativeAcceptanceReceiptPath(settingsFilePath)
    writeFileSync(receiptPath, 'x'.repeat(MAX_NATIVE_ACCEPTANCE_RECEIPT_BYTES + 1), { mode: 0o600 })
    assert.equal(readNativeAcceptanceReceipt(settingsFilePath), null)

    writeFileSync(receiptPath, `${JSON.stringify(prepareNativeAcceptance(context, preparedAt))}\n`, { mode: 0o644 })
    chmodSync(receiptPath, 0o644)
    assert.equal(readNativeAcceptanceReceipt(settingsFilePath), null)

    const target = path.join(root, 'target.json')
    writeFileSync(target, `${JSON.stringify(prepareNativeAcceptance(context, preparedAt))}\n`, { mode: 0o600 })
    rmSync(receiptPath)
    symlinkSync(target, receiptPath)
    assert.equal(readNativeAcceptanceReceipt(settingsFilePath), null)
    assert.throws(() => writeNativeAcceptanceReceipt(settingsFilePath, prepareNativeAcceptance(context, preparedAt)), /unsafe/)

    rmSync(receiptPath)
    mkdirSync(receiptPath)
    assert.equal(readNativeAcceptanceReceipt(settingsFilePath), null)
    assert.equal(removeNativeAcceptanceReceipt(settingsFilePath), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a symlinked settings directory for writes', (t) => {
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')
  const root = mkdtempSync(path.join(tmpdir(), 'native-acceptance-directory-'))
  try {
    const target = path.join(root, 'target')
    const linked = path.join(root, 'linked')
    mkdirSync(target)
    symlinkSync(target, linked)
    assert.throws(
      () => writeNativeAcceptanceReceipt(path.join(linked, 'settings.json'), prepareNativeAcceptance(context, preparedAt)),
      /unsafe/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fails closed on extra privacy fields and malformed receipt shapes', () => {
  const prepared = prepareNativeAcceptance(context, preparedAt)
  for (const hostile of [
    { ...prepared, sessionId: 'private-session' },
    { ...prepared, prompt: 'private prompt' },
    { ...prepared, context: { ...context, localPath: '/Users/example' } },
    { ...prepared, context: { ...context, device: { ...context.device, serial: 'private-serial' } } },
    { ...prepared, preparedAt: '2026-09-03' },
    { ...prepared, state: 'accepted' },
    { ...prepared, attestations: { ...prepared.attestations, dial: 'yes' } },
    { ...prepared, attestations: { ...prepared.attestations, extra: false } },
  ]) assert.equal(sanitizeNativeAcceptanceReceipt(hostile), null)
})

test('bounds route, generic device identity, Codex version, and Codex build', () => {
  for (const hostile of [
    { ...context, route: 'ashlr_layer' },
    { ...context, device: { ...context.device, vidPid: '303a:8298' } },
    { ...context, device: { ...context.device, descriptorSha256: 'a'.repeat(64) } },
    { ...context, device: { ...context.device, firmwareVersion: '0.6.2' } },
    { ...context, codex: { ...context.codex, version: 'x'.repeat(65) } },
    { ...context, codex: { ...context.codex, build: '7019\nprivate' } },
  ]) assert.throws(() => prepareNativeAcceptance(hostile, preparedAt), /invalid/)
  assert.throws(() => nativeAcceptanceReceiptPath('relative/settings.json'), /absolute local path/)
  assert.throws(() => nativeAcceptanceReceiptPath(`/tmp/settings\nprivate.json`), /absolute local path/)
})

test('projects missing, malformed, and mismatched current context without leaking values', () => {
  const prepared = prepareNativeAcceptance(context, preparedAt)
  assert.equal(evaluateNativeAcceptance(null).status, 'not_prepared')
  assert.deepEqual(
    evaluateNativeAcceptance({ ...prepared, title: 'private' }, { currentContext: context, nativeInitialization: initialization, now: acceptedAt }).reason,
    'receipt_invalid',
  )
  assert.equal(evaluateNativeAcceptance(prepared, {
    currentContext: { ...context, codex: { ...context.codex, build: '7020' } },
    nativeInitialization: initialization,
    now: acceptedAt,
  }).reason, 'context_mismatch')
  const result = evaluateNativeAcceptance(prepared, {
    currentContext: { ...context, localPath: '/Users/private' },
    nativeInitialization: initialization,
    now: acceptedAt,
  })
  assert.equal(result.reason, 'current_context_invalid')
  assert.doesNotMatch(JSON.stringify(result), /Users|private|7020/)
})

test('requires a fresh ordered initialization newer than preparation', () => {
  const prepared = prepareNativeAcceptance(context, preparedAt)
  const evaluate = (nativeInitialization, now = acceptedAt) => evaluateNativeAcceptance(prepared, {
    currentContext: context,
    nativeInitialization,
    now,
  })
  assert.equal(evaluate({ status: 'connection_failed', observedAt: initialization.observedAt, fresh: true }).reason, 'initialization_disconnected')
  assert.equal(evaluate({ status: 'disconnected', observedAt: initialization.observedAt, fresh: true }).reason, 'initialization_disconnected')
  assert.equal(evaluate({ status: 'not_observed', observedAt: null, fresh: false }).reason, 'initialization_not_observed')
  assert.equal(evaluate({ ...initialization, fresh: false }).reason, 'initialization_historical')
  assert.equal(evaluate({ ...initialization, observedAt: preparedAt }).reason, 'initialization_predates_preparation')
  assert.equal(evaluate({ ...initialization, observedAt: '2026-09-03T00:03:00.000Z' }).reason, 'initialization_timestamp_future')
  assert.equal(evaluate(initialization, new Date(Date.parse(initialization.observedAt) + MAX_INITIALIZATION_AGE_MS + 1)).reason, 'initialization_historical')
  assert.deepEqual(evaluate(initialization), {
    status: 'initialization_observed',
    reason: 'fresh_ordered_initialization_observed',
    preparedAt,
    initializationObservedAt: initialization.observedAt,
    acceptedAt: null,
    attestations: Object.fromEntries(ATTESTATION_KEYS.map((key) => [key, false])),
  })
})

test('accepts only all seven control groups against the same live context', () => {
  const prepared = prepareNativeAcceptance(context, preparedAt)
  for (const key of ATTESTATION_KEYS) {
    assert.throws(() => acceptNativeAcceptance(prepared, {
      currentContext: context,
      nativeInitialization: initialization,
      attestations: { ...allAccepted, [key]: false },
      acceptedAt,
    }), /every native acceptance attestation/)
  }
  assert.throws(() => acceptNativeAcceptance(prepared, {
    currentContext: { ...context, device: { vidPid: '303A:8297' } },
    nativeInitialization: initialization,
    attestations: allAccepted,
    acceptedAt,
  }), /context_mismatch/)

  const accepted = acceptNativeAcceptance(prepared, {
    currentContext: context,
    nativeInitialization: initialization,
    attestations: allAccepted,
    acceptedAt,
  })
  assert.equal(accepted.state, 'accepted')
  assert.equal(accepted.initializationObservedAt, initialization.observedAt)
  assert.deepEqual(evaluateNativeAcceptance(accepted, {
    currentContext: context,
    nativeInitialization: initialization,
    now: acceptedAt,
  }), {
    status: 'accepted',
    reason: 'all_native_controls_accepted',
    preparedAt,
    initializationObservedAt: initialization.observedAt,
    acceptedAt,
    attestations: allAccepted,
  })
})

test('revokes an accepted projection when live evidence or context no longer matches', () => {
  const accepted = acceptNativeAcceptance(prepareNativeAcceptance(context, preparedAt), {
    currentContext: context,
    nativeInitialization: initialization,
    attestations: allAccepted,
    acceptedAt,
  })
  const evaluate = (currentContext, nativeInitialization, now = acceptedAt) => evaluateNativeAcceptance(accepted, {
    currentContext,
    nativeInitialization,
    now,
  })
  assert.equal(evaluate(context, { status: 'disconnected', observedAt: acceptedAt, fresh: true }).status, 'pending')
  assert.equal(evaluate(context, { ...initialization, fresh: false }).reason, 'initialization_historical')
  assert.equal(evaluate({ ...context, codex: { ...context.codex, build: '7020' } }, initialization).status, 'invalid')
  assert.equal(evaluate(context, { ...initialization, observedAt: '2026-09-03T00:00:30.000Z' }).reason, 'accepted_initialization_not_current')
  assert.equal(evaluate(context, initialization, '2026-09-03T00:01:30.000Z').reason, 'receipt_timestamp_future')
})

test('accepted schema rejects partial attestations and impossible timestamp order', () => {
  const accepted = acceptNativeAcceptance(prepareNativeAcceptance(context, preparedAt), {
    currentContext: context,
    nativeInitialization: initialization,
    attestations: allAccepted,
    acceptedAt,
  })
  assert.equal(sanitizeNativeAcceptanceReceipt({ ...accepted, attestations: { ...allAccepted, lighting: false } }), null)
  assert.equal(sanitizeNativeAcceptanceReceipt({ ...accepted, initializationObservedAt: preparedAt }), null)
  assert.equal(sanitizeNativeAcceptanceReceipt({ ...accepted, acceptedAt: '2026-09-03T00:00:30.000Z' }), null)

  const root = mkdtempSync(path.join(tmpdir(), 'native-acceptance-privacy-'))
  try {
    const settingsFilePath = path.join(root, 'settings.json')
    writeNativeAcceptanceReceipt(settingsFilePath, accepted)
    const serialized = readFileSync(nativeAcceptanceReceiptPath(settingsFilePath), 'utf8')
    assert.doesNotMatch(serialized, /Users|session|prompt|title|raw|detail/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
