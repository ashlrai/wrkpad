const { spawnSync } = require('node:child_process')
const fs = require('node:fs')

const CHATGPT_APPLICATION_PATH = '/Applications/ChatGPT.app'
const CHATGPT_INFO_PLIST_PATH = '/Applications/ChatGPT.app/Contents/Info.plist'
const PLUTIL_PATH = '/usr/bin/plutil'
const MAX_COMMAND_OUTPUT_BYTES = 512
const PROBE_TIMEOUT_MS = 3_000
const METADATA_KEYS = new Set(['CFBundleShortVersionString', 'CFBundleVersion'])

function result(installed, status, version = null, build = null) {
  return { installed, version, build, status }
}

function expectedArguments(key) {
  return ['-extract', key, 'raw', '-o', '-', CHATGPT_INFO_PLIST_PATH]
}

function runFixed(executable, args, options = {}) {
  const key = Array.isArray(args) ? args[1] : null
  if (
    executable !== PLUTIL_PATH
    || !METADATA_KEYS.has(key)
    || args.length !== 6
    || args.some((argument, index) => argument !== expectedArguments(key)[index])
  ) {
    return { status: null, stdout: '', stderr: '' }
  }

  const completed = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? PROBE_TIMEOUT_MS,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  if (completed.error || !Number.isInteger(completed.status)) {
    return { status: null, stdout: '', stderr: '' }
  }
  return {
    status: completed.status,
    stdout: typeof completed.stdout === 'string' ? completed.stdout : '',
    stderr: typeof completed.stderr === 'string' ? completed.stderr : '',
  }
}

function normalizeRun(value) {
  if (!value || !Number.isInteger(value.status)) return null
  if (typeof value.stdout !== 'string' || typeof value.stderr !== 'string') return null
  if (Buffer.byteLength(value.stdout, 'utf8') > MAX_COMMAND_OUTPUT_BYTES) return null
  if (Buffer.byteLength(value.stderr, 'utf8') > MAX_COMMAND_OUTPUT_BYTES) return null
  return value
}

function sanitizeMetadata(value) {
  if (typeof value !== 'string') return null
  if (Buffer.byteLength(value, 'utf8') > MAX_COMMAND_OUTPUT_BYTES) return null
  const match = /^([0-9A-Za-z][0-9A-Za-z._+-]{0,63})(?:\r?\n)?$/u.exec(value)
  return match?.[1] ?? null
}

function fingerprint(stats) {
  return [stats.dev, stats.ino, stats.mode, stats.nlink, stats.size, stats.mtimeNs, stats.ctimeNs]
    .map((value) => value.toString())
    .join(':')
}

function safeStat(filesystem, target, expectedType) {
  try {
    const stats = filesystem.lstatSync(target, { bigint: true })
    const validType = expectedType === 'directory' ? stats.isDirectory() : stats.isFile()
    if (stats.isSymbolicLink() || !validType) return { status: 'unsafe' }
    return { status: 'safe', fingerprint: fingerprint(stats) }
  } catch (error) {
    return { status: error?.code === 'ENOENT' ? 'missing' : 'unavailable' }
  }
}

function captureInstallation(filesystem) {
  const entries = [
    ['/', 'directory'],
    ['/Applications', 'directory'],
    [CHATGPT_APPLICATION_PATH, 'directory'],
    ['/Applications/ChatGPT.app/Contents', 'directory'],
    [CHATGPT_INFO_PLIST_PATH, 'file'],
  ]
  const fingerprints = []

  for (let index = 0; index < entries.length; index += 1) {
    const [target, expectedType] = entries[index]
    const inspected = safeStat(filesystem, target, expectedType)
    if (inspected.status !== 'safe') {
      return {
        status: inspected.status,
        installed: index > 2 || (index === 2 && inspected.status !== 'missing'),
        missingIndex: inspected.status === 'missing' ? index : null,
      }
    }
    fingerprints.push(inspected.fingerprint)
  }

  return { status: 'safe', installed: true, fingerprints }
}

function sameInstallation(filesystem, baseline) {
  const current = captureInstallation(filesystem)
  return current.status === 'safe'
    && current.fingerprints.length === baseline.fingerprints.length
    && current.fingerprints.every((value, index) => value === baseline.fingerprints[index])
}

function runMetadataProbe(runner, filesystem, baseline, key) {
  let completed = null
  try {
    completed = normalizeRun(runner(PLUTIL_PATH, expectedArguments(key), {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    }))
  } catch {
    completed = null
  }

  if (!sameInstallation(filesystem, baseline)) return { status: 'changed' }
  if (!completed || completed.status !== 0) return { status: 'unavailable' }
  if (completed.stderr !== '') return { status: 'malformed' }
  const value = sanitizeMetadata(completed.stdout)
  return value ? { status: 'available', value } : { status: 'malformed' }
}

function inspectChatGptInstallation(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return result(false, 'probe_unavailable')
  }
  const filesystem = options.filesystem ?? fs
  const runner = options.runner ?? runFixed
  if (
    !filesystem
    || typeof filesystem.lstatSync !== 'function'
    || typeof runner !== 'function'
  ) return result(false, 'probe_unavailable')

  const baseline = captureInstallation(filesystem)
  if (baseline.status === 'missing') {
    return baseline.missingIndex === 2
      ? result(false, 'missing')
      : result(baseline.installed, 'probe_unavailable')
  }
  if (baseline.status === 'unsafe') return result(baseline.installed, 'unsafe')
  if (baseline.status !== 'safe') return result(baseline.installed, 'probe_unavailable')

  const version = runMetadataProbe(runner, filesystem, baseline, 'CFBundleShortVersionString')
  if (version.status === 'changed') return result(true, 'changed_during_probe')
  if (version.status === 'unavailable') return result(true, 'probe_unavailable')
  if (version.status !== 'available') return result(true, 'invalid_metadata')

  const build = runMetadataProbe(runner, filesystem, baseline, 'CFBundleVersion')
  if (build.status === 'changed') return result(true, 'changed_during_probe')
  if (build.status === 'unavailable') return result(true, 'probe_unavailable')
  if (build.status !== 'available') return result(true, 'invalid_metadata')

  return sameInstallation(filesystem, baseline)
    ? result(true, 'installed', version.value, build.value)
    : result(true, 'changed_during_probe')
}

module.exports = {
  CHATGPT_APPLICATION_PATH,
  CHATGPT_INFO_PLIST_PATH,
  MAX_COMMAND_OUTPUT_BYTES,
  PLUTIL_PATH,
  PROBE_TIMEOUT_MS,
  inspectChatGptInstallation,
  runFixed,
  sanitizeMetadata,
}
