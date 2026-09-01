const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { executeSpec } = require('./action-registry.cjs')
const { configuredFilterCommands, gitEnvironment, hardenedGitArgs, resolveGitExecutable, runGit } = require('./git-runner.cjs')
const { inspectWorkspace } = require('./workspace-inspector.cjs')

function testGitExecutable() {
  return process.platform === 'darwin' && existsSync('/usr/bin/git') ? '/usr/bin/git' : resolveGitExecutable()
}

function rawGit(executable, cwd, args) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

function shellCommand(...parts) {
  return parts.map((part) => `"${String(part).replaceAll('"', '\\"')}"`).join(' ')
}

function createFilterFixture(t, executable, configKey) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-filter-git-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const marker = path.join(root, 'filter-ran')
  const helper = path.join(root, 'filter-helper.cjs')
  writeFileSync(helper, `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'called\\n'); process.stdin.pipe(process.stdout)\n`)

  rawGit(executable, root, ['init', '--quiet'])
  rawGit(executable, root, ['config', 'user.email', 'test@example.invalid'])
  rawGit(executable, root, ['config', 'user.name', 'Agent Board Test'])
  writeFileSync(path.join(root, '.gitattributes'), 'payload.txt filter=spy\n')
  writeFileSync(path.join(root, 'payload.txt'), 'first\n')
  rawGit(executable, root, ['add', '.gitattributes', 'payload.txt'])
  rawGit(executable, root, ['commit', '--quiet', '-m', 'fixture'])
  rawGit(executable, root, ['config', configKey, shellCommand(process.execPath, helper)])
  writeFileSync(path.join(root, 'payload.txt'), 'second\n')
  return { root, marker }
}

test('hardens argv and strips Git process-injection environment variables', () => {
  assert.deepEqual(hardenedGitArgs(['diff', '--stat']), [
    '-c', 'core.fsmonitor=false', '--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--stat',
  ])
  assert.deepEqual(hardenedGitArgs(['status', '--short']), [
    '-c', 'core.fsmonitor=false', '--no-pager', 'status', '--short',
  ])

  const env = gitEnvironment({
    PATH: '/safe/bin',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'diff.external',
    GIT_CONFIG_VALUE_0: 'unsafe-helper',
    GIT_EXTERNAL_DIFF: 'unsafe-helper',
    GIT_DIR: '/redirected',
    GIT_EXEC_PATH: '/tmp/hostile-git-core',
    GIT_CONFIG_PARAMETERS: "'diff.external'='unsafe-helper'",
    GIT_TRACE: '1',
  })
  assert.equal(env.PATH, '/safe/bin')
  assert.equal(env.GIT_OPTIONAL_LOCKS, '0')
  assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  for (const key of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_EXTERNAL_DIFF', 'GIT_DIR', 'GIT_EXEC_PATH', 'GIT_CONFIG_PARAMETERS', 'GIT_TRACE']) {
    assert.equal(env[key], undefined, key)
  }
})

test('resolves only absolute platform-owned Git locations', () => {
  const seen = []
  const linux = resolveGitExecutable('linux', (candidate) => {
    seen.push(candidate)
    return candidate === '/bin/git'
  })
  assert.equal(linux, '/bin/git')
  assert.deepEqual(seen, ['/usr/bin/git', '/bin/git'])
  assert.equal(path.isAbsolute(linux), true)

  const windows = resolveGitExecutable('win32', (candidate) => candidate.endsWith('cmd\\git.exe'))
  assert.equal(path.win32.isAbsolute(windows), true)
  assert.equal(resolveGitExecutable('linux', () => false), null)
})

test('read-only Git runner refuses repository fsmonitor, external diff, and textconv helpers', async (t) => {
  const executable = testGitExecutable()
  if (!executable) return t.skip('Git is unavailable on this test runner')

  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-hostile-git-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const marker = path.join(root, 'helper-ran')
  const helper = path.join(root, 'helper.cjs')
  writeFileSync(helper, `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'called\\n'); process.stdout.write('fixture\\n')\n`)

  rawGit(executable, root, ['init', '--quiet'])
  rawGit(executable, root, ['config', 'user.email', 'test@example.invalid'])
  rawGit(executable, root, ['config', 'user.name', 'Agent Board Test'])
  writeFileSync(path.join(root, '.gitattributes'), '*.bin diff=spy\n')
  writeFileSync(path.join(root, 'sample.bin'), 'first\n')
  writeFileSync(path.join(root, 'tracked.txt'), 'first\n')
  rawGit(executable, root, ['add', '.gitattributes', 'sample.bin', 'tracked.txt'])
  rawGit(executable, root, ['commit', '--quiet', '-m', 'fixture'])

  const command = shellCommand(process.execPath, helper)
  rawGit(executable, root, ['config', 'core.fsmonitor', command])
  rawGit(executable, root, ['config', 'diff.external', command])
  rawGit(executable, root, ['config', 'diff.spy.textconv', command])
  writeFileSync(path.join(root, 'sample.bin'), 'second\n')
  writeFileSync(path.join(root, 'tracked.txt'), 'second\n')

  const status = await runGit(['status', '--short'], { cwd: root })
  assert.equal(status.ok, true, status.error)
  assert.match(status.stdout, /sample\.bin/)
  const diff = await runGit(['diff', '--stat'], { cwd: root })
  assert.equal(diff.ok, true, diff.error)
  assert.match(diff.stdout, /tracked\.txt/)

  const inspection = await inspectWorkspace(root)
  assert.equal(inspection.isGit, true)
  assert.equal(inspection.statusKnown, true)
  assert.ok(inspection.dirtyFiles >= 2)

  const action = await executeSpec('git_diff', root, { home: tmpdir() })
  assert.equal(action.ok, true, action.message)
  assert.match(action.output, /tracked\.txt/)
  assert.equal(existsSync(marker), false, 'a repository-configured helper executed')
})

test('status and diff fail closed before a configured clean filter can execute', async (t) => {
  const executable = testGitExecutable()
  if (!executable) return t.skip('Git is unavailable on this test runner')
  const { root, marker } = createFilterFixture(t, executable, 'filter.spy.clean')

  const configured = await configuredFilterCommands({ cwd: root })
  assert.deepEqual(configured.keys, ['filter.spy.clean'])

  const status = await runGit(['status', '--short'], { cwd: root })
  assert.equal(status.ok, false)
  assert.match(status.error, /configured content filters may execute helpers.*filter\.spy\.clean/)
  const diff = await runGit(['diff', '--stat'], { cwd: root })
  assert.equal(diff.ok, false)
  assert.match(diff.error, /configured content filters may execute helpers.*filter\.spy\.clean/)

  const inspection = await inspectWorkspace(root)
  assert.equal(inspection.isGit, true)
  assert.equal(inspection.statusKnown, false)
  const action = await executeSpec('git_diff', root, { home: tmpdir() })
  assert.equal(action.ok, false)
  assert.match(action.message, /configured content filters may execute helpers/)
  assert.equal(existsSync(marker), false, 'a configured clean filter executed')
})

test('status and diff fail closed before a configured process filter can execute', async (t) => {
  const executable = testGitExecutable()
  if (!executable) return t.skip('Git is unavailable on this test runner')
  const { root, marker } = createFilterFixture(t, executable, 'filter.spy.process')

  for (const args of [['status', '--short'], ['diff', '--stat']]) {
    const result = await runGit(args, { cwd: root })
    assert.equal(result.ok, false)
    assert.match(result.error, /configured content filters may execute helpers.*filter\.spy\.process/)
  }
  assert.equal(existsSync(marker), false, 'a configured process filter executed')
})
