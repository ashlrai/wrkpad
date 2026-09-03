const { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } = require('node:fs')
const path = require('node:path')

const MAX_KEYMAP_BYTES = 512 * 1024
const DEFAULT_DEVICE_STORAGE_ID = '33432'
const SUPPORTED_DEVICE_STORAGE_IDS = new Set(['33431', '33432'])
const EXPECTED_ENCODER_KEYS = Object.freeze({
  correct: ['KC_W', 'KC_Q', 'KC_R'],
  reversed: ['KC_Q', 'KC_W', 'KC_R'],
})

function unavailable(cacheStatus) {
  return {
    cacheStatus,
    activeProfile: null,
    activeLayer: null,
    encoderDirection: 'unavailable',
    configuredLayers: [],
  }
}

const EXPECTED_DAILY_BASE_KEYS = Object.freeze([
  'KC_1', 'KC_2', 'KC_3', 'KC_4', 'KC_5', 'KC_6',
  'KC_A', 'KC_B', 'KC_C', 'KC_D', 'KC_E', 'KC_F', 'KC_G',
])
const EXPECTED_NATIVE_BASE_KEYS = Object.freeze([
  'KV_OAI_AG00', 'KV_OAI_AG01', 'KV_OAI_AG02', 'KV_OAI_AG03', 'KV_OAI_AG04', 'KV_OAI_AG05',
  'KV_OAI_ACT06', 'KV_OAI_ACT07', 'KV_OAI_ACT08', 'KV_OAI_ACT09', 'KV_OAI_ACT10', 'KV_OAI_ACT11', 'KV_OAI_ACT12',
])
const EXPECTED_HYBRID_BASE_KEYS = Object.freeze([
  'KV_OAI_AG00', 'KV_OAI_AG01', 'KV_OAI_AG02', 'KV_OAI_AG03', 'KV_OAI_AG04', 'KV_OAI_AG05',
  'KC_A', 'KC_B', 'KC_C', 'KC_D', 'KC_E', 'KC_F', 'KC_G',
])
const EXPECTED_NATIVE_ENCODER_KEYS = Object.freeze(['KV_OAI_ENC_CC', 'KV_OAI_ENC_CW', 'KV_OAI_ENC_CLK'])
const EXPECTED_DAILY_JOYSTICK = Object.freeze([
  Object.freeze({ key: 'KC_DOWN', a1: 0.1875, a2: 0.3125 }), Object.freeze({ key: 'KC_NONE', a1: 0.3125, a2: 0.4375 }),
  Object.freeze({ key: 'KC_LEFT', a1: 0.4375, a2: 0.5625 }), Object.freeze({ key: 'KC_NONE', a1: 0.5625, a2: 0.6875 }),
  Object.freeze({ key: 'KC_UP', a1: 0.6875, a2: 0.8125 }), Object.freeze({ key: 'KC_NONE', a1: 0.8125, a2: 0.9375 }),
  Object.freeze({ key: 'KC_RGHT', a1: 0.9375, a2: 0.0625 }), Object.freeze({ key: 'KC_NONE', a1: 0.0625, a2: 0.1875 }),
])

function referencedKeycode(value) {
  return typeof value === 'string' ? value : value?.keycode
}

function classifyLayer(layer, macros) {
  const name = sanitizeLabel(layer?.name)
  const rawBase = Array.isArray(layer?.layout?.base) ? layer.layout.base : layer?.layout?.keymap
  const base = Array.isArray(rawBase) ? rawBase.flat() : []
  const resolvedBase = base.map((cell) => {
    const reference = referencedKeycode(cell)
    if (typeof reference !== 'string') return null
    if (reference.startsWith('KV_OAI_')) return reference
    return macroTapKey(macroForReference(reference, macros))
  })
  const encoder = layer?.layout?.encoders?.[0]
  const encoderDirection = classifyEncoderDirection(encoder, macros)
  const encoderKeycodes = Array.isArray(encoder) ? encoder.map(referencedKeycode) : []
  const joystick = layer?.layout?.joystick
  const normalizedSectors = Array.isArray(joystick?.sectors) ? joystick.sectors.map((sector) => {
    const reference = sector?.k
    const key = reference === 'KC_NONE' ? reference : macroTapKey(macroForReference(reference, macros))
    return { key, a1: sector?.a1, a2: sector?.a2 }
  }) : []
  const exactDailyJoystick = joystick?.type === 'RADIAL'
    && JSON.stringify(normalizedSectors) === JSON.stringify(EXPECTED_DAILY_JOYSTICK)
  const exactNativeControls = joystick?.type === 'VENDOR'
    && Array.isArray(joystick.sectors)
    && joystick.sectors.length === 0
    && JSON.stringify(encoderKeycodes) === JSON.stringify(EXPECTED_NATIVE_ENCODER_KEYS)
  const mapping = JSON.stringify(resolvedBase) === JSON.stringify(EXPECTED_DAILY_BASE_KEYS) && encoderDirection === 'correct' && exactDailyJoystick
    ? 'ashlr_daily'
    : JSON.stringify(resolvedBase) === JSON.stringify(EXPECTED_HYBRID_BASE_KEYS) && encoderDirection === 'correct' && exactDailyJoystick
      ? 'hybrid_native'
    : JSON.stringify(resolvedBase) === JSON.stringify(EXPECTED_NATIVE_BASE_KEYS) && exactNativeControls
      ? 'codex_native'
      : 'unknown'
  return { name, mapping, encoderDirection }
}

