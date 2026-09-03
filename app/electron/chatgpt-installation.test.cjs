const test = require('node:test')
const assert = require('node:assert/strict')
const {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs')
const fs = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const {
  CHATGPT_INFO_PLIST_PATH,
  MAX_COMMAND_OUTPUT_BYTES,
  PLUTIL_PATH,
  PROBE_TIMEOUT_MS,
  inspectChatGptInstallation,
  inspectChatGptInstallationAsync,
  runFixed,
  runFixedAsync,
  sanitizeMetadata,
} = require('./chatgpt-installation.cjs')

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'chatgpt-installation-'))
  const applications = path.join(root, 'Applications')
  const application = path.join(applications, 'ChatGPT.app')
  const contents = path.join(application, 'Contents')
  const plist = path.join(contents, 'Info.plist')
  mkdirSync(contents, { recursive: true })
  writeFileSync(plist, 'fixture')

  const map = (target) => target === '/'
    ? root
    : path.join(root, target.slice(1))
  return {
    root,
    applications,
    application,
    contents,
    plist,
    filesystem: {
      lstatSync(target, options) {
        return fs.lstatSync(map(target), options)
      },
    },
  }
}

function metadataRunner(calls = [], overrides = {}) {
  return (executable, args, options) => {
    calls.push({ executable, args, options })
    const key = args[1]
    return overrides[key] ?? {
      status: 0,
      stdout: key === 'CFBundleShortVersionString' ? '26.818.61809\n' : '17600\n',
      stderr: '',
    }
  }
}

