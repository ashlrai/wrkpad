const { lstatSync, readdirSync, realpathSync } = require('node:fs')
const { homedir } = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const INPUT_BUNDLE_ID = 'it.focusense.input-app'
const INPUT_TEAM_ID = '86245L52HA'
const KNOWN_MUTATED_RESOURCE = path.join('Contents', 'Resources', 'scripts', 'window-info-retriever.scpt')
const MAX_COMMAND_OUTPUT_BYTES = 32 * 1024
const MAX_LOCAL_PATH_LENGTH = 4096
const MAX_EXECUTABLE_ENTRIES = 64
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

function canonicalCandidate(candidate) {
  try {
    return realpathSync.native(candidate) === path.resolve(candidate) ? 'canonical' : 'mismatch'
  } catch {
    return 'unavailable'
  }
}

function statFingerprint(target) {
  try {
    const stats = lstatSync(target, { bigint: true })
    return [stats.dev, stats.ino, stats.mode, stats.nlink, stats.size, stats.mtimeNs, stats.ctimeNs]
      .map((value) => value.toString())
      .join(':')
  } catch (error) {
    return error?.code === 'ENOENT' ? 'missing' : null
  }
}

function bundleFingerprint(candidate) {
  if (canonicalCandidate(candidate) !== 'canonical') return null
  const tracked = [
    candidate,
    path.join(candidate, 'Contents'),
    path.join(candidate, 'Contents', 'Info.plist'),
    path.join(candidate, 'Contents', '_CodeSignature'),
    path.join(candidate, 'Contents', '_CodeSignature', 'CodeResources'),
    path.join(candidate, 'Contents', 'MacOS'),
  ]
  const macosDirectory = path.join(candidate, 'Contents', 'MacOS')
  let executableEntries = []
  try {
    executableEntries = readdirSync(macosDirectory).sort()
  } catch (error) {
    if (error?.code !== 'ENOENT') return null
  }
  if (executableEntries.length > MAX_EXECUTABLE_ENTRIES) return null
  tracked.push(...executableEntries.map((entry) => path.join(macosDirectory, entry)))
  const fingerprints = tracked.map(statFingerprint)
  if (fingerprints.some((fingerprint) => fingerprint === null)) return null
  return fingerprints.join('|')
}

function executeStable(runner, executable, args, candidate, baseline) {
  if (bundleFingerprint(candidate) !== baseline) return null
  const probe = execute(runner, executable, args)
  if (!probe || bundleFingerprint(candidate) !== baseline) return null
  return probe
}

function metadataValue(runner, plistPath, key, candidate, baseline) {
  const probe = executeStable(runner, '/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plistPath], candidate, baseline)
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

function isKnownResourceMutation(probe, candidate) {
  const lines = `${probe.stdout}\n${probe.stderr}`
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
  const expectedSummary = `${candidate}: a sealed resource is missing or invalid`
  const expectedMutation = `file modified: ${path.join(candidate, KNOWN_MUTATED_RESOURCE)}`
  return lines.length === 2
    && lines.filter((line) => line === expectedSummary).length === 1
    && lines.filter((line) => line === expectedMutation).length === 1
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
  const candidateState = canonicalCandidate(candidate)
  if (candidateState === 'mismatch') return result('unsafe')
  if (candidateState !== 'canonical') return result('probe_unavailable')
  const baseline = bundleFingerprint(candidate)
  if (!baseline) return result('probe_unavailable')
  const plistPath = path.join(candidate, 'Contents', 'Info.plist')
  const bundle = metadataValue(runner, plistPath, 'CFBundleIdentifier', candidate, baseline)
  const versionProbe = metadataValue(runner, plistPath, 'CFBundleShortVersionString', candidate, baseline)
  if (bundle.unavailable || versionProbe.unavailable) return result('probe_unavailable')
  const version = sanitizeVersion(versionProbe.value)
  if (bundle.value !== INPUT_BUNDLE_ID || !version) return result('invalid_metadata')

  const identity = executeStable(runner, '/usr/bin/codesign', ['-dvvv', candidate], candidate, baseline)
  if (!identity) return result('probe_unavailable')
  if (identity.status !== 0) return result('invalid_signature', version)
  const identityText = `${identity.stdout}\n${identity.stderr}`
  const teamIds = [...identityText.matchAll(/^TeamIdentifier=([^\r\n]{1,128})$/gm)].map((match) => match[1])
  if (teamIds.length !== 1 || teamIds[0] !== INPUT_TEAM_ID) return result('publisher_unrecognized', version)

  const signature = executeStable(runner, '/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=1', candidate], candidate, baseline)
  if (!signature) return result('probe_unavailable')
  if (signature.status !== 0) {
    if (version === '0.18.4' && isKnownResourceMutation(signature, candidate)) return result('known_resource_mutation', version)
    return result('invalid_signature', version)
  }

  const confirmedIdentity = executeStable(runner, '/usr/bin/codesign', ['-dvvv', candidate], candidate, baseline)
  if (!confirmedIdentity) return result('probe_unavailable')
  if (confirmedIdentity.status !== 0) return result('invalid_signature', version)
  const confirmedIdentityText = `${confirmedIdentity.stdout}\n${confirmedIdentity.stderr}`
  const confirmedTeamIds = [...confirmedIdentityText.matchAll(/^TeamIdentifier=([^\r\n]{1,128})$/gm)].map((match) => match[1])
  if (confirmedTeamIds.length !== 1 || confirmedTeamIds[0] !== INPUT_TEAM_ID) return result('publisher_unrecognized', version)

  const gatekeeper = executeStable(runner, '/usr/sbin/spctl', ['--assess', '--type', 'execute', candidate], candidate, baseline)
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
