const path = require('node:path')
const { realpathSync, statSync } = require('node:fs')

const MIN_HOME_RELATIVE_COMPONENTS = 2
const MAX_WORKSPACE_LABEL_CODE_POINTS = 72

function unsafeLabelCharacter(character) {
  const point = character.codePointAt(0) ?? 0
  return point <= 0x1f
    || (point >= 0x7f && point <= 0x9f)
    || point === 0x061c
    || point === 0x200e
    || point === 0x200f
    || (point >= 0x202a && point <= 0x202e)
    || (point >= 0x2066 && point <= 0x2069)
    || character === '/'
    || character === '\\'
}

function workspaceLabel(workspace) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) return null
  const basename = path.basename(workspace)
  const clean = Array.from(basename, (character) => unsafeLabelCharacter(character) ? ' ' : character)
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!clean) return null
  return Array.from(clean).slice(0, MAX_WORKSPACE_LABEL_CODE_POINTS).join('')
}

function executableIdentity(executable, options = {}) {
  const realpathImpl = options.realpathImpl ?? realpathSync
  const statImpl = options.statImpl ?? statSync
  if (typeof executable !== 'string' || !path.isAbsolute(executable)) return null
  try {
    const canonicalExecutable = realpathImpl(executable)
    if (typeof canonicalExecutable !== 'string'
      || canonicalExecutable.length === 0
      || canonicalExecutable.length > 2048
      || !path.isAbsolute(canonicalExecutable)
      || Array.from(canonicalExecutable).some((character) => unsafeLabelCharacter(character) && character !== '/' && character !== '\\')) return null
    const stat = statImpl(canonicalExecutable)
    if (!stat.isFile() || (stat.mode & 0o111) === 0) return null
    return Object.freeze({
      executable: canonicalExecutable,
      identity: `${String(stat.dev)}:${String(stat.ino)}`,
    })
  } catch {
    return null
  }
}

function selectedWorkspaceIdentity(workspace, options = {}) {
  const home = options.home
  const realpathImpl = options.realpathImpl ?? realpathSync
  const statImpl = options.statImpl ?? statSync
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace) || typeof home !== 'string' || !path.isAbsolute(home)) return null
  try {
    const canonicalHome = realpathImpl(home)
    const canonicalWorkspace = realpathImpl(workspace)
    const relative = path.relative(canonicalHome, canonicalWorkspace)
    const components = relative.split(path.sep).filter(Boolean)
    if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return null
    if (components.length < MIN_HOME_RELATIVE_COMPONENTS) return null
    const stat = statImpl(canonicalWorkspace)
    if (!stat.isDirectory()) return null
    const label = workspaceLabel(canonicalWorkspace)
    if (!label) return null
    return Object.freeze({
      workspace: canonicalWorkspace,
      identity: `${String(stat.dev)}:${String(stat.ino)}`,
      label,
    })
  } catch {
    return null
  }
}

module.exports = {
  MAX_WORKSPACE_LABEL_CODE_POINTS,
  MIN_HOME_RELATIVE_COMPONENTS,
  executableIdentity,
  selectedWorkspaceIdentity,
  workspaceLabel,
}
