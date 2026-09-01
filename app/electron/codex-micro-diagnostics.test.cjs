const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { classifyCodexMicroLog, inspectCodexMicroLogs } = require('./codex-micro-diagnostics.cjs')

test('classifies the exact native firmware RPC failure without returning raw logs', () => {
  const classified = classifyCodexMicroLog([
    '2026-09-01T17:18:10.000Z info [CodexMicroService] Work Louder info args=["Connecting with HID"]',
    '2026-09-01T17:18:10.010Z error [CodexMicroService] Work Louder error args=["Error calling RPC","method:","v.oai.rgbcfg",{"details":{"rpcCode":404}}]',
    '2026-09-01T17:18:10.020Z warning [CodexMicroService] Codex Micro connection failed secret=/private/path',
  ].join('\n'))
  assert.deepEqual(classified, {
    status: 'firmware_rpc_missing',
    observedAt: '2026-09-01T17:18:10.020Z',
    detail: 'Codex reached the board, but firmware returned RPC 404 for v.oai.rgbcfg.',
  })
  assert.equal(JSON.stringify(classified).includes('/private/path'), false)
})

test('does not convert generic process presence into native connection evidence', () => {
  assert.equal(classifyCodexMicroLog('ChatGPT is running').status, 'not_observed')
  assert.equal(classifyCodexMicroLog('2026-09-01T17:18:10Z warning [CodexMicroService] Codex Micro connection failed').status, 'connection_failed')
})

test('a newer connection attempt supersedes an older firmware failure without inventing success', () => {
  const classified = classifyCodexMicroLog([
    '2026-09-01T17:18:10.000Z info [CodexMicroService] Connecting with HID',
    '2026-09-01T17:18:10.010Z error [CodexMicroService] method: v.oai.rgbcfg rpcCode 404',
    '2026-09-01T17:18:10.020Z warning [CodexMicroService] Codex Micro connection failed',
    '2026-09-01T17:20:00.000Z info [CodexMicroService] Connecting with HID',
  ].join('\n'))
  assert.equal(classified.status, 'not_observed')
  assert.equal(classified.observedAt, '2026-09-01T17:20:00.000Z')
})

test('inspects only bounded recent log files under the fixed Codex log root', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'codex-micro-diagnostics-'))
  try {
    const directory = path.join(home, 'Library', 'Logs', 'com.openai.codex', '2026', '09', '01')
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, 'codex-desktop.log'), '2026-09-01T17:18:10Z error [CodexMicroService] method: v.oai.rgbcfg rpcCode 404\n')
    const result = inspectCodexMicroLogs(home, new Date('2026-09-01T18:00:00Z'))
    assert.equal(result.status, 'firmware_rpc_missing')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('chooses the newest evidence across files and expires historical evidence', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'codex-micro-diagnostics-'))
  try {
    const directory = path.join(home, 'Library', 'Logs', 'com.openai.codex', '2026', '09', '01')
    mkdirSync(directory, { recursive: true })
    const older = path.join(directory, 'older.log')
    const newer = path.join(directory, 'newer.log')
    writeFileSync(older, '2026-09-01T17:10:00Z error [CodexMicroService] method: v.oai.rgbcfg rpcCode 404\n')
    writeFileSync(newer, '2026-09-01T17:20:00Z warning [CodexMicroService] Codex Micro connection failed\n')
    utimesSync(older, new Date('2026-09-01T17:25:00Z'), new Date('2026-09-01T17:25:00Z'))
    utimesSync(newer, new Date('2026-09-01T17:20:00Z'), new Date('2026-09-01T17:20:00Z'))

    const fresh = inspectCodexMicroLogs(home, new Date('2026-09-01T17:30:00Z'))
    assert.equal(fresh.status, 'connection_failed')
    assert.equal(fresh.fresh, true)
    const historical = inspectCodexMicroLogs(home, new Date('2026-09-01T18:00:01Z'))
    assert.equal(historical.status, 'connection_failed')
    assert.equal(historical.fresh, false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
