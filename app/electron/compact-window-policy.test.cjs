const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const main = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const preload = readFileSync(path.join(__dirname, 'compact-preload.cjs'), 'utf8')

test('Compact Deck uses a dedicated sandboxed renderer and narrow preload', () => {
  const windowBlock = main.match(/function createCompactWindow\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(windowBlock, /frame: false/)
  assert.match(windowBlock, /alwaysOnTop: preferences\.alwaysOnTop/)
  assert.match(windowBlock, /preload: path\.join\(__dirname, 'compact-preload\.cjs'\)/)
  assert.match(windowBlock, /contextIsolation: true/)
  assert.match(windowBlock, /nodeIntegration: false/)
  assert.match(windowBlock, /sandbox: true/)
  assert.match(windowBlock, /partition: 'ashlr-compact-deck'/)
  assert.match(windowBlock, /setPermissionRequestHandler\([^]*callback\(false\)/)
})

test('every Compact Deck IPC handler verifies the exact compact renderer', () => {
  for (const channel of [
    'compact:getSnapshot',
    'compact:focusAgentSlot',
    'compact:focusAttention',
    'compact:runSkillAction',
    'compact:runWorkflowAction',
    'compact:getPreferences',
    'compact:savePreferences',
    'compact:hide',
  ]) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}', trustedCompactIpc\\(`))
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\('${channel}'`))
  }
})

test('Compact Deck never acquires global shortcut or terminal authority', () => {
  const compactHandlers = main.match(/ipcMain\.handle\('compact:getSnapshot'[\s\S]*?ipcMain\.handle\('board:setProfile'/)?.[0] ?? ''
  assert.doesNotMatch(compactHandlers, /globalShortcut|spawn\(|osascript|terminal|confirmAction|beginHold/)
  assert.match(compactHandlers, /requireCompactAction\(actionId, ACTION_SPECS\)/)
  assert.match(compactHandlers, /requireCompactWorkflowAction\(actionId, ACTION_SPECS\)/)
})

test('Compact Deck contains rejected background work and clears lifecycle timers', () => {
  assert.match(main, /function queueCompactSnapshot\(\) \{[\s\S]*?sendCompactSnapshot\(\)\.catch\(\(\) => \{\}\)/)
  assert.doesNotMatch(main, /void sendCompactSnapshot\(\)(?!\.catch)/)
  assert.match(main, /app\.on\('will-quit',[\s\S]*?stopCompactSnapshotFeed\(\)[\s\S]*?clearTimeout\(compactBoundsTimer\)/)
  assert.match(main, /loadURL\(compactRendererUrl\)\.catch/)
})

test('preference saves preserve current window bounds and roll back runtime settings on failure', () => {
  const handler = main.match(/ipcMain\.handle\('compact:savePreferences'[\s\S]*?\n\}\)\)/)?.[0] ?? ''
  assert.match(handler, /validateCompactDeckSettings\(\{ \.\.\.candidate, bounds \}, workArea\)/)
  assert.doesNotMatch(handler, /setBounds\(/)
  assert.match(handler, /setAlwaysOnTop\(previous\.alwaysOnTop\)/)
  assert.match(handler, /openAtLogin: previous\.openAtLaunch/)
})

test('startup restores settings against the display containing the saved bounds', () => {
  assert.match(main, /targetBounds = bounds \?\? readCompactDeckBounds\(compactSettingsPath\(\)\)/)
  assert.match(main, /compactWorkArea\(targetBounds\)/)
})

test('Compact Deck snapshot is privacy-projected before crossing IPC', () => {
  const snapshotHandler = main.match(/ipcMain\.handle\('compact:getSnapshot'[\s\S]*?\n\}\)\)/)?.[0] ?? ''
  assert.match(snapshotHandler, /projectCompactSnapshot/)
  assert.match(snapshotHandler, /showTitles: preferences\.showTitles/)
  assert.ok(snapshotHandler.indexOf('await missionControl') < snapshotHandler.indexOf('readCompactSettings'), 'privacy preference must be sampled after asynchronous mission collection')
  assert.doesNotMatch(snapshotHandler, /workspace|prompt|transcript|sessionId/)
})

test('Compact Deck action receipts are projected and Attention resolves atomically in main', () => {
  const handlers = main.match(/ipcMain\.handle\('compact:focusAgentSlot'[\s\S]*?ipcMain\.handle\('compact:getPreferences'/)?.[0] ?? ''
  assert.match(handlers, /projectCompactActionResult\(await focusAgentSlotResult\(slot\)\)/)
  assert.match(handlers, /ipcMain\.handle\('compact:focusAttention'/)
  assert.match(handlers, /requireCompactWorkflowAction\('stage_attention', ACTION_SPECS\)/)
  assert.match(handlers, /focusHighestPriorityAgentResult\(\)/)
  assert.doesNotMatch(handlers, /agent\.title|attentionSlot\)/)
  const attention = main.match(/async function focusHighestPriorityAgentResult\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(attention, /missionControl\(true\)/)
  assert.match(attention, /projectCompactSnapshot\(mission\)\.attentionSlot/)
  assert.match(attention, /focusAgentFromSnapshot\(slot, mission\)/)
})

test('background snapshots sample privacy after asynchronous mission collection', () => {
  const sender = main.match(/async function sendCompactSnapshot\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.ok(sender.indexOf('await missionControl') < sender.indexOf('readCompactSettings'), 'a stale showTitles value must not cross IPC after privacy is enabled')
  assert.match(sender, /target !== compactWindow/)
})
