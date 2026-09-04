const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const {
  MAX_KEYMAP_BYTES,
  classifyInputKeymap,
  inspectInputProfile,
  sanitizeLabel,
} = require('./input-profile-diagnostics.cjs')

function macro(id, tap) {
  return {
    id,
    name: `private name ${id}`,
    actions: [
      { kc: 'KC_LCTL', act: 1 }, { kc: 'KC_LALT', act: 1 }, { kc: 'KC_LGUI', act: 1 },
      { kc: tap, act: 2 },
      { kc: 'KC_LGUI', act: 0 }, { kc: 'KC_LALT', act: 0 }, { kc: 'KC_LCTL', act: 0 },
    ],
  }
}

function fixture(encoder = ['KA_A19', 'KA_A18', 'KA_A20']) {
  return {
    version: 1,
    activeProfileId: 1,
    profiles: [{ id: 1, name: 'Ashlr Agent Board', layers: [{ id: 0, name: 'Ashlr Daily', layout: { encoders: [encoder] } }] }],
    macros: [macro(18, 'KC_Q'), macro(19, 'KC_W'), macro(20, 'KC_R')],
  }
}

function writeFixedKeymap(home, value, storageId = '33432') {
  const directory = path.join(home, 'Library', 'Application Support', 'input', 'devices', storageId)
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'keymap.json'), typeof value === 'string' ? value : JSON.stringify(value))
}

test('reports only sanitized active labels and a correct encoder direction', () => {
  const result = classifyInputKeymap(fixture())
  assert.deepEqual(result, {
    cacheStatus: 'available',
    activeProfile: 'Ashlr Agent Board',
    activeLayer: 'Ashlr Daily',
    encoderDirection: 'correct',
    configuredLayers: [{ name: 'Ashlr Daily', mapping: 'unknown', encoderDirection: 'correct', dailySignalCount: 3, unboundControls: [] }],
  })
  assert.equal(JSON.stringify(result).includes('KC_'), false)
  assert.equal(JSON.stringify(result).includes('private name'), false)
})

test('detects the observed left-right encoder inversion', () => {
  assert.equal(classifyInputKeymap(fixture(['KA_A18', 'KA_A19', 'KA_A20'])).encoderDirection, 'reversed')
})

test('does not invent an active layer for a multi-layer profile', () => {
  const raw = fixture()
  raw.profiles[0].layers.push({ id: 1, name: 'Another layer', layout: { encoders: [['KC_NONE', 'KC_NONE', 'KC_NONE']] } })
  assert.deepEqual(classifyInputKeymap(raw), {
    cacheStatus: 'available', activeProfile: 'Ashlr Agent Board', activeLayer: null, encoderDirection: 'unavailable',
    configuredLayers: [
      { name: 'Ashlr Daily', mapping: 'unknown', encoderDirection: 'correct', dailySignalCount: 3, unboundControls: [] },
      { name: 'Another layer', mapping: 'unknown', encoderDirection: 'unrecognized', dailySignalCount: 0, unboundControls: [] },
    ],
  })

})

