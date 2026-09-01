const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { ACTION_SPECS, shellQuote, testCommand } = require('./action-registry.cjs')

test('consequential actions never use one-press safety', () => {
  for (const id of ['start_codex','start_claude','run_tests','pause_fleet','resume_fleet','daemon_stop']) {
    assert.notEqual(ACTION_SPECS[id].safety, 'safe', id)
  }
})
test('no release or permission approval action is registered', () => {
  const ids = Object.keys(ACTION_SPECS).join(' ')
  assert.doesNotMatch(ids, /push|deploy|publish|merge|approve_permission|delete/)
})
test('Git inspections cannot fall through the general executable runner', () => {
  for (const id of ['git_status', 'git_diff', 'git_log']) {
    assert.equal(ACTION_SPECS[id].kind, 'gitInspect', id)
    assert.equal(ACTION_SPECS[id].executable, undefined, id)
  }
})
test('shellQuote safely preserves apostrophes', () => {
  assert.equal(shellQuote("/tmp/Mason's repo"), "'/tmp/Mason'\\''s repo'")
})
test('test command selects package manager from lockfile', () => {
  const command = testCommand(path.resolve(__dirname, '..'))
  assert.match(command, /npm test$/)
})
test('test command recognizes a Cargo workspace without guessing npm', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-cargo-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname="demo"\nversion="0.1.0"\n')
  assert.match(testCommand(root), /cargo test --all-targets$/)
})
test('test command fails closed for an ambiguous polyglot root', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-polyglot-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\n')
  writeFileSync(path.join(root, 'package.json'), '{}\n')
  writeFileSync(path.join(root, 'package-lock.json'), '{}\n')
  assert.equal(testCommand(root), null)
})
test('test command fails closed when no supported manifest exists', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-unknown-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.equal(testCommand(root), null)
})
