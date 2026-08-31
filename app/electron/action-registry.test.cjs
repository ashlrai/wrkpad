const test = require('node:test')
const assert = require('node:assert/strict')
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
test('shellQuote safely preserves apostrophes', () => {
  assert.equal(shellQuote("/tmp/Mason's repo"), "'/tmp/Mason'\\''s repo'")
})
test('test command selects package manager from lockfile', () => {
  const command = testCommand(path.resolve(__dirname, '..'))
  assert.match(command, /npm test$/)
})
