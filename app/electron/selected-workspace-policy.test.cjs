const test = require('node:test')
const assert = require('node:assert/strict')
const { executableIdentity, selectedWorkspaceIdentity, workspaceLabel } = require('./selected-workspace-policy.cjs')

function policy(workspace, home = '/Users/operator') {
  return selectedWorkspaceIdentity(workspace, {
    home,
    realpathImpl: (value) => value,
    statImpl: () => ({ isDirectory: () => true, dev: 7, ino: 42 }),
  })
}

test('binds only project-depth directories beneath the local home', () => {
  assert.deepEqual(policy('/Users/operator/Desktop/project'), {
    workspace: '/Users/operator/Desktop/project',
    identity: '7:42',
    label: 'project',
  })
  assert.equal(policy('/Users/operator'), null)
  assert.equal(policy('/Users/operator/Desktop'), null)
  assert.equal(policy('/Users/other/Desktop/project'), null)
  assert.equal(policy('/tmp/project'), null)
  assert.equal(policy('/Volumes/share/project'), null)
  assert.equal(policy('/'), null)
})

test('fails closed for relative paths, files, and filesystem errors', () => {
  assert.equal(policy('Desktop/project'), null)
  assert.equal(selectedWorkspaceIdentity('/Users/operator/Desktop/file', {
    home: '/Users/operator',
    realpathImpl: (value) => value,
    statImpl: () => ({ isDirectory: () => false, dev: 7, ino: 42 }),
  }), null)
  assert.equal(selectedWorkspaceIdentity('/Users/operator/Desktop/project', {
    home: '/Users/operator',
    realpathImpl: () => { throw new Error('unavailable') },
  }), null)
})

test('authorizes the canonical target rather than a symlink label', () => {
  assert.deepEqual(selectedWorkspaceIdentity('/Users/operator/link/project', {
    home: '/Users/operator',
    realpathImpl: (value) => value.endsWith('/link/project') ? '/Users/operator/Work/project' : value,
    statImpl: () => ({ isDirectory: () => true, dev: 9, ino: 99 }),
  }), {
    workspace: '/Users/operator/Work/project',
    identity: '9:99',
    label: 'project',
  })
})

test('projects a bounded control and bidi-safe basename rather than a path', () => {
  assert.equal(workspaceLabel('/Users/operator/Desktop/customer-repo'), 'customer-repo')
  assert.equal(workspaceLabel('/Users/operator/Desktop/customer\\secret\u061c\u200e\u200f\u202erepo'), 'customer secret repo')
  assert.equal(workspaceLabel(`/Users/operator/Desktop/${'x'.repeat(100)}`).length, 72)
  assert.equal(workspaceLabel('/'), null)
  assert.equal(workspaceLabel('relative/repo'), null)
})

test('canonicalizes and binds an executable to its device and inode', () => {
  assert.deepEqual(executableIdentity('/opt/homebrew/bin/codex', {
    realpathImpl: () => '/opt/homebrew/lib/node_modules/codex/bin/codex',
    statImpl: () => ({ isFile: () => true, mode: 0o100755, dev: 8, ino: 91 }),
  }), {
    executable: '/opt/homebrew/lib/node_modules/codex/bin/codex',
    identity: '8:91',
  })
  assert.equal(executableIdentity('codex'), null)
  assert.equal(executableIdentity('/opt/homebrew/bin/codex', {
    realpathImpl: (value) => value,
    statImpl: () => ({ isFile: () => true, mode: 0o100644, dev: 8, ino: 91 }),
  }), null)
  assert.equal(executableIdentity('/opt/homebrew/bin/codex', {
    realpathImpl: () => '/opt/homebrew/lib/codex\n/bin/codex',
    statImpl: () => ({ isFile: () => true, mode: 0o100755, dev: 8, ino: 91 }),
  }), null)
})
