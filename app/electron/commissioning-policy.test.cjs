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
