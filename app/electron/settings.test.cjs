const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const {
  MAX_SETTINGS_BYTES,
  readWorkspaceSettings,
  saveBoardRouteSettings,
  saveWorkspaceSettings,
  validBoardRoute,
  validWorkspace,
} = require('./settings.cjs')

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
    assert.deepEqual(readWorkspaceSettings(filePath, '/safe/fallback'), { workspace: '/safe/fallback', boardRoute: 'unknown' })
    writeFileSync(filePath, 'x'.repeat(MAX_SETTINGS_BYTES + 1), 'utf8')
    assert.deepEqual(readWorkspaceSettings(filePath, '/safe/fallback'), { workspace: '/safe/fallback', boardRoute: 'unknown' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('workspace settings use a private atomic replacement', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-settings-'))
  try {
    const filePath = path.join(root, 'settings.json')
    saveWorkspaceSettings(filePath, '/Users/example/project')
    assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')), { workspace: '/Users/example/project', boardRoute: 'unknown' })
    assert.equal(statSync(filePath).mode & 0o777, 0o600)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('board route accepts only declared local modes', () => {
  assert.equal(validBoardRoute('unknown'), true)
  assert.equal(validBoardRoute('codex_native'), true)
  assert.equal(validBoardRoute('ashlr_layer'), true)
  assert.equal(validBoardRoute('takeover'), false)
  assert.equal(validBoardRoute(''), false)
})

test('workspace and board-route updates preserve each other', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-settings-'))
  try {
    const filePath = path.join(root, 'settings.json')
    saveWorkspaceSettings(filePath, '/Users/example/one')
    saveBoardRouteSettings(filePath, 'codex_native', '/Users/example/one')
    saveWorkspaceSettings(filePath, '/Users/example/two')
    assert.deepEqual(readWorkspaceSettings(filePath, '/safe/fallback'), {
      workspace: '/Users/example/two',
      boardRoute: 'codex_native',
    })
    saveBoardRouteSettings(filePath, 'ashlr_layer', '/Users/example/two')
    assert.deepEqual(readWorkspaceSettings(filePath, '/safe/fallback'), {
      workspace: '/Users/example/two',
      boardRoute: 'ashlr_layer',
    })
    assert.equal(statSync(filePath).mode & 0o777, 0o600)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
