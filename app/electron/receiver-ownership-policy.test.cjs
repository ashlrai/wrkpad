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
  assert.match(source, /for \(const control of shortcutSignalsForRoute\(boardRoute\)\)[\s\S]*globalShortcut\.register\(accelerator, shortcutCallbackGuard\.bind\(\(\) => \{[\s\S]*flightSession\.record\(envelope\)[\s\S]*webContents\.send\('board:control', envelope\)/)
  assert.match(source, /inputApplication = boardRoute === 'hybrid_native' \? inspectInputApplicationRuntime\(\) : null[\s\S]*routeAllowsShortcutDelivery\(boardRoute, currentRoute, inputApplication\)[\s\S]*if \(!deliveryAllowed\) \{[\s\S]*shortcutCallbackGuard\.invalidate\(\)[\s\S]*synchronizeShortcutOwnership\('unknown'\)/)
  assert.match(source, /if \(!routeOwnsShortcuts\(boardRoute\)\) shortcutCallbackGuard\.invalidate\(\)/)
  assert.match(source, /boardRoute !== 'hybrid_native' \|\| runtime\?\.inputApplication\?\.status === 'not_running'/)
  assert.match(source, /catch \(error\) \{[\s\S]*shortcutRegistrations = \[\][\s\S]*shortcutCallbackGuard\.invalidate\(\)[\s\S]*throw error/)
})

test('startup and route switches apply the declared route before owning shortcuts', () => {
  assert.match(source, /app\.whenReady\(\)\.then\(\(\) => \{[\s\S]*?createWindow\(\)[\s\S]*?synchronizeShortcutOwnership\(readSettings\(\)\.boardRoute\)[\s\S]*?\n\s*\}\)/)
  assert.match(source, /currentRoute = readSettings\(\)\.boardRoute[\s\S]*currentRoute !== boardRoute \|\| !routeOwnsShortcuts\(boardRoute\)[\s\S]*shortcutState = synchronizeShortcutOwnership\('unknown'\)[\s\S]*shortcutState\.released !== true[\s\S]*saveBoardRoute\(boardRoute\)[\s\S]*if \(routeOwnsShortcuts\(boardRoute\)\) synchronizeShortcutOwnership\(boardRoute\)/)
})

test('main independently revalidates every Flight Check admission and receipt', () => {
  assert.match(source, /async function verifyFlightGates\(variant, forceInput = true, dualPlaneAshlrLayerSelected = false\)/)
  assert.match(source, /verifyGates: \(\) => verifyBoundFlightGates\(variant\)/)
  assert.match(source, /configuration: \{\s*registrations: shortcutRegistrations,\s*registeredCount,\s*admission: admission\.evidence,\s*gates: admission\.gates,\s*dualPlaneLayerAttestation:/)
})

test('main wires the validated dual-plane attestation and profile binding into Flight Check', () => {
  assert.match(source, /require\('\.\/dual-plane-attestation\.cjs'\)/)
  assert.match(source, /inputProfileFingerprint: inputProfileFingerprint\(admission\)/)
  assert.match(source, /inputProfileFingerprint\(admission\) !== bound\.inputProfileFingerprint/)
  assert.match(source, /if \(prior\?\.dualPlaneAshlrLayerSelected\) \{[\s\S]*provide a fresh attestation/)
  assert.match(source, /dualPlaneLayerAttestation: activeFlightAdmission\?\.dualPlaneAshlrLayerSelected[\s\S]*source: 'operator'[\s\S]*attestedAt: activeFlightAdmission\.attestedAt/)
  assert.match(source, /ipcMain\.handle\('board:saveFlightReceipt',[\s\S]*?async \(_event, receipt\)/)
})

test('status IPC does not expose the local receiver executable path', () => {
  const identityBlock = source.match(/receiverIdentity: \{([\s\S]*?)\n\s*\},\n\s*receiverRuntime:/)?.[1] ?? ''
  assert.doesNotMatch(identityBlock, /path:/)
  assert.doesNotMatch(identityBlock, /process\.execPath|app\.getAppPath/)
})

test('packaged build identity is available independently of shortcut ownership', () => {
  assert.match(source, /function currentPackagedAsarSha256\(\) \{[\s\S]*previousNoAsar = process\.noAsar[\s\S]*process\.noAsar = true[\s\S]*cachedReceiverAsarHash\(app\.getAppPath\(\)\)[\s\S]*process\.noAsar = previousNoAsar/)
  assert.match(source, /appAsarSha256: currentReceiverRuntime\.currentAsarSha256 \?\? currentPackagedAsarSha256\(\)/)
})