test('recognizes exact native and Ashlr mappings inside a dual-plane profile without claiming the selected layer', () => {
  const taps = ['KC_1', 'KC_2', 'KC_3', 'KC_4', 'KC_5', 'KC_6', 'KC_A', 'KC_B', 'KC_C', 'KC_D', 'KC_E', 'KC_F', 'KC_G', 'KC_UP', 'KC_RGHT', 'KC_DOWN', 'KC_LEFT', 'KC_Q', 'KC_W', 'KC_R']
  const raw = {
    activeProfileId: 7,
    profiles: [{
      id: 7,
      name: 'Ashlr Dual Plane (UNOFFICIAL)',
      layers: [
        {
          id: 0,
          name: 'Codex Native Recovery (UNOFFICIAL)',
          layout: {
            keymap: [
              ['KV_OAI_AG00', 'KV_OAI_AG01'],
              ['KV_OAI_AG02', 'KV_OAI_AG03', 'KV_OAI_AG04', 'KV_OAI_AG05'],
              ['KV_OAI_ACT06', 'KV_OAI_ACT07', 'KV_OAI_ACT08', 'KV_OAI_ACT09'],
              ['KV_OAI_ACT10', 'KV_OAI_ACT11', 'KV_OAI_ACT12'],
            ],
            encoders: [['KV_OAI_ENC_CC', 'KV_OAI_ENC_CW', 'KV_OAI_ENC_CLK']],
            joystick: { type: 'VENDOR', sectors: [] },
          },
        },
        {
          id: 1,
          name: 'Ashlr Daily',
          layout: {
            keymap: [['KA_A1', 'KA_A2'], ['KA_A3', 'KA_A4', 'KA_A5', 'KA_A6'], ['KA_A7', 'KA_A8', 'KA_A9', 'KA_A10'], ['KA_A11', 'KA_A12', 'KA_A13']],
            encoders: [['KA_A19', 'KA_A18', 'KA_A20']],
            joystick: {
              type: 'RADIAL',
              sectors: [
                { k: 'KA_A16', a1: 0.1875, a2: 0.3125 }, { k: 'KC_NONE', a1: 0.3125, a2: 0.4375 },
                { k: 'KA_A17', a1: 0.4375, a2: 0.5625 }, { k: 'KC_NONE', a1: 0.5625, a2: 0.6875 },
                { k: 'KA_A14', a1: 0.6875, a2: 0.8125 }, { k: 'KC_NONE', a1: 0.8125, a2: 0.9375 },
                { k: 'KA_A15', a1: 0.9375, a2: 0.0625 }, { k: 'KC_NONE', a1: 0.0625, a2: 0.1875 },
              ],
            },
          },
        },
      ],
    }],
    macros: taps.map((tap, index) => macro(index + 1, tap)),
  }
  assert.deepEqual(classifyInputKeymap(raw), {
    cacheStatus: 'available',
    activeProfile: 'Ashlr Dual Plane (UNOFFICIAL)',
    activeLayer: null,
    encoderDirection: 'unavailable',
    configuredLayers: [
      { name: 'Codex Native Recovery (UNOFFICIAL)', mapping: 'codex_native', encoderDirection: 'unrecognized', dailySignalCount: 0, unboundControls: [] },
      { name: 'Ashlr Daily', mapping: 'ashlr_daily', encoderDirection: 'correct', dailySignalCount: 20, unboundControls: [] },
    ],
  })

  const unexpected = structuredClone(raw)
  unexpected.profiles[0].layers[1].layout.encoders.push(['KA_A1'])
  assert.deepEqual(classifyInputKeymap(unexpected).configuredLayers[1], {
    name: 'Ashlr Daily',
    mapping: 'unknown',
    encoderDirection: 'correct',
    dailySignalCount: null,
    unboundControls: [],
    unexpectedBindings: true,
  })

  const unexpectedSector = structuredClone(raw)
  unexpectedSector.profiles[0].layers[1].layout.joystick.sectors.push({ k: 'KA_A1', a1: 0.1, a2: 0.2 })
  assert.deepEqual(classifyInputKeymap(unexpectedSector).configuredLayers[1], {
    name: 'Ashlr Daily',
    mapping: 'unknown',
    encoderDirection: 'correct',
    dailySignalCount: null,
    unboundControls: [],
    unexpectedBindings: true,
  })

  const parallelBase = structuredClone(raw)
  parallelBase.profiles[0].layers[1].layout.base = structuredClone(parallelBase.profiles[0].layers[1].layout.keymap)
  assert.equal(classifyInputKeymap(parallelBase).configuredLayers[1].mapping, 'unknown')

  const unexpectedButtons = structuredClone(raw)
  unexpectedButtons.profiles[0].layers[1].layout.joystick.buttons = ['KA_A1']
  assert.equal(classifyInputKeymap(unexpectedButtons).configuredLayers[1].mapping, 'unknown')

  const malformedParallelBase = structuredClone(raw)
  malformedParallelBase.profiles[0].layers[1].layout.base = null
  assert.equal(classifyInputKeymap(malformedParallelBase).configuredLayers[1].mapping, 'unknown')

  const extraSectorField = structuredClone(raw)
  extraSectorField.profiles[0].layers[1].layout.joystick.sectors[0].extraBinding = 'KA_A1'
  assert.equal(classifyInputKeymap(extraSectorField).configuredLayers[1].mapping, 'unknown')

  const incomplete = structuredClone(raw)
  incomplete.profiles[0].name = 'Ashlr Agent Board Corrected'
  incomplete.profiles[0].layers = [incomplete.profiles[0].layers[1]]
  incomplete.profiles[0].layers[0].id = 0
  incomplete.profiles[0].layers[0].layout.keymap[3][1] = 'KC_NONE'
  assert.deepEqual(classifyInputKeymap(incomplete).configuredLayers[0], {
    name: 'Ashlr Daily',
    mapping: 'unknown',
    encoderDirection: 'correct',
    dailySignalCount: 19,
    unboundControls: ['ACT11'],
  })
})

