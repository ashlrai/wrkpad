const assert = require('node:assert/strict')
const test = require('node:test')
const { createHash, randomUUID } = require('node:crypto')
const { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  MAX_FLIGHT_RECEIPT_BYTES,
  MAX_FLIGHT_RECEIPT_DIRECTORY_ENTRIES,
  MAX_FLIGHT_RECEIPT_FILES,
  inspectFlightBuildAcceptance,
  sanitizeFlightBuildAcceptanceReceipt,
} = require('./flight-build-acceptance.cjs')

const CURRENT_SHA = 'a'.repeat(64)
const OTHER_SHA = 'b'.repeat(64)
const HOTKEYS = {
  agent1: 'Control+Alt+Command+1', agent2: 'Control+Alt+Command+2',
  agent3: 'Control+Alt+Command+3', agent4: 'Control+Alt+Command+4',
  agent5: 'Control+Alt+Command+5', agent6: 'Control+Alt+Command+6',
  cmd1: 'Control+Alt+Command+A', cmd2: 'Control+Alt+Command+B',
  cmd3: 'Control+Alt+Command+C', cmd4: 'Control+Alt+Command+D',
  cmd5: 'Control+Alt+Command+E', cmd6: 'Control+Alt+Command+F',
  cmd7: 'Control+Alt+Command+G',
  joyUp: 'Control+Alt+Command+Up', joyRight: 'Control+Alt+Command+Right',
  joyDown: 'Control+Alt+Command+Down', joyLeft: 'Control+Alt+Command+Left',
  dialLeft: 'Control+Alt+Command+Q', dialRight: 'Control+Alt+Command+W',
  dialPress: 'Control+Alt+Command+R',
}
const ORDER = [
  'dialLeft', 'dialLeft', 'dialLeft', 'dialRight', 'dialRight', 'dialRight',
  'dialPress', 'agent1', 'agent2', 'joyUp', 'joyRight', 'joyDown', 'joyLeft',
  'agent3', 'agent4', 'agent5', 'agent6', 'cmd1', 'cmd2', 'cmd3', 'cmd4',
  'cmd5', 'cmd6', 'cmd7',
]
const UNIQUE = [...new Set(ORDER)]
const EDGES = [
  'agent1', 'agent2', 'agent3', 'agent4', 'agent5', 'agent6',
  'cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6', 'cmd7', 'dialPress',
]

function seal(receipt) {
  const canonical = { ...receipt }
  delete canonical.sha256
  receipt.sha256 = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  return receipt
}

function makeReceipt({ asarSha = CURRENT_SHA, exportedAt = '2026-09-08T22:14:51.519Z' } = {}) {
  const baseMs = Date.parse('2026-09-08T22:13:58.206Z')
  const rawEvents = ORDER.map((signalId, index) => ({
    schemaVersion: 1,
    sequence: index + 47,
    signalId,
    source: 'global-shortcut',
    accelerator: HOTKEYS[signalId],
    receivedAt: new Date(baseMs + 250 + index * 500).toISOString(),
    monotonicNs: String(178_793_208_696_166n + BigInt(index) * 500_000_000n),
  }))
  return seal({
    schema: 'ai.ashlr.agent-board.flight-check/v2',
    receiptId: randomUUID(),
    profileKind: 'daily',
    status: 'passed',
    startedAt: '2026-09-08T22:13:58.206Z',
    exportedAt,
    appVersion: '0.2.0',
    device: { expectedName: 'Creator Micro 2', usbDetected: true },
    configuration: {
      registrations: UNIQUE.map((signalId) => ({ signalId, accelerator: HOTKEYS[signalId], registered: true })),
      registeredCount: 20,
      admission: {
        boardRoute: 'ashlr_layer',
        dualPlaneAshlrLayerSelected: false,
        usbDetected: true,
        inputInstallation: { status: 'verified', version: '0.18.4' },
        inputProfile: {
          cacheStatus: 'available',
          activeProfile: 'Ashlr Agent Board Corrected',
          activeLayer: 'Ashlr Daily',
          encoderDirection: 'correct',
          configuredLayers: [{ name: 'Ashlr Daily', mapping: 'ashlr_daily', encoderDirection: 'correct' }],
        },
        profileFailure: null,
        receiverRuntime: { status: 'exclusive', instanceCount: 1, distinctBuildCount: 1, currentAsarSha256: asarSha },
        inputApplication: { status: 'not_running' },
        shortcuts: { registeredCount: 20, expectedCount: 20 },
      },
      gates: { variant: true, route: true, usb: true, input: true, profile: true, receiver: true, shortcuts: true },
      dualPlaneLayerAttestation: null,
    },
    evaluation: {
      status: 'passed', completedGestures: 20, expectedGestures: 20, expectedSignals: 20,
      receivedSignals: UNIQUE, missingSignals: [], problems: [],
      expectedCallbackCount: 24, acceptedCallbackCount: 24,
    },
    duplicateSuppression: {
      policy: 'adjacent-edge-once/v1', windowMs: 35, inclusive: true, nonSliding: true,
      maxPerAcceptedEdge: 1, eligibleSignals: EDGES, suppressedCount: 0, droppedCount: 0, events: [],
    },
    rawEvents,
    disclaimer: 'Operator-guided global-shortcut receipt; not a cryptographic device-identity attestation.',
    sha256: '',
  })
}

