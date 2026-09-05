const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const main = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const preload = readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')

test('commissioning IPC stays trusted, read-only, and argument-free', () => {
  assert.match(main, /ipcMain\.handle\('board:getCommissioning', trustedIpc\(\(\) => commissioningOperations\.get\(\)\)\)/)
  assert.match(main, /ipcMain\.handle\('board:prepareCommissioningPlan', trustedIpc\(\(\) => commissioningOperations\.prepare\(\)\)\)/)
  assert.match(preload, /getCommissioning: \(\) => ipcRenderer\.invoke\('board:getCommissioning'\)/)
  assert.match(preload, /prepareCommissioningPlan: \(\) => ipcRenderer\.invoke\('board:prepareCommissioningPlan'\)/)
})
test('renderer bridge exposes no commissioning apply or device-write capability', () => {
  assert.doesNotMatch(preload, /applyCommission|authorizeCommission|writeDevice|writeHid|resetDevice|flashFirmware/i)
  assert.doesNotMatch(main, /board:(?:applyCommission|authorizeCommission|writeDevice|writeHid|resetDevice|flashFirmware)/i)
})

test('commissioning collection never reconciles shortcut ownership', () => {
  assert.match(main, /collectSystemStatus\(\{ reconcileShortcuts: false \}\)/)
})

test('saved acceptance remains historical and cannot promote a restarted commissioner', () => {
  assert.match(main, /A saved receipt is historical evidence only/)
  assert.match(main, /projectActiveFlightAcceptance\([\s\S]*activeFlightAdmission,[\s\S]*flight,[\s\S]*evaluation,[\s\S]*artifacts\.candidate/)
  assert.doesNotMatch(main, /physicalAcceptance:\s*artifacts\./)
  assert.match(main, /candidateSha256:\s*artifacts\.candidate\.status === 'verified'/)
})
