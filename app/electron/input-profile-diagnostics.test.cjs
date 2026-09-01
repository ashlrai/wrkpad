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

function writeFixedKeymap(home, value) {
  const directory = path.join(home, 'Library', 'Application Support', 'input', 'devices', '33432')
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
  })
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
      cacheStatus: 'missing', activeProfile: null, activeLayer: null, encoderDirection: 'unavailable',
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
