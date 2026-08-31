const { accessSync, constants, statSync } = require('node:fs')
const path = require('node:path')

const FIXED_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

function executableFile(candidate) {
  try {
    accessSync(candidate, constants.X_OK)
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

function toolSearchDirectories(home, envPath) {
  const directories = [
    ...(typeof home === 'string' && path.isAbsolute(home)
      ? [path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin')]
      : []),
    ...FIXED_BIN_DIRS,
    ...(typeof envPath === 'string' ? envPath.split(path.delimiter) : []),
  ]
  return [...new Set(directories.filter((directory) => path.isAbsolute(directory)))]
}

function resolveTool(name, options = {}) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9._+-]+$/.test(name)) return null
  for (const directory of toolSearchDirectories(options.home, options.envPath)) {
    const candidate = path.join(directory, name)
    if (executableFile(candidate)) return candidate
  }
  return null
}

module.exports = { executableFile, resolveTool, toolSearchDirectories }