function sanitizeLabel(value) {
  if (typeof value !== 'string') return null
  const clean = [...value.normalize('NFKC')]
    .map((character) => {
      const point = character.codePointAt(0)
      const control = point <= 0x1f || (point >= 0x7f && point <= 0x9f)
      const bidiControl = (point >= 0x202a && point <= 0x202e) || (point >= 0x2066 && point <= 0x2069)
      return control || bidiControl ? ' ' : character
    })
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!clean) return null
  return [...clean].slice(0, 64).join('')
}

function macroTapKey(macro) {
  if (!macro || !Array.isArray(macro.actions) || macro.actions.length !== 7) return null
  const expected = [
    ['KC_LCTL', 1], ['KC_LALT', 1], ['KC_LGUI', 1],
    [null, 2],
    ['KC_LGUI', 0], ['KC_LALT', 0], ['KC_LCTL', 0],
  ]
  for (let index = 0; index < expected.length; index += 1) {
    const action = macro.actions[index]
    if (!action || action.act !== expected[index][1]) return null
    if (expected[index][0] && action.kc !== expected[index][0]) return null
  }
  return typeof macro.actions[3].kc === 'string' ? macro.actions[3].kc : null
}

function macroForReference(reference, macros) {
  const match = /^KA_A(\d{1,6})$/.exec(reference)
  if (!match) return null
  const id = Number(match[1])
  return macros.find((macro) => macro && macro.id === id) ?? null
}

function classifyEncoderDirection(encoder, macros) {
  if (!Array.isArray(encoder) || encoder.length !== 3 || !Array.isArray(macros) || macros.length > 512) return 'unavailable'
  const keys = encoder.map((reference) => macroTapKey(macroForReference(reference, macros)))
  if (keys.every((key, index) => key === EXPECTED_ENCODER_KEYS.correct[index])) return 'correct'
  if (keys.every((key, index) => key === EXPECTED_ENCODER_KEYS.reversed[index])) return 'reversed'
  return 'unrecognized'
}

function classifyInputKeymap(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.profiles) || raw.profiles.length > 32) return unavailable('invalid')
  if (!Number.isInteger(raw.activeProfileId)) return unavailable('invalid')
  const profile = raw.profiles.find((candidate) => candidate && candidate.id === raw.activeProfileId)
  if (!profile || !Array.isArray(profile.layers) || profile.layers.length < 1 || profile.layers.length > 16) return unavailable('invalid')

  const activeProfile = sanitizeLabel(profile.name)
  if (!activeProfile) return unavailable('invalid')

  // This cache does not persist an active-layer ID. A single-layer profile is
  // observable; a multi-layer profile must remain operator-verified.
  const configuredLayers = profile.layers.map((layer) => classifyLayer(layer, raw.macros))
  if (profile.layers.length !== 1) {
    return { cacheStatus: 'available', activeProfile, activeLayer: null, encoderDirection: 'unavailable', configuredLayers }
  }
  const layer = profile.layers[0]
  const activeLayer = sanitizeLabel(layer?.name)
  if (!activeLayer) return unavailable('invalid')
  const encoder = layer?.layout?.encoders?.[0]
  return {
    cacheStatus: 'available',
    activeProfile,
    activeLayer,
    encoderDirection: classifyEncoderDirection(encoder, raw.macros),
    configuredLayers,
  }
}

function keymapPath(home, deviceStorageId) {
  if (!SUPPORTED_DEVICE_STORAGE_IDS.has(deviceStorageId)) return null
  return path.join(home, 'Library', 'Application Support', 'input', 'devices', deviceStorageId, 'keymap.json')
}

function pathHasSymlink(home, filePath) {
  const relative = path.relative(home, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return true
  let current = home
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    const stats = lstatSync(current)
    if (stats.isSymbolicLink()) return true
  }
  return false
}

function inspectInputProfile(home, deviceStorageId = DEFAULT_DEVICE_STORAGE_ID) {
  let descriptor
  try {
    const filePath = keymapPath(home, deviceStorageId)
    if (!filePath) return unavailable('missing')
    if (pathHasSymlink(home, filePath)) return unavailable('unsafe')
    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (!stats.isFile()) return unavailable('unsafe')
    if (stats.size < 2 || stats.size > MAX_KEYMAP_BYTES) return unavailable('invalid')
    const text = readFileSync(descriptor, 'utf8')
    return classifyInputKeymap(JSON.parse(text))
  } catch (error) {
    return unavailable(error?.code === 'ENOENT' ? 'missing' : 'invalid')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

module.exports = {
  DEFAULT_DEVICE_STORAGE_ID,
  MAX_KEYMAP_BYTES,
  SUPPORTED_DEVICE_STORAGE_IDS,
  classifyEncoderDirection,
  classifyLayer,
  classifyInputKeymap,
  inspectInputProfile,
  sanitizeLabel,
}
