const { lstatSync } = require('node:fs')
const { homedir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const INPUT_BUNDLE_ID = 'it.focusense.input-app'
const INPUT_TEAM_ID = '86245L52HA'
const MAX_COMMAND_OUTPUT_BYTES = 32 * 1024
const MAX_LOCAL_PATH_LENGTH = 4096
const PROBE_TIMEOUT_MS = 5_000
const FIXED_EXECUTABLES = new Set([
  '/usr/bin/codesign',
  '/usr/libexec/PlistBuddy',
  '/usr/sbin/spctl',
])

function result(status, version = null) {
  return { status, version }
}

function validCandidate(candidate) {
  return typeof candidate === 'string'
    && candidate.length > 0
    && candidate.length <= MAX_LOCAL_PATH_LENGTH
    && path.isAbsolute(candidate)
    && !candidate.includes('\0')
}

function defaultCandidates(home = homedir()) {
  if (!validCandidate(home)) return null
  return ['/Applications/Input.app', path.join(home, 'Applications', 'Input.app')]
}

function runFixed(executable, args, options = {}) {
  if (!FIXED_EXECUTABLES.has(executable) || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    return { status: null, stdout: '', stderr: '' }
  }
  const completed = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? PROBE_TIMEOUT_MS,
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    windowsHide: true,
  })
  if (completed.error || !Number.isInteger(completed.status)) return { status: null, stdout: '', stderr: '' }
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

function execute(runner, executable, args) {
  try {
    return normalizeRun(runner(executable, args, { timeout: PROBE_TIMEOUT_MS }))
  } catch {
    return null
  }
}

function metadataValue(runner, plistPath, key) {
  const probe = execute(runner, '/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath])
  if (!probe) return { unavailable: true, value: null }
  if (probe.status !== 0) return { unavailable: false, value: null }
  const value = probe.stdout.trim()
  return { unavailable: false, value }
}

function sanitizeVersion(value) {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC').trim()
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(normalized)) return null
  return normalized
}

function inspectInputInstallation(options = {}) {
  const candidates = options.candidates ?? defaultCandidates(options.home)
  const runner = options.runner ?? runFixed
  if (!Array.isArray(candidates) || candidates.length !== 2 || new Set(candidates).size !== 2 || candidates.some((candidate) => !validCandidate(candidate))) {
    return result('probe_unavailable')
  }

  const present = []
  for (const candidate of candidates) {
    try {
      const stats = lstatSync(candidate)
      if (stats.isSymbolicLink() || !stats.isDirectory()) return result('unsafe')
      present.push(candidate)
    } catch (error) {
      if (error?.code !== 'ENOENT') return result('probe_unavailable')
    }
  }

  if (present.length === 0) return result('missing')
  if (present.length > 1) return result('multiple_installations')

  const candidate = present[0]
  const plistPath = path.join(candidate, 'Contents', 'Info.plist')
  const bundle = metadataValue(runner, plistPath, 'CFBundleIdentifier')
  const versionProbe = metadataValue(runner, plistPath, 'CFBundleShortVersionString')
  if (bundle.unavailable || versionProbe.unavailable) return result('probe_unavailable')
  const version = sanitizeVersion(versionProbe.value)
  if (bundle.value !== INPUT_BUNDLE_ID || !version) return result('invalid_metadata')

  const identity = execute(runner, '/usr/bin/codesign', ['-dvvv', candidate])
  if (!identity) return result('probe_unavailable')
  if (identity.status !== 0) return result('invalid_signature', version)
  const identityText = `${identity.stdout}\n${identity.stderr}`
  const teamIds = [...identityText.matchAll(/^TeamIdentifier=([^\r\n]{1,128})$/gm)].map((match) => match[1])
  if (teamIds.length !== 1 || teamIds[0] !== INPUT_TEAM_ID) return result('publisher_unrecognized', version)

  const signature = execute(runner, '/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate])
  if (!signature) return result('probe_unavailable')
  if (signature.status !== 0) return result('invalid_signature', version)

  const gatekeeper = execute(runner, '/usr/sbin/spctl', ['--assess', '--type', 'execute', candidate])
  if (!gatekeeper) return result('probe_unavailable')
  if (gatekeeper.status !== 0) return result('gatekeeper_rejected', version)
  return result('verified', version)
}

module.exports = {
  INPUT_BUNDLE_ID,
  INPUT_TEAM_ID,
  MAX_COMMAND_OUTPUT_BYTES,
  PROBE_TIMEOUT_MS,
  defaultCandidates,
  inspectInputInstallation,
  runFixed,
  sanitizeVersion,
}