function tempDirectory(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'agent-board-flight-acceptance-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

function receiptFilename(stamp = '2026-09-08T22-14-51-519Z') {
  return `ashlr-agent-board-flight-check-${stamp}-${randomUUID()}.json`
}

function writeReceipt(directory, receipt, name = receiptFilename()) {
  writeFileSync(path.join(directory, name), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
  return name
}

function inspect(directory, currentAppAsarSha256 = CURRENT_SHA) {
  return inspectFlightBuildAcceptance({ receiptDirectory: directory, currentAppAsarSha256 })
}

test('returns a minimal current-build projection for an exact sealed receipt', (t) => {
  const directory = tempDirectory(t)
  const receipt = makeReceipt()
  writeReceipt(directory, receipt)

  const result = inspect(directory)
  assert.deepEqual(result, {
    status: 'current_build_accepted',
    acceptedAt: receipt.rawEvents.at(-1).receivedAt,
    exportedAt: receipt.exportedAt,
    appVersion: '0.2.0',
    appAsarSha256: CURRENT_SHA,
    route: 'ashlr_layer',
    profileKind: 'daily',
    profileName: 'Ashlr Agent Board Corrected',
    layerName: 'Ashlr Daily',
    expectedCallbackCount: 24,
    acceptedCallbackCount: 24,
    suppressedDuplicateCount: 0,
    receiptSha256: receipt.sha256,
  })
  for (const privateKey of ['rawEvents', 'configuration', 'device', 'receiptId', 'filename', 'path']) {
    assert.equal(Object.hasOwn(result, privateKey), false)
  }
  assert.equal(Object.isFrozen(result), true)
})

test('distinguishes a missing or empty store from an invalid store', (t) => {
  const root = tempDirectory(t)
  assert.equal(inspect(path.join(root, 'missing')).status, 'absent')
  const empty = path.join(root, 'empty')
  mkdirSync(empty, { mode: 0o700 })
  assert.equal(inspect(empty).status, 'absent')
  writeFileSync(path.join(empty, 'unrelated.txt'), 'not a receipt')
  assert.equal(inspect(empty).status, 'absent')
})

test('returns the newest other-build acceptance when no receipt matches this build', (t) => {
  const directory = tempDirectory(t)
  const older = makeReceipt({ asarSha: OTHER_SHA, exportedAt: '2026-09-08T22:14:51.519Z' })
  const newer = makeReceipt({ asarSha: 'c'.repeat(64), exportedAt: '2026-09-08T23:14:51.519Z' })
  writeReceipt(directory, older)
  writeReceipt(directory, newer)
  const result = inspect(directory)
  assert.equal(result.status, 'accepted_other_build')
  assert.equal(result.appAsarSha256, 'c'.repeat(64))
})

test('prefers the newest matching build over a newer receipt for another build', (t) => {
  const directory = tempDirectory(t)
  const matching = makeReceipt({ exportedAt: '2026-09-08T22:14:51.519Z' })
  const other = makeReceipt({ asarSha: OTHER_SHA, exportedAt: '2026-09-08T23:14:51.519Z' })
  writeReceipt(directory, matching)
  writeReceipt(directory, other)
  const result = inspect(directory)
  assert.equal(result.status, 'current_build_accepted')
  assert.equal(result.receiptSha256, matching.sha256)
})

test('uses the receipt hash as a deterministic tie breaker', (t) => {
  const directory = tempDirectory(t)
  const first = makeReceipt()
  const second = makeReceipt()
  writeReceipt(directory, first)
  writeReceipt(directory, second)
  const result = inspect(directory)
  assert.equal(result.receiptSha256, [first.sha256, second.sha256].sort().at(-1))
})

test('accepts bounded suppression evidence and projects only its count', (t) => {
  const directory = tempDirectory(t)
  const receipt = makeReceipt()
  const anchor = receipt.rawEvents.find((event) => event.signalId === 'agent1')
  receipt.duplicateSuppression.suppressedCount = 1
  receipt.duplicateSuppression.events = [{
    signalId: anchor.signalId,
    accelerator: anchor.accelerator,
    receivedAt: new Date(Date.parse(anchor.receivedAt) + 10).toISOString(),
    monotonicNs: String(BigInt(anchor.monotonicNs) + 10_000_000n),
    route: 'ashlr_layer',
    receiverGeneration: 4,
    priorAcceptedSequence: anchor.sequence,
    deltaNs: '10000000',
    reason: 'adjacent_duplicate_within_window',
  }]
  seal(receipt)
  writeReceipt(directory, receipt)
  const result = inspect(directory)
  assert.equal(result.status, 'current_build_accepted')
  assert.equal(result.suppressedDuplicateCount, 1)
  assert.equal(Object.hasOwn(result, 'events'), false)
})

test('accepts a daily Ashlr receipt with a fresh operator-attested Dual Plane selection', (t) => {
  const directory = tempDirectory(t)
  const receipt = makeReceipt()
  receipt.configuration.admission.dualPlaneAshlrLayerSelected = true
  receipt.configuration.admission.inputProfile = {
    cacheStatus: 'available',
    activeProfile: 'Ashlr Dual Plane (UNOFFICIAL)',
    activeLayer: null,
    encoderDirection: 'correct',
    configuredLayers: [
      { name: 'Codex Native Recovery (UNOFFICIAL)', mapping: 'codex_native', encoderDirection: 'unavailable' },
      { name: 'Ashlr Daily', mapping: 'ashlr_daily', encoderDirection: 'correct' },
    ],
  }
  receipt.configuration.dualPlaneLayerAttestation = {
    source: 'operator',
    attestedAt: '2026-09-08T22:13:58.000Z',
  }
  seal(receipt)
  writeReceipt(directory, receipt)

  const result = inspect(directory)
  assert.equal(result.status, 'current_build_accepted')
  assert.equal(result.profileName, 'Ashlr Dual Plane (UNOFFICIAL)')
  // The receipt records a run-scoped layer attestation, not a currently
  // observable active layer after relaunch.
  assert.equal(result.layerName, null)
})

test('rejects a receipt changed after its SHA was sealed', (t) => {
  const directory = tempDirectory(t)
  const receipt = makeReceipt()
  receipt.appVersion = '9.9.9'
  writeReceipt(directory, receipt)
  assert.equal(inspect(directory).status, 'invalid')
})

const semanticMutations = [
  ['failed status', (receipt) => { receipt.status = 'failed' }],
  ['diagnostic profile', (receipt) => { receipt.profileKind = 'diagnostic' }],
  ['wrong route', (receipt) => { receipt.configuration.admission.boardRoute = 'hybrid_native' }],
  ['missing USB', (receipt) => { receipt.device.usbDetected = false }],
  ['untrusted Input', (receipt) => { receipt.configuration.admission.inputInstallation.status = 'invalid_signature' }],
  ['wrong profile', (receipt) => { receipt.configuration.admission.inputProfile.activeProfile = 'Other' }],
  ['wrong layer', (receipt) => { receipt.configuration.admission.inputProfile.activeLayer = 'Other' }],
  ['contended receiver', (receipt) => { receipt.configuration.admission.receiverRuntime.status = 'contended_same_build' }],
  ['malformed receiver hash', (receipt) => { receipt.configuration.admission.receiverRuntime.currentAsarSha256 = 'bad' }],
  ['missing registration', (receipt) => { receipt.configuration.registrations.pop() }],
  ['duplicate registration', (receipt) => { receipt.configuration.registrations[1] = { ...receipt.configuration.registrations[0] } }],
  ['unregistered endpoint', (receipt) => { receipt.configuration.registrations[0].registered = false }],
  ['wrong accelerator', (receipt) => { receipt.configuration.registrations[0].accelerator = 'Command+1' }],
  ['failed gate', (receipt) => { receipt.configuration.gates.shortcuts = false }],
  ['wrong accepted count', (receipt) => { receipt.evaluation.acceptedCallbackCount = 23 }],
  ['missing callback', (receipt) => { receipt.rawEvents.pop() }],
  ['out-of-order callback', (receipt) => { [receipt.rawEvents[0], receipt.rawEvents[1]] = [receipt.rawEvents[1], receipt.rawEvents[0]] }],
  ['reported problem', (receipt) => { receipt.evaluation.problems.push({ kind: 'misroute' }) }],
  ['missing signal', (receipt) => { receipt.evaluation.missingSignals.push('cmd7') }],
  ['suppression drop', (receipt) => { receipt.duplicateSuppression.droppedCount = 1 }],
  ['wrong suppression policy', (receipt) => { receipt.duplicateSuppression.policy = 'unknown/v1' }],
  ['contradictory suppression timing', (receipt) => {
    const anchor = receipt.rawEvents.find((event) => event.signalId === 'agent1')
    receipt.duplicateSuppression.suppressedCount = 1
    receipt.duplicateSuppression.events = [{
      signalId: anchor.signalId,
      accelerator: anchor.accelerator,
      receivedAt: new Date(Date.parse(anchor.receivedAt) + 10).toISOString(),
      monotonicNs: String(BigInt(anchor.monotonicNs) + 20_000_000n),
      route: 'ashlr_layer',
      receiverGeneration: 4,
      priorAcceptedSequence: anchor.sequence,
      deltaNs: '10000000',
      reason: 'adjacent_duplicate_within_window',
    }]
  }],
  ['multiple suppressions for one accepted edge', (receipt) => {
    const anchor = receipt.rawEvents.find((event) => event.signalId === 'agent1')
    const event = {
      signalId: anchor.signalId,
      accelerator: anchor.accelerator,
      receivedAt: new Date(Date.parse(anchor.receivedAt) + 10).toISOString(),
      monotonicNs: String(BigInt(anchor.monotonicNs) + 10_000_000n),
      route: 'ashlr_layer',
      receiverGeneration: 4,
      priorAcceptedSequence: anchor.sequence,
      deltaNs: '10000000',
      reason: 'adjacent_duplicate_within_window',
    }
    receipt.duplicateSuppression.suppressedCount = 2
    receipt.duplicateSuppression.events = [
      event,
      {
        ...event,
        receivedAt: new Date(Date.parse(anchor.receivedAt) + 20).toISOString(),
        monotonicNs: String(BigInt(anchor.monotonicNs) + 20_000_000n),
        deltaNs: '20000000',
      },
    ]
  }],
  ['unsealed extra field', (receipt) => { receipt.localPath = '/private/path' }],
]

for (const [label, mutate] of semanticMutations) {
  test(`rejects a correctly hashed receipt with ${label}`, (t) => {
    const directory = tempDirectory(t)
    const receipt = makeReceipt()
    mutate(receipt)
    seal(receipt)
    writeReceipt(directory, receipt)
    assert.equal(inspect(directory).status, 'invalid')
  })
}

test('rejects truncated and oversized candidate receipt files', (t) => {
  const truncated = tempDirectory(t)
  writeFileSync(path.join(truncated, receiptFilename()), '{')
  assert.equal(inspect(truncated).status, 'invalid')

  const oversized = tempDirectory(t)
  writeFileSync(
    path.join(oversized, receiptFilename()),
    Buffer.alloc(MAX_FLIGHT_RECEIPT_BYTES + 1, 0x20),
  )
  assert.equal(inspect(oversized).status, 'invalid')
})

test('rejects symlinked stores and files without following them', (t) => {
  const root = tempDirectory(t)
  const target = path.join(root, 'target')
  mkdirSync(target, { mode: 0o700 })
  writeReceipt(target, makeReceipt(), 'source.json')
  const linkedDirectory = path.join(root, 'linked-directory')
  symlinkSync(target, linkedDirectory)
  assert.equal(inspect(linkedDirectory).status, 'invalid')

  const store = path.join(root, 'store')
  mkdirSync(store, { mode: 0o700 })
  symlinkSync(
    path.join(target, 'source.json'),
    path.join(store, receiptFilename()),
  )
  assert.equal(inspect(store).status, 'invalid')
})

test('rejects acceptance evidence readable by other local users', { skip: process.platform === 'win32' }, (t) => {
  const insecureFileStore = tempDirectory(t)
  const filename = writeReceipt(insecureFileStore, makeReceipt())
  chmodSync(path.join(insecureFileStore, filename), 0o644)
  assert.equal(inspect(insecureFileStore).status, 'invalid')

  const insecureDirectory = tempDirectory(t)
  writeReceipt(insecureDirectory, makeReceipt())
  chmodSync(insecureDirectory, 0o755)
  assert.equal(inspect(insecureDirectory).status, 'invalid')
})

test('ignores unrelated files beyond the receipt scan bound without losing acceptance', (t) => {
  const directory = tempDirectory(t)
  const receipt = makeReceipt()
  writeReceipt(directory, receipt)
  for (let index = 0; index <= MAX_FLIGHT_RECEIPT_FILES; index += 1) {
    writeFileSync(path.join(directory, `unrelated-${index}.txt`), '')
  }
  assert.equal(inspect(directory).status, 'current_build_accepted')
})

test('keeps inspection bounded when receipt history exceeds the scan window', (t) => {
  const directory = tempDirectory(t)
  for (let index = 0; index <= MAX_FLIGHT_RECEIPT_FILES; index += 1) {
    const receipt = makeReceipt({ exportedAt: new Date(Date.parse('2026-09-08T22:14:51.519Z') + index).toISOString() })
    writeReceipt(directory, receipt, receiptFilename(`2026-09-08T22-14-51-${String(index).padStart(3, '0')}Z`))
  }
  assert.equal(inspect(directory).status, 'current_build_accepted')
})

test('rejects an implausibly crowded private receipt directory', (t) => {
  const directory = tempDirectory(t)
  for (let index = 0; index <= MAX_FLIGHT_RECEIPT_DIRECTORY_ENTRIES; index += 1) {
    writeFileSync(path.join(directory, `unrelated-${index}.txt`), '')
  }
  assert.equal(inspect(directory).status, 'invalid')
})

test('a malformed older candidate does not hide a valid sealed receipt', (t) => {
  const directory = tempDirectory(t)
  writeFileSync(path.join(directory, receiptFilename('2026-09-08T21-14-51-519Z')), '{')
  const receipt = makeReceipt()
  writeReceipt(directory, receipt)
  assert.equal(inspect(directory).status, 'current_build_accepted')
})

test('rejects malformed construction arguments', (t) => {
  const directory = tempDirectory(t)
  assert.throws(() => inspectFlightBuildAcceptance({ receiptDirectory: 'relative', currentAppAsarSha256: CURRENT_SHA }), /bounded absolute path/)
  assert.throws(() => inspectFlightBuildAcceptance({ receiptDirectory: `${directory}\n`, currentAppAsarSha256: CURRENT_SHA }), /bounded absolute path/)
  assert.throws(() => inspectFlightBuildAcceptance({ receiptDirectory: `${directory}\u202e`, currentAppAsarSha256: CURRENT_SHA }), /bounded absolute path/)
  assert.throws(() => inspectFlightBuildAcceptance({ receiptDirectory: directory, currentAppAsarSha256: 'A'.repeat(64) }), /lowercase SHA-256/)
  assert.throws(() => inspectFlightBuildAcceptance({ receiptDirectory: directory, currentAppAsarSha256: null }), /lowercase SHA-256/)
})

test('the standalone sanitizer never projects raw receipt structures', () => {
  const receipt = makeReceipt()
  const result = sanitizeFlightBuildAcceptanceReceipt(receipt)
  assert.equal(result.appAsarSha256, CURRENT_SHA)
  assert.equal(Object.hasOwn(result, 'rawEvents'), false)
  assert.equal(Object.hasOwn(result, 'configuration'), false)
  assert.equal(Object.hasOwn(result, 'receiptId'), false)
  assert.equal(sanitizeFlightBuildAcceptanceReceipt(null), null)
})
