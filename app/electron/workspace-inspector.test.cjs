const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { packageFacts, parseStatus } = require('./workspace-inspector.cjs')

test('parses staged, unstaged, and untracked workspace facts', () => {
  assert.deepEqual(parseStatus('M  staged.ts\n M changed.ts\n?? new.ts'), { statusKnown: true, dirtyFiles: 3, stagedFiles: 1, unstagedFiles: 1, untrackedFiles: 1, conflictedFiles: 0 })
  assert.deepEqual(parseStatus(null), { statusKnown: false, dirtyFiles: null, stagedFiles: null, unstagedFiles: null, untrackedFiles: null, conflictedFiles: null })
})

test('detects package manager and configured test script', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ashlr-board-'))
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@ashlr/demo', scripts: { test: 'vitest run' } }))
  writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9')
  assert.deepEqual(packageFacts(root), { packageName: '@ashlr/demo', packageManager: 'pnpm', testCommand: 'vitest run' })
})
