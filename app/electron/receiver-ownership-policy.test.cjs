const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const source = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')

test('main requests one Electron instance and focuses the existing receiver', () => {
  assert.match(source, /app\.requestSingleInstanceLock\(\)/)
  assert.match(source, /app\.on\('second-instance'/)
  assert.match(source, /mainWindow\.focus\(\)/)
})

test('main synchronizes receiver ownership before registering shortcuts', () => {
  assert.match(source, /function synchronizeShortcutOwnership\(\)/)
  assert.match(source, /globalShortcut\.unregisterAll\(\)/)
})

test('main independently revalidates every Flight Check admission and receipt', () => {
  assert.match(source, /async function verifyFlightGates\(variant, forceInput = true\)/)
  assert.match(source, /verifyGates: \(\) => verifyFlightGates\(variant, true\)/)
  assert.match(source, /configuration: \{ registrations: shortcutRegistrations, registeredCount, admission: admission\.evidence, gates: admission\.gates \}/)
})

test('status IPC does not expose the local receiver executable path', () => {
  const identityBlock = source.match(/receiverIdentity: \{([\s\S]*?)\n\s*\},\n\s*receiverRuntime:/)?.[1] ?? ''
  assert.doesNotMatch(identityBlock, /path:/)
  assert.doesNotMatch(identityBlock, /process\.execPath|app\.getAppPath/)
})
