import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { githubSlug, localLinks, markdownAnchors, validateMarkdown, validateUnsignedDistributionPolicy } from './docs-check.mjs'

test('GitHub-style heading anchors are stable and deduplicated', () => {
  assert.equal(githubSlug('Run the read-only preflight'), 'run-the-read-only-preflight')
  assert.equal(githubSlug('Safe <span>agent</span> operations'), 'safe-agent-operations')
  assert.equal(githubSlug('Safe <script>alert(1)</script> operations'), 'safe-alert1-operations')
  assert.deepEqual(
    [...markdownAnchors('# Setup\n## Flight check\n## Flight check\n')],
    ['setup', 'flight-check', 'flight-check-1'],
  )
})

test('local link parser ignores web and email targets', () => {
  assert.deepEqual(
    localLinks('[local](guide.md#setup) [web](https://example.com) [mail](mailto:test@example.com)'),
    ['guide.md#setup'],
  )
})

test('Markdown validation reports missing files and anchors', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wrkpad-docs-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'README.md'), '[ok](docs/guide.md#setup) [bad](missing.md)\n')
  writeFileSync(join(root, 'docs', 'guide.md'), '# Setup\n')
  assert.deepEqual(validateMarkdown(root, ['README.md', 'docs/guide.md']), ['README.md: missing local target missing.md'])

  writeFileSync(join(root, 'README.md'), '[bad](docs/guide.md#absent)\n')
  assert.deepEqual(validateMarkdown(root, ['README.md', 'docs/guide.md']), ['README.md: missing anchor docs/guide.md#absent'])
})

test('expected-unsigned workflows cannot upload or publish artifacts', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wrkpad-release-policy-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const workflows = join(root, '.github', 'workflows')
  mkdirSync(workflows, { recursive: true })
  writeFileSync(join(workflows, 'safe.yml'), 'name: Unsigned audit\nsteps:\n  - run: echo developer_id_signed=false\n')
  assert.deepEqual(validateUnsignedDistributionPolicy(root), [])

  writeFileSync(join(workflows, 'unsafe.yml'), 'name: Unsigned preview\nsteps:\n  - uses: actions/upload-artifact@v7\n')
  assert.deepEqual(validateUnsignedDistributionPolicy(root), [
    'unsafe.yml: expected-unsigned workflow must not publish or upload artifacts',
  ])
})

test('operator docs preserve the exact twenty-gesture cross-provider contract', () => {
  const root = join(import.meta.dirname, '..')
  const controls = readFileSync(join(root, 'app', 'docs', 'controls.md'), 'utf8')
  const setup = readFileSync(join(root, 'app', 'docs', 'setup.md'), 'utf8')
  const operations = readFileSync(join(root, 'docs', 'agent-operations.md'), 'utf8')
  const publicDocs = [
    readFileSync(join(root, 'README.md'), 'utf8'),
    readFileSync(join(root, 'app', 'README.md'), 'utf8'),
    controls,
    setup,
    operations,
    readFileSync(join(root, 'app', 'docs', 'troubleshooting.md'), 'utf8'),
    readFileSync(join(root, 'docs', 'creator-micro-2-post-flash-2026-09-02.md'), 'utf8'),
  ].join('\n')

  assert.match(controls, /DIAL \| AG00 \| AG01 \| PLANAR TOGGLE \/ JOYSTICK/)
  assert.match(controls, /ACT10 \| Voice[\s\S]*ACT11 \| Guarded Continue[\s\S]*ACT12 \| Attention/)
  assert.match(controls, /error > needs_input > working > unread > idle/)
  assert.match(controls, /two taps within 350 ms/)
  assert.match(controls, /Recovery \| Fleet doctor \| Pause Fleet \(hold required\)/)
  assert.match(operations, /all 20 gestures/)
  assert.match(setup, /16 control groups[\s\S]*not the\s+20-gesture Ashlr Layer Flight Check/)
  assert.doesNotMatch(publicDocs, /19-gesture|all 19 daily signals|wide microphone cap/i)
})

test('README uses the canonical matrix without a stale renderer screenshot', () => {
  const root = join(import.meta.dirname, '..')
  const readme = readFileSync(join(root, 'README.md'), 'utf8')

  assert.match(readme, /DIAL\s+\| AG00\s+\| AG01\s+\| STICK/)
  assert.match(readme, /TOUCH \| ACT10 \| ACT11 \| ACT12 \(transparent\)/)
  assert.match(readme, /clearly synthetic[\s\S]*not vendor artwork/)
  assert.doesNotMatch(readme, /agent-board-public-demo\.png|accurate Creator Micro 2 control geometry/i)
})

