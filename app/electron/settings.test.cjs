const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { MAX_SETTINGS_BYTES, readWorkspaceSettings, saveWorkspaceSettings, validWorkspace } = require('./settings.cjs')

test('workspace settings accept only bounded absolute paths', () => {
  assert.equal(validWorkspace('/Users/example/project'), true)
  assert.equal(validWorkspace('../project'), false)
  assert.equal(validWorkspace(''), false)
  assert.equal(validWorkspace(`/tmp/${'x'.repeat(5000)}`), false)
})

test('workspace settings fall back on malformed or oversized input', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-settings-'))
  try {
    const filePath = path.join(root, 'settings.json')
    writeFileSync(filePath, '{invalid', 'utf8')
    assert.deepEqual(readWorkspaceSettings(filePath, '/safe/fallback'), { workspace: '/safe/fallback' })
    writeFileSync(filePath, 'x'.repeat(MAX_SETTINGS_BYTES + 1), 'utf8')
    assert.deepEqual(readWorkspaceSettings(filePath, '/safe/fallback'), { workspace: '/safe/fallback' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('workspace settings use a private atomic replacement', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-settings-'))
  try {
    const filePath = path.join(root, 'settings.json')
    saveWorkspaceSettings(filePath, '/Users/example/project')
    assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')), { workspace: '/Users/example/project' })
    assert.equal(statSync(filePath).mode & 0o777, 0o600)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

