const { spawnSync } = require('node:child_process')

const INPUT_PROCESS_PATTERN = '/[Ii]nput\\.app/Contents/MacOS/Input([[:space:]]|$)'
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024
const INPUT_PROCESS_ROW = /^\d{1,10}\s+\/(?:Applications|Users\/[^/\r\n]{1,255}\/Applications)\/[Ii]nput\.app\/Contents\/MacOS\/Input(?:\s[^\r\n]{0,4095})?$/u

function inspectInputApplicationRuntime(options = {}) {
  const run = typeof options.run === 'function' ? options.run : spawnSync
  let result
  try {
    result = run('/usr/bin/pgrep', ['-fl', INPUT_PROCESS_PATTERN], {
      encoding: 'utf8',
      timeout: 2_500,
      maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
    })
  } catch {
    return { status: 'unavailable' }
  }
  if (!result || result.error || result.signal || !Number.isInteger(result.status)) return { status: 'unavailable' }
  if (result.status === 1 && !result.stdout) return { status: 'not_running' }
  if (result.status !== 0 || typeof result.stdout !== 'string' || result.stdout.length === 0) return { status: 'unavailable' }
  if (Buffer.byteLength(result.stdout, 'utf8') > MAX_PROCESS_OUTPUT_BYTES) return { status: 'unavailable' }
  const lines = result.stdout.split(/\r?\n/u).filter(Boolean)
  if (!lines.length || !lines.every((line) => INPUT_PROCESS_ROW.test(line))) return { status: 'unavailable' }
  return { status: 'running' }
}

module.exports = { INPUT_PROCESS_PATTERN, MAX_PROCESS_OUTPUT_BYTES, inspectInputApplicationRuntime }
