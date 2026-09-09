const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  CHATGPT_BUNDLE_ID,
  CHATGPT_BUNDLE_PATH,
  CODEX_CLI_PATH,
  OPEN_PATH,
  createAppServerRunner,
  createCodexDesktopAdapter,
  createDeepLinkOpener,
  sanitizeCwd,
  sanitizeThread,
  sanitizeTitle,
  sanitizeUnixTimestamp,
  validThreadId,
  validateInstalledCodexDesktop,
} = require('./codex-desktop-adapter.cjs')

const THREAD = '019cbb00-1234-7abc-8def-0123456789ab'
const THREAD_2 = '019cbb01-1234-7abc-9def-0123456789ab'
const CREATED = 1_788_887_000
const UPDATED = 1_788_887_100

function stat({ directory = false, file = false, symlink = false, mode = 0o755 } = {}) {
  return {
    mode,
    isDirectory: () => directory,
    isFile: () => file,
    isSymbolicLink: () => symlink,
  }
}

function validPlist({ bundleId = CHATGPT_BUNDLE_ID, scheme = 'codex' } = {}) {
  return Buffer.from(`<?xml version="1.0"?><plist><dict>
    <key>CFBundleIdentifier</key><string>${bundleId}</string>
    <key>CFBundleURLTypes</key><array><dict>
      <key>CFBundleURLName</key><string>Codex</string>
      <key>CFBundleURLSchemes</key><array><string>${scheme}</string></array>
    </dict></array>
  </dict></plist>`)
}

function fakeChild(setup = () => {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = new EventEmitter()
  child.stdin.writes = []
  child.stdin.write = (value) => { child.stdin.writes.push(value); return true }
  child.signals = []
  child.kill = (signal) => {
    child.signals.push(signal)
    queueMicrotask(() => child.emit('close', null, signal))
    return true
  }
  queueMicrotask(() => setup(child))
  return child
}

function rawThread(overrides = {}) {
  return {
    id: THREAD,
    name: 'Research agent board workflows',
    preview: 'fallback preview',
    cwd: '/Users/example/work louder board',
    createdAt: CREATED,
    updatedAt: UPDATED,
    path: '/private/thread.jsonl',
    status: { type: 'notLoaded' },
    ...overrides,
  }
}

test('pins the installed OpenAI bundle, bundled CLI, and URL dispatcher', () => {
  assert.equal(CHATGPT_BUNDLE_PATH, '/Applications/ChatGPT.app')
  assert.equal(CHATGPT_BUNDLE_ID, 'com.openai.codex')
  assert.equal(CODEX_CLI_PATH, '/Applications/ChatGPT.app/Contents/Resources/codex')
  assert.equal(OPEN_PATH, '/usr/bin/open')
})

test('accepts only a non-symlink OpenAI bundle with an executable bundled CLI and codex URL scheme', () => {
  const lstatImpl = (target) => target === CHATGPT_BUNDLE_PATH
    ? stat({ directory: true })
    : stat({ file: true, mode: 0o755 })
  const valid = validateInstalledCodexDesktop({ lstatImpl, readFileImpl: () => validPlist() })
  assert.deepEqual(valid, { ok: true, code: 'ok', cliPath: CODEX_CLI_PATH })

  assert.equal(validateInstalledCodexDesktop({
    lstatImpl: (target) => target === CHATGPT_BUNDLE_PATH ? stat({ directory: true, symlink: true }) : stat({ file: true }),
    readFileImpl: () => validPlist(),
  }).code, 'bundle_identity_invalid')
  assert.equal(validateInstalledCodexDesktop({ lstatImpl, readFileImpl: () => validPlist({ bundleId: 'example.fake' }) }).code, 'bundle_identity_invalid')
  assert.equal(validateInstalledCodexDesktop({ lstatImpl, readFileImpl: () => validPlist({ scheme: 'fake' }) }).code, 'bundle_identity_invalid')
  assert.equal(validateInstalledCodexDesktop({
    lstatImpl: (target) => target === CHATGPT_BUNDLE_PATH ? stat({ directory: true }) : stat({ file: true, mode: 0o644 }),
    readFileImpl: () => validPlist(),
  }).code, 'bundled_cli_identity_invalid')
  assert.equal(validateInstalledCodexDesktop({ lstatImpl: () => { throw new Error('missing') } }).code, 'codex_desktop_unavailable')
})

test('strictly sanitizes thread identity, title, cwd, and timestamps without projecting private protocol fields', () => {
  assert.equal(validThreadId(THREAD), true)
  assert.equal(validThreadId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), false)
  assert.equal(validThreadId('019cbb00-1234-7abc-0def-0123456789ab'), false)
  assert.equal(sanitizeTitle(' Hello\u0000\n world \u202e bad ', ''), 'Hello world bad')
  assert.equal(Array.from(sanitizeTitle('x'.repeat(200), '')).length, 160)
  assert.equal(sanitizeTitle('', 'private preview title'), 'Untitled Codex task')
  assert.equal(sanitizeTitle(null, 'private preview title'), 'Untitled Codex task')
  assert.equal(sanitizeCwd('/Users/example/project'), '/Users/example/project')
  assert.equal(sanitizeCwd('/Users/example/project/'), '/Users/example/project')
  assert.equal(sanitizeCwd('relative/project'), null)
  assert.equal(sanitizeCwd('/Users/example/../secret'), null)
  assert.equal(sanitizeCwd('/Users/example/evil\u0000path'), null)
  assert.equal(sanitizeUnixTimestamp('123'), null)
  assert.equal(sanitizeUnixTimestamp(-1), null)

  const sanitized = sanitizeThread(rawThread())
  assert.deepEqual(sanitized, {
    threadId: THREAD,
    title: 'Research agent board workflows',
    cwd: '/Users/example/work louder board',
    createdAt: new Date(CREATED * 1_000).toISOString(),
    updatedAt: new Date(UPDATED * 1_000).toISOString(),
  })
  assert.equal(Object.hasOwn(sanitized, 'path'), false)
  assert.equal(Object.hasOwn(sanitized, 'preview'), false)
  assert.equal(Object.hasOwn(sanitized, 'status'), false)
  assert.equal(sanitizeThread(rawThread({ id: 'bad' })), null)
  assert.equal(sanitizeThread(rawThread({ updatedAt: CREATED - 1 })), null)
})

