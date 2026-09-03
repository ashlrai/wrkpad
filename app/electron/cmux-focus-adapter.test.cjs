const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  AUTHORIZATION_MAX_AGE_MS,
  CMUX_AUTHORIZATION_SCHEMA,
  CMUX_CLI_PATH,
  CMUX_LOCATOR_SCHEMA,
  LOCATOR_MAX_AGE_MS,
  commandArgs,
  createCmuxCliRunner,
  createCmuxFocusAdapter,
  identifyMatches,
  inspectSocketIdentity,
  parseCapabilities,
  parseVersion,
  sameSocketIdentity,
  validateAuthorization,
  validateLocator,
} = require('./cmux-focus-adapter.cjs')

const NOW = new Date('2026-09-03T18:00:00.000Z')
const WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SURFACE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SOCKET = '/tmp/cmux-test.sock'
const SOCKET_IDENTITY = Object.freeze({ device: '1', inode: '2', uid: '501' })
const LOCATOR = {
  schema: CMUX_LOCATOR_SCHEMA,
  provider: 'claude',
  sessionBinding: `hmac-sha256:${'c'.repeat(64)}`,
  workspaceId: WORKSPACE,
  surfaceId: SURFACE,
  capturedAt: NOW.toISOString(),
}
const HELP = 'capabilities\nidentify\nselect-workspace\nfocus-panel\n'
const CAPABILITIES = JSON.stringify({ protocol: 'cmux-socket', socket_path: SOCKET, access_mode: 'password', methods: ['system.identify', 'workspace.select', 'surface.focus'] })
const IDENTIFY = JSON.stringify({
  socket_path: SOCKET,
  bundle_identifier: 'com.cmuxterm.app',
  app_bundle_path: '/Applications/cmux.app',
  app_executable_path: '/Applications/cmux.app/Contents/MacOS/cmux',
  app_cli_path: CMUX_CLI_PATH,
  caller: { workspace_id: WORKSPACE, surface_id: SURFACE },
})

function authorization(id = '1'.repeat(32), overrides = {}) {
  return {
    schema: CMUX_AUTHORIZATION_SCHEMA,
    decision: 'allow_once',
    provider: 'claude',
    authorizationId: id,
    sessionBinding: LOCATOR.sessionBinding,
    issuedAt: NOW.toISOString(),
    ...overrides,
  }
}

function adapterOptions(options = {}) {
  return { now: () => NOW, inspectSocket: () => SOCKET_IDENTITY, ...options }
}

function sequenceRunner(sequence, calls = []) {
  return {
    invoke: async (command, locator, socketPath) => {
      calls.push({ command, locator, socketPath })
      const next = sequence.shift()
      assert.equal(next.command, command)
      return next.result
    },
  }
}

function successfulSequence() {
  return [
    { command: 'version', result: { ok: true, output: 'cmux 0.62.2 (77) [6c203b514]' } },
    { command: 'help', result: { ok: true, output: HELP } },
    { command: 'capabilities', result: { ok: true, output: CAPABILITIES } },
    { command: 'identify', result: { ok: true, output: IDENTIFY } },
    { command: 'select_workspace', result: { ok: true, output: '' } },
    { command: 'focus_surface', result: { ok: true, output: '' } },
  ]
}

test('pins the bundle CLI and cannot construct terminal read or write commands', () => {
  assert.equal(CMUX_CLI_PATH, '/Applications/cmux.app/Contents/Resources/bin/cmux')
  assert.deepEqual(commandArgs('capabilities', LOCATOR), ['--json', 'capabilities'])
  assert.deepEqual(commandArgs('identify', LOCATOR, SOCKET), ['--socket', SOCKET, '--json', '--id-format', 'uuids', 'identify', '--workspace', WORKSPACE, '--surface', SURFACE])
  for (const command of ['send', 'send-key', 'read-screen', 'capture-pane', 'paste-buffer', 'terminal']) {
    assert.equal(commandArgs(command, LOCATOR), null)
  }
  assert.equal(commandArgs('identify', null), null)
  assert.equal(commandArgs('focus_surface', { workspaceId: WORKSPACE, surfaceId: 'surface:2' }, SOCKET), null)
  assert.equal(commandArgs('focus_surface', LOCATOR, 'relative.sock'), null)
})

