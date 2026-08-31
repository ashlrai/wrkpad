import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const checks = []
const check = (name, ok, detail, blocking = true) => checks.push({ name, ok, detail, severity: ok ? 'pass' : blocking ? 'error' : 'warning', blocking })
const run = (executable, args) => {
  try { return execFileSync(executable, args, { encoding: 'utf8', timeout: 5000 }).trim() }
  catch { return null }
}

const usb = run('/usr/sbin/ioreg', ['-p', 'IOUSB', '-n', 'Creator Micro 2', '-r', '-l'])
check('Creator Micro 2 USB', Boolean(usb?.includes('Work Louder') && usb.includes('33432')), usb ? 'Work Louder 303A:8298' : 'not detected')
check('ChatGPT desktop', existsSync('/Applications/ChatGPT.app'), existsSync('/Applications/ChatGPT.app') ? 'installed' : 'missing')
check('Work Louder Input', existsSync('/Applications/Input.app'), existsSync('/Applications/Input.app') ? 'installed' : 'missing')

for (const [name, executable] of [
  ['Codex CLI', '/opt/homebrew/bin/codex'],
  ['Claude Code', `${process.env.HOME}/.local/bin/claude`],
  ['Ashlr Hub', `${process.env.HOME}/.local/bin/ashlr`],
]) {
  const version = run(executable, ['--version'])
  check(name, Boolean(version), version || 'unavailable')
}

const logi = run('/usr/bin/pgrep', ['-fl', 'logioptionsplus_agent'])
check('Competing Logitech HID owner', !logi, logi ? 'running; may interfere with the Micro' : 'not running', false)

const ok = checks.filter((item) => item.blocking).every((item) => item.ok)
if (process.argv.includes('--json')) console.log(JSON.stringify({ ok, checks }, null, 2))
else {
  for (const item of checks) console.log(`${item.ok ? '✓' : '!'} ${item.name}: ${item.detail}`)
  console.log('\nInput Monitoring must be verified manually in System Settings; macOS protects the TCC database.')
}

process.exitCode = ok ? 0 : 1
