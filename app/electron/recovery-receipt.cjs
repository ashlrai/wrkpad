const { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } = require('node:fs')
const { createHash, randomUUID } = require('node:crypto')
const path = require('node:path')

const RECOVERY_SCHEMA = 'ai.ashlr.agent-board.input-recovery/v1'
const MAX_RECOVERY_RECEIPT_BYTES = 8 * 1024
const MAX_RECOVERY_ARTIFACT_BYTES = 2 * 1024 * 1024
const MAX_LOCAL_PATH_LENGTH = 4096
function hasUnsafePathText(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069)
  })
}

function validLocalPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_LOCAL_PATH_LENGTH
    && path.isAbsolute(value)
    && !hasUnsafePathText(value)
}

function validIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function recoveryReceiptPath(settingsFilePath) {
  if (!validLocalPath(settingsFilePath)) throw new TypeError('settingsFilePath must be an absolute local path')
  return path.join(path.dirname(settingsFilePath), 'input-recovery-handoff.json')
}

function sanitizeRecoveryReceipt(value) {
  if (!value || value.schema !== RECOVERY_SCHEMA) return null
  if (!validLocalPath(value.artifactPath) || !/^[0-9a-f]{64}$/.test(value.sha256) || !validIsoTimestamp(value.createdAt)) return null
  return {
    schema: RECOVERY_SCHEMA,
    artifactPath: value.artifactPath,
    sha256: value.sha256,
    createdAt: value.createdAt,
  }
}

function readRecoveryReceipt(filePath) {
  let descriptor
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.size < 2 || stats.size > MAX_RECOVERY_RECEIPT_BYTES) return null
    return sanitizeRecoveryReceipt(JSON.parse(readFileSync(descriptor, 'utf8')))
  } catch {
    return null
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function writeRecoveryReceipt(filePath, value) {
  const receipt = sanitizeRecoveryReceipt({ ...value, schema: RECOVERY_SCHEMA })
  if (!receipt) throw new TypeError('recovery receipt is invalid')
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  })
  renameSync(temporaryPath, filePath)
  return receipt
}

function observeRecoveryArtifact(receipt) {
  if (!receipt || !validLocalPath(receipt.artifactPath) || !/^[0-9a-f]{64}$/.test(receipt.sha256)) return { status: 'invalid', available: false }
  let descriptor
  try {
    const pathStats = lstatSync(receipt.artifactPath)
    if (!pathStats.isFile() || pathStats.isSymbolicLink()) return { status: 'unsafe', available: false }
    descriptor = openSync(receipt.artifactPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.size < 2 || stats.size > MAX_RECOVERY_ARTIFACT_BYTES) return { status: 'unsafe', available: false }
    const sha256 = createHash('sha256').update(readFileSync(descriptor)).digest('hex')
    return sha256 === receipt.sha256
      ? { status: 'available', available: true }
      : { status: 'hash_mismatch', available: false }
  } catch (error) {
    return { status: error?.code === 'ENOENT' ? 'missing' : 'unavailable', available: false }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function removeRecoveryReceipt(filePath) {
  if (!validLocalPath(filePath)) return false
  try {
    const stats = lstatSync(filePath)
    if (!stats.isFile() || stats.isSymbolicLink()) return false
    unlinkSync(filePath)
    return true
  } catch (error) {
    return error?.code === 'ENOENT'
  }
}

function buildRecoveryChecklist(receipt, observation = observeRecoveryArtifact(receipt)) {
  const artifactName = receipt ? path.basename(receipt.artifactPath) : null
  const artifact = receipt && observation?.available
    ? `Keep the ordinary Input export as your rollback backup. The corrected artifact is ${artifactName}; verify the displayed SHA-256 before import.`
    : receipt
      ? `The recorded corrected artifact ${artifactName} is missing, moved, unsafe, or does not match its saved SHA-256. Locate the exact file and verify it, or create a new corrected artifact before opening Input. Do not import a guessed file.`
    : 'In Input’s profile chooser, hover an ordinary US Creator Micro 2 profile and choose Export Profile. Keep that export as your rollback backup, then return here and choose Create corrected Input profile.'
  return [
    artifact,
    'End Flight Check. Use Command-Q to fully quit Agent Board, Codex/ChatGPT, Claude, and every other board controller; closing a window is not enough. Then power-cycle the Creator Micro 2.',
    'Open Work Louder Input alone. In the profile chooser, choose Import Profile and select the corrected JSON artifact.',
    'If Import Profile is absent, Input already has six profiles. Export a backup, then remove only an unused ordinary profile. Never delete or transform a protected KV_OAI profile or layer.',
    'On the Ashlr Agent Board Corrected row, choose Set as current profile, then select Ashlr Daily.',
    'Wait for Input to finish. “layout updated” is not acceptance. If Input says “update error, retry,” keep Input as the only board controller and retry; do not continue from an error.',
    'Use Command-Q to fully quit Input. Relaunch Input alone and confirm Ashlr Agent Board Corrected is still current with Ashlr Daily selected.',
    'Reopen Agent Board. Open Input Monitoring settings and manually verify the exact receiver build shown in Setup is enabled; Agent Board does not claim it can read this permission.',
    'Run a fresh Daily Flight Check using only the physical board. A passing receipt proves the shortcut path, not native Codex RGB or firmware compatibility.',
  ]
}

function recoveryChecklistText(receipt, observation = observeRecoveryArtifact(receipt)) {
  const artifactName = receipt ? path.basename(receipt.artifactPath) : null
  const heading = receipt
    ? `Ashlr Agent Board Input-only recovery handoff\nArtifact filename: ${artifactName}\nSHA-256: ${receipt.sha256}\nCreated: ${receipt.createdAt}`
    : 'Ashlr Agent Board Input-only recovery checklist'
  return `${heading}\nAvailability: ${receipt ? observation.status : 'no_saved_artifact'}\n\n${buildRecoveryChecklist(receipt, observation).map((step, index) => `${index + 1}. ${step}`).join('\n')}\n`
}

module.exports = {
  MAX_RECOVERY_ARTIFACT_BYTES,
  MAX_RECOVERY_RECEIPT_BYTES,
  RECOVERY_SCHEMA,
  buildRecoveryChecklist,
  readRecoveryReceipt,
  observeRecoveryArtifact,
  recoveryChecklistText,
  recoveryReceiptPath,
  removeRecoveryReceipt,
  sanitizeRecoveryReceipt,
  writeRecoveryReceipt,
}