test('validates the version, capability, and echoed identity contracts', () => {
  assert.deepEqual(parseVersion('cmux 0.62.2 (77) [6c203b514]'), { major: 0, minor: 62, patch: 2, build: 77, revision: '6c203b514', supported: true, text: '0.62.2' })
  assert.equal(parseVersion('cmux 0.61.9 (1) [abcdef0]').supported, false)
  assert.equal(parseVersion('cmux 0.63.0 (1) [abcdef0]').supported, false)
  assert.equal(parseVersion('cmux latest'), null)
  assert.equal(parseCapabilities(CAPABILITIES).required, true)
  assert.equal(parseCapabilities(JSON.stringify({ protocol: 'cmux-socket', socket_path: SOCKET, access_mode: 'password', methods: ['system.identify'] })).required, false)
  assert.equal(parseCapabilities(JSON.stringify({ protocol: 'unexpected', socket_path: SOCKET, access_mode: 'password', methods: ['system.identify'] })), null)
  assert.equal(parseCapabilities(JSON.stringify({ protocol: 'cmux-socket', socket_path: 'relative.sock', access_mode: 'password', methods: ['system.identify'] })), null)
  assert.equal(parseCapabilities(JSON.stringify({ protocol: 'cmux-socket', socket_path: SOCKET, access_mode: 'unknown', methods: ['system.identify'] })), null)
  assert.equal(parseCapabilities('{bad'), null)
  assert.equal(identifyMatches(IDENTIFY, LOCATOR, SOCKET), true)
  assert.equal(identifyMatches(JSON.stringify({ ...JSON.parse(IDENTIFY), bundle_identifier: 'org.example.fake' }), LOCATOR, SOCKET), false)
  assert.equal(identifyMatches(JSON.stringify({ socket_path: SOCKET, caller: { workspace_id: WORKSPACE, surface_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } }), LOCATOR, SOCKET), false)
  assert.equal(identifyMatches(JSON.stringify({ socket_path: '/tmp/different.sock', caller: { workspace_id: WORKSPACE, surface_id: SURFACE } }), LOCATOR, SOCKET), false)
  assert.equal(identifyMatches(JSON.stringify({ socket_path: SOCKET, focused: { workspace_id: WORKSPACE, surface_id: SURFACE } }), LOCATOR, SOCKET), false)
})

test('admits only a same-user Unix socket and compares its device and inode', () => {
  const socketStat = { dev: 1n, ino: 2n, uid: 501n, isSocket: () => true }
  assert.deepEqual(inspectSocketIdentity(SOCKET, { statImpl: () => socketStat, expectedUid: 501n }), SOCKET_IDENTITY)
  assert.equal(inspectSocketIdentity(SOCKET, { statImpl: () => ({ ...socketStat, uid: 502n }), expectedUid: 501n }), null)
  assert.equal(inspectSocketIdentity(SOCKET, { statImpl: () => ({ ...socketStat, isSocket: () => false }), expectedUid: 501n }), null)
  assert.equal(inspectSocketIdentity(SOCKET, { statImpl: () => { throw new Error('missing') }, expectedUid: 501n }), null)
  assert.equal(sameSocketIdentity(SOCKET_IDENTITY, { ...SOCKET_IDENTITY }), true)
  assert.equal(sameSocketIdentity(SOCKET_IDENTITY, { ...SOCKET_IDENTITY, inode: '3' }), false)
})

test('rejects malformed, cross-provider, cross-session, future, and stale locators', () => {
  assert.equal(validateLocator(null, NOW).code, 'locator_unavailable')
  assert.equal(validateLocator({ ...LOCATOR, schema: 'v2' }, NOW, LOCATOR.sessionBinding).code, 'locator_schema_unsupported')
  assert.equal(validateLocator({ ...LOCATOR, provider: 'codex' }, NOW, LOCATOR.sessionBinding).code, 'locator_provider_mismatch')
  assert.equal(validateLocator({ ...LOCATOR, sessionBinding: 'raw-session' }, NOW, LOCATOR.sessionBinding).code, 'locator_binding_invalid')
  assert.equal(validateLocator(LOCATOR, NOW).code, 'locator_binding_unverified')
  assert.equal(validateLocator(LOCATOR, NOW, `hmac-sha256:${'d'.repeat(64)}`).code, 'locator_binding_mismatch')
  assert.equal(validateLocator({ ...LOCATOR, surfaceId: 'surface:2' }, NOW, LOCATOR.sessionBinding).code, 'locator_id_invalid')
  assert.equal(validateLocator({ ...LOCATOR, capturedAt: 'invalid' }, NOW, LOCATOR.sessionBinding).code, 'locator_time_invalid')
  assert.equal(validateLocator({ ...LOCATOR, capturedAt: new Date(NOW.getTime() + 5_001).toISOString() }, NOW, LOCATOR.sessionBinding).code, 'locator_stale')
  assert.equal(validateLocator({ ...LOCATOR, capturedAt: new Date(NOW.getTime() - LOCATOR_MAX_AGE_MS - 1).toISOString() }, NOW, LOCATOR.sessionBinding).code, 'locator_stale')
  assert.equal(validateLocator(LOCATOR, NOW, LOCATOR.sessionBinding).ok, true)
})

