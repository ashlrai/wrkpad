const { existsSync, readFileSync, renameSync, statSync, writeFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')

const MAX_SETTINGS_BYTES = 64 * 1024

function validWorkspace(value) {
  return typeof value === 'string' && path.isAbsolute(value) && value.length <= 4096 && !value.includes('\0')
}

function readWorkspaceSettings(filePath, fallbackWorkspace) {
  const fallback = validWorkspace(fallbackWorkspace) ? fallbackWorkspace : process.cwd()
  try {
    if (!existsSync(filePath) || statSync(filePath).size > MAX_SETTINGS_BYTES) return { workspace: fallback }
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return { workspace: validWorkspace(parsed?.workspace) ? parsed.workspace : fallback }
  } catch {
    return { workspace: fallback }
  }
}

function saveWorkspaceSettings(filePath, workspace) {
  if (!validWorkspace(workspace)) throw new TypeError('workspace must be an absolute local path')
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify({ workspace }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  })
  renameSync(temporaryPath, filePath)
}

module.exports = { MAX_SETTINGS_BYTES, readWorkspaceSettings, saveWorkspaceSettings, validWorkspace }