test('rejects near-match dual layers with changed native or joystick controls', () => {
  const taps = ['KC_1', 'KC_2', 'KC_3', 'KC_4', 'KC_5', 'KC_6', 'KC_A', 'KC_B', 'KC_C', 'KC_D', 'KC_E', 'KC_F', 'KC_G', 'KC_UP', 'KC_RGHT', 'KC_DOWN', 'KC_LEFT', 'KC_Q', 'KC_W', 'KC_R']
  const raw = {
    activeProfileId: 1,
    profiles: [{ id: 1, name: 'Ashlr Dual Plane (UNOFFICIAL)', layers: [
      { name: 'Codex Native Recovery (UNOFFICIAL)', layout: { keymap: [
        ['KV_OAI_AG00', 'KV_OAI_AG01'], ['KV_OAI_AG02', 'KV_OAI_AG03', 'KV_OAI_AG04', 'KV_OAI_AG05'],
        ['KV_OAI_ACT06', 'KV_OAI_ACT07', 'KV_OAI_ACT08', 'KV_OAI_ACT09'], ['KV_OAI_ACT10', 'KV_OAI_ACT11', 'KV_OAI_ACT12'],
      ], encoders: [['KV_OAI_ENC_CC', 'KV_OAI_ENC_CW', 'KC_ENTER']], joystick: { type: 'VENDOR', sectors: [] } } },
      { name: 'Ashlr Daily', layout: { keymap: [['KA_A1', 'KA_A2'], ['KA_A3', 'KA_A4', 'KA_A5', 'KA_A6'], ['KA_A7', 'KA_A8', 'KA_A9', 'KA_A10'], ['KA_A11', 'KA_A12', 'KA_A13']], encoders: [['KA_A19', 'KA_A18', 'KA_A20']], joystick: { type: 'RADIAL', sectors: [] } } },
    ] }],
    macros: taps.map((tap, index) => macro(index + 1, tap)),
  }
  assert.deepEqual(classifyInputKeymap(raw).configuredLayers.map((layer) => layer.mapping), ['unknown', 'unknown'])
})

