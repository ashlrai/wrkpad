const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { ACTION_SPECS, BRIEFS, WORKFLOW_ACTION_IDS, executeSpec, guardedWorkspaceCommand, requiresSelectedSlotWorkspace, resolveTerminalPlan, shellQuote, testCommand, testDescriptor } = require('./action-registry.cjs')

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
test('only workspace-dependent actions require a freshly resolved selected slot', () => {
  const expected = new Set([
    'open_codex', 'start_codex', 'resume_codex', 'codex_review',
    'start_claude', 'resume_claude', 'claude_agents',
    'git_status', 'git_diff', 'git_log', 'run_tests',
  ])
  for (const id of Object.keys(ACTION_SPECS)) {
    assert.equal(requiresSelectedSlotWorkspace(id), expected.has(id), id)
  }
  assert.equal(requiresSelectedSlotWorkspace('not_registered'), false)
})
test('shellQuote safely preserves apostrophes', () => {
  assert.equal(shellQuote("/tmp/Mason's repo"), "'/tmp/Mason'\\''s repo'")
})
test('test command selects package manager from lockfile', () => {
  assert.deepEqual(testDescriptor(path.resolve(__dirname, '..')), { tool: 'npm', args: ['test'] })
  const command = testCommand(path.resolve(__dirname, '..'), '/usr/local/bin/npm', '7:42', '9:91')
  assert.match(command, /exec '\/usr\/local\/bin\/npm' 'test'$/)
})
test('test command recognizes a Cargo workspace without guessing npm', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-cargo-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname="demo"\nversion="0.1.0"\n')
  assert.deepEqual(testDescriptor(root), { tool: 'cargo', args: ['test', '--all-targets'] })
})
test('test command fails closed for an ambiguous polyglot root', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-polyglot-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(path.join(root, 'Cargo.toml'), '[workspace]\n')
  writeFileSync(path.join(root, 'package.json'), '{}\n')
  writeFileSync(path.join(root, 'package-lock.json'), '{}\n')
  assert.equal(testDescriptor(root), null)
})
test('test command fails closed when no supported manifest exists', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-unknown-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.equal(testDescriptor(root), null)
})

test('terminal plans bind a canonical absolute executable and guarded workspace inode', () => {
  const plan = resolveTerminalPlan('resume_codex', '/Users/operator/Code/repo', {
    home: '/Users/operator',
    workspaceIdentity: '7:42',
    resolveToolImpl: (name) => `/opt/homebrew/bin/${name}`,
    executableIdentityImpl: () => ({ executable: '/opt/homebrew/lib/codex', identity: '9:91' }),
  })
  assert.equal(plan.executable, '/opt/homebrew/lib/codex')
  assert.equal(plan.executableIdentity, '9:91')
  assert.match(plan.command, /^expected='7:42'; observed=\$\(\/usr\/bin\/stat/)
  assert.match(plan.command, /cd -P -- '\/Users\/operator\/Code\/repo'/)
  assert.match(plan.command, /stat -f '%d:%i' -- \./)
  assert.match(plan.command, /executable_observed=\$\(\/usr\/bin\/stat/)
  assert.match(plan.command, /exec '\/opt\/homebrew\/lib\/codex' 'resume' '--last'$/)
  assert.doesNotMatch(plan.command, /(?:^|\s)codex(?:\s|$)/)
})

test('terminal plans fail closed without exact tool or workspace authority', () => {
  const options = {
    home: '/Users/operator',
    workspaceIdentity: '7:42',
    resolveToolImpl: () => null,
  }
  assert.equal(resolveTerminalPlan('start_codex', '/Users/operator/Code/repo', options), null)
  assert.equal(guardedWorkspaceCommand('/usr/bin/codex', [], '/Users/operator/Code/repo', 'invalid', '9:91'), null)
  assert.equal(guardedWorkspaceCommand('codex', [], '/Users/operator/Code/repo', '7:42', '9:91'), null)
  assert.equal(guardedWorkspaceCommand('/usr/bin/codex', [], '/Users/operator/Code/repo', '7:42', 'invalid'), null)
})

test('executeSpec refuses terminal execution without a bound plan', async () => {
  const result = await executeSpec('start_codex', '/Users/operator/Code/repo', { home: '/Users/operator', clipboard: { writeText() {} } })
  assert.equal(result.ok, false)
  assert.match(result.message, /not bound/)
})
