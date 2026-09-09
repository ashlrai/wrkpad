const { spawn } = require('node:child_process')
const { lstatSync, readFileSync } = require('node:fs')
const path = require('node:path')

const CHATGPT_BUNDLE_PATH = '/Applications/ChatGPT.app'
const CHATGPT_BUNDLE_ID = 'com.openai.codex'
const CHATGPT_INFO_PLIST_PATH = `${CHATGPT_BUNDLE_PATH}/Contents/Info.plist`
const CODEX_CLI_PATH = `${CHATGPT_BUNDLE_PATH}/Contents/Resources/codex`
const OPEN_PATH = '/usr/bin/open'
const CODEX_URL_SCHEME = 'codex'
const DEFAULT_LIST_LIMIT = 6
const MAX_LIST_LIMIT = 24
const DEFAULT_TIMEOUT_MS = 3_000
const DEFAULT_OPEN_TIMEOUT_MS = 1_500
const DEFAULT_TERMINATION_GRACE_MS = 100
const DEFAULT_TERMINATION_SETTLE_MS = 100
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const MAX_PLIST_BYTES = 1024 * 1024
const MAX_TITLE_CODE_POINTS = 160
const MAX_CWD_BYTES = 4_096
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function unsafeCharacter(character) {
  const point = character.codePointAt(0) ?? 0
  return point <= 0x1f
    || (point >= 0x7f && point <= 0x9f)
    || (point >= 0x202a && point <= 0x202e)
    || (point >= 0x2066 && point <= 0x2069)
}

function hasUnsafeText(value) {
  return Array.from(value).some(unsafeCharacter)
}

function plistHasString(plist, key, expected) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const value = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`<key>\\s*${escaped}\\s*</key>\\s*<string>\\s*${value}\\s*</string>`).test(plist)
}

function plistHasUrlScheme(plist, expected) {
  const value = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const urlTypes = /<key>\s*CFBundleURLTypes\s*<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist)?.[1]
  if (!urlTypes) return false
  return new RegExp(`<key>\\s*CFBundleURLSchemes\\s*</key>\\s*<array>\\s*<string>\\s*${value}\\s*</string>`).test(urlTypes)
}

function validateInstalledCodexDesktop(options = {}) {
  const lstatImpl = options.lstatImpl ?? lstatSync
  const readFileImpl = options.readFileImpl ?? readFileSync
  try {
    const bundle = lstatImpl(CHATGPT_BUNDLE_PATH)
    const executable = lstatImpl(CODEX_CLI_PATH)
    if (!bundle.isDirectory() || bundle.isSymbolicLink()) return { ok: false, code: 'bundle_identity_invalid' }
    if (!executable.isFile() || executable.isSymbolicLink() || (executable.mode & 0o111) === 0) {
      return { ok: false, code: 'bundled_cli_identity_invalid' }
    }
    const plistBuffer = readFileImpl(CHATGPT_INFO_PLIST_PATH)
    if (!Buffer.isBuffer(plistBuffer) || plistBuffer.length === 0 || plistBuffer.length > MAX_PLIST_BYTES) {
      return { ok: false, code: 'bundle_metadata_invalid' }
    }
    const plist = plistBuffer.toString('utf8')
    if (!plistHasString(plist, 'CFBundleIdentifier', CHATGPT_BUNDLE_ID) || !plistHasUrlScheme(plist, CODEX_URL_SCHEME)) {
      return { ok: false, code: 'bundle_identity_invalid' }
    }
    return { ok: true, code: 'ok', cliPath: CODEX_CLI_PATH }
  } catch {
    return { ok: false, code: 'codex_desktop_unavailable' }
  }
}

function validThreadId(value) {
  return typeof value === 'string' && THREAD_ID.test(value)
}

function sanitizeTitle(name) {
  if (typeof name !== 'string') return 'Untitled Codex task'
  const normalized = Array.from(name, (character) => unsafeCharacter(character) ? ' ' : character).join('').replace(/\s+/gu, ' ').trim()
  if (!normalized) return 'Untitled Codex task'
  return Array.from(normalized).slice(0, MAX_TITLE_CODE_POINTS).join('')
}

function sanitizeCwd(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || Buffer.byteLength(value) > MAX_CWD_BYTES || hasUnsafeText(value)) return null
  const normalized = path.normalize(value)
  if (normalized !== value && !(value !== '/' && `${normalized}/` === value)) return null
  return normalized === '/' ? normalized : normalized.replace(/\/$/u, '')
}

function sanitizeUnixTimestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253_402_300_799) return null
  try {
    return new Date(value * 1_000).toISOString()
  } catch {
    return null
  }
}

function sanitizeThread(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
  if (!validThreadId(candidate.id)) return null
  const title = sanitizeTitle(candidate.name)
  const cwd = sanitizeCwd(candidate.cwd)
  const createdAt = sanitizeUnixTimestamp(candidate.createdAt)
  const updatedAt = sanitizeUnixTimestamp(candidate.updatedAt)
  if (!title || !cwd || !createdAt || !updatedAt || Date.parse(updatedAt) < Date.parse(createdAt)) return null
  return Object.freeze({
    threadId: candidate.id.toLowerCase(),
    title,
    cwd,
    createdAt,
    updatedAt,
  })
}

function appServerEnvironment() {
  const environment = { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }
  if (typeof process.env.HOME === 'string') environment.HOME = process.env.HOME
  if (typeof process.env.CODEX_HOME === 'string') environment.CODEX_HOME = process.env.CODEX_HOME
  return environment
}

function createAppServerRunner(options = {}) {
  const spawnImpl = options.spawnImpl ?? spawn
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const terminationGraceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS
  const terminationSettleMs = options.terminationSettleMs ?? DEFAULT_TERMINATION_SETTLE_MS
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES
  const maxStderrBytes = options.maxStderrBytes ?? MAX_STDERR_BYTES

  async function list(limit = DEFAULT_LIST_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) return { ok: false, code: 'limit_invalid' }
    return new Promise((resolve) => {
      let child
      try {
        child = spawnImpl(CODEX_CLI_PATH, ['app-server', '--stdio'], {
          env: appServerEnvironment(),
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch {
        resolve({ ok: false, code: 'spawn_failed' })
        return
      }

      let stdoutBytes = 0
      let stderrBytes = 0
      let lineBuffer = ''
      let initializeSeen = false
      let listResponse = null
      let settled = false
      let terminationCode = null
      let forceKillTimer = null
      let terminationSettleTimer = null

      const finish = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearTimeout(forceKillTimer)
        clearTimeout(terminationSettleTimer)
        resolve(result)
      }
      const terminate = (code) => {
        if (settled || terminationCode) return
        terminationCode = code
        try { child.kill('SIGTERM') } catch { /* escalate on the same fixed deadline */ }
        forceKillTimer = setTimeout(() => {
          try { child.kill('SIGKILL') } catch { /* close/error will settle */ }
          terminationSettleTimer = setTimeout(() => {
            if (code === 'complete') finish({ ok: false, code: 'termination_unconfirmed' })
            else finish({ ok: false, code })
          }, terminationSettleMs)
        }, terminationGraceMs)
      }
      const rejectProtocol = (code) => terminate(code)
      const handleLine = (line) => {
        if (terminationCode || line === '') return
        let message
        try { message = JSON.parse(line) } catch { rejectProtocol('protocol_malformed'); return }
        if (!message || typeof message !== 'object' || Array.isArray(message)) { rejectProtocol('protocol_malformed'); return }
        if (!Object.hasOwn(message, 'id')) return
        if (message.id !== 1 && message.id !== 2) { rejectProtocol('response_id_invalid'); return }
        if (Object.hasOwn(message, 'error')) { rejectProtocol('app_server_error'); return }
        if (!message.result || typeof message.result !== 'object' || Array.isArray(message.result)) { rejectProtocol('response_invalid'); return }
        if (message.id === 1) {
          if (initializeSeen || listResponse) { rejectProtocol('response_order_invalid'); return }
          initializeSeen = true
          return
        }
        if (!initializeSeen || listResponse) { rejectProtocol('response_order_invalid'); return }
        if (!Array.isArray(message.result.data) || message.result.data.length > limit) { rejectProtocol('thread_list_invalid'); return }
        listResponse = message.result.data
        terminate('complete')
      }

      const timer = setTimeout(() => terminate('timeout'), timeoutMs)
      child.stdout.on('data', (chunk) => {
        if (terminationCode) return
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        stdoutBytes += buffer.length
        if (stdoutBytes > maxOutputBytes) { terminate('output_too_large'); return }
        lineBuffer += buffer.toString('utf8')
        if (Buffer.byteLength(lineBuffer) > maxOutputBytes) { terminate('output_too_large'); return }
        const lines = lineBuffer.split('\n')
        lineBuffer = lines.pop() ?? ''
        for (const line of lines) handleLine(line.trimEnd())
      })
      child.stderr.on('data', (chunk) => {
        if (terminationCode) return
        stderrBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
        if (stderrBytes > maxStderrBytes) terminate('output_too_large')
      })
      child.stdin.once('error', () => {
        if (!terminationCode) terminate('stdin_failed')
      })
      child.once('error', (error) => {
        if (!terminationCode) finish({ ok: false, code: error?.code === 'ENOENT' ? 'bundled_cli_unavailable' : 'spawn_failed' })
      })
      child.once('close', (code) => {
        if (terminationCode === 'complete' && listResponse) finish({ ok: true, code: 'ok', threads: listResponse })
        else if (terminationCode) finish({ ok: false, code: terminationCode })
        else if (code === 0) finish({ ok: false, code: 'response_incomplete' })
        else finish({ ok: false, code: 'app_server_failed' })
      })

      const initialize = {
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'ashlr-agent-board', version: '0.2.0' },
          capabilities: { experimentalApi: false, optOutNotificationMethods: [] },
        },
      }
      const threadList = {
        id: 2,
        method: 'thread/list',
        params: {
          archived: false,
          limit,
          sortKey: 'updated_at',
          sortDirection: 'desc',
          useStateDbOnly: true,
        },
      }
      try {
        child.stdin.write(`${JSON.stringify(initialize)}\n${JSON.stringify(threadList)}\n`)
      } catch {
        terminate('stdin_failed')
      }
    })
  }

  return Object.freeze({ cliPath: CODEX_CLI_PATH, list })
}