test('recognizes only the exact mixed Hybrid Native ownership surface', () => {
  const taps = ['KC_1', 'KC_2', 'KC_3', 'KC_4', 'KC_5', 'KC_6', 'KC_A', 'KC_B', 'KC_C', 'KC_D', 'KC_E', 'KC_F', 'KC_G', 'KC_UP', 'KC_RGHT', 'KC_DOWN', 'KC_LEFT', 'KC_Q', 'KC_W', 'KC_R']
  const hybrid = {
    name: 'Ashlr Hybrid Native (UNOFFICIAL)',
    layout: {
      keymap: [
        ['KV_OAI_AG00', 'KV_OAI_AG01'],
        ['KV_OAI_AG02', 'KV_OAI_AG03', 'KV_OAI_AG04', 'KV_OAI_AG05'],
        ['KA_A7', 'KA_A8', 'KA_A9', 'KA_A10'],
        ['KA_A11', 'KA_A12', 'KA_A13'],
      ],
      encoders: [['KA_A19', 'KA_A18', 'KA_A20']],
      joystick: {
        type: 'RADIAL',
        sectors: [
          { k: 'KA_A16', a1: 0.1875, a2: 0.3125 }, { k: 'KC_NONE', a1: 0.3125, a2: 0.4375 },
          { k: 'KA_A17', a1: 0.4375, a2: 0.5625 }, { k: 'KC_NONE', a1: 0.5625, a2: 0.6875 },
          { k: 'KA_A14', a1: 0.6875, a2: 0.8125 }, { k: 'KC_NONE', a1: 0.8125, a2: 0.9375 },
          { k: 'KA_A15', a1: 0.9375, a2: 0.0625 }, { k: 'KC_NONE', a1: 0.0625, a2: 0.1875 },
        ],
      },
    },
  }
  const raw = {
    activeProfileId: 1,
    profiles: [{ id: 1, name: 'Ashlr Hybrid Dual Plane (UNOFFICIAL)', layers: [hybrid, { ...hybrid, name: 'fallback' }] }],
    macros: taps.map((tap, index) => macro(index + 1, tap)),
  }
  assert.equal(classifyInputKeymap(raw).configuredLayers[0].mapping, 'hybrid_native')
  const malformedGeometry = structuredClone(raw)
  malformedGeometry.profiles[0].layers[0].layout.keymap = [
    malformedGeometry.profiles[0].layers[0].layout.keymap.flat(),
  ]
  assert.equal(classifyInputKeymap(malformedGeometry).configuredLayers[0].mapping, 'unknown')
  raw.profiles[0].layers[0].layout.keymap[0][0] = 'KA_A1'
  assert.equal(classifyInputKeymap(raw).configuredLayers[0].mapping, 'unknown')
})

test('fails closed for unknown macros and malformed cache data', () => {
  const unknown = fixture()
  unknown.macros[0].actions[3].kc = 'KC_Z'
  assert.equal(classifyInputKeymap(unknown).encoderDirection, 'unrecognized')
  assert.equal(classifyInputKeymap({ profiles: [] }).cacheStatus, 'invalid')
})

test('sanitizes control and bidi characters and bounds displayed labels', () => {
  const label = sanitizeLabel(`  Ashlr\n\u202eAgent\u2066 ${'x'.repeat(80)}  `)
  assert.equal(label.includes('\n'), false)
  assert.equal(label.includes('\u202e'), false)
  assert.equal([...label].length, 64)
})

test('reads only the fixed bounded Creator Micro 2 keymap path', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'input-profile-diagnostics-'))
  try {
    writeFixedKeymap(home, fixture())
    assert.equal(inspectInputProfile(home).encoderDirection, 'correct')
    writeFixedKeymap(home, 'x'.repeat(MAX_KEYMAP_BYTES + 1))
    assert.equal(inspectInputProfile(home).cacheStatus, 'invalid')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('reads the candidate 8297 cache only when that bounded identity is selected', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'input-profile-diagnostics-'))
  try {
    writeFixedKeymap(home, fixture(), '33431')
    assert.equal(inspectInputProfile(home, '33431').encoderDirection, 'correct')
    assert.equal(inspectInputProfile(home, '99999').cacheStatus, 'missing')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('rejects a symlinked keymap and never follows it', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'input-profile-diagnostics-'))
  const outside = mkdtempSync(path.join(tmpdir(), 'input-profile-outside-'))
  try {
    const directory = path.join(home, 'Library', 'Application Support', 'input', 'devices', '33432')
    mkdirSync(directory, { recursive: true })
    const target = path.join(outside, 'keymap.json')
    writeFileSync(target, JSON.stringify(fixture()))
    symlinkSync(target, path.join(directory, 'keymap.json'))
    assert.equal(inspectInputProfile(home).cacheStatus, 'unsafe')
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('distinguishes a missing cache without exposing its path', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'input-profile-diagnostics-'))
  try {
    assert.deepEqual(inspectInputProfile(home), {
      cacheStatus: 'missing', activeProfile: null, activeLayer: null, encoderDirection: 'unavailable', configuredLayers: [],
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
