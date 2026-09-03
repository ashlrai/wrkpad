const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const {
  WORKER_ENTRY_PATH,
  createInputInstallationInspector,
  sanitizeInspection,
} = require('./input-installation-async.cjs')
const { validRequest } = require('./input-installation-worker-entry.cjs')

const HOME = '/Users/example'

class FakeWorker extends EventEmitter {
  constructor() {
    super()
    this.terminateCalls = 0
  }

  terminate() {
    this.terminateCalls += 1
    return Promise.resolve(0)
  }
}

test('runs the fixed worker once, shares an in-flight probe, and caches its sanitized result', async () => {
  const workers = []
  const calls = []
  let monotonicMs = 100
  const inspect = createInputInstallationInspector({
    clock: () => monotonicMs,
    workerFactory(filename, options) {
      calls.push({ filename, options })
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
  })

  const first = inspect({ home: HOME })
  const shared = inspect({ home: HOME })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].filename, WORKER_ENTRY_PATH)
  assert.deepEqual(calls[0].options, { workerData: { schemaVersion: 1, home: HOME } })
  workers[0].emit('message', { status: 'verified', version: '0.18.4' })
  const firstResult = await first
  assert.deepEqual(firstResult, { status: 'verified', version: '0.18.4' })
  assert.equal(Object.isFrozen(firstResult), true)
  assert.deepEqual(await shared, { status: 'verified', version: '0.18.4' })
  assert.equal(workers[0].terminateCalls, 1)

  monotonicMs += 1_000
  assert.deepEqual(await inspect({ home: HOME }), { status: 'verified', version: '0.18.4' })
  assert.equal(calls.length, 1)

  const forced = inspect({ home: HOME, force: true })
  assert.equal(calls.length, 2)
  workers[1].emit('message', { status: 'known_resource_mutation', version: '0.18.4' })
  assert.deepEqual(await forced, { status: 'known_resource_mutation', version: '0.18.4' })
})

