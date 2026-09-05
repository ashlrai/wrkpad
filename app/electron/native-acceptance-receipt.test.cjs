const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const {
  chmodSync,
  existsSync,
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
  NATIVE_ACCEPTANCE_LOCK_FILENAME,
  NATIVE_ACCEPTANCE_LOCK_SCHEMA,
  NATIVE_ACCEPTANCE_SCHEMA,
  acceptNativeAcceptance,
  evaluateNativeAcceptance,
  nativeAcceptanceReceiptPath,
  prepareNativeAcceptance,
  readNativeAcceptanceReceipt,
  removeNativeAcceptanceReceipt,
  sanitizeNativeAcceptanceReceipt,
  stageNativeAcceptance,
  writeNativeAcceptanceReceipt,
} = require('./native-acceptance-receipt.cjs')
const { createNativeAcceptanceOperationCoordinator } = require('./native-acceptance-operations.cjs')

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
    assert.deepEqual(writeNativeAcceptanceReceipt(settingsFilePath, prepared, null), prepared)
    assert.equal(statSync(receiptPath).mode & 0o777, 0o600)
    assert.deepEqual(readNativeAcceptanceReceipt(settingsFilePath), prepared)

    const accepting = stageNativeAcceptance(prepared, {
      currentContext: context,
      nativeInitialization: initialization,
      attestations: allAccepted,
      stagedAt: acceptedAt,
    })
    assert.deepEqual(writeNativeAcceptanceReceipt(settingsFilePath, accepting, prepared), accepting)
    const accepted = acceptNativeAcceptance(accepting, {
      currentContext: context,
      nativeInitialization: initialization,
      acceptedAt,
    })
    assert.deepEqual(writeNativeAcceptanceReceipt(settingsFilePath, accepted, accepting), accepted)
    assert.deepEqual(readNativeAcceptanceReceipt(settingsFilePath), accepted)
    assert.equal(removeNativeAcceptanceReceipt(settingsFilePath, accepted), true)
    assert.equal(readNativeAcceptanceReceipt(settingsFilePath), null)
    assert.equal(removeNativeAcceptanceReceipt(settingsFilePath, null), true)
    assert.equal(existsSync(path.join(path.dirname(receiptPath), NATIVE_ACCEPTANCE_LOCK_FILENAME)), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('conditional persistence rejects competing receipts and a held private lock', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'native-acceptance-cas-'))
  try {
    const settingsFilePath = path.join(root, 'settings', 'settings.json')
    const receiptPath = nativeAcceptanceReceiptPath(settingsFilePath)
    const lockPath = path.join(path.dirname(receiptPath), NATIVE_ACCEPTANCE_LOCK_FILENAME)
    const first = prepareNativeAcceptance(context, preparedAt)
    const competing = prepareNativeAcceptance(context, '2026-09-03T00:00:30.000Z')
    const accepting = stageNativeAcceptance(first, {
      currentContext: context,
      nativeInitialization: initialization,
      attestations: allAccepted,
      stagedAt: acceptedAt,
    })
    const accepted = acceptNativeAcceptance(accepting, {
      currentContext: context,
      nativeInitialization: initialization,
      acceptedAt,
    })

    assert.throws(() => writeNativeAcceptanceReceipt(settingsFilePath, first), /expected native acceptance receipt is required/)
    assert.deepEqual(writeNativeAcceptanceReceipt(settingsFilePath, first, null), first)
    assert.deepEqual(writeNativeAcceptanceReceipt(settingsFilePath, competing, first), competing)
    assert.throws(() => writeNativeAcceptanceReceipt(settingsFilePath, accepted, first), /busy or unsafe/)
    assert.deepEqual(readNativeAcceptanceReceipt(settingsFilePath), competing)
    assert.equal(removeNativeAcceptanceReceipt(settingsFilePath, first), false)
    assert.deepEqual(readNativeAcceptanceReceipt(settingsFilePath), competing)

    writeFileSync(lockPath, '', { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    assert.equal(statSync(lockPath).mode & 0o777, 0o600)
    assert.throws(() => writeNativeAcceptanceReceipt(settingsFilePath, accepted, competing), /busy or unsafe/)
    assert.throws(() => removeNativeAcceptanceReceipt(settingsFilePath, competing), /busy or unsafe/)
    assert.deepEqual(readNativeAcceptanceReceipt(settingsFilePath), competing)
    rmSync(lockPath)

    assert.equal(removeNativeAcceptanceReceipt(settingsFilePath, competing), true)
    assert.equal(readNativeAcceptanceReceipt(settingsFilePath), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a restarted coordinator excludes a live owner and reclaims SIGKILL, PID-reuse, and reboot locks', async (t) => {
  if (process.platform === 'win32') return t.skip('SIGKILL ownership probing is POSIX-specific')
  const root = mkdtempSync(path.join(tmpdir(), 'native-acceptance-crash-lock-'))
  const settingsFilePath = path.join(root, 'settings', 'settings.json')
  const receiptPath = nativeAcceptanceReceiptPath(settingsFilePath)
  const lockPath = path.join(path.dirname(receiptPath), NATIVE_ACCEPTANCE_LOCK_FILENAME)
  mkdirSync(path.dirname(receiptPath), { recursive: true, mode: 0o700 })
  const now = Date.now()
  const dynamicPreparedAt = new Date(now - 60_000).toISOString()
  const dynamicInitialization = {
    status: 'connected',
    observedAt: new Date(now - 30_000).toISOString(),
    fresh: true,
  }
  const childSource = `
    const fs = require('node:fs')
    fs.renameSync = () => {
      process.stdout.write('LOCKED\\n')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
    }
    const receipt = require(process.argv[1])
    const prepared = receipt.prepareNativeAcceptance(JSON.parse(process.argv[4]), process.argv[3])
    receipt.writeNativeAcceptanceReceipt(process.argv[2], prepared, null)
  `
  const child = spawn(process.execPath, [
    '-e',
    childSource,
    require.resolve('./native-acceptance-receipt.cjs'),
    settingsFilePath,
    dynamicPreparedAt,
    JSON.stringify(context),
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  try {
    await new Promise((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => reject(new Error(`child did not acquire lock: ${stderr}`)), 5_000)
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
        if (stdout.includes('LOCKED\n')) {
          clearTimeout(timeout)
          resolve()
        }
      })
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        reject(new Error(`child exited before acquiring lock: ${code ?? signal}`))
      })
    })
    assert.equal(statSync(lockPath).mode & 0o777, 0o600)
    const lockOwner = JSON.parse(readFileSync(lockPath, 'utf8'))
    assert.deepEqual(Object.keys(lockOwner).sort(), ['bootId', 'nonce', 'pid', 'processBirthId', 'schema'])
    assert.equal(lockOwner.schema, NATIVE_ACCEPTANCE_LOCK_SCHEMA)
    assert.equal(lockOwner.pid, child.pid)
    assert.match(lockOwner.bootId, /^[0-9a-f]{64}$/)
    assert.match(lockOwner.processBirthId, /^[0-9a-f]{64}$/)
    assert.doesNotMatch(JSON.stringify(lockOwner), /Users|session|prompt|title|workspace/)

    const createCoordinator = () => createNativeAcceptanceOperationCoordinator({
      acceptReceipt: acceptNativeAcceptance,
      collectEvidence: async () => ({ currentContext: context, nativeInitialization: dynamicInitialization }),
      evaluateReceipt: evaluateNativeAcceptance,
      prepareReceipt: (value) => prepareNativeAcceptance(value, dynamicPreparedAt),
      readReceipt: () => readNativeAcceptanceReceipt(settingsFilePath),
      removeReceipt: (expected) => removeNativeAcceptanceReceipt(settingsFilePath, expected),
      stageReceipt: stageNativeAcceptance,
      writeReceipt: (value, expected) => writeNativeAcceptanceReceipt(settingsFilePath, value, expected),
    })
    const liveOwnerAttempt = await createCoordinator().prepare()
    assert.equal(liveOwnerAttempt.ok, false)
    assert.equal(readNativeAcceptanceReceipt(settingsFilePath), null)

    const closed = once(child, 'close')
    assert.equal(child.kill('SIGKILL'), true)
    await closed

    const restarted = createCoordinator()
    const prepared = await restarted.prepare()
    assert.equal(prepared.ok, true)
    assert.equal(prepared.snapshot.receipt.state, 'prepared')
    const cleared = await restarted.clear()
    assert.equal(cleared.ok, true)
    assert.equal(cleared.snapshot.receipt, null)
    assert.equal(existsSync(lockPath), false)

    const zeroIdentity = '0'.repeat(64)
    writeFileSync(lockPath, `${JSON.stringify({
      ...lockOwner,
      pid: process.pid,
      nonce: '00000000-0000-4000-8000-000000000001',
      processBirthId: zeroIdentity,
    })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    const pidReused = createCoordinator()
    assert.equal((await pidReused.prepare()).ok, true)
    assert.equal((await pidReused.clear()).ok, true)

    writeFileSync(lockPath, `${JSON.stringify({
      ...lockOwner,
      pid: process.pid,
      nonce: '00000000-0000-4000-8000-000000000002',
      bootId: zeroIdentity,
      processBirthId: zeroIdentity,
    })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    const afterReboot = createCoordinator()
    assert.equal((await afterReboot.prepare()).ok, true)
    assert.equal((await afterReboot.clear()).ok, true)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close')
      child.kill('SIGKILL')
      await closed
    }
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
    assert.throws(() => writeNativeAcceptanceReceipt(settingsFilePath, prepareNativeAcceptance(context, preparedAt), null), /busy or unsafe/)

    writeFileSync(receiptPath, `${JSON.stringify(prepareNativeAcceptance(context, preparedAt))}\n`, { mode: 0o644 })
    chmodSync(receiptPath, 0o644)
    assert.equal(readNativeAcceptanceReceipt(settingsFilePath), null)
    assert.throws(() => writeNativeAcceptanceReceipt(settingsFilePath, prepareNativeAcceptance(context, preparedAt), null), /busy or unsafe/)

    const target = path.join(root, 'target.json')
    writeFileSync(target, `${JSON.stringify(prepareNativeAcceptance(context, preparedAt))}\n`, { mode: 0o600 })
    rmSync(receiptPath)
    symlinkSync(target, receiptPath)
    assert.equal(readNativeAcceptanceReceipt(settingsFilePath), null)
    assert.throws(() => writeNativeAcceptanceReceipt(settingsFilePath, prepareNativeAcceptance(context, preparedAt), null), /busy or unsafe/)

    rmSync(receiptPath)
    mkdirSync(receiptPath)
    assert.equal(readNativeAcceptanceReceipt(settingsFilePath), null)
    assert.equal(removeNativeAcceptanceReceipt(settingsFilePath, null), false)
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
      () => writeNativeAcceptanceReceipt(path.join(linked, 'settings.json'), prepareNativeAcceptance(context, preparedAt), null),
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
    { ...prepared, state: 'accepting' },
    { ...prepared, state: 'accepted' },
    { ...prepared, attestations: { ...prepared.attestations, dial: 'yes' } },
    { ...prepared, attestations: { ...prepared.attestations, extra: false } },
  ]) assert.equal(sanitizeNativeAcceptanceReceipt(hostile), null)
})