test('README commissions native Codex without treating connection as acceptance', () => {
  const root = join(import.meta.dirname, '..')
  const readme = readFileSync(join(root, 'README.md'), 'utf8')

  const steps = [
    'data-capable USB-C cable',
    'underglow is white',
    'select layer 1',
    'Input Monitoring:',
    'within 350',
    'npm run doctor',
  ]
  let cursor = -1
  for (const phrase of steps) {
    const next = readme.indexOf(phrase, cursor + 1)
    assert.ok(next > cursor, `${phrase} should follow the prior commissioning step`)
    cursor = next
  }

  assert.match(readme, /indicators prove discovery and permission state, not that a physical\s+key navigated a task/)
  assert.match(readme, /quit Karabiner or Logitech Options\+ when it has\s+Input Monitoring/)
  assert.match(readme, /Reset settings[\s\S]*deletes all profiles, layers, and actions/)
})

test('native recovery preserves the working layer and gates activation', () => {
  const root = join(import.meta.dirname, '..')
  const recovery = readFileSync(join(root, 'app', 'docs', 'codex-native-layer-recovery.md'), 'utf8')

  const orderedSteps = [
    'fresh direct signature check',
    'pristine copy',
    'new candidate profile',
    'Import layer',
    'appended',
    'first visible position',
    'profile:check-native',
    'set the candidate profile current',
    'Physically verify Codex',
  ]
  let cursor = -1
  for (const phrase of orderedSteps) {
    const next = recovery.indexOf(phrase, cursor + 1)
    assert.ok(next > cursor, `${phrase} should follow the prior native recovery gate`)
    cursor = next
  }

  assert.match(recovery, /black numeric badge is a one-based editor\s+position/)
  assert.match(recovery, /black \*\*1\*\*[\s\S]*does not identify the layer's bindings/)
  assert.match(recovery, /replaces the artifact's provisional `layer\.id`[\s\S]*next available ID[\s\S]*appends the layer/)
  assert.match(recovery, /does not replace the existing layer whose ID\s+is `0`/)
  assert.match(recovery, /`window-info-retriever\.scpt`[\s\S]*earlier renderer status[\s\S]*fresh direct result governs/)
  assert.match(recovery, /launch-time self-mutation as possible[\s\S]*causality is not proven/)
  assert.match(recovery, /`match` result[\s\S]*does not prove layer order/)
  assert.match(recovery, /`profile\.layers\[0\]`[\s\S]*exact `KV_OAI_\*` layout/)
  assert.match(recovery, /Do not choose \*\*Import\s+profile\*\* or \*\*Reset Settings\*\*/)
  assert.match(recovery, /Rollback does not require deleting the candidate/)
})

test('architecture keeps one mixed queue and scopes only the provider view', () => {
  const root = join(import.meta.dirname, '..')
  const architecture = readFileSync(join(root, 'docs', 'architecture.md'), 'utf8')

  assert.match(architecture, /one mixed, provider-neutral queue/)
  assert.match(architecture, /`all` must remain the default/)
  assert.match(architecture, /`all \| codex \| claude`/)
  assert.match(architecture, /not a second reducer/)
  assert.match(architecture, /Hidden slots retain[\s\S]*global AG00-AG05 identities/)
  assert.match(architecture, /resolve the provider from the fresh main-process snapshot/)
  assert.match(architecture, /cannot promise the same mixed-provider physical key semantics/)
  assert.match(architecture, /must not claim exact Codex-task or cmux-pane\s+focus/)
})

test('cmux adapter contract permits focus without terminal read or write authority', () => {
  const root = join(import.meta.dirname, '..')
  const contract = readFileSync(join(root, 'protocol', 'cmux-provider-adapter.md'), 'utf8')

  assert.match(contract, /adapter substrate is implemented[\s\S]*Locator capture,[\s\S]*socket-password enrollment are not/)
  assert.match(contract, /CMUX_WORKSPACE_ID[\s\S]*CMUX_SURFACE_ID/)
  assert.match(contract, /token-keyed HMAC binding/)
  assert.match(contract, /Access denied.*only processes started inside cmux can connect/)
  assert.match(contract, /one-use[\s\S]*human confirmation[\s\S]*exact_focus_not_authorized/)
  assert.match(contract, /access mode to be exactly `password`/)
  assert.match(contract, /device and inode[\s\S]*path.*alone is not server-instance/)
  assert.match(contract, /SIGTERM[\s\S]*SIGKILL[\s\S]*child `close`/)
  assert.match(contract, /Exact focus is off by default/)
  assert.match(contract, /macOS Keychain[\s\S]*CMUX_SOCKET_PASSWORD/)
  assert.match(contract, /--json capabilities/)
  assert.match(contract, /identify --workspace <workspace>[\s\S]*--surface <surface>/)
  assert.match(contract, /select-workspace[\s\S]*focus-panel/)
  assert.match(contract, /`send`, `send-key`, `send-panel`/)
  assert.match(contract, /`read-screen`, `capture-pane`, `pipe-pane`/)
  assert.match(contract, /never[\s\S]*submit a prompt[\s\S]*press Enter/)
  assert.match(contract, /opens cmux[\s\S]*bounded reason code/)
})
