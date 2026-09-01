const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

const TRUSTED_GIT_EXECUTABLES = Object.freeze({
  darwin: Object.freeze(['/usr/bin/git']),
  linux: Object.freeze(['/usr/bin/git', '/bin/git']),
  win32: Object.freeze([
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\git.exe',
  ]),
})

function resolveGitExecutable(platform = process.platform, fileExists = existsSync) {
  const candidates = TRUSTED_GIT_EXECUTABLES[platform] || ['/usr/local/bin/git', '/usr/bin/git']
  return candidates.find((candidate) => fileExists(candidate)) || null
}

const FIXED_GIT_EXECUTABLE = process.platform === 'darwin' ? '/usr/bin/git' : resolveGitExecutable()
const FILTER_GUARDED_COMMANDS = new Set(['diff', 'status'])
const FILTER_CONFIG_PATTERN = '^[fF][iI][lL][tT][eE][rR]\\.'

function gitEnvironment(source = process.env) {
  const env = {}
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('GIT_')) continue
    env[key] = value
  }
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}

function hardenedGitArgs(args) {
  if (!Array.isArray(args) || args.length === 0 || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('git arguments must be a non-empty string array')
  }
  const [command, ...rest] = args
  const commandArgs = command === 'diff'
    ? [command, '--no-ext-diff', '--no-textconv', ...rest]
    : [command, ...rest]
  return ['-c', 'core.fsmonitor=false', '--no-pager', ...commandArgs]
}

function spawnGit(args, options = {}) {
  const executable = FIXED_GIT_EXECUTABLE
  const timeoutMs = options.timeoutMs ?? 2500
  const stdoutLimit = options.stdoutLimit ?? 20_000
  const stderrLimit = options.stderrLimit ?? 8_000
  const acceptedExitCodes = options.acceptedExitCodes ?? [0]

  if (!executable) return Promise.resolve({ ok: false, exitCode: null, stdout: '', stderr: '', error: 'Git is unavailable in a trusted system location.' })
  if (!path.isAbsolute(executable)) return Promise.resolve({ ok: false, exitCode: null, stdout: '', stderr: '', error: 'Git executable must use an absolute trusted path.' })

  return new Promise((resolve) => {
    let child
    try {
      child = spawn(executable, hardenedGitArgs(args), {
        cwd: options.cwd,
        env: gitEnvironment(options.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({ ok: false, exitCode: null, stdout: '', stderr: '', error: error.message })
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ ok: false, exitCode: null, stdout, stderr, error: `Git command timed out after ${timeoutMs} ms.` })
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      if (options.failOnStdoutLimit && stdout.length + text.length > stdoutLimit) {
        child.kill('SIGTERM')
        finish({ ok: false, exitCode: null, stdout: '', stderr, error: 'Git command output exceeded the safety limit.' })
        return
      }
      stdout += text
      if (stdout.length > stdoutLimit) stdout = stdout.slice(-stdoutLimit)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > stderrLimit) stderr = stderr.slice(-stderrLimit)
    })
    child.once('error', (error) => finish({ ok: false, exitCode: null, stdout, stderr, error: error.message }))
    child.once('close', (code) => {
      const ok = acceptedExitCodes.includes(code)
      finish({
        ok,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: ok ? '' : stderr.trim() || `Git exited with code ${code}.`,
      })
    })
  })
}

async function configuredFilterCommands(options = {}) {
  const result = await spawnGit([
    'config', '--local', '--null', '--name-only', '--get-regexp', FILTER_CONFIG_PATTERN,
  ], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: Math.min(options.timeoutMs ?? 2500, 2500),
    stdoutLimit: 64_000,
    stderrLimit: 8_000,
    failOnStdoutLimit: true,
    acceptedExitCodes: [0, 1],
  })
  if (!result.ok) return { ok: false, keys: [], error: `Could not verify Git content-filter safety: ${result.error}` }
  if (result.exitCode === 1) return { ok: true, keys: [], error: '' }
  const keys = result.stdout.split('\0').filter(Boolean).filter((key) => {
    const normalized = key.toLowerCase()
    return normalized.endsWith('.clean') || normalized.endsWith('.smudge') || normalized.endsWith('.process')
  })
  return { ok: true, keys: [...new Set(keys)].sort(), error: '' }
}

async function runGit(args, options = {}) {
  if (FILTER_GUARDED_COMMANDS.has(args?.[0])) {
    const filters = await configuredFilterCommands(options)
    if (!filters.ok) return { ok: false, exitCode: null, stdout: '', stderr: '', error: filters.error }
    if (filters.keys.length > 0) {
      return {
        ok: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        error: `Git inspection refused because configured content filters may execute helpers: ${filters.keys.join(', ')}.`,
      }
    }
  }
  return spawnGit(args, options)
}

module.exports = { FIXED_GIT_EXECUTABLE, configuredFilterCommands, gitEnvironment, hardenedGitArgs, resolveGitExecutable, runGit }
