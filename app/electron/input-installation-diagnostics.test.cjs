const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const {
  INPUT_BUNDLE_ID,
  INPUT_TEAM_ID,
  MAX_COMMAND_OUTPUT_BYTES,
  PROBE_TIMEOUT_MS,
  defaultCandidates,
  inspectInputInstallation,
  sanitizeVersion,
} = require('./input-installation-diagnostics.cjs')

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'input-installation-'))
  return {
    root,
    system: path.join(root, 'system', 'Input.app'),
    user: path.join(root, 'user', 'Input.app'),
  }
}

function createBundle(candidate) {
  mkdirSync(path.join(candidate, 'Contents'), { recursive: true })
  writeFileSync(path.join(candidate, 'Contents', 'Info.plist'), 'fixture')
}

function verifiedRunner(calls = [], overrides = {}) {
  return (executable, args, options) => {
    calls.push({ executable, args, options })
    if (overrides.throw) throw new Error('private runner failure')
    const key = `${executable} ${args.slice(0, -1).join(' ')}`
    if (overrides[key]) return overrides[key]
    if (executable === '/usr/libexec/PlistBuddy') {
      return { status: 0, stdout: args[1] === 'Print :CFBundleIdentifier' ? `${INPUT_BUNDLE_ID}\n` : '0.18.4\n', stderr: '' }
    }
    if (executable === '/usr/bin/codesign' && args[0] === '-dvvv') {
      return { status: 0, stdout: '', stderr: `Identifier=${INPUT_BUNDLE_ID}\nTeamIdentifier=${INPUT_TEAM_ID}\nprivate path /Users/example\n` }
    }
    return { status: 0, stdout: '', stderr: '' }
  }
}

test('uses only the two fixed production candidate locations', () => {
  assert.deepEqual(defaultCandidates('/Users/example'), [
    '/Applications/Input.app',
    '/Users/example/Applications/Input.app',
  ])
  assert.equal(defaultCandidates('relative'), null)
})

test('reports missing without running metadata or trust probes', () => {
  const files = fixture()
  let calls = 0
  try {
    assert.deepEqual(inspectInputInstallation({ candidates: [files.system, files.user], runner: () => { calls += 1 } }), {
      status: 'missing', version: null,
    })
    assert.equal(calls, 0)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('verifies one exact publisher bundle with bounded fixed commands', () => {
  const files = fixture()
  const calls = []
  try {
    createBundle(files.system)
    assert.deepEqual(inspectInputInstallation({ candidates: [files.system, files.user], runner: verifiedRunner(calls) }), {
      status: 'verified', version: '0.18.4',
    })
    assert.deepEqual(calls.map(({ executable, args }) => [executable, ...args.slice(0, -1)]), [
      ['/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleIdentifier'],
      ['/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleShortVersionString'],
      ['/usr/bin/codesign', '-dvvv'],
      ['/usr/bin/codesign', '--verify', '--deep', '--strict'],
      ['/usr/sbin/spctl', '--assess', '--type', 'execute'],
    ])
    assert.ok(calls.every(({ options }) => options.timeout === PROBE_TIMEOUT_MS))
    assert.doesNotMatch(JSON.stringify(inspectInputInstallation({ candidates: [files.system, files.user], runner: verifiedRunner() })), /Users|example|Input\.app/)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('accepts the fixed user-level candidate when it is the only installation', () => {
  const files = fixture()
  try {
    createBundle(files.user)
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner: verifiedRunner() }).status, 'verified')
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('rejects multiple installations before executing either bundle', () => {
  const files = fixture()
  let calls = 0
  try {
    createBundle(files.system)
    createBundle(files.user)
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner: () => { calls += 1 } }).status, 'multiple_installations')
    assert.equal(calls, 0)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('rejects symlinked and non-directory candidates as unsafe', () => {
  const files = fixture()
  try {
    const target = path.join(files.root, 'real-input')
    createBundle(target)
    mkdirSync(path.dirname(files.system), { recursive: true })
    symlinkSync(target, files.system)
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner: verifiedRunner() }).status, 'unsafe')
    rmSync(files.system)
    writeFileSync(files.system, 'not an app')
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner: verifiedRunner() }).status, 'unsafe')
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('requires exact bundle metadata and a bounded sanitized version', () => {
  const files = fixture()
  try {
    createBundle(files.system)
    const wrongBundle = verifiedRunner([], {
      '/usr/libexec/PlistBuddy -c Print :CFBundleIdentifier': { status: 0, stdout: 'example.lookalike\n', stderr: '' },
    })
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner: wrongBundle }).status, 'invalid_metadata')
    const unsafeVersion = verifiedRunner([], {
      '/usr/libexec/PlistBuddy -c Print :CFBundleShortVersionString': { status: 0, stdout: '0.18.4\nprivate', stderr: '' },
    })
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner: unsafeVersion }).status, 'invalid_metadata')
    assert.equal(sanitizeVersion('0.18.4-beta+1'), '0.18.4-beta+1')
    assert.equal(sanitizeVersion('x'.repeat(65)), null)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('distinguishes an unrecognized publisher from invalid signature integrity', () => {
  const files = fixture()
  try {
    createBundle(files.system)
    const wrongPublisher = verifiedRunner([], {
      '/usr/bin/codesign -dvvv': { status: 0, stdout: '', stderr: 'TeamIdentifier=OTHERTEAM\n' },
    })
    assert.deepEqual(inspectInputInstallation({ candidates: [files.system, files.user], runner: wrongPublisher }), {
      status: 'publisher_unrecognized', version: '0.18.4',
    })
    const invalidIdentity = verifiedRunner([], {
      '/usr/bin/codesign -dvvv': { status: 1, stdout: '', stderr: 'private signature output' },
    })
    assert.deepEqual(inspectInputInstallation({ candidates: [files.system, files.user], runner: invalidIdentity }), {
      status: 'invalid_signature', version: '0.18.4',
    })
    const invalidSeal = verifiedRunner([], {
      '/usr/bin/codesign --verify --deep --strict': { status: 1, stdout: '', stderr: 'private modified file' },
    })
    assert.deepEqual(inspectInputInstallation({ candidates: [files.system, files.user], runner: invalidSeal }), {
      status: 'invalid_signature', version: '0.18.4',
    })
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('distinguishes Gatekeeper rejection after signature verification', () => {
  const files = fixture()
  try {
    createBundle(files.system)
    const rejected = verifiedRunner([], {
      '/usr/sbin/spctl --assess --type execute': { status: 3, stdout: '', stderr: 'private assessment output' },
    })
    assert.deepEqual(inspectInputInstallation({ candidates: [files.system, files.user], runner: rejected }), {
      status: 'gatekeeper_rejected', version: '0.18.4',
    })
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('fails closed when a probe is unavailable, malformed, or over the output bound', () => {
  const files = fixture()
  try {
    createBundle(files.system)
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner: verifiedRunner([], { throw: true }) }).status, 'probe_unavailable')
    const malformed = verifiedRunner([], {
      '/usr/libexec/PlistBuddy -c Print :CFBundleIdentifier': { status: null, stdout: '', stderr: '' },
    })
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner: malformed }).status, 'probe_unavailable')
    const oversized = verifiedRunner([], {
      '/usr/bin/codesign -dvvv': { status: 0, stdout: 'x'.repeat(MAX_COMMAND_OUTPUT_BYTES + 1), stderr: '' },
    })
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner: oversized }).status, 'probe_unavailable')
    assert.equal(inspectInputInstallation({ candidates: [files.system], runner: verifiedRunner() }).status, 'probe_unavailable')
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})
