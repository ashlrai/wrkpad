const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } = require('node:fs')
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

test('infers a connected native control plane only from the ordered correlated handshake', () => {
  const classified = classifyCodexMicroLog([
    '2026-09-02T23:10:00.000Z info [CodexMicroService] Work Louder info args=["|wl_device_comm|      ","Connecting with HID"]',
    '2026-09-02T23:10:00.001Z info [CodexMicroService] Work Louder info args=["|wl_rpc_client|       ","Sending RPC call, id:",101]',
    '2026-09-02T23:10:00.010Z info [CodexMicroService] Work Louder info args=["|wl_rpc_client|       ","Received answer, id:",101,"method:","v.oai.rgbcfg"]',
    '2026-09-02T23:10:00.011Z info [CodexMicroService] Work Louder info args=["|wl_rpc_client|       ","Sending RPC call, id:",102]',
    '2026-09-02T23:10:00.020Z info [CodexMicroService] Work Louder info args=["|wl_rpc_client|       ","Received answer, id:",102,"method:","v.oai.thstatus"]',
    '2026-09-02T23:10:00.021Z info [CodexMicroService] Work Louder info args=["|wl_device_comm|      ","Added notify handler for method:","v.oai.hid"]',
    '2026-09-02T23:10:00.022Z info [CodexMicroService] Work Louder info args=["|wl_device_comm|      ","Added notify handler for method:","v.oai.rad"]',
  ].join('\n'))
  assert.deepEqual(classified, {
    status: 'connected',
    observedAt: '2026-09-02T23:10:00.022Z',
    detail: 'An ordered Codex log sequence supports inferred native Creator Micro initialization.',
  })
})

test('rejects out-of-order or uncorrelated native handshake markers', () => {
  const lines = [
    '2026-09-02T23:10:00.000Z info [CodexMicroService] Work Louder info args=["Connecting with HID"]',
    '2026-09-02T23:10:00.001Z info [CodexMicroService] Work Louder info args=["Sending RPC call, id:",101]',
    '2026-09-02T23:10:00.010Z info [CodexMicroService] Work Louder info args=["Received answer, id:",999,"method:","v.oai.rgbcfg"]',
    '2026-09-02T23:10:00.011Z info [CodexMicroService] Work Louder info args=["Sending RPC call, id:",102]',
    '2026-09-02T23:10:00.020Z info [CodexMicroService] Work Louder info args=["Received answer, id:",102,"method:","v.oai.thstatus"]',
    '2026-09-02T23:10:00.021Z info [CodexMicroService] Added notify handler for method: v.oai.hid',
    '2026-09-02T23:10:00.022Z info [CodexMicroService] Added notify handler for method: v.oai.rad',
  ]
  assert.equal(classifyCodexMicroLog(lines.join('\n')).status, 'not_observed')

  const reversedHandlers = [
    '2026-09-02T23:10:00.000Z info [CodexMicroService] Connecting with HID',
    '2026-09-02T23:10:00.001Z info [CodexMicroService] Sending RPC call, id:",101',
    '2026-09-02T23:10:00.010Z info [CodexMicroService] Received answer, id:",101,"method:","v.oai.rgbcfg"',
    '2026-09-02T23:10:00.011Z info [CodexMicroService] Sending RPC call, id:",102',
    '2026-09-02T23:10:00.020Z info [CodexMicroService] Received answer, id:",102,"method:","v.oai.thstatus"',
    '2026-09-02T23:10:00.021Z info [CodexMicroService] Added notify handler for method: v.oai.rad',
    '2026-09-02T23:10:00.022Z info [CodexMicroService] Added notify handler for method: v.oai.hid',
  ]
  assert.equal(classifyCodexMicroLog(reversedHandlers.join('\n')).status, 'not_observed')
})

test('does not preserve connected state after native invalidation or cleanup', () => {
  const handshake = [
    '2026-09-02T23:10:00.000Z info [CodexMicroService] Connecting with HID',
    '2026-09-02T23:10:00.001Z info [CodexMicroService] Sending RPC call, id:",101',
    '2026-09-02T23:10:00.010Z info [CodexMicroService] Received answer, id:",101,"method:","v.oai.rgbcfg"',
    '2026-09-02T23:10:00.011Z info [CodexMicroService] Sending RPC call, id:",102',
    '2026-09-02T23:10:00.020Z info [CodexMicroService] Received answer, id:",102,"method:","v.oai.thstatus"',
    '2026-09-02T23:10:00.021Z info [CodexMicroService] Added notify handler for method: v.oai.hid',
    '2026-09-02T23:10:00.022Z info [CodexMicroService] Added notify handler for method: v.oai.rad',
  ]
  assert.equal(classifyCodexMicroLog([...handshake, '2026-09-02T23:11:00.000Z info [CodexMicroService] Disconnecting HID device'].join('\n')).status, 'not_observed')
  assert.equal(classifyCodexMicroLog([...handshake, '2026-09-02T23:11:00.000Z warning [CodexMicroService] Codex Micro connection invalidated'].join('\n')).status, 'connection_failed')
})