test('reads only the two exact bounded ChatGPT bundle values with fixed plutil argv', () => {
  const files = fixture()
  const calls = []
  try {
    assert.deepEqual(inspectChatGptInstallation({
      filesystem: files.filesystem,
      runner: metadataRunner(calls),
    }), {
      installed: true,
      version: '26.818.61809',
      build: '17600',
      status: 'installed',
    })
    assert.deepEqual(calls.map(({ executable, args }) => ({ executable, args })), [
      {
        executable: PLUTIL_PATH,
        args: ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', CHATGPT_INFO_PLIST_PATH],
      },
      {
        executable: PLUTIL_PATH,
        args: ['-extract', 'CFBundleVersion', 'raw', '-o', '-', CHATGPT_INFO_PLIST_PATH],
      },
    ])
    assert.ok(calls.every(({ options }) => options.timeout === PROBE_TIMEOUT_MS))
    assert.ok(calls.every(({ options }) => options.maxBuffer === MAX_COMMAND_OUTPUT_BYTES))
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('async inspection preserves the fixed contract under one aggregate deadline', async () => {
  const files = fixture()
  const calls = []
  try {
    assert.deepEqual(await inspectChatGptInstallationAsync({
      filesystem: files.filesystem,
      runner: metadataRunner(calls),
    }), {
      installed: true,
      version: '26.818.61809',
      build: '17600',
      status: 'installed',
    })
    assert.equal(calls.length, 2)
    assert.ok(calls.every(({ options }) => options.timeout > 0 && options.timeout <= PROBE_TIMEOUT_MS))
    assert.ok(calls[1].options.timeout <= calls[0].options.timeout)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('reports a missing fixed application without invoking a runner', () => {
  const files = fixture()
  let called = false
  try {
    rmSync(files.application, { recursive: true, force: true })
    assert.deepEqual(inspectChatGptInstallation({
      filesystem: files.filesystem,
      runner() {
        called = true
      },
    }), {
      installed: false,
      version: null,
      build: null,
      status: 'missing',
    })
    assert.equal(called, false)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('keeps installation presence while failing closed on missing bundle metadata', () => {
  const files = fixture()
  try {
    rmSync(files.plist)
    assert.deepEqual(inspectChatGptInstallation({ filesystem: files.filesystem }), {
      installed: true,
      version: null,
      build: null,
      status: 'probe_unavailable',
    })
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('rejects symlinked and non-directory fixed ancestors without probing metadata', (t) => {
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')
  for (const targetName of ['Applications', 'ChatGPT.app', 'Contents']) {
    const files = fixture()
    let called = false
    try {
      const target = targetName === 'Applications'
        ? files.applications
        : targetName === 'ChatGPT.app' ? files.application : files.contents
      const external = path.join(files.root, `private-${targetName}`)
      mkdirSync(external)
      rmSync(target, { recursive: true, force: true })
      symlinkSync(external, target)
      const inspected = inspectChatGptInstallation({
        filesystem: files.filesystem,
        runner() {
          called = true
        },
      })
      assert.equal(inspected.status, 'unsafe')
      assert.equal(JSON.stringify(inspected).includes(files.root), false)
      assert.equal(JSON.stringify(inspected).includes('private-'), false)
      assert.equal(called, false)
    } finally {
      rmSync(files.root, { recursive: true, force: true })
    }
  }

  const files = fixture()
  try {
    rmSync(files.contents, { recursive: true, force: true })
    writeFileSync(files.contents, 'not a directory')
    assert.equal(inspectChatGptInstallation({ filesystem: files.filesystem }).status, 'unsafe')
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('rejects a symlinked or non-regular Info.plist', (t) => {
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')
  const files = fixture()
  try {
    const external = path.join(files.root, 'private.plist')
    writeFileSync(external, 'secret')
    rmSync(files.plist)
    symlinkSync(external, files.plist)
    assert.deepEqual(inspectChatGptInstallation({ filesystem: files.filesystem }), {
      installed: true,
      version: null,
      build: null,
      status: 'unsafe',
    })
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('fails closed on malformed, multiline, or oversized metadata without returning raw output', () => {
  const unsafeValues = [
    '26.818 private\n',
    '26.818\n/private/secret\n',
    'x'.repeat(65),
    '\u202e26.818\n',
    'x'.repeat(MAX_COMMAND_OUTPUT_BYTES + 1),
  ]
  for (const unsafeValue of unsafeValues) {
    const files = fixture()
    try {
      const inspected = inspectChatGptInstallation({
        filesystem: files.filesystem,
        runner: metadataRunner([], {
          CFBundleShortVersionString: { status: 0, stdout: unsafeValue, stderr: '' },
        }),
      })
      assert.deepEqual(inspected, {
        installed: true,
        version: null,
        build: null,
        status: unsafeValue.length > MAX_COMMAND_OUTPUT_BYTES ? 'probe_unavailable' : 'invalid_metadata',
      })
      assert.equal(JSON.stringify(inspected).includes('secret'), false)
    } finally {
      rmSync(files.root, { recursive: true, force: true })
    }
  }
  assert.equal(sanitizeMetadata('26.818.61809\n'), '26.818.61809')
  assert.equal(sanitizeMetadata('26.818\nprivate'), null)
})

test('fails closed on runner exceptions, failures, stderr, and malformed result shapes', () => {
  const runners = [
    () => { throw new Error('/private/runner failure') },
    () => ({ status: 1, stdout: '/private/raw', stderr: 'failed' }),
    () => ({ status: 0, stdout: '26.818\n', stderr: '/private/warning' }),
    () => ({ status: 0, stdout: Buffer.from('26.818'), stderr: '' }),
  ]
  for (const runner of runners) {
    const files = fixture()
    try {
      const inspected = inspectChatGptInstallation({ filesystem: files.filesystem, runner })
      assert.equal(['probe_unavailable', 'invalid_metadata'].includes(inspected.status), true)
      assert.equal(JSON.stringify(inspected).includes('/private'), false)
    } finally {
      rmSync(files.root, { recursive: true, force: true })
    }
  }
})

test('fails closed on malformed options and filesystem results', () => {
  assert.deepEqual(inspectChatGptInstallation(null), {
    installed: false,
    version: null,
    build: null,
    status: 'probe_unavailable',
  })
  assert.deepEqual(inspectChatGptInstallation({
    filesystem: { lstatSync: () => ({}) },
  }), {
    installed: false,
    version: null,
    build: null,
    status: 'probe_unavailable',
  })
})

test('detects bundle mutation after either metadata read and returns no partial values', () => {
  for (const mutateAfterCall of [1, 2]) {
    const files = fixture()
    let callCount = 0
    try {
      const runner = metadataRunner([], new Proxy({}, {
        get(_target, key) {
          callCount += 1
          if (callCount === mutateAfterCall) {
            const replacement = `${files.plist}.replacement`
            writeFileSync(replacement, `replacement-${callCount}`)
            renameSync(replacement, files.plist)
          }
          return key === 'CFBundleShortVersionString'
            ? { status: 0, stdout: '26.818.61809\n', stderr: '' }
            : { status: 0, stdout: '17600\n', stderr: '' }
        },
      }))
      assert.deepEqual(inspectChatGptInstallation({ filesystem: files.filesystem, runner }), {
        installed: true,
        version: null,
        build: null,
        status: 'changed_during_probe',
      })
    } finally {
      rmSync(files.root, { recursive: true, force: true })
    }
  }
})

test('never accepts caller-controlled paths or executable arguments', () => {
  const files = fixture()
  const calls = []
  try {
    const inspected = inspectChatGptInstallation({
      applicationPath: '/private/ChatGPT.app',
      plistPath: '/private/Info.plist',
      executable: '/bin/sh',
      filesystem: files.filesystem,
      runner: metadataRunner(calls),
    })
    assert.equal(inspected.status, 'installed')
    assert.ok(calls.every(({ executable }) => executable === PLUTIL_PATH))
    assert.ok(calls.every(({ args }) => args.at(-1) === CHATGPT_INFO_PLIST_PATH))
    assert.equal(JSON.stringify(inspected).includes('/private'), false)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('the production runner rejects every executable or argv shape outside the fixed contract', () => {
  assert.deepEqual(runFixed('/bin/sh', ['-c', 'exit 0']), {
    status: null,
    stdout: '',
    stderr: '',
  })
  assert.deepEqual(runFixed(PLUTIL_PATH, [
    '-extract',
    'CFBundleVersion',
    'raw',
    '-o',
    '-',
    '/private/Info.plist',
  ]), {
    status: null,
    stdout: '',
    stderr: '',
  })
})

test('the async runner rejects executable and argv input outside the fixed contract', async () => {
  assert.deepEqual(await runFixedAsync('/bin/sh', ['-c', 'exit 0']), {
    status: null,
    stdout: '',
    stderr: '',
  })
  assert.deepEqual(await runFixedAsync(PLUTIL_PATH, [
    '-extract',
    'CFBundleVersion',
    'raw',
    '-o',
    '-',
    '/private/Info.plist',
  ]), {
    status: null,
    stdout: '',
    stderr: '',
  })
})