test('bounds route, generic device identity, Codex version, and Codex build', () => {
  for (const hostile of [
    { ...context, route: 'ashlr_layer' },
    { ...context, route: 'hybrid_native' },
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

test('stages all seven control groups, remains non-accepted, then promotes against fresh evidence', () => {
  const prepared = prepareNativeAcceptance(context, preparedAt)
  for (const key of ATTESTATION_KEYS) {
    assert.throws(() => stageNativeAcceptance(prepared, {
      currentContext: context,
      nativeInitialization: initialization,
      attestations: { ...allAccepted, [key]: false },
      stagedAt: acceptedAt,
    }), /every native acceptance attestation/)
  }
  assert.throws(() => stageNativeAcceptance(prepared, {
    currentContext: { ...context, device: { vidPid: '303A:8297' } },
    nativeInitialization: initialization,
    attestations: allAccepted,
    stagedAt: acceptedAt,
  }), /context_mismatch/)

  const accepting = stageNativeAcceptance(prepared, {
    currentContext: context,
    nativeInitialization: initialization,
    attestations: allAccepted,
    stagedAt: acceptedAt,
  })
  assert.equal(accepting.state, 'accepting')
  assert.equal(evaluateNativeAcceptance(accepting, {
    currentContext: context,
    nativeInitialization: initialization,
    now: acceptedAt,
  }).status, 'pending')
  assert.throws(() => acceptNativeAcceptance(accepting, {
    currentContext: { ...context, device: { vidPid: '303A:8297' } },
    nativeInitialization: initialization,
    acceptedAt,
  }), /context_mismatch/)
  assert.throws(() => acceptNativeAcceptance(accepting, {
    currentContext: context,
    nativeInitialization: { ...initialization, observedAt: '2026-09-03T00:00:30.000Z' },
    acceptedAt,
  }), /initialization is stale/)
  const accepted = acceptNativeAcceptance(accepting, {
    currentContext: context,
    nativeInitialization: initialization,
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
  const accepting = stageNativeAcceptance(prepareNativeAcceptance(context, preparedAt), {
    currentContext: context,
    nativeInitialization: initialization,
    attestations: allAccepted,
    stagedAt: acceptedAt,
  })
  const accepted = acceptNativeAcceptance(accepting, {
    currentContext: context,
    nativeInitialization: initialization,
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
  const accepting = stageNativeAcceptance(prepareNativeAcceptance(context, preparedAt), {
    currentContext: context,
    nativeInitialization: initialization,
    attestations: allAccepted,
    stagedAt: acceptedAt,
  })
  assert.equal(sanitizeNativeAcceptanceReceipt({ ...accepting, attestations: { ...allAccepted, lighting: false } }), null)
  assert.equal(sanitizeNativeAcceptanceReceipt({ ...accepting, initializationObservedAt: preparedAt }), null)
  assert.equal(sanitizeNativeAcceptanceReceipt({ ...accepting, acceptedAt }), null)
  const accepted = acceptNativeAcceptance(accepting, {
    currentContext: context,
    nativeInitialization: initialization,
    acceptedAt,
  })
  assert.equal(sanitizeNativeAcceptanceReceipt({ ...accepted, attestations: { ...allAccepted, lighting: false } }), null)
  assert.equal(sanitizeNativeAcceptanceReceipt({ ...accepted, initializationObservedAt: preparedAt }), null)
  assert.equal(sanitizeNativeAcceptanceReceipt({ ...accepted, acceptedAt: '2026-09-03T00:00:30.000Z' }), null)

  const root = mkdtempSync(path.join(tmpdir(), 'native-acceptance-privacy-'))
  try {
    const settingsFilePath = path.join(root, 'settings.json')
    writeNativeAcceptanceReceipt(settingsFilePath, accepted, null)
    const serialized = readFileSync(nativeAcceptanceReceiptPath(settingsFilePath), 'utf8')
    assert.doesNotMatch(serialized, /Users|session|prompt|title|raw|detail/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
