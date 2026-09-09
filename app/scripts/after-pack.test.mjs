import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { previewCodesignCommand } = require('./after-pack.cjs')

test('ad-hoc preview signing uses one fixed executable and argv contract', () => {
  assert.deepEqual(previewCodesignCommand('/fixed/Agent Board.app', { WRKPAD_ADHOC_PREVIEW: '1' }), {
    executable: '/usr/bin/codesign',
    args: ['--force', '--deep', '--sign', '-', '/fixed/Agent Board.app'],
  })
})

test('preview signing stays off for absent, false, or unexpected gates', () => {
  for (const value of [undefined, '', '0', 'true', 'yes', '2']) {
    assert.equal(previewCodesignCommand('/fixed/Agent Board.app', { WRKPAD_ADHOC_PREVIEW: value }), null)
  }
})