function createDeepLinkOpener(options = {}) {
  const spawnImpl = options.spawnImpl ?? spawn
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS
  return async function openThread(threadId) {
    if (!validThreadId(threadId)) return { ok: false, dispatched: false, exact: false, reason: 'thread_id_invalid' }
    return new Promise((resolve) => {
      let child
      try {
        child = spawnImpl(OPEN_PATH, ['-b', CHATGPT_BUNDLE_ID, `${CODEX_URL_SCHEME}://threads/${threadId.toLowerCase()}`], {
          env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
          shell: false,
          stdio: 'ignore',
        })
      } catch {
        resolve({ ok: false, dispatched: false, exact: false, reason: 'deep_link_spawn_failed' })
        return
      }
      let settled = false
      const finish = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM') } catch { /* close/error may still arrive */ }
        finish({ ok: false, dispatched: false, exact: false, reason: 'deep_link_timeout' })
      }, timeoutMs)
      child.once('error', () => finish({ ok: false, dispatched: false, exact: false, reason: 'deep_link_spawn_failed' }))
      child.once('close', (code) => {
        if (code === 0) finish({ ok: true, dispatched: true, exact: false, reason: 'deep_link_dispatched_unverified' })
        else finish({ ok: false, dispatched: false, exact: false, reason: 'deep_link_failed' })
      })
    })
  }
}

function createCodexDesktopAdapter(options = {}) {
  const validateInstallation = options.validateInstallation ?? (() => validateInstalledCodexDesktop(options))
  const runner = options.runner ?? createAppServerRunner(options)
  const openThread = options.openThread ?? createDeepLinkOpener(options)

  return Object.freeze({
    async listRecentTasks(limit = DEFAULT_LIST_LIMIT) {
      const installation = validateInstallation()
      if (!installation?.ok) return { ok: false, code: installation?.code ?? 'codex_desktop_unavailable', tasks: [] }
      const response = await runner.list(limit)
      if (!response.ok) return { ok: false, code: response.code, tasks: [] }
      const tasks = response.threads.map(sanitizeThread)
      if (tasks.some((task) => !task)) return { ok: false, code: 'thread_list_invalid', tasks: [] }
      return { ok: true, code: 'ok', tasks }
    },
    async focusTask(task) {
      const installation = validateInstallation()
      if (!installation?.ok) return { ok: false, dispatched: false, exact: false, reason: installation?.code ?? 'codex_desktop_unavailable' }
      const threadId = typeof task === 'string' ? task : task?.threadId
      return openThread(threadId)
    },
  })
}

module.exports = {
  CHATGPT_BUNDLE_ID,
  CHATGPT_BUNDLE_PATH,
  CODEX_CLI_PATH,
  CODEX_URL_SCHEME,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  OPEN_PATH,
  createAppServerRunner,
  createCodexDesktopAdapter,
  createDeepLinkOpener,
  sanitizeCwd,
  sanitizeThread,
  sanitizeTitle,
  sanitizeUnixTimestamp,
  validThreadId,
  validateInstalledCodexDesktop,
}
