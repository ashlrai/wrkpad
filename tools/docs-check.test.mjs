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