test('disconnect terminates a partial native handshake and does not erase a finalized failure', () => {
  const partialThenLateHandlers = [
    '2026-09-02T23:10:00.000Z info [CodexMicroService] Connecting with HID',
    '2026-09-02T23:10:00.001Z info [CodexMicroService] Sending RPC call, id:",101',
    '2026-09-02T23:10:00.010Z info [CodexMicroService] Received answer, id:",101,"method:","v.oai.rgbcfg"',
    '2026-09-02T23:10:00.011Z info [CodexMicroService] Sending RPC call, id:",102',
    '2026-09-02T23:10:00.020Z info [CodexMicroService] Received answer, id:",102,"method:","v.oai.thstatus"',
    '2026-09-02T23:10:00.021Z info [CodexMicroService] Disconnecting HID device',
    '2026-09-02T23:10:00.022Z info [CodexMicroService] Added notify handler for method: v.oai.hid',
    '2026-09-02T23:10:00.023Z info [CodexMicroService] Added notify handler for method: v.oai.rad',
  ]
  assert.equal(classifyCodexMicroLog(partialThenLateHandlers.join('\n')).status, 'not_observed')

  const failureThenDisconnect = [
    '2026-09-02T23:10:00.000Z info [CodexMicroService] Connecting with HID',
    '2026-09-02T23:10:00.010Z error [CodexMicroService] method: v.oai.rgbcfg rpcCode 404',
    '2026-09-02T23:10:00.020Z warning [CodexMicroService] Codex Micro connection failed',
    '2026-09-02T23:10:00.021Z info [CodexMicroService] Disconnecting HID device',
  ]
  assert.deepEqual(classifyCodexMicroLog(failureThenDisconnect.join('\n')), {
    status: 'firmware_rpc_missing',
    observedAt: '2026-09-02T23:10:00.020Z',
    detail: 'Codex reached the board, but firmware returned RPC 404 for v.oai.rgbcfg.',
  })
})

test('requires valid nondecreasing timestamps for connected evidence', () => {
  const timestamped = [
    '2026-09-02T23:10:00.000Z info [CodexMicroService] Connecting with HID',
    '2026-09-02T23:10:00.001Z info [CodexMicroService] Sending RPC call, id:",101',
    '2026-09-02T23:10:00.010Z info [CodexMicroService] Received answer, id:",101,"method:","v.oai.rgbcfg"',
    '2026-09-02T23:10:00.011Z info [CodexMicroService] Sending RPC call, id:",102',
    '2026-09-02T23:10:00.020Z info [CodexMicroService] Received answer, id:",102,"method:","v.oai.thstatus"',
    '2026-09-02T23:10:00.021Z info [CodexMicroService] Added notify handler for method: v.oai.hid',
    '2026-09-02T23:10:00.022Z info [CodexMicroService] Added notify handler for method: v.oai.rad',
  ]
  const missingTimestamp = [...timestamped]
  missingTimestamp[5] = '[CodexMicroService] Added notify handler for method: v.oai.hid'
  assert.equal(classifyCodexMicroLog(missingTimestamp.join('\n')).status, 'not_observed')

  const regressedTimestamp = [...timestamped]
  regressedTimestamp[5] = '2026-09-02T23:09:59.999Z info [CodexMicroService] Added notify handler for method: v.oai.hid'
  assert.equal(classifyCodexMicroLog(regressedTimestamp.join('\n')).status, 'not_observed')
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

test('inspects the UTC current-day folder across a local-time date rollover', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'codex-micro-diagnostics-utc-'))
  try {
    const now = new Date('2026-09-03T00:05:00.000Z')
    // Keep this regression meaningful even when CI itself runs in UTC.
    now.getFullYear = () => 2026
    now.getMonth = () => 8
    now.getDate = () => 2
    const directory = path.join(home, 'Library', 'Logs', 'com.openai.codex', '2026', '09', '03')
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, 'codex-desktop.log'), [
      '2026-09-03T00:04:00.000Z info [CodexMicroService] Connecting with HID',
      '2026-09-03T00:04:00.001Z info [CodexMicroService] Sending RPC call, id:",101',
      '2026-09-03T00:04:00.010Z info [CodexMicroService] Received answer, id:",101,"method:","v.oai.rgbcfg"',
      '2026-09-03T00:04:00.011Z info [CodexMicroService] Sending RPC call, id:",102',
      '2026-09-03T00:04:00.020Z info [CodexMicroService] Received answer, id:",102,"method:","v.oai.thstatus"',
      '2026-09-03T00:04:00.021Z info [CodexMicroService] Added notify handler for method: v.oai.hid',
      '2026-09-03T00:04:00.022Z info [CodexMicroService] Added notify handler for method: v.oai.rad',
    ].join('\n'))

    assert.deepEqual(inspectCodexMicroLogs(home, now), {
      status: 'connected',
      observedAt: '2026-09-03T00:04:00.022Z',
      detail: 'An ordered Codex log sequence supports inferred native Creator Micro initialization.',
      fresh: true,
    })
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

