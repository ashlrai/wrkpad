const test = require('node:test')
const assert = require('node:assert/strict')
const { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { resolveTool, toolSearchDirectories } = require('./tool-resolver.cjs')

test('resolveTool finds an executable on an explicit PATH', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-tools-'))
  try {
    const executable = path.join(root, 'ashlr')
    writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    assert.equal(resolveTool('ashlr', { home: '/nonexistent', envPath: root }), executable)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('resolveTool rejects non-executable files and directories', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-tools-'))
  try {
    const file = path.join(root, 'claude-nonexec-test')
    writeFileSync(file, 'not executable', { mode: 0o600 })
    mkdirSync(path.join(root, 'codex-dir-test'))
    chmodSync(path.join(root, 'codex-dir-test'), 0o700)
    assert.equal(resolveTool('claude-nonexec-test', { home: '/nonexistent', envPath: root }), null)
    assert.equal(resolveTool('codex-dir-test', { home: '/nonexistent', envPath: root }), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('tool search includes user-local and both macOS package-manager roots', () => {
  const directories = toolSearchDirectories('/Users/example', '/custom/bin:/usr/bin')
  assert.deepEqual(directories.slice(0, 5), [
    '/Users/example/.local/bin',
    '/Users/example/.npm-global/bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ])
  assert.equal(directories.includes('/custom/bin'), true)
})

test('resolveTool rejects names that could escape a search root', () => {
  assert.equal(resolveTool('../ashlr', { home: '/Users/example', envPath: '/usr/bin' }), null)
  assert.equal(resolveTool('/tmp/ashlr', { home: '/Users/example', envPath: '/usr/bin' }), null)
})
