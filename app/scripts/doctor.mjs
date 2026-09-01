import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { resolveTool } = require('../electron/tool-resolver.cjs')

const REQUIRED_CHECKS = [
  {
    key: 'board',
    name: 'Creator Micro 2 USB',
    nextAction: 'Connect the Creator Micro 2 with a data-capable USB-C cable, then rerun the doctor.',
  },
  {
    key: 'input',
    name: 'Work Louder Input',
    nextAction: 'Install the signed Work Louder Input app, then rerun the doctor.',
  },
]

const OPTIONAL_CHECKS = [
  { key: 'chatgpt', name: 'ChatGPT desktop' },
  { key: 'codex', name: 'Codex CLI' },
  { key: 'claude', name: 'Claude Code' },
  { key: 'ashlr', name: 'Ashlr Hub' },
  { key: 'logitech', name: 'Competing Logitech HID owner' },
]

const MANUAL_CHECKS = [
  {
    id: 'input-monitoring',
    name: 'Input Monitoring',
    detail: 'Verify the shortcut-receiving app in System Settings → Privacy & Security → Input Monitoring.',
  },
  {
    id: 'input-layer',
    name: 'Work Louder Input layer',
    detail: 'Verify the canonical daily shortcut layer is active in Work Louder Input.',
  },
  {
    id: 'flight-check',
    name: 'Physical Flight Check',
    detail: 'Run the Daily Flight Check in Agent Board and export a passing receipt.',
  },
]

const makeCheck = (definition, probe, category) => ({
  name: definition.name,
  ok: Boolean(probe?.ok),
  detail: probe?.detail || 'unavailable',
  category,
  severity: probe?.ok ? 'pass' : category === 'required' ? 'error' : 'warning',
  blocking: category === 'required',
})

export function evaluateDoctor(probes) {
  const requiredChecks = REQUIRED_CHECKS.map((definition) =>
    makeCheck(definition, probes[definition.key], 'required'),
  )
  const optionalChecks = OPTIONAL_CHECKS.map((definition) =>
    makeCheck(definition, probes[definition.key], 'optional'),
  )
  const failedRequiredIndex = requiredChecks.findIndex((check) => !check.ok)
  const manualChecks = MANUAL_CHECKS.map((check) => ({
    ...check,
    category: 'manual',
    status: 'manual',
    blocking: false,
  }))

  return {
    ok: failedRequiredIndex === -1,
    checks: [...requiredChecks, ...optionalChecks],
    manualChecks,
    nextAction:
      failedRequiredIndex === -1
        ? manualChecks[0].detail
        : REQUIRED_CHECKS[failedRequiredIndex].nextAction,
  }
}

const run = (executable, args) => {
  try {
    return execFileSync(executable, args, { encoding: 'utf8', timeout: 5000 }).trim()
  } catch {
    return null
  }
}

const toolProbe = (tool) => {
  const executable = resolveTool(tool, { home: homedir() })
  const version = executable ? run(executable, ['--version']) : null
  return { ok: Boolean(version), detail: version || 'unavailable' }
}

function collectProbes() {
  const usb = run('/usr/sbin/ioreg', ['-p', 'IOUSB', '-n', 'Creator Micro 2', '-r', '-l'])
  const boardDetected = Boolean(usb?.includes('Work Louder') && usb.includes('33432'))
  const chatgptInstalled = existsSync('/Applications/ChatGPT.app')
  const inputInstalled = existsSync('/Applications/Input.app')
  const logitechOwner = run('/usr/bin/pgrep', ['-fl', 'logioptionsplus_agent'])

  return {
    board: { ok: boardDetected, detail: boardDetected ? 'Work Louder 303A:8298' : 'not detected' },
    input: { ok: inputInstalled, detail: inputInstalled ? 'installed' : 'missing' },
    chatgpt: { ok: chatgptInstalled, detail: chatgptInstalled ? 'installed' : 'missing' },
    codex: toolProbe('codex'),
    claude: toolProbe('claude'),
    ashlr: toolProbe('ashlr'),
    logitech: {
      ok: !logitechOwner,
      detail: logitechOwner ? 'running; may interfere with the Micro' : 'not running',
    },
  }
}

function printHuman(result) {
  const sections = [
    ['Required', result.checks.filter((check) => check.category === 'required')],
    ['Optional integrations', result.checks.filter((check) => check.category === 'optional')],
  ]

  for (const [heading, checks] of sections) {
    console.log(`${heading}:`)
    for (const check of checks) console.log(`  ${check.ok ? '✓' : check.blocking ? '✕' : '!'} ${check.name}: ${check.detail}`)
  }

  console.log('Manual verification:')
  for (const check of result.manualChecks) console.log(`  • ${check.name}: ${check.detail}`)
  console.log(`\n${result.ok ? 'Doctor passed required checks.' : 'Doctor failed required checks.'}`)
  console.log(`Next: ${result.nextAction}`)
}

function main() {
  const result = evaluateDoctor(collectProbes())
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else printHuman(result)
  process.exitCode = result.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
