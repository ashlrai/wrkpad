const { spawn } = require('node:child_process')

const CMUX_CLI_PATH = '/Applications/cmux.app/Contents/Resources/bin/cmux'
const CMUX_LOCATOR_SCHEMA = 'dev.wrkpad.cmux-locator/v1'
const LOCATOR_MAX_AGE_MS = 5 * 60 * 1000
const MAX_OUTPUT_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 1500
const REQUIRED_CAPABILITIES = Object.freeze(['system.identify', 'workspace.select', 'surface.focus'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SESSION_BINDING = /^hmac-sha256:[0-9a-f]{64}$/
const MAX_SOCKET_PATH_BYTES = 1024

function locatorResult(ok, code, locator) {
  return { ok, code, locator }
}

function validateLocator(candidate, now = new Date(), expectedSessionBinding) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return locatorResult(false, 'locator_unavailable')
  if (candidate.schema !== CMUX_LOCATOR_SCHEMA) return locatorResult(false, 'locator_schema_unsupported')
  if (candidate.provider !== 'claude') return locatorResult(false, 'locator_provider_mismatch')
  if (!SESSION_BINDING.test(candidate.sessionBinding ?? '')) return locatorResult(false, 'locator_binding_invalid')
  if (!SESSION_BINDING.test(expectedSessionBinding ?? '')) return locatorResult(false, 'locator_binding_unverified')
  if (candidate.sessionBinding !== expectedSessionBinding) return locatorResult(false, 'locator_binding_mismatch')
  if (!UUID.test(candidate.workspaceId ?? '') || !UUID.test(candidate.surfaceId ?? '')) return locatorResult(false, 'locator_id_invalid')
  const capturedAt = Date.parse(candidate.capturedAt)
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN
  if (!Number.isFinite(capturedAt) || !Number.isFinite(nowMs)) return locatorResult(false, 'locator_time_invalid')
  const age = nowMs - capturedAt
  if (age < -5_000 || age > LOCATOR_MAX_AGE_MS) return locatorResult(false, 'locator_stale')
  return locatorResult(true, 'ok', {
    schema: CMUX_LOCATOR_SCHEMA,
    provider: 'claude',
    sessionBinding: candidate.sessionBinding,
    workspaceId: candidate.workspaceId.toLowerCase(),
    surfaceId: candidate.surfaceId.toLowerCase(),
    capturedAt: new Date(capturedAt).toISOString(),
  })
}

function parseVersion(output) {
  if (typeof output !== 'string') return null
  const match = /^cmux (\d+)\.(\d+)\.(\d+) \((\d+)\) \[([0-9a-f]{7,40})\]$/i.exec(output.trim())
  if (!match) return null
  const version = { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), build: Number(match[4]), revision: match[5].toLowerCase() }
  const supported = version.major === 0 && version.minor === 62 && version.patch >= 2
  return { ...version, supported, text: `${version.major}.${version.minor}.${version.patch}` }
}

function parseJsonObject(output) {
  if (typeof output !== 'string' || Buffer.byteLength(output) > MAX_OUTPUT_BYTES) return null
  try {
    const parsed = JSON.parse(output)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const value = parsed.result && typeof parsed.result === 'object' && !Array.isArray(parsed.result) ? parsed.result : parsed
    return value
  } catch {
    return null
  }
}

function validSocketPath(value) {
  return typeof value === 'string'
    && value.startsWith('/')
    && Buffer.byteLength(value) <= MAX_SOCKET_PATH_BYTES
    && !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint <= 0x1f || codePoint === 0x7f
    })
}

function parseCapabilities(output) {
  const value = parseJsonObject(output)
  if (!value || !Array.isArray(value.methods) || value.methods.length > 512) return null
  if (!value.methods.every((method) => typeof method === 'string' && method.length > 0 && method.length <= 100)) return null
  if (value.protocol !== 'cmux-socket' || !validSocketPath(value.socket_path)) return null
  const methods = new Set(value.methods)
  return {
    protocol: value.protocol,
    socketPath: value.socket_path,
    accessMode: typeof value.access_mode === 'string' && value.access_mode.length <= 80 ? value.access_mode : null,
    required: REQUIRED_CAPABILITIES.every((method) => methods.has(method)),
  }
}

function identifyMatches(output, locator, expectedSocketPath) {
  const value = parseJsonObject(output)
  const caller = value?.caller
  if (!validSocketPath(expectedSocketPath) || value?.socket_path !== expectedSocketPath) return false
  if (!caller || typeof caller !== 'object' || Array.isArray(caller)) return false
  if (!UUID.test(caller.workspace_id ?? '') || !UUID.test(caller.surface_id ?? '')) return false
  return caller.workspace_id.toLowerCase() === locator.workspaceId
    && caller.surface_id.toLowerCase() === locator.surfaceId
}

