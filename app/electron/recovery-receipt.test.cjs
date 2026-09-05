const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { tmpdir } = require('node:os')
const path = require('node:path')
const {
  MAX_RECOVERY_RECEIPT_BYTES,
  RECOVERY_SCHEMA,
  buildRecoveryChecklist,
  readRecoveryReceipt,
  observeRecoveryArtifact,
  observeRecoveryBaseline,
  recoveryChecklistText,
  recoveryReceiptPath,
  removeRecoveryReceipt,
  writeRecoveryReceipt,
} = require('./recovery-receipt.cjs')

const receipt = {
  artifactPath: '/Users/example/Documents/Ashlr-Agent-Board-corrected.json',
  sha256: 'a'.repeat(64),
  createdAt: '2026-09-01T20:00:00.000Z',
}

test('writes and resumes one bounded private recovery handoff', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-recovery-'))
  try {
    const filePath = recoveryReceiptPath(path.join(root, 'settings.json'))
    const saved = writeRecoveryReceipt(filePath, receipt)
    assert.deepEqual(saved, { schema: RECOVERY_SCHEMA, ...receipt })
    assert.deepEqual(readRecoveryReceipt(filePath), saved)
    assert.equal(statSync(filePath).mode & 0o777, 0o600)
    assert.equal(JSON.parse(readFileSync(filePath, 'utf8')).artifactPath, receipt.artifactPath)
    assert.equal(removeRecoveryReceipt(filePath), true)
    assert.equal(readRecoveryReceipt(filePath), null)
    assert.equal(removeRecoveryReceipt(filePath), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects malformed, oversized, and symlinked recovery receipts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-recovery-'))
  try {
    const filePath = path.join(root, 'handoff.json')
    writeFileSync(filePath, JSON.stringify({ schema: RECOVERY_SCHEMA, ...receipt, artifactPath: '../relative' }))
    assert.equal(readRecoveryReceipt(filePath), null)
    writeFileSync(filePath, 'x'.repeat(MAX_RECOVERY_RECEIPT_BYTES + 1))
    assert.equal(readRecoveryReceipt(filePath), null)
    const target = path.join(root, 'target.json')
    writeFileSync(target, JSON.stringify({ schema: RECOVERY_SCHEMA, ...receipt }))
    const link = path.join(root, 'link.json')
    symlinkSync(target, link)
    assert.equal(readRecoveryReceipt(link), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('builds an exact non-mutating checklist with Input fallbacks', () => {
  const available = { status: 'available', available: true }
  const unavailable = { status: 'missing', available: false }
  const steps = buildRecoveryChecklist({ schema: RECOVERY_SCHEMA, ...receipt }, available)
  assert.equal(steps.length, 9)
  assert.match(steps.join('\n'), /Import Profile/)
  assert.match(steps.join('\n'), /Set as current profile/)
  assert.match(steps.join('\n'), /six profiles/)
  assert.match(steps.join('\n'), /update error, retry/)
  assert.match(recoveryChecklistText({ schema: RECOVERY_SCHEMA, ...receipt }, available), new RegExp(receipt.sha256))
  assert.doesNotMatch(recoveryChecklistText({ schema: RECOVERY_SCHEMA, ...receipt }, available), /Users\/example/)
  assert.match(buildRecoveryChecklist({ schema: RECOVERY_SCHEMA, ...receipt }, unavailable)[0], /missing, moved, unsafe/)
  assert.match(recoveryChecklistText({ schema: RECOVERY_SCHEMA, ...receipt }, unavailable), /Do not import a guessed file/)
  assert.deepEqual(observeRecoveryArtifact({ schema: RECOVERY_SCHEMA, ...receipt }), { status: 'missing', available: false })
})

test('re-hashes a bounded regular artifact and rejects replacement or symlink state', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-artifact-'))
  try {
    const artifactPath = path.join(root, 'corrected.json')
    const content = '{"profile":"corrected"}\n'
    writeFileSync(artifactPath, content)
    const artifactReceipt = { schema: RECOVERY_SCHEMA, artifactPath, sha256: createHash('sha256').update(content).digest('hex'), createdAt: receipt.createdAt }
    assert.deepEqual(observeRecoveryArtifact(artifactReceipt), { status: 'available', available: true })
    writeFileSync(artifactPath, '{"profile":"replaced"}\n')
    assert.deepEqual(observeRecoveryArtifact(artifactReceipt), { status: 'hash_mismatch', available: false })
    const target = path.join(root, 'target.json')
    writeFileSync(target, content)
    rmSync(artifactPath)
    symlinkSync(target, artifactPath)
    assert.deepEqual(observeRecoveryArtifact(artifactReceipt), { status: 'unsafe', available: false })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('persists and independently observes the selected source backup', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-baseline-'))
  try {
    const artifactPath = path.join(root, 'corrected.json')
    const baselinePath = path.join(root, 'ordinary-export.json')
    writeFileSync(artifactPath, '{"profile":"corrected"}\n')
    writeFileSync(baselinePath, '{"profile":"ordinary"}\n')
    const extended = {
      artifactPath,
      sha256: createHash('sha256').update(readFileSync(artifactPath)).digest('hex'),
      baselinePath,
      baselineSha256: createHash('sha256').update(readFileSync(baselinePath)).digest('hex'),
      createdAt: receipt.createdAt,
      acceptedCandidateSha256: createHash('sha256').update(readFileSync(artifactPath)).digest('hex'),
      acceptedAt: '2026-09-01T20:05:00.000Z',
    }
    const filePath = recoveryReceiptPath(path.join(root, 'settings.json'))
    assert.deepEqual(writeRecoveryReceipt(filePath, extended), { schema: RECOVERY_SCHEMA, ...extended })
    assert.deepEqual(observeRecoveryBaseline(readRecoveryReceipt(filePath)), { status: 'available', available: true })
    writeFileSync(baselinePath, '{"profile":"changed"}\n')
    assert.deepEqual(observeRecoveryBaseline(readRecoveryReceipt(filePath)), { status: 'hash_mismatch', available: false })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects control and bidi characters in persisted paths', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-board-path-'))
  try {
    const filePath = recoveryReceiptPath(path.join(root, 'settings.json'))
    assert.throws(() => writeRecoveryReceipt(filePath, { ...receipt, artifactPath: `${root}/bad\n2. injected.json` }), /invalid/)
    assert.throws(() => writeRecoveryReceipt(filePath, { ...receipt, artifactPath: `${root}/bad\u202eevil.json` }), /invalid/)
    assert.throws(() => writeRecoveryReceipt(filePath, { ...receipt, acceptedCandidateSha256: 'a'.repeat(64) }), /invalid/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
