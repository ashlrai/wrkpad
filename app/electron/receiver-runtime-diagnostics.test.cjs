const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { tmpdir } = require('node:os')
const path = require('node:path')
const {
  MAX_PROCESS_OUTPUT_BYTES,
  RECEIVER_PROCESS_PATTERN,
  MAX_ASAR_BYTES,
  classifyPackagedReceiverPeers,
  classifyReceiverRuntime,
  createCachedAsarHasher,
  hashBoundedAsar,
  inspectPackagedReceiverPeers,
  inspectReceiverRuntime,
  shouldRegisterShortcuts,
} = require('./receiver-runtime-diagnostics.cjs')

const mainExecutable = (root, name = 'Ashlr Agent Board.app') => path.join(root, name, 'Contents', 'MacOS', 'Ashlr Agent Board')
const asarFor = (executablePath) => path.join(path.dirname(path.dirname(executablePath)), 'Resources', 'app.asar')
const psRow = (pid, executablePath) => `${String(pid).padStart(6)} ${executablePath}`
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function createBuild(root, label, contents) {
  const executablePath = mainExecutable(path.join(root, label))
  const asarPath = asarFor(executablePath)
  mkdirSync(path.dirname(asarPath), { recursive: true })
  writeFileSync(asarPath, contents)
  return { executablePath, asarPath, sha256: sha256(contents) }
}