test('expires its cache by monotonic TTL and invalidates it on clock rollback', async () => {
  const workers = []
  let monotonicMs = 10_000
  const inspect = createInputInstallationInspector({
    cacheTtlMs: 100,
    clock: () => monotonicMs,
    workerFactory() {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
  })
  const complete = async () => {
    const pending = inspect({ home: HOME })
    workers.at(-1).emit('message', { status: 'verified', version: '0.18.4' })
    await pending
  }
  await complete()
  monotonicMs += 99
  await inspect({ home: HOME })
  assert.equal(workers.length, 1)
  monotonicMs += 1
  await complete()
  assert.equal(workers.length, 2)
  monotonicMs -= 1_000
  await complete()
  assert.equal(workers.length, 3)
})

test('rejects malformed worker messages without returning extra or private fields', async () => {
  const unsafeMessages = [
    null,
    { status: 'verified', version: '0.18.4', path: '/Users/private/input.app' },
    { status: 'invented', version: null },
    { status: 'verified', version: '../private' },
  ]
  for (const unsafeMessage of unsafeMessages) {
    let worker
    const inspect = createInputInstallationInspector({
      workerFactory() {
        worker = new FakeWorker()
        return worker
      },
    })
    const pending = inspect({ home: HOME })
    worker.emit('message', unsafeMessage)
    const result = await pending
    assert.deepEqual(result, { status: 'probe_unavailable', version: null })
    assert.doesNotMatch(JSON.stringify(result), /Users|private|input\.app/u)
  }
})

test('terminates a worker that exceeds the outer deadline and ignores late output', async () => {
  let worker
  const inspect = createInputInstallationInspector({
    workerTimeoutMs: 10,
    workerFactory() {
      worker = new FakeWorker()
      return worker
    },
  })
  const result = await inspect({ home: HOME })
  assert.deepEqual(result, { status: 'probe_unavailable', version: null })
  assert.equal(worker.terminateCalls, 1)
  worker.emit('message', { status: 'verified', version: '0.18.4' })
  assert.deepEqual(await inspect({ home: HOME }), result)
})

test('fails closed for worker errors, invalid homes, clock failure, and competing homes', async () => {
  let worker
  let calls = 0
  const inspect = createInputInstallationInspector({
    clock: () => { throw new Error('clock unavailable') },
    workerFactory() {
      calls += 1
      worker = new FakeWorker()
      return worker
    },
  })
  assert.deepEqual(await inspect({ home: 'relative/private' }), { status: 'probe_unavailable', version: null })
  assert.equal(calls, 0)
  const pending = inspect({ home: HOME })
  assert.deepEqual(await inspect({ home: '/Users/another' }), { status: 'probe_unavailable', version: null })
  assert.equal(calls, 1)
  worker.emit('error', new Error('/Users/private/worker failure'))
  assert.deepEqual(await pending, { status: 'probe_unavailable', version: null })
  assert.equal(worker.terminateCalls, 1)
})

test('fails closed for worker construction, premature exit, and termination rejection', async () => {
  const constructionFailure = createInputInstallationInspector({
    workerFactory() { throw new Error('/Users/private/construction failure') },
  })
  assert.deepEqual(await constructionFailure({ home: HOME }), { status: 'probe_unavailable', version: null })

  let setupWorker
  const setupFailure = createInputInstallationInspector({
    workerFactory() {
      setupWorker = new FakeWorker()
      setupWorker.once = () => { throw new Error('/Users/private/listener failure') }
      return setupWorker
    },
  })
  assert.deepEqual(await setupFailure({ home: HOME }), { status: 'probe_unavailable', version: null })
  assert.equal(setupWorker.terminateCalls, 1)

  let exitedWorker
  const prematureExit = createInputInstallationInspector({
    workerFactory() {
      exitedWorker = new FakeWorker()
      return exitedWorker
    },
  })
  const exited = prematureExit({ home: HOME })
  exitedWorker.emit('exit', 0)
  assert.deepEqual(await exited, { status: 'probe_unavailable', version: null })

  let rejectingWorker
  const rejectingTermination = createInputInstallationInspector({
    workerFactory() {
      rejectingWorker = new FakeWorker()
      rejectingWorker.terminate = () => Promise.reject(new Error('/Users/private/termination failure'))
      return rejectingWorker
    },
  })
  const pending = rejectingTermination({ home: HOME })
  rejectingWorker.emit('message', { status: 'verified', version: '0.18.4' })
  assert.deepEqual(await pending, { status: 'verified', version: '0.18.4' })
  await new Promise((resolve) => setImmediate(resolve))
})

test('worker request and result contracts remain fixed and narrow', () => {
  assert.equal(path.basename(WORKER_ENTRY_PATH), 'input-installation-worker-entry.cjs')
  assert.equal(validRequest({ schemaVersion: 1, home: HOME }), true)
  assert.equal(validRequest({ schemaVersion: 1, home: HOME, candidate: '/private/input.app' }), false)
  assert.equal(validRequest({ schemaVersion: 1, home: 'relative' }), false)
  assert.deepEqual(sanitizeInspection({ status: 'missing', version: null }), { status: 'missing', version: null })
  assert.deepEqual(sanitizeInspection({ status: 'missing', version: '0.18.4' }), { status: 'probe_unavailable', version: null })
  assert.deepEqual(sanitizeInspection({ status: 'verified', version: null }), { status: 'probe_unavailable', version: null })
})

test('main status and Flight Check paths await the shared worker-backed inspector', () => {
  const source = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
  assert.match(source, /createInputInstallationInspector/u)
  assert.doesNotMatch(source, /require\('\.\/input-installation-diagnostics\.cjs'\)/u)
  assert.match(source, /const inputInstallation = await inspectCurrentInputInstallation\(forceInput\)[\s\S]*const board = await boardConnected\(\)[\s\S]*const settings = readSettings\(\)[\s\S]*const currentReceiverRuntime = synchronizeShortcutOwnership\(settings\.boardRoute\)\.runtime/u)
  assert.match(source, /const inputInstallationPending = inspectCurrentInputInstallation\(\)[\s\S]*const currentReceiverRuntime = synchronizeShortcutOwnership\(settings\.boardRoute\)\.runtime[\s\S]*\[inputInstallation, board,[\s\S]*inputInstallationPending/u)
  assert.match(source, /const \[inputInstallation, board, codex, claude, ashlr, workspaceSnapshot, chatgptInspection\] = await Promise\.all/u)
})
