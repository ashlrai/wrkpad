const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const mainSource = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const preloadSource = readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')

test('native acceptance handlers stay behind trusted renderer IPC', () => {
  for (const channel of [
    'board:getNativeAcceptance',
    'board:prepareNativeAcceptance',
    'board:acceptNativeAcceptance',
    'board:clearNativeAcceptance',
  ]) {
    assert.match(mainSource, new RegExp(`ipcMain\\.handle\\('${channel}', trustedIpc\\(`))
    assert.match(preloadSource, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
  }
})

test('native preparation requires declared route, USB identity, and bounded Desktop metadata', () => {
  assert.match(mainSource, /if \(settings\.boardRoute === 'codex_native'\) \{[\s\S]*shortcutState = synchronizeShortcutOwnership\(settings\.boardRoute\)[\s\S]*passiveRouteVerified = shortcutState\.released === true && shortcutsAreReleased\(\)/)
  assert.match(mainSource, /shortcutsAreReleased\(\)[\s\S]*globalShortcut\.isRegistered\(accelerator\)/)
  assert.match(mainSource, /currentContext = passiveRouteVerified && board && chatgpt\.status === 'installed'/)
  assert.match(mainSource, /device: \{ vidPid: board\.vidPid \}/)
  assert.match(mainSource, /codex: \{ version: chatgpt\.version, build: chatgpt\.build \}/)
})

test('native acceptance is staged and re-evaluated from current evidence before persistence', () => {
  assert.match(mainSource, /createNativeAcceptanceOperationCoordinator\(\{[\s\S]*collectEvidence: collectNativeAcceptanceEvidence,[\s\S]*readReceipt: \(\) => readNativeAcceptanceReceipt\(settingsPath\(\)\),[\s\S]*removeReceipt: \(expectedReceipt\) => removeNativeAcceptanceReceipt\(settingsPath\(\), expectedReceipt\),[\s\S]*stageReceipt: stageNativeAcceptance,[\s\S]*writeReceipt: \(receipt, expectedReceipt\) => writeNativeAcceptanceReceipt\(settingsPath\(\), receipt, expectedReceipt\)/)
  assert.match(mainSource, /nativeAcceptanceOperations\.accept\(attestations\)/)
})

test('board route mutations share the native acceptance operation queue', () => {
  assert.match(mainSource, /board:setBoardRoute[\s\S]*nativeAcceptanceOperations\.mutateContext\(\(\) => \{[\s\S]*saveBoardRoute\(boardRoute\)/)
})

test('native evidence projection excludes diagnostic detail and local paths', () => {
  const projection = mainSource.match(/function projectNativeInitialization\(inspection\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const context = mainSource.match(/const currentContext = settings\.boardRoute[\s\S]*?\n\s*: null/)?.[0] ?? ''
  assert.doesNotMatch(projection, /detail|path|session|prompt|title/)
  assert.doesNotMatch(context, /detail|path|session|prompt|title/)
})