test('a newer markerless app session prevents older connected evidence from passing', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'codex-micro-diagnostics-'))
  try {
    const directory = path.join(home, 'Library', 'Logs', 'com.openai.codex', '2026', '09', '02')
    mkdirSync(directory, { recursive: true })
    const oldSession = path.join(directory, 'codex-desktop-11111111-1111-1111-1111-111111111111-111-t0-i1-000001-0.log')
    const currentSession = path.join(directory, 'codex-desktop-22222222-2222-2222-2222-222222222222-222-t0-i1-000001-0.log')
    writeFileSync(oldSession, [
      '2026-09-02T23:10:00.000Z info [CodexMicroService] Connecting with HID',
      '2026-09-02T23:10:00.001Z info [CodexMicroService] Sending RPC call, id:",101',
      '2026-09-02T23:10:00.010Z info [CodexMicroService] Received answer, id:",101,"method:","v.oai.rgbcfg"',
      '2026-09-02T23:10:00.011Z info [CodexMicroService] Sending RPC call, id:",102',
      '2026-09-02T23:10:00.020Z info [CodexMicroService] Received answer, id:",102,"method:","v.oai.thstatus"',
      '2026-09-02T23:10:00.021Z info [CodexMicroService] Added notify handler for method: v.oai.hid',
      '2026-09-02T23:10:00.022Z info [CodexMicroService] Added notify handler for method: v.oai.rad',
    ].join('\n'))
    writeFileSync(currentSession, '2026-09-02T23:11:00.000Z info application started\n')
    utimesSync(oldSession, new Date('2026-09-02T23:10:00Z'), new Date('2026-09-02T23:10:00Z'))
    utimesSync(currentSession, new Date('2026-09-02T23:11:00Z'), new Date('2026-09-02T23:11:00Z'))

    assert.equal(inspectCodexMicroLogs(home, new Date('2026-09-02T23:12:00Z')).status, 'not_observed')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('connected evidence never falls back to file mtime and rejects future timestamps', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'codex-micro-diagnostics-'))
  try {
    const directory = path.join(home, 'Library', 'Logs', 'com.openai.codex', '2026', '09', '02')
    mkdirSync(directory, { recursive: true })
    const stale = path.join(directory, 'stale.log')
    writeFileSync(stale, [
      '2026-09-02T22:00:00.000Z info [CodexMicroService] Connecting with HID',
      '2026-09-02T22:00:00.001Z info [CodexMicroService] Sending RPC call, id:",101',
      '2026-09-02T22:00:00.010Z info [CodexMicroService] Received answer, id:",101,"method:","v.oai.rgbcfg"',
      '2026-09-02T22:00:00.011Z info [CodexMicroService] Sending RPC call, id:",102',
      '2026-09-02T22:00:00.020Z info [CodexMicroService] Received answer, id:",102,"method:","v.oai.thstatus"',
      '2026-09-02T22:00:00.021Z info [CodexMicroService] Added notify handler for method: v.oai.hid',
      '2026-09-02T22:00:00.022Z info [CodexMicroService] Added notify handler for method: v.oai.rad',
    ].join('\n'))
    utimesSync(stale, new Date('2026-09-02T23:11:00Z'), new Date('2026-09-02T23:11:00Z'))
    const staleResult = inspectCodexMicroLogs(home, new Date('2026-09-02T23:12:00Z'))
    assert.equal(staleResult.status, 'connected')
    assert.equal(staleResult.fresh, false)
    rmSync(stale)

    const future = path.join(directory, 'future.log')
    writeFileSync(future, [
      '2026-09-02T23:20:00.000Z info [CodexMicroService] Connecting with HID',
      '2026-09-02T23:20:00.001Z info [CodexMicroService] Sending RPC call, id:",101',
      '2026-09-02T23:20:00.010Z info [CodexMicroService] Received answer, id:",101,"method:","v.oai.rgbcfg"',
      '2026-09-02T23:20:00.011Z info [CodexMicroService] Sending RPC call, id:",102',
      '2026-09-02T23:20:00.020Z info [CodexMicroService] Received answer, id:",102,"method:","v.oai.thstatus"',
      '2026-09-02T23:20:00.021Z info [CodexMicroService] Added notify handler for method: v.oai.hid',
      '2026-09-02T23:20:00.022Z info [CodexMicroService] Added notify handler for method: v.oai.rad',
    ].join('\n'))
    utimesSync(future, new Date('2026-09-02T23:00:00Z'), new Date('2026-09-02T23:00:00Z'))

    assert.equal(inspectCodexMicroLogs(home, new Date('2026-09-02T23:12:00Z')).status, 'not_observed')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('fails closed and does not disclose paths for symlink or non-regular log entries', (t) => {
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')
  const home = mkdtempSync(path.join(tmpdir(), 'codex-micro-diagnostics-secret-'))
  try {
    const directory = path.join(home, 'Library', 'Logs', 'com.openai.codex', '2026', '09', '02')
    mkdirSync(directory, { recursive: true })
    const privateTarget = path.join(home, 'private-secret.log')
    writeFileSync(privateTarget, '2026-09-02T23:10:00Z warning [CodexMicroService] Codex Micro connection failed\n')
    symlinkSync(privateTarget, path.join(directory, 'linked.log'))

    const linked = inspectCodexMicroLogs(home, new Date('2026-09-02T23:12:00Z'))
    assert.deepEqual(linked, {
      status: 'log_unavailable',
      observedAt: null,
      detail: 'Codex desktop logs were unavailable for read-only inspection.',
    })
    assert.equal(JSON.stringify(linked).includes(home), false)

    rmSync(path.join(directory, 'linked.log'))
    mkdirSync(path.join(directory, 'directory.log'))
    const nonRegular = inspectCodexMicroLogs(home, new Date('2026-09-02T23:12:00Z'))
    assert.equal(nonRegular.status, 'log_unavailable')
    assert.equal(JSON.stringify(nonRegular).includes(home), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('rejects symlinked fixed log-directory ancestors without disclosing the escape target', (t) => {
  if (process.platform === 'win32') return t.skip('symlink creation requires platform-specific privileges')

  for (const symlinkIndex of [2, 3, 4, 5]) {
    const home = mkdtempSync(path.join(tmpdir(), 'codex-micro-diagnostics-root-'))
    try {
      const fixedSegments = ['Library', 'Logs', 'com.openai.codex', '2026', '09', '02']
      const external = path.join(home, `private-escape-${symlinkIndex}`)
      const externalRemainder = fixedSegments.slice(symlinkIndex + 1)
      mkdirSync(path.join(external, ...externalRemainder), { recursive: true })
      writeFileSync(
        path.join(external, ...externalRemainder, 'secret.log'),
        '2026-09-02T23:10:00Z warning [CodexMicroService] Codex Micro connection failed\n',
      )

      let parent = home
      for (const segment of fixedSegments.slice(0, symlinkIndex)) {
        parent = path.join(parent, segment)
        mkdirSync(parent)
      }
      symlinkSync(external, path.join(parent, fixedSegments[symlinkIndex]))

      const inspected = inspectCodexMicroLogs(home, new Date('2026-09-02T23:12:00Z'))
      assert.deepEqual(inspected, {
        status: 'log_unavailable',
        observedAt: null,
        detail: 'Codex desktop logs were unavailable for read-only inspection.',
      })
      assert.equal(JSON.stringify(inspected).includes('private-escape'), false)
      assert.equal(JSON.stringify(inspected).includes(home), false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }
})

test('rejects non-directory fixed log ancestors without falling through to another path', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'codex-micro-diagnostics-root-'))
  try {
    const root = path.join(home, 'Library', 'Logs', 'com.openai.codex')
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, '2026'), 'not a directory')

    assert.deepEqual(inspectCodexMicroLogs(home, new Date('2026-09-02T23:12:00Z')), {
      status: 'log_unavailable',
      observedAt: null,
      detail: 'Codex desktop logs were unavailable for read-only inspection.',
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
