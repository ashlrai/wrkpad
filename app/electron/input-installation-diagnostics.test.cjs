const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')
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
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'input-installation-')))
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

function writeKnownHelper(candidate, contents = 'known helper fixture') {
  const helper = path.join(candidate, 'Contents', 'Resources', 'scripts', 'window-info-retriever.scpt')
  mkdirSync(path.dirname(helper), { recursive: true })
  writeFileSync(helper, contents)
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

test('uses only the two fixed official lowercase production candidate locations', () => {
  assert.deepEqual(defaultCandidates('/Users/example'), [
    '/Applications/input.app',
    '/Users/example/Applications/input.app',
  ])
  assert.equal(defaultCandidates('relative'), null)
})

test('accepts the official lowercase bundle and probes only its canonical path', () => {
  const files = fixture()
  const calls = []
  const official = path.join(files.root, 'system', 'input.app')
  try {
    createBundle(official)
    assert.deepEqual(inspectInputInstallation({ candidates: [official, files.user], runner: verifiedRunner(calls) }), {
      status: 'verified', version: '0.18.4',
    })
    assert.ok(calls.length > 0)
    const approvedTargets = new Set([official, path.join(official, 'Contents', 'Info.plist')])
    assert.ok(calls.every(({ args }) => approvedTargets.has(args.at(-1))))
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('does not case-fold unapproved bundle spellings on case-sensitive filesystems', (t) => {
  const files = fixture()
  const official = path.join(files.root, 'system', 'input.app')
  const unapproved = path.join(files.root, 'system', 'INPUT.app')
  let calls = 0
  try {
    createBundle(unapproved)
    let caseSensitive = false
    try {
      caseSensitive = realpathSync.native(official) !== realpathSync.native(unapproved)
    } catch (error) {
      caseSensitive = error?.code === 'ENOENT'
    }
    if (!caseSensitive) {
      t.skip('fixture volume is case-insensitive')
      return
    }
    assert.deepEqual(inspectInputInstallation({ candidates: [official, files.user], runner: () => { calls += 1 } }), {
      status: 'missing', version: null,
    })
    assert.equal(calls, 0)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
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
      ['/usr/bin/codesign', '--verify', '--deep', '--strict', '--verbose=1'],
      ['/usr/bin/codesign', '-dvvv'],
      ['/usr/sbin/spctl', '--assess', '--type', 'execute'],
      ['/usr/bin/codesign', '--verify', '--deep', '--strict', '--verbose=1'],
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

test('rejects a candidate reached through a symlinked ancestor as unsafe', () => {
  const files = fixture()
  let calls = 0
  try {
    const realParent = path.join(files.root, 'real-parent')
    const aliasParent = path.join(files.root, 'alias-parent')
    const realCandidate = path.join(realParent, 'Input.app')
    const aliasCandidate = path.join(aliasParent, 'Input.app')
    createBundle(realCandidate)
    symlinkSync(realParent, aliasParent)
    assert.equal(inspectInputInstallation({
      candidates: [aliasCandidate, files.user],
      runner: () => { calls += 1 },
    }).status, 'unsafe')
    assert.equal(calls, 0)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('fails closed when the bundle is swapped during any trust phase', () => {
  for (const swapCommand of [
    '/usr/libexec/PlistBuddy -c Print :CFBundleIdentifier',
    '/usr/bin/codesign -dvvv',
    '/usr/bin/codesign --verify --deep --strict --verbose=1',
    '/usr/sbin/spctl --assess --type execute',
  ]) {
    const files = fixture()
    try {
      createBundle(files.system)
      let swapped = false
      const baseRunner = verifiedRunner()
      const runner = (executable, args, options) => {
        const key = `${executable} ${args.slice(0, -1).join(' ')}`
        const output = baseRunner(executable, args, options)
        if (!swapped && key === swapCommand) {
          renameSync(files.system, `${files.system}.previous`)
          createBundle(files.system)
          swapped = true
        }
        return output
      }
      assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner }).status, 'probe_unavailable')
      assert.equal(swapped, true)
    } finally {
      rmSync(files.root, { recursive: true, force: true })
    }
  }
})

test('reconfirms the exact publisher after strict verification', () => {
  const files = fixture()
  let identities = 0
  try {
    createBundle(files.system)
    const baseRunner = verifiedRunner()
    const runner = (executable, args, options) => {
      if (executable === '/usr/bin/codesign' && args[0] === '-dvvv') {
        identities += 1
        if (identities === 2) return { status: 0, stdout: '', stderr: 'TeamIdentifier=OTHERTEAM\n' }
      }
      return baseRunner(executable, args, options)
    }
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner }).status, 'publisher_unrecognized')
    assert.equal(identities, 2)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('fails closed when tracked bundle content changes before publisher reconfirmation', () => {
  const files = fixture()
  let identities = 0
  try {
    createBundle(files.system)
    const baseRunner = verifiedRunner()
    const runner = (executable, args, options) => {
      const output = baseRunner(executable, args, options)
      if (executable === '/usr/bin/codesign' && args[0] === '-dvvv') {
        identities += 1
        if (identities === 2) writeFileSync(path.join(files.system, 'Contents', 'Info.plist'), 'mutated')
      }
      return output
    }
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner }).status, 'probe_unavailable')
    assert.equal(identities, 2)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('cannot verify when the known helper mutates immediately after the first strict check', () => {
  const files = fixture()
  let strictChecks = 0
  try {
    createBundle(files.system)
    writeKnownHelper(files.system)
    const baseRunner = verifiedRunner()
    const runner = (executable, args, options) => {
      const output = baseRunner(executable, args, options)
      if (executable === '/usr/bin/codesign' && args[0] === '--verify') {
        strictChecks += 1
        if (strictChecks === 1) writeKnownHelper(files.system, 'mutated after first strict check')
      }
      return output
    }
    const inspected = inspectInputInstallation({ candidates: [files.system, files.user], runner })
    assert.equal(inspected.status, 'probe_unavailable')
    assert.notEqual(inspected.status, 'verified')
    assert.equal(strictChecks, 1)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('cannot verify when the known helper mutates during Gatekeeper or the final strict check', () => {
  for (const mutationPhase of ['gatekeeper', 'final_signature']) {
    const files = fixture()
    let strictChecks = 0
    try {
      createBundle(files.system)
      writeKnownHelper(files.system)
      const baseRunner = verifiedRunner()
      const runner = (executable, args, options) => {
        const output = baseRunner(executable, args, options)
        if (executable === '/usr/bin/codesign' && args[0] === '--verify') {
          strictChecks += 1
          if (mutationPhase === 'final_signature' && strictChecks === 2) {
            writeKnownHelper(files.system, 'mutated during final strict check')
          }
        }
        if (mutationPhase === 'gatekeeper' && executable === '/usr/sbin/spctl') {
          writeKnownHelper(files.system, 'mutated during Gatekeeper')
        }
        return output
      }
      const inspected = inspectInputInstallation({ candidates: [files.system, files.user], runner })
      assert.equal(inspected.status, 'probe_unavailable')
      assert.notEqual(inspected.status, 'verified')
    } finally {
      rmSync(files.root, { recursive: true, force: true })
    }
  }
})

test('requires the final strict signature result after Gatekeeper', () => {
  const files = fixture()
  let strictChecks = 0
  try {
    createBundle(files.system)
    const baseRunner = verifiedRunner()
    const runner = (executable, args, options) => {
      if (executable === '/usr/bin/codesign' && args[0] === '--verify') {
        strictChecks += 1
        if (strictChecks === 2) return { status: 1, stdout: '', stderr: 'final private signature failure' }
      }
      return baseRunner(executable, args, options)
    }
    assert.deepEqual(inspectInputInstallation({ candidates: [files.system, files.user], runner }), {
      status: 'invalid_signature', version: '0.18.4',
    })
    assert.equal(strictChecks, 2)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('one monotonic deadline bounds helper retries and every subprocess timeout', () => {
  const files = fixture()
  let clock = 0
  let retries = 0
  const timeouts = []
  try {
    createBundle(files.system)
    writeKnownHelper(files.system)
    const baseRunner = verifiedRunner()
    const runner = (executable, args, options) => {
      timeouts.push(options.timeout)
      clock += options.timeout === 2_000 ? 2_000 : 4_000
      const output = baseRunner(executable, args, options)
      if (executable === '/usr/libexec/PlistBuddy' && args[1] === 'Print :CFBundleIdentifier') {
        retries += 1
        writeKnownHelper(files.system, `retry ${retries}`)
      }
      return output
    }
    assert.deepEqual(inspectInputInstallation({
      candidates: [files.system, files.user], runner, now: () => clock,
    }), { status: 'probe_unavailable', version: null })
    assert.deepEqual(timeouts, [5_000, 5_000, 2_000])
    assert.equal(clock, 10_000)
    assert.equal(retries, 3)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('a helper retry restarts all evidence and can stabilize inside the shared deadline', () => {
  const files = fixture()
  let clock = 0
  let metadataReads = 0
  let helperChanged = false
  const timeouts = []
  try {
    createBundle(files.system)
    writeKnownHelper(files.system)
    const baseRunner = verifiedRunner()
    const runner = (executable, args, options) => {
      timeouts.push(options.timeout)
      clock += 100
      const output = baseRunner(executable, args, options)
      if (executable === '/usr/libexec/PlistBuddy') metadataReads += 1
      if (!helperChanged && executable === '/usr/libexec/PlistBuddy' && args[1] === 'Print :CFBundleIdentifier') {
        helperChanged = true
        writeKnownHelper(files.system, 'stable after one retry')
      }
      return output
    }
    assert.deepEqual(inspectInputInstallation({
      candidates: [files.system, files.user], runner, now: () => clock,
    }), { status: 'verified', version: '0.18.4' })
    assert.equal(helperChanged, true)
    assert.equal(metadataReads, 3)
    assert.equal(timeouts.length, 8)
    assert.ok(timeouts.every((timeout) => timeout > 0 && timeout <= PROBE_TIMEOUT_MS))
    assert.equal(clock, 800)
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
      '/usr/bin/codesign --verify --deep --strict --verbose=1': { status: 1, stdout: '', stderr: 'private modified file' },
    })
    assert.deepEqual(inspectInputInstallation({ candidates: [files.system, files.user], runner: invalidSeal }), {
      status: 'invalid_signature', version: '0.18.4',
    })
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('identifies only the exact known signed-resource mutation without trusting it', () => {
  const files = fixture()
  const calls = []
  try {
    createBundle(files.system)
    const knownMutation = verifiedRunner(calls, {
      '/usr/bin/codesign --verify --deep --strict --verbose=1': {
        status: 1,
        stdout: `file modified: ${files.system}/Contents/Resources/scripts/window-info-retriever.scpt\n`,
        stderr: `${files.system}: a sealed resource is missing or invalid\n`,
      },
    })
    assert.deepEqual(inspectInputInstallation({ candidates: [files.system, files.user], runner: knownMutation }), {
      status: 'known_resource_mutation', version: '0.18.4',
    })
    assert.equal(calls.some(({ executable }) => executable === '/usr/sbin/spctl'), false)
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('does not classify the known mutation transcript on another Input version', () => {
  const files = fixture()
  try {
    createBundle(files.system)
    const futureVersion = verifiedRunner([], {
      '/usr/libexec/PlistBuddy -c Print :CFBundleShortVersionString': {
        status: 0, stdout: '0.18.5\n', stderr: '',
      },
      '/usr/bin/codesign --verify --deep --strict --verbose=1': {
        status: 1,
        stdout: `file modified: ${files.system}/Contents/Resources/scripts/window-info-retriever.scpt\n`,
        stderr: `${files.system}: a sealed resource is missing or invalid\n`,
      },
    })
    assert.deepEqual(inspectInputInstallation({ candidates: [files.system, files.user], runner: futureVersion }), {
      status: 'invalid_signature', version: '0.18.5',
    })
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('does not broaden the known mutation exception to near matches or multiple files', () => {
  const files = fixture()
  try {
    createBundle(files.system)
    const nearMatch = verifiedRunner([], {
      '/usr/bin/codesign --verify --deep --strict --verbose=1': {
        status: 1,
        stdout: '',
        stderr: `file modified: ${files.system}/Contents/Resources/scripts/window-info-retriever.scpt.backup\n`,
      },
    })
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner: nearMatch }).status, 'invalid_signature')

    const multipleFiles = verifiedRunner([], {
      '/usr/bin/codesign --verify --deep --strict --verbose=1': {
        status: 1,
        stdout: `file modified: ${files.system}/Contents/Resources/scripts/window-info-retriever.scpt\n`,
        stderr: `file modified: ${files.system}/Contents/Resources/app.asar\n`,
      },
    })
    assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner: multipleFiles }).status, 'invalid_signature')

    for (const additionalFinding of [
      `file added: ${files.system}/Contents/Resources/unexpected.txt`,
      `file missing: ${files.system}/Contents/Resources/expected.txt`,
      `${files.system}: code object is not signed at all`,
    ]) {
      const combinedFailure = verifiedRunner([], {
        '/usr/bin/codesign --verify --deep --strict --verbose=1': {
          status: 1,
          stdout: '',
          stderr: `${files.system}: a sealed resource is missing or invalid\nfile modified: ${files.system}/Contents/Resources/scripts/window-info-retriever.scpt\n${additionalFinding}\n`,
        },
      })
      assert.equal(inspectInputInstallation({ candidates: [files.system, files.user], runner: combinedFailure }).status, 'invalid_signature')
    }
  } finally {
    rmSync(files.root, { recursive: true, force: true })
  }
})

test('does not expose private verification output while rejecting a lookalike mutation', () => {
  const files = fixture()
  try {
    createBundle(files.system)
    const privateOutput = verifiedRunner([], {
      '/usr/bin/codesign --verify --deep --strict --verbose=1': {
        status: 1,
        stdout: 'private account mason@example.test\n',
        stderr: `private /Users/mason/Documents\nfile modified: ${files.system}/Contents/Resources/scripts/window-info-retriever.scpt\n`,
      },
    })
    const inspected = inspectInputInstallation({ candidates: [files.system, files.user], runner: privateOutput })
    assert.deepEqual(inspected, { status: 'invalid_signature', version: '0.18.4' })
    assert.doesNotMatch(JSON.stringify(inspected), /mason|Documents|Input\.app|input-installation-/u)
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