test('app-server runner uses the fixed binary, no shell, and only initialize plus bounded read-only thread/list', async () => {
  let invocation
  const runner = createAppServerRunner({ spawnImpl: (executable, args, options) => {
    invocation = { executable, args, options }
    return fakeChild((child) => {
      child.stdout.emit('data', `${JSON.stringify({ id: 1, result: { userAgent: 'codex' } })}\n`)
      child.stdout.emit('data', `${JSON.stringify({ method: 'unrelated/notification', params: {} })}\n`)
      child.stdout.emit('data', `${JSON.stringify({ id: 2, result: { data: [rawThread()] } })}\n`)
    })
  } })
  const result = await runner.list(6)
  assert.equal(result.ok, true)
  assert.deepEqual(result.threads, [rawThread()])
  assert.equal(invocation.executable, CODEX_CLI_PATH)
  assert.deepEqual(invocation.args, ['app-server', '--stdio'])
  assert.equal(invocation.options.shell, false)
  assert.deepEqual(invocation.options.stdio, ['pipe', 'pipe', 'pipe'])
})

test('runner request body fixes list ordering, archive state, state-db-only behavior, and page bound', async () => {
  let childRef
  const runner = createAppServerRunner({ spawnImpl: () => {
    childRef = fakeChild((child) => {
      const requests = child.stdin.writes.join('').trim().split('\n').map(JSON.parse)
      assert.deepEqual(requests.map(({ id, method }) => ({ id, method })), [
        { id: 1, method: 'initialize' },
        { id: 2, method: 'thread/list' },
      ])
      assert.deepEqual(requests[1].params, {
        archived: false,
        limit: 6,
        sortKey: 'updated_at',
        sortDirection: 'desc',
        useStateDbOnly: true,
      })
      child.stdout.emit('data', `${JSON.stringify({ id: 1, result: {} })}\n${JSON.stringify({ id: 2, result: { data: [] } })}\n`)
    })
    return childRef
  } })
  assert.deepEqual(await runner.list(6), { ok: true, code: 'ok', threads: [] })
  assert.deepEqual(await runner.list(0), { ok: false, code: 'limit_invalid' })
  assert.deepEqual(await runner.list(25), { ok: false, code: 'limit_invalid' })
})

test('runner rejects malformed, out-of-order, duplicate, error, oversized, and incomplete responses', async () => {
  const cases = [
    ['not json\n', 'protocol_malformed'],
    [`${JSON.stringify({ id: 2, result: { data: [] } })}\n`, 'response_order_invalid'],
    [`${JSON.stringify({ id: 9, result: {} })}\n`, 'response_id_invalid'],
    [`${JSON.stringify({ id: 1, error: { message: 'secret' } })}\n`, 'app_server_error'],
    [`${JSON.stringify({ id: 1, result: {} })}\n${JSON.stringify({ id: 1, result: {} })}\n`, 'response_order_invalid'],
    [`${JSON.stringify({ id: 1, result: {} })}\n${JSON.stringify({ id: 2, result: { data: Array(7).fill(rawThread()) } })}\n`, 'thread_list_invalid'],
  ]
  for (const [output, code] of cases) {
    const runner = createAppServerRunner({ spawnImpl: () => fakeChild((child) => child.stdout.emit('data', output)) })
    assert.deepEqual(await runner.list(6), { ok: false, code })
  }

  const oversized = createAppServerRunner({ maxOutputBytes: 10, spawnImpl: () => fakeChild((child) => child.stdout.emit('data', 'x'.repeat(11))) })
  assert.deepEqual(await oversized.list(), { ok: false, code: 'output_too_large' })

  const incomplete = createAppServerRunner({ spawnImpl: () => fakeChild((child) => child.emit('close', 0)) })
  assert.deepEqual(await incomplete.list(), { ok: false, code: 'response_incomplete' })
})

