const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const source = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const preloadSource = readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')

test('main requests one Electron instance and focuses the existing receiver', () => {
  assert.match(source, /app\.requestSingleInstanceLock\(\)/)
  assert.match(source, /app\.on\('second-instance'/)
  assert.match(source, /mainWindow\.focus\(\)/)
})

test('main synchronizes receiver ownership before registering shortcuts', () => {
  assert.match(source, /createShortcutOwnershipController\(\{/)
  assert.match(source, /function synchronizeShortcutOwnership\(boardRoute\)/)
  assert.match(source, /unregisterAll: \(\) => globalShortcut\.unregisterAll\(\)/)
  assert.match(source, /for \(const control of shortcutSignalsForRoute\(boardRoute\)\)[\s\S]*const deliver = shortcutCallbackGuard\.bind\([\s\S]*flightSession\.record\(envelope\)[\s\S]*webContents\.send\('board:control', envelope\)[\s\S]*globalShortcut\.register\(accelerator, \(\) => \{[\s\S]*deliver\(/)
  assert.match(source, /inputApplication = boardRoute === 'hybrid_native' \? inspectInputApplicationRuntime\(\) : null[\s\S]*routeAllowsShortcutDelivery\(boardRoute, currentRoute, inputApplication\)[\s\S]*if \(!deliveryAllowed\) \{[\s\S]*shortcutCallbackGuard\.invalidate\(\)[\s\S]*synchronizeShortcutOwnership\('unknown'\)/)
  assert.match(source, /if \(!deliveryAllowed\) \{[\s\S]*synchronizeShortcutOwnership\('unknown'\)[\s\S]*shortcutObservability\.observe\(control\)[\s\S]*return/)
  assert.match(source, /if \(!routeOwnsShortcuts\(boardRoute\)\) \{[\s\S]*shortcutCallbackGuard\.invalidate\(\)[\s\S]*shortcutObservability\.beginGeneration\(boardRoute\)/)
  assert.match(source, /shortcutOwnership\.synchronize\(boardRoute\)[\s\S]*shortcutOwnership\.finalize\(boardRoute\)[\s\S]*const active = state\.active === true[\s\S]*const scope = active[\s\S]*`\$\{boardRoute\}_released`[\s\S]*shortcutObservability\.beginGeneration\(scope\)/)
  assert.match(source, /boardRoute !== 'hybrid_native' \|\| runtime\?\.inputApplication\?\.status === 'not_running'/)
  assert.match(source, /catch \(error\) \{[\s\S]*shortcutRegistrations = \[\][\s\S]*shortcutCallbackGuard\.invalidate\(\)[\s\S]*throw error/)
})

test('callback telemetry precedes the guard and Flight evidence is main-owned', () => {
  assert.match(source, /globalShortcut\.register\(accelerator, \(\) => \{[\s\S]*deliver\(shortcutObservability\.observe\(control\)\)/)
  assert.match(source, /shortcutObservability\.allow\(observation\)[\s\S]*flightSession\.record\(envelope\)[\s\S]*webContents\.send\('board:control', envelope\)/)
  assert.match(source, /recordedForFlight[\s\S]*evaluateFlightSignals\([\s\S]*evaluation\.problems\.length > 0\) flightSession\.invalidate\(\)/)
  assert.match(source, /ipcMain\.handle\('board:getFlightSnapshot', trustedIpc\(\(\) => publicFlightSnapshot\(\)\)\)/)
  assert.match(source, /shortcutTelemetry: shortcutObservability\.snapshot\(\)/)
  assert.match(source, /flight\.invalidated !== true \? 'passed'/)
  assert.match(preloadSource, /getFlightSnapshot: \(\) => ipcRenderer\.invoke\('board:getFlightSnapshot'\)/)
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

test('Flight Check suppresses actions while admission is pending and across compact surfaces', () => {
  assert.match(source, /const flightAdmissionSuppressions = new Set\(\)/)
  assert.match(source, /const mappedActionOperations = new Set\(\)/)
  assert.match(source, /function flightActionsSuppressed\(\) \{[\s\S]*flightSession\.isActive\(\) \|\| flightAdmissionSuppressions\.size > 0/)
  assert.match(source, /async function runMappedAction\(operation,[\s\S]*flightActionsSuppressed\(\)[\s\S]*mappedActionOperations\.add\(lease\)[\s\S]*await operation\(\)[\s\S]*mappedActionOperations\.delete\(lease\)/)
  assert.match(source, /flightAdmissionSuppressions\.add\(suppression\)[\s\S]*requireMappedActionsIdle\(\)[\s\S]*await flightOperations\.start[\s\S]*finally \{[\s\S]*flightAdmissionSuppressions\.delete\(suppression\)/)
  assert.match(source, /ipcMain\.handle\('compact:focusAgentSlot'[\s\S]*runMappedAction\([\s\S]*ipcMain\.handle\('compact:focusAttention'[\s\S]*runMappedAction\([\s\S]*ipcMain\.handle\('compact:runSkillAction'[\s\S]*runMappedAction\([\s\S]*ipcMain\.handle\('compact:runWorkflowAction'[\s\S]*runMappedAction\(/)
  assert.match(source, /ipcMain\.handle\('board:setBoardRoute'[\s\S]*flightActionsSuppressed\(\)[\s\S]*End Flight Check before changing shortcut ownership/)
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
  assert.match(source, /originalFilesystem = require\('original-fs'\)/)
  assert.match(source, /createCachedAsarHasher\(\{ ttlMs: 30_000, maxEntries: 32, filesystem: originalFilesystem \}\)/)
  assert.match(source, /function inspectCurrentReceiverRuntime\(\) \{[\s\S]*inspectReceiverRuntime\(\{ currentPid: process\.pid, hashAsar: cachedReceiverAsarHash \}\)/)
  assert.match(source, /function currentPackagedAsarSha256\(\) \{[\s\S]*cachedReceiverAsarHash\(app\.getAppPath\(\)\)/)
  assert.match(source, /appAsarSha256: currentReceiverRuntime\.currentAsarSha256 \?\? currentPackagedAsarSha256\(\)/)
  assert.doesNotMatch(source, /process\.noAsar|withRawAsarFilesystem/)
})