test('requires a fresh one-use human authorization before any cmux probe', async () => {
  assert.equal(validateAuthorization(null, NOW).code, 'exact_focus_not_authorized')
  assert.equal(validateAuthorization(authorization('2'.repeat(32), { decision: 'always' }), NOW).code, 'authorization_invalid')
  assert.equal(validateAuthorization(authorization('3'.repeat(32), { issuedAt: new Date(NOW.getTime() - AUTHORIZATION_MAX_AGE_MS - 1).toISOString() }), NOW).code, 'authorization_expired')
  assert.equal(validateAuthorization(authorization(), NOW).ok, true)

  let invoked = false
  const adapter = createCmuxFocusAdapter({
    runner: { invoke: async () => { invoked = true; return { ok: false } } },
    foreground: async () => true,
    now: () => NOW,
  })
  assert.deepEqual(await adapter.focus(LOCATOR), { ok: true, opened: true, exact: false, reason: 'exact_focus_not_authorized' })
  assert.deepEqual(await adapter.focus(null, authorization('4'.repeat(32))), { ok: true, opened: true, exact: false, reason: 'locator_unavailable' })
  assert.deepEqual(await adapter.focus(LOCATOR, authorization('4'.repeat(32))), { ok: true, opened: true, exact: false, reason: 'authorization_replayed' })
  assert.equal(invoked, false)
})

test('preserves outside-process access denial and malformed capability output', async () => {
  for (const [result, reason] of [
    [{ ok: false, code: 'access_denied' }, 'access_denied'],
    [{ ok: true, output: '{bad' }, 'capabilities_malformed'],
    [{ ok: true, output: JSON.stringify({ protocol: 'cmux-socket', socket_path: SOCKET, access_mode: 'password', methods: ['system.identify'] }) }, 'capabilities_incomplete'],
    [{ ok: true, output: JSON.stringify({ protocol: 'cmux-socket', socket_path: SOCKET, access_mode: 'allowAll', methods: ['system.identify', 'workspace.select', 'surface.focus'] }) }, 'access_mode_not_authorized'],
  ]) {
    const sequence = successfulSequence().slice(0, 2)
    sequence.push({ command: 'capabilities', result })
    const calls = []
    const adapter = createCmuxFocusAdapter(adapterOptions({ runner: sequenceRunner(sequence, calls), foreground: async () => true }))
    assert.equal((await adapter.focus(LOCATOR, authorization())).reason, reason)
    assert.deepEqual(calls.map(({ command }) => command), ['version', 'help', 'capabilities'])
  }
})