test('runner kills a timed-out child and never returns stderr content', async () => {
  let childRef
  const runner = createAppServerRunner({ timeoutMs: 5, spawnImpl: () => {
    childRef = fakeChild((child) => child.stderr.emit('data', 'sensitive local detail'))
    return childRef
  } })
  assert.deepEqual(await runner.list(), { ok: false, code: 'timeout' })
  assert.deepEqual(childRef.signals, ['SIGTERM'])
})

test('runner settles on a final fixed deadline when a child ignores TERM and KILL', async () => {
  let childRef
  const runner = createAppServerRunner({
    timeoutMs: 5,
    terminationGraceMs: 5,
    terminationSettleMs: 5,
    spawnImpl: () => {
      childRef = fakeChild()
      childRef.kill = (signal) => { childRef.signals.push(signal); return false }
      return childRef
    },
  })
  assert.deepEqual(await runner.list(), { ok: false, code: 'timeout' })
  assert.deepEqual(childRef.signals, ['SIGTERM', 'SIGKILL'])
})

test('a valid response is not accepted when app-server termination cannot be confirmed', async () => {
  const runner = createAppServerRunner({
    terminationGraceMs: 5,
    terminationSettleMs: 5,
    spawnImpl: () => {
      const child = fakeChild((candidate) => {
        candidate.stdout.emit('data', `${JSON.stringify({ id: 1, result: {} })}\n${JSON.stringify({ id: 2, result: { data: [] } })}\n`)
      })
      child.kill = (signal) => { child.signals.push(signal); return false }
      return child
    },
  })
  assert.deepEqual(await runner.list(), { ok: false, code: 'termination_unconfirmed' })
})

test('deep-link opener dispatches only validated thread ids through fixed open argv and makes no exact-focus claim', async () => {
  let invocation
  const opener = createDeepLinkOpener({ spawnImpl: (executable, args, options) => {
    invocation = { executable, args, options }
    return fakeChild((child) => child.emit('close', 0))
  } })
  assert.deepEqual(await opener(THREAD.toUpperCase()), {
    ok: true,
    dispatched: true,
    exact: false,
    reason: 'deep_link_dispatched_unverified',
  })
  assert.equal(invocation.executable, OPEN_PATH)
  assert.deepEqual(invocation.args, ['-b', CHATGPT_BUNDLE_ID, `codex://threads/${THREAD}`])
  assert.equal(invocation.options.shell, false)
  assert.equal(invocation.options.stdio, 'ignore')
  assert.deepEqual(await opener('bad;open https://example.com'), {
    ok: false,
    dispatched: false,
    exact: false,
    reason: 'thread_id_invalid',
  })
})

test('adapter validates installation, rejects any malformed task batch, and dispatches sanitized tasks', async () => {
  const opened = []
  const adapter = createCodexDesktopAdapter({
    validateInstallation: () => ({ ok: true }),
    runner: { list: async () => ({ ok: true, threads: [rawThread(), rawThread({ id: THREAD_2, name: null, preview: 'Second task' })] }) },
    openThread: async (id) => { opened.push(id); return { ok: true, dispatched: true, exact: false, reason: 'deep_link_dispatched_unverified' } },
  })
  const listed = await adapter.listRecentTasks(6)
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.tasks.map(({ threadId, title }) => ({ threadId, title })), [
    { threadId: THREAD, title: 'Research agent board workflows' },
    { threadId: THREAD_2, title: 'Untitled Codex task' },
  ])
  assert.equal((await adapter.focusTask(listed.tasks[1])).exact, false)
  assert.deepEqual(opened, [THREAD_2])

  const malformed = createCodexDesktopAdapter({
    validateInstallation: () => ({ ok: true }),
    runner: { list: async () => ({ ok: true, threads: [rawThread(), rawThread({ cwd: 'relative' })] }) },
  })
  assert.deepEqual(await malformed.listRecentTasks(), { ok: false, code: 'thread_list_invalid', tasks: [] })

  const unavailable = createCodexDesktopAdapter({ validateInstallation: () => ({ ok: false, code: 'codex_desktop_unavailable' }) })
  assert.deepEqual(await unavailable.listRecentTasks(), { ok: false, code: 'codex_desktop_unavailable', tasks: [] })
  assert.equal((await unavailable.focusTask(THREAD)).reason, 'codex_desktop_unavailable')
})
