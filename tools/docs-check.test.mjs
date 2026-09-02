import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
