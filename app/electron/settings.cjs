const { existsSync, readFileSync, renameSync, statSync, writeFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')

const APP_DATA_DIRECTORY_NAME = 'ashlr-agent-board'
const MAX_SETTINGS_BYTES = 64 * 1024
const BOARD_ROUTES = new Set(['unknown', 'codex_native', 'ashlr_layer'])

function appSettingsPath(appDataRoot) {
  if (!validWorkspace(appDataRoot)) throw new TypeError('appDataRoot must be an absolute local path')
  return path.join(appDataRoot, APP_DATA_DIRECTORY_NAME, 'settings.json')
}

function validWorkspace(value) {
  return typeof value === 'string' && path.isAbsolute(value) && value.length <= 4096 && !value.includes('\0')
}

function validBoardRoute(value) {
  return typeof value === 'string' && BOARD_ROUTES.has(value)
}

function readAppSettings(filePath, fallbackWorkspace) {
  const fallback = validWorkspace(fallbackWorkspace) ? fallbackWorkspace : process.cwd()
  try {
    if (!existsSync(filePath) || statSync(filePath).size > MAX_SETTINGS_BYTES) return { workspace: fallback, boardRoute: 'unknown' }
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    return {
      workspace: validWorkspace(parsed?.workspace) ? parsed.workspace : fallback,
      boardRoute: validBoardRoute(parsed?.boardRoute) ? parsed.boardRoute : 'unknown',
    }
  } catch {
    return { workspace: fallback, boardRoute: 'unknown' }
  }
}

function writeAppSettings(filePath, settings) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  })
  renameSync(temporaryPath, filePath)
}

function saveWorkspaceSettings(filePath, workspace, fallbackWorkspace = workspace) {
  if (!validWorkspace(workspace)) throw new TypeError('workspace must be an absolute local path')
  const current = readAppSettings(filePath, fallbackWorkspace)
  writeAppSettings(filePath, { ...current, workspace })
}

function saveBoardRouteSettings(filePath, boardRoute, fallbackWorkspace) {
  if (!validBoardRoute(boardRoute)) throw new TypeError('boardRoute must be a supported declaration')
  const current = readAppSettings(filePath, fallbackWorkspace)
  writeAppSettings(filePath, { ...current, boardRoute })
}

const readWorkspaceSettings = readAppSettings

module.exports = {
  BOARD_ROUTES,
  MAX_SETTINGS_BYTES,
  appSettingsPath,
  readAppSettings,
  readWorkspaceSettings,
  saveBoardRouteSettings,
  saveWorkspaceSettings,
  validBoardRoute,
  validWorkspace,
}
