const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { ACTION_SPECS, BRIEFS, WORKFLOW_ACTION_IDS, executeSpec, shellQuote, testCommand } = require('./action-registry.cjs')

test('consequential actions never use one-press safety', () => {
  for (const id of ['start_codex','start_claude','run_tests','pause_fleet','resume_fleet','daemon_stop']) {
    assert.notEqual(ACTION_SPECS[id].safety, 'safe', id)
  }
})
test('no release or permission approval action is registered', () => {
  const ids = Object.keys(ACTION_SPECS).join(' ')
  assert.doesNotMatch(ids, /push|deploy|publish|merge|approve_permission|delete/)
})
test('workflow actions are provider-neutral safe copies or inert staged intents', () => {
  assert.deepEqual(WORKFLOW_ACTION_IDS, [
    'copy_amplify_skill',
    'copy_verify_skill',
    'copy_polish_skill',
    'copy_advance_skill',
    'stage_voice',
    'copy_guarded_continue',
    'stage_attention',
  ])
  for (const id of WORKFLOW_ACTION_IDS) {
    const spec = ACTION_SPECS[id]
    assert.equal(spec.safety, 'safe', id)
    assert.ok(spec.kind === 'copy' || spec.kind === 'stage', id)
    assert.equal(spec.command, undefined, id)
    assert.equal(spec.executable, undefined, id)
    assert.equal(spec.args, undefined, id)
  }
  assert.equal(BRIEFS.copy_amplify_skill, '$ashlr-delivery Amplify')
  assert.equal(BRIEFS.copy_verify_skill, '$ashlr-delivery Verify')
  assert.equal(BRIEFS.copy_polish_skill, '$ashlr-delivery Polish')
  assert.equal(BRIEFS.copy_advance_skill, '$ashlr-delivery Advance')
  assert.doesNotMatch(BRIEFS.copy_guarded_continue, /\bpress enter\b|\bsend (?:it|this|the prompt)\b/i)
})
test('workflow copy actions only write their server-owned text to the clipboard', async () => {
  const writes = []
  const electron = { home: '/tmp', clipboard: { writeText: (text) => writes.push(text) } }
  const result = await executeSpec('copy_amplify_skill', '/tmp/example', electron)
  assert.equal(result.ok, true)
  assert.equal(result.title, 'Amplify copied')
  assert.match(result.message, /Nothing was pasted or submitted/)
  assert.deepEqual(writes, ['$ashlr-delivery Amplify'])
})
test('Voice and Attention return typed intents without clipboard or process side effects', async () => {
  const writes = []
  const electron = { home: '/tmp', clipboard: { writeText: (text) => writes.push(text) } }
  const voice = await executeSpec('stage_voice', '/tmp/example', electron)
  const attention = await executeSpec('stage_attention', '/tmp/example', electron)
  assert.deepEqual(voice.stagedIntent, { actionId: 'stage_voice', intent: 'voice_capture' })
  assert.deepEqual(attention.stagedIntent, { actionId: 'stage_attention', intent: 'focus_attention' })
  assert.match(voice.message, /no prompt was submitted/i)
  assert.match(attention.message, /No task was guessed and no prompt was submitted/i)
  assert.deepEqual(writes, [])
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