function commandArgs(command, locator, socketPath) {
  const needsLocator = ['identify', 'select_workspace', 'focus_surface'].includes(command)
  if (needsLocator && (!locator || !UUID.test(locator.workspaceId ?? '') || !UUID.test(locator.surfaceId ?? ''))) return null
  if (needsLocator && !validSocketPath(socketPath)) return null
  const socket = needsLocator ? ['--socket', socketPath] : []
  switch (command) {
    case 'version': return ['--version']
    case 'help': return ['--help']
    case 'capabilities': return ['--json', 'capabilities']
    case 'identify': return [...socket, '--json', '--id-format', 'uuids', 'identify', '--workspace', locator.workspaceId, '--surface', locator.surfaceId]
    case 'select_workspace': return [...socket, 'select-workspace', '--workspace', locator.workspaceId]
    case 'focus_surface': return [...socket, 'focus-panel', '--workspace', locator.workspaceId, '--panel', locator.surfaceId]
    default: return null
  }
}

function createCmuxCliRunner(options = {}) {
  const spawnImpl = options.spawnImpl ?? spawn
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES

  async function invoke(command, locator, socketPath) {
    const args = commandArgs(command, locator, socketPath)
    if (!args) return { ok: false, code: 'forbidden_command' }
    return new Promise((resolve) => {
      const environment = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }
      if (typeof process.env.HOME === 'string') environment.HOME = process.env.HOME
      let child
      try {
        child = spawnImpl(CMUX_CLI_PATH, args, { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch {
        resolve({ ok: false, code: 'spawn_failed' })
        return
      }
      let stdout = Buffer.alloc(0)
      let stderr = Buffer.alloc(0)
      let settled = false
      const finish = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const append = (current, chunk) => Buffer.concat([current, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        finish({ ok: false, code: 'timeout' })
      }, timeoutMs)
      child.stdout.on('data', (chunk) => {
        stdout = append(stdout, chunk)
        if (stdout.length > maxOutputBytes) {
          child.kill('SIGTERM')
          finish({ ok: false, code: 'output_too_large' })
        }
      })
      child.stderr.on('data', (chunk) => {
        stderr = append(stderr, chunk)
        if (stderr.length > maxOutputBytes) {
          child.kill('SIGTERM')
          finish({ ok: false, code: 'output_too_large' })
        }
      })
      child.once('error', (error) => finish({ ok: false, code: error?.code === 'ENOENT' ? 'cli_unavailable' : 'spawn_failed' }))
      child.once('close', (code) => {
        if (code === 0) finish({ ok: true, code: 'ok', output: stdout.toString('utf8').trim() })
        else if (stderr.toString('utf8').includes('Access denied')) finish({ ok: false, code: 'access_denied' })
        else finish({ ok: false, code: 'command_failed' })
      })
    })
  }

  return Object.freeze({ cliPath: CMUX_CLI_PATH, invoke })
}

function createCmuxFocusAdapter(options = {}) {
  const runner = options.runner ?? createCmuxCliRunner()
  const foreground = options.foreground
  const now = options.now ?? (() => new Date())
  if (typeof foreground !== 'function') throw new TypeError('cmux foreground callback is required')

  async function fallback(reason) {
    const opened = await foreground()
    return { ok: opened, opened, exact: false, reason }
  }

  async function focus(candidate, expectedSessionBinding) {
    const validation = validateLocator(candidate, now(), expectedSessionBinding)
    if (!validation.ok) return fallback(validation.code)
    const locator = validation.locator

    const versionResult = await runner.invoke('version', locator)
    if (!versionResult.ok) return fallback(versionResult.code)
    const version = parseVersion(versionResult.output)
    if (!version) return fallback('version_malformed')
    if (!version.supported) return fallback('version_unsupported')

    const helpResult = await runner.invoke('help', locator)
    if (!helpResult.ok) return fallback(helpResult.code)
    if (!['capabilities', 'identify', 'select-workspace', 'focus-panel'].every((command) => helpResult.output.includes(command))) {
      return fallback('command_surface_incomplete')
    }

    const capabilityResult = await runner.invoke('capabilities', locator)
    if (!capabilityResult.ok) return fallback(capabilityResult.code)
    const capabilities = parseCapabilities(capabilityResult.output)
    if (!capabilities) return fallback('capabilities_malformed')
    if (!capabilities.required) return fallback('capabilities_incomplete')

    const identifyResult = await runner.invoke('identify', locator, capabilities.socketPath)
    if (!identifyResult.ok) return fallback(identifyResult.code)
    if (!identifyMatches(identifyResult.output, locator, capabilities.socketPath)) return fallback('locator_mismatch')

    const opened = await foreground()
    if (!opened) return { ok: false, opened: false, exact: false, reason: 'app_unavailable' }
    const workspaceResult = await runner.invoke('select_workspace', locator, capabilities.socketPath)
    if (!workspaceResult.ok) return { ok: true, opened: true, exact: false, reason: workspaceResult.code }
    const surfaceResult = await runner.invoke('focus_surface', locator, capabilities.socketPath)
    if (!surfaceResult.ok) return { ok: true, opened: true, exact: false, reason: surfaceResult.code }
    return { ok: true, opened: true, exact: true, reason: 'focus_cli_accepted', version: version.text }
  }

  return Object.freeze({ focus })
}

module.exports = {
  CMUX_CLI_PATH,
  CMUX_LOCATOR_SCHEMA,
  LOCATOR_MAX_AGE_MS,
  REQUIRED_CAPABILITIES,
  commandArgs,
  createCmuxCliRunner,
  createCmuxFocusAdapter,
  identifyMatches,
  parseCapabilities,
  parseVersion,
  validateLocator,
}
