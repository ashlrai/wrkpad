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
  assert.match(source, /createShortcutOwnershipController\(\{/)
  assert.match(source, /function synchronizeShortcutOwnership\(boardRoute\)/)
  assert.match(source, /unregisterAll: \(\) => globalShortcut\.unregisterAll\(\)/)
  assert.match(source, /globalShortcut\.register\(accelerator, shortcutCallbackGuard\.bind\(\(\) => \{[\s\S]*flightSession\.record\(envelope\)[\s\S]*webContents\.send\('board:control', envelope\)/)
  assert.match(source, /if \(boardRoute !== 'ashlr_layer'\) shortcutCallbackGuard\.invalidate\(\)/)
  assert.match(source, /catch \(error\) \{[\s\S]*shortcutRegistrations = \[\][\s\S]*shortcutCallbackGuard\.invalidate\(\)[\s\S]*throw error/)
})

test('startup and route switches apply the declared route before owning shortcuts', () => {
  assert.match(source, /app\.whenReady\(\)\.then\(\(\) => \{ createWindow\(\); synchronizeShortcutOwnership\(readSettings\(\)\.boardRoute\) \}\)/)
  assert.match(source, /if \(boardRoute !== 'ashlr_layer'\) \{[\s\S]*shortcutState = synchronizeShortcutOwnership\(boardRoute\)[\s\S]*shortcutState\.released !== true[\s\S]*saveBoardRoute\(boardRoute\)[\s\S]*if \(boardRoute === 'ashlr_layer'\) synchronizeShortcutOwnership\(boardRoute\)/)
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