test('denies unsupported versions, incomplete help, timeouts, and locator mismatch', async () => {
  const cases = [
    [[{ command: 'version', result: { ok: true, output: 'cmux 0.61.9 (1) [abcdef0]' } }], 'version_unsupported'],
    [[{ command: 'version', result: { ok: true, output: 'not a version' } }], 'version_malformed'],
    [[{ command: 'version', result: { ok: false, code: 'timeout' } }], 'timeout'],
    [[...successfulSequence().slice(0, 1), { command: 'help', result: { ok: true, output: 'identify only' } }], 'command_surface_incomplete'],
    [[...successfulSequence().slice(0, 3), { command: 'identify', result: { ok: true, output: JSON.stringify({ caller: { workspace_id: WORKSPACE, surface_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' } }) } }], 'locator_mismatch'],
    [[...successfulSequence().slice(0, 3), { command: 'identify', result: { ok: true, output: JSON.stringify({ socket_path: '/tmp/replaced.sock', caller: { workspace_id: WORKSPACE, surface_id: SURFACE } }) } }], 'locator_mismatch'],
  ]
  for (const [sequence, reason] of cases) {
    const adapter = createCmuxFocusAdapter(adapterOptions({ runner: sequenceRunner(sequence), foreground: async () => true }))
    assert.equal((await adapter.focus(LOCATOR, authorization())).reason, reason)
  }
})

test('focuses only after fresh identity validation and foregrounding', async () => {
  const calls = []
  let foregroundedAt = 0
  const adapter = createCmuxFocusAdapter({
    runner: sequenceRunner(successfulSequence(), calls),
    foreground: async () => { foregroundedAt = calls.length; return true },
    now: () => NOW,
    inspectSocket: () => SOCKET_IDENTITY,
  })
  assert.deepEqual(await adapter.focus(LOCATOR, authorization()), { ok: true, opened: true, exact: true, reason: 'focus_cli_accepted', version: '0.62.2' })
  assert.equal(foregroundedAt, 4)
  assert.deepEqual(calls.map(({ command }) => command), ['version', 'help', 'capabilities', 'identify', 'select_workspace', 'focus_surface'])
  assert.deepEqual(calls.map(({ socketPath }) => socketPath), [undefined, undefined, undefined, SOCKET, SOCKET, SOCKET])
})

test('keeps app foregrounding as the fallback when either focus command fails', async () => {
  for (const failedCommand of ['select_workspace', 'focus_surface']) {
    const sequence = successfulSequence()
    const item = sequence.find(({ command }) => command === failedCommand)
    item.result = { ok: false, code: 'command_failed' }
    if (failedCommand === 'select_workspace') sequence.pop()
    let foregroundCount = 0
    const calls = []
    const adapter = createCmuxFocusAdapter(adapterOptions({ runner: sequenceRunner(sequence, calls), foreground: async () => { foregroundCount += 1; return true } }))
    assert.deepEqual(await adapter.focus(LOCATOR, authorization()), { ok: true, opened: true, exact: false, reason: 'command_failed' })
    assert.equal(foregroundCount, 1)
    if (failedCommand === 'select_workspace') assert.equal(calls.some(({ command }) => command === 'focus_surface'), false)
  }
})

test('fails exact focus when the admitted socket instance changes', async () => {
  let inspections = 0
  const adapter = createCmuxFocusAdapter({
    runner: sequenceRunner(successfulSequence().slice(0, 4)),
    foreground: async () => true,
    now: () => NOW,
    inspectSocket: () => {
      inspections += 1
      return inspections === 1 ? SOCKET_IDENTITY : { ...SOCKET_IDENTITY, inode: '99' }
    },
  })
  assert.deepEqual(await adapter.focus(LOCATOR, authorization()), { ok: true, opened: true, exact: false, reason: 'socket_identity_changed' })
})

function fakeChild(setup) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.signals = []
  child.kill = (signal) => { child.signals.push(signal); return true }
  queueMicrotask(() => setup(child))
  return child
}

test('bounded runner uses only the fixed path and reports denial without raw output', async () => {
  let invocation
  const runner = createCmuxCliRunner({ spawnImpl: (executable, args, options) => {
    invocation = { executable, args, options }
    return fakeChild((child) => { child.stderr.emit('data', 'ERROR: Access denied — secret detail'); child.emit('close', 1) })
  } })
  assert.deepEqual(await runner.invoke('capabilities', LOCATOR), { ok: false, code: 'access_denied' })
  assert.equal(invocation.executable, CMUX_CLI_PATH)
  assert.deepEqual(invocation.args, ['--json', 'capabilities'])
  assert.equal(Object.hasOwn(invocation.options.env, 'CMUX_SOCKET_PASSWORD'), false)
  assert.equal(JSON.stringify(invocation).includes('secret detail'), false)
  assert.deepEqual(await runner.invoke('send', LOCATOR), { ok: false, code: 'forbidden_command' })
  assert.deepEqual(await runner.invoke('identify', null), { ok: false, code: 'forbidden_command' })
})

test('bounded runner kills timeout and oversized output without returning content', async () => {
  let timeoutChild
  const timeoutRunner = createCmuxCliRunner({ timeoutMs: 5, spawnImpl: () => {
    timeoutChild = fakeChild(() => {})
    timeoutChild.kill = (signal) => { timeoutChild.signals.push(signal); queueMicrotask(() => timeoutChild.emit('close', null, signal)); return true }
    return timeoutChild
  } })
  assert.deepEqual(await timeoutRunner.invoke('version', LOCATOR), { ok: false, code: 'timeout' })
  assert.deepEqual(timeoutChild.signals, ['SIGTERM'])

  let outputChild
  const outputRunner = createCmuxCliRunner({ maxOutputBytes: 8, spawnImpl: () => {
    outputChild = fakeChild((child) => child.stdout.emit('data', 'private-output'))
    outputChild.kill = (signal) => { outputChild.signals.push(signal); queueMicrotask(() => outputChild.emit('close', null, signal)); return true }
    return outputChild
  } })
  assert.deepEqual(await outputRunner.invoke('version', LOCATOR), { ok: false, code: 'output_too_large' })
  assert.deepEqual(outputChild.signals, ['SIGTERM'])
})

test('bounded runner escalates termination and does not settle before process close', async () => {
  let child
  let settled = false
  const runner = createCmuxCliRunner({ timeoutMs: 5, terminationGraceMs: 5, spawnImpl: () => {
    child = fakeChild(() => {})
    return child
  } })
  const pending = runner.invoke('version', LOCATOR).then((result) => {
    settled = true
    return result
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(settled, false)
  child.emit('error', new Error('kill failed'))
  assert.equal(settled, false)
  child.emit('close', null, 'SIGKILL')
  assert.deepEqual(await pending, { ok: false, code: 'timeout' })
})