test('classifies one exact main process and compares a candidate without returning paths or process text', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-'))
  try {
    const current = createBuild(root, 'current', 'same-build')
    const candidate = createBuild(root, 'candidate', 'same-build')
    const privatePath = '/Users/example/private/customer-repository'
    const classified = classifyReceiverRuntime([
      psRow(42, current.executablePath),
      `    99 /bin/zsh ${privatePath}`,
    ].join('\n'), {
      currentPid: 42,
      currentAsarPath: current.asarPath,
      candidateAsarPaths: [candidate.asarPath],
    })

    assert.deepEqual(classified, {
      status: 'exclusive',
      instanceCount: 1,
      distinctBuildCount: 1,
      currentAsarSha256: current.sha256,
      candidateAsarSha256: current.sha256,
      candidateMatchesCurrent: true,
    })
    assert.doesNotMatch(JSON.stringify(classified), /Users|customer|repository|pid|executable|path/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('distinguishes no main process, same-build contention, and distinct builds', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-'))
  try {
    const current = createBuild(root, 'current', 'current-build')
    const other = createBuild(root, 'other', 'other-build')

    assert.equal(classifyReceiverRuntime('   7 /usr/bin/other', { currentPid: 7 }).status, 'not_running')
    const contendedSame = classifyReceiverRuntime([
      psRow(10, current.executablePath),
      psRow(11, current.executablePath),
    ].join('\n'), { currentPid: 10, currentAsarPath: current.asarPath })
    assert.equal(contendedSame.status, 'contended_same_build')
    assert.equal(contendedSame.instanceCount, 2)
    assert.equal(contendedSame.distinctBuildCount, 1)

    const contendedDistinct = classifyReceiverRuntime([
      psRow(10, current.executablePath),
      psRow(11, current.executablePath),
      psRow(12, other.executablePath),
    ].join('\n'), { currentPid: 10, currentAsarPath: current.asarPath, candidateAsarPaths: [other.asarPath] })
    assert.equal(contendedDistinct.status, 'contended_distinct_builds')
    assert.equal(contendedDistinct.instanceCount, 3)
    assert.equal(contendedDistinct.distinctBuildCount, 2)
    assert.equal(contendedDistinct.candidateAsarSha256, other.sha256)
    assert.equal(contendedDistinct.candidateMatchesCurrent, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('detects receivers outside the current and candidate build paths', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-'))
  try {
    const current = createBuild(root, 'current', 'current-build')
    const unlisted = createBuild(root, 'unlisted', 'unlisted-build')
    const classified = classifyReceiverRuntime([
      psRow(16, current.executablePath),
      psRow(17, unlisted.executablePath),
    ].join('\n'), {
      currentPid: 16,
      currentAsarPath: current.asarPath,
    })
    assert.equal(classified.status, 'contended_distinct_builds')
    assert.equal(classified.instanceCount, 2)
    assert.equal(classified.distinctBuildCount, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('matches only the exact packaged main executable and ignores renderer, shell, and name near-matches', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-'))
  try {
    const current = createBuild(root, 'current', 'build')
    const text = [
      psRow(21, current.executablePath),
      `${psRow(22, current.executablePath)} --type=renderer`,
      psRow(23, mainExecutable(path.join(root, 'near'), 'Fake Agent Board.app')),
      '    24 /bin/sh',
    ].join('\n')
    const classified = classifyReceiverRuntime(text, { currentPid: 21, currentAsarPath: current.asarPath })
    assert.equal(classified.status, 'exclusive')
    assert.equal(classified.instanceCount, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fails closed for malformed, control, bidi, oversized, duplicate, and unanchored current rows', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-'))
  try {
    const current = createBuild(root, 'current', 'build')
    const cases = [
      `not-a-pid ${current.executablePath}`,
      psRow(31, `${root}/unsafe\u202e/Ashlr Agent Board.app/Contents/MacOS/Ashlr Agent Board`),
      psRow(31, `${root}/unsafe\t/Ashlr Agent Board.app/Contents/MacOS/Ashlr Agent Board`),
      [psRow(31, current.executablePath), psRow(31, current.executablePath)].join('\n'),
      psRow(32, current.executablePath),
    ]
    for (const processText of cases) {
      assert.equal(classifyReceiverRuntime(processText, { currentPid: 31, currentAsarPath: current.asarPath }).status, 'unavailable')
    }
    assert.equal(classifyReceiverRuntime('x'.repeat(MAX_PROCESS_OUTPUT_BYTES + 1), { currentPid: 31 }).status, 'unavailable')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('hashes a bounded regular app.asar and refuses a final symlink', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-'))
  const outside = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-outside-'))
  try {
    const regular = path.join(root, 'app.asar')
    const target = path.join(outside, 'app.asar')
    const link = path.join(root, 'linked', 'app.asar')
    const oversized = path.join(root, 'oversized', 'app.asar')
    mkdirSync(path.dirname(link), { recursive: true })
    mkdirSync(path.dirname(oversized), { recursive: true })
    writeFileSync(regular, 'regular-build')
    writeFileSync(target, 'private-build')
    symlinkSync(target, link)
    writeFileSync(oversized, 'x')
    truncateSync(oversized, MAX_ASAR_BYTES + 1)

    assert.deepEqual(hashBoundedAsar(regular), { status: 'available', sha256: sha256('regular-build') })
    assert.deepEqual(hashBoundedAsar(link), { status: 'unsafe', sha256: null })
    assert.deepEqual(hashBoundedAsar(oversized), { status: 'unsafe', sha256: null })
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('cached hasher reuses stable file identities, expires by TTL, and invalidates changed bytes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-cache-'))
  try {
    const asarPath = path.join(root, 'app.asar')
    writeFileSync(asarPath, 'first-build')
    let clock = 1_000
    let calls = 0
    const cachedHasher = createCachedAsarHasher({
      ttlMs: 1_000,
      now: () => clock,
      hashAsar(filePath) {
        calls += 1
        return hashBoundedAsar(filePath)
      },
    })

    assert.deepEqual(cachedHasher(asarPath), { status: 'available', sha256: sha256('first-build') })
    assert.deepEqual(cachedHasher(asarPath), { status: 'available', sha256: sha256('first-build') })
    assert.equal(calls, 1)

    clock += 1_001
    assert.deepEqual(cachedHasher(asarPath), { status: 'available', sha256: sha256('first-build') })
    assert.equal(calls, 2)

    writeFileSync(asarPath, 'second-build-with-new-identity')
    assert.deepEqual(cachedHasher(asarPath), { status: 'available', sha256: sha256('second-build-with-new-identity') })
    assert.equal(calls, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('cached hasher is bounded, refuses unsafe inputs, and detects mutation during hashing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-cache-'))
  const outside = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-cache-outside-'))
  try {
    const first = path.join(root, 'first', 'app.asar')
    const second = path.join(root, 'second', 'app.asar')
    const target = path.join(outside, 'app.asar')
    const link = path.join(root, 'linked', 'app.asar')
    mkdirSync(path.dirname(first), { recursive: true })
    mkdirSync(path.dirname(second), { recursive: true })
    mkdirSync(path.dirname(link), { recursive: true })
    writeFileSync(first, 'first')
    writeFileSync(second, 'second')
    writeFileSync(target, 'private')
    symlinkSync(target, link)
    let calls = 0
    const bounded = createCachedAsarHasher({
      maxEntries: 1,
      hashAsar(filePath) {
        calls += 1
        return hashBoundedAsar(filePath)
      },
    })

    assert.equal(bounded(first).status, 'available')
    assert.equal(bounded(second).status, 'available')
    assert.equal(bounded(first).status, 'available')
    assert.equal(calls, 3)
    assert.deepEqual(bounded(link), { status: 'unsafe', sha256: null })
    assert.equal(calls, 3)

    const mutating = createCachedAsarHasher({
      hashAsar(filePath) {
        const result = hashBoundedAsar(filePath)
        writeFileSync(filePath, 'changed-during-hash')
        return result
      },
    })
    assert.deepEqual(mutating(second), { status: 'unavailable', sha256: null })
    assert.throws(() => createCachedAsarHasher({ ttlMs: -1 }), /Invalid bounded ASAR cache options/)
    assert.throws(() => createCachedAsarHasher({ maxEntries: 65 }), /Invalid bounded ASAR cache options/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('rejects mismatched current identity and unbounded candidate paths', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-'))
  try {
    const current = createBuild(root, 'current', 'current-build')
    const other = createBuild(root, 'other', 'other-build')
    const processText = psRow(61, other.executablePath)
    assert.equal(classifyReceiverRuntime(processText, {
      currentPid: 61,
      currentAsarPath: current.asarPath,
      candidateAsarPaths: [other.asarPath],
    }).status, 'unavailable')
    assert.equal(classifyReceiverRuntime(psRow(61, current.executablePath), {
      currentPid: 61,
      currentAsarPath: current.asarPath,
      candidateAsarPaths: [`/${'x'.repeat(5000)}/app.asar`],
    }).status, 'unavailable')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fails closed when a running instance or candidate resolves to a symlinked app.asar', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-'))
  const outside = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-outside-'))
  try {
    const current = createBuild(root, 'current', 'current-build')
    const otherExecutable = mainExecutable(path.join(root, 'other'))
    const otherAsar = asarFor(otherExecutable)
    const target = path.join(outside, 'app.asar')
    mkdirSync(path.dirname(otherAsar), { recursive: true })
    writeFileSync(target, 'other-build')
    symlinkSync(target, otherAsar)

    const processText = [psRow(41, current.executablePath), psRow(42, otherExecutable)].join('\n')
    assert.equal(classifyReceiverRuntime(processText, {
      currentPid: 41,
      currentAsarPath: current.asarPath,
      candidateAsarPaths: [otherAsar],
    }).status, 'unavailable')
    assert.equal(classifyReceiverRuntime(psRow(41, current.executablePath), {
      currentPid: 41,
      currentAsarPath: current.asarPath,
      candidateAsarPaths: [otherAsar],
    }).status, 'unavailable')
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('runs only the fixed bounded receiver probe and treats runner failure as unavailable', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-'))
  try {
    const current = createBuild(root, 'current', 'build')
    let received
    const classified = inspectReceiverRuntime({
      run(executable, args, options) {
        received = { executable, args, options }
        return psRow(51, current.executablePath)
      },
      currentPid: 51,
      currentAsarPath: current.asarPath,
    })
    assert.equal(classified.status, 'exclusive')
    assert.equal(received.executable, '/usr/bin/pgrep')
    assert.deepEqual(received.args, ['-fl', RECEIVER_PROCESS_PATTERN])
    assert.equal(received.options.maxBuffer, MAX_PROCESS_OUTPUT_BYTES)
    assert.equal(inspectReceiverRuntime({ run: () => { throw Object.assign(new Error('no matches'), { status: 1 }) } }).status, 'not_running')
    assert.equal(inspectReceiverRuntime({ run: () => null }).status, 'unavailable')
    assert.equal(inspectReceiverRuntime({ run: () => { throw new Error('private output') } }).status, 'unavailable')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('development peer probe detects packaged receivers without exposing process details', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-peer-'))
  try {
    const first = createBuild(root, 'first', 'first-build')
    const second = createBuild(root, 'second', 'second-build')
    const privatePath = '/Users/example/private/customer-repository'
    const peers = classifyPackagedReceiverPeers([
      psRow(71, first.executablePath),
      psRow(72, second.executablePath),
      `    73 /bin/zsh ${privatePath}`,
    ].join('\n'))
    assert.deepEqual(peers, { status: 'present', instanceCount: 2 })
    assert.doesNotMatch(JSON.stringify(peers), /Users|customer|repository|pid|path|command/i)
    assert.deepEqual(classifyPackagedReceiverPeers('    73 /bin/zsh'), { status: 'none', instanceCount: 0 })
    assert.deepEqual(classifyPackagedReceiverPeers(`bad ${first.executablePath}`), { status: 'unavailable', instanceCount: 0 })
    assert.deepEqual(classifyPackagedReceiverPeers('x'.repeat(MAX_PROCESS_OUTPUT_BYTES + 1)), { status: 'unavailable', instanceCount: 0 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('development peer probe uses only the fixed bounded process command and fails closed', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'receiver-runtime-peer-'))
  try {
    const packaged = createBuild(root, 'packaged', 'build')
    let received
    const peers = inspectPackagedReceiverPeers({
      run(executable, args, options) {
        received = { executable, args, options }
        return psRow(81, packaged.executablePath)
      },
    })
    assert.deepEqual(peers, { status: 'present', instanceCount: 1 })
    assert.equal(received.executable, '/usr/bin/pgrep')
    assert.deepEqual(received.args, ['-fl', RECEIVER_PROCESS_PATTERN])
    assert.equal(received.options.maxBuffer, MAX_PROCESS_OUTPUT_BYTES)
    assert.deepEqual(inspectPackagedReceiverPeers({ run: () => { throw Object.assign(new Error('none'), { status: 1 }) } }), { status: 'none', instanceCount: 0 })
    assert.deepEqual(inspectPackagedReceiverPeers({ run: () => null }), { status: 'unavailable', instanceCount: 0 })
    assert.deepEqual(inspectPackagedReceiverPeers({ run: () => { throw new Error('private output') } }), { status: 'unavailable', instanceCount: 0 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('allows shortcuts only for one exclusively owned and hashed receiver', () => {
  const hash = 'a'.repeat(64)
  assert.equal(shouldRegisterShortcuts({
    status: 'exclusive',
    instanceCount: 1,
    distinctBuildCount: 1,
    currentAsarSha256: hash,
  }), true)

  for (const runtime of [
    null,
    {},
    { status: 'unavailable', instanceCount: 1, distinctBuildCount: 1, currentAsarSha256: hash },
    { status: 'contended_same_build', instanceCount: 2, distinctBuildCount: 1, currentAsarSha256: hash },
    { status: 'exclusive', instanceCount: 2, distinctBuildCount: 1, currentAsarSha256: hash },
    { status: 'exclusive', instanceCount: 1, distinctBuildCount: 2, currentAsarSha256: hash },
    { status: 'exclusive', instanceCount: 1, distinctBuildCount: 1, currentAsarSha256: null },
    { status: 'exclusive', instanceCount: 1, distinctBuildCount: 1, currentAsarSha256: 'not-a-hash' },
  ]) {
    assert.equal(shouldRegisterShortcuts(runtime), false)
  }
})
