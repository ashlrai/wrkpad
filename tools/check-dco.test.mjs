import assert from 'node:assert/strict'
import test from 'node:test'

import { missingSignoffs, parseCommitRecords } from './check-dco.mjs'

test('DCO parser accepts a matching author sign-off', () => {
  const raw = `a${'1'.repeat(39)}\x00Mason Wyatt\x00mason@example.com\x00feat: demo\n\nSigned-off-by: Mason Wyatt <mason@example.com>\n\x1e`
  const commits = parseCommitRecords(raw)
  assert.equal(commits.length, 1)
  assert.deepEqual(missingSignoffs(commits), [])
})

test('DCO parser rejects an unrelated sign-off', () => {
  const commits = [{
    sha: 'b'.repeat(40), authorName: 'Mason Wyatt', authorEmail: 'mason@example.com',
    body: 'fix: demo\n\nSigned-off-by: Another Person <other@example.com>\n',
  }]
  assert.deepEqual(missingSignoffs(commits).map((item) => item.sha), ['b'.repeat(40)])
})

test('DCO matching is case-insensitive but still binds name and email', () => {
  const commits = [{
    sha: 'c'.repeat(40), authorName: 'Mason Wyatt', authorEmail: 'MASON@example.com',
    body: 'Signed-off-by: mason wyatt <mason@EXAMPLE.com>\n',
  }]
  assert.equal(missingSignoffs(commits).length, 0)
})
