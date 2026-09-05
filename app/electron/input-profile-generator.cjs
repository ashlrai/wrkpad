const { createHash } = require('node:crypto')
const { closeSync, constants, fstatSync, openSync, readFileSync, writeFileSync } = require('node:fs')

const MAX_SOURCE_BYTES = 512 * 1024
const shortcutActions = [
  ['agent1', 'KC_1'], ['agent2', 'KC_2'], ['agent3', 'KC_3'], ['agent4', 'KC_4'], ['agent5', 'KC_5'], ['agent6', 'KC_6'],
  ['cmd1', 'KC_A'], ['cmd2', 'KC_B'], ['cmd3', 'KC_C'], ['cmd4', 'KC_D'], ['cmd5', 'KC_E'], ['cmd6', 'KC_F'], ['cmd7', 'KC_G'],
  ['joyUp', 'KC_UP'], ['joyRight', 'KC_RGHT'], ['joyDown', 'KC_DOWN'], ['joyLeft', 'KC_LEFT'],
  ['dialLeft', 'KC_Q'], ['dialRight', 'KC_W'], ['dialPress', 'KC_R'],
]

const DEFAULT_LIGHTS = Object.freeze({
  backlight: { effect: 'solid', brightness: 1, speed: 0.5, magic: 1, color: '#FFFFFF' },
  underglow: { effect: 'rainbow', brightness: 1, speed: 0.55, magic: 1, color: '#FFFFFF' },
})

const CODEX_NATIVE_RECOVERY_LAYER_NAME = 'Codex Native Recovery (UNOFFICIAL)'
const DUAL_PLANE_PROFILE_NAME = 'Ashlr Dual Plane (UNOFFICIAL)'
const HYBRID_NATIVE_LAYER_NAME = 'Ashlr Hybrid Native (UNOFFICIAL)'
const HYBRID_NATIVE_PROFILE_NAME = 'Ashlr Hybrid Dual Plane (UNOFFICIAL)'
const ONE_LAYER_PROFILE_VARIANTS = Object.freeze({
  daily: Object.freeze({
    profileName: 'Ashlr Agent Board Corrected',
    layerName: 'Ashlr Daily',
    color: '#4E70FF',
  }),
  diagnostic: Object.freeze({
    profileName: 'Ashlr Flight Check Corrected - diagnostic',
    layerName: 'Ashlr Diagnostic',
    color: '#ED9B4A',
  }),
})
const CODEX_NATIVE_KEYMAP = Object.freeze([
  Object.freeze(['KV_OAI_AG00', 'KV_OAI_AG01']),
  Object.freeze(['KV_OAI_AG02', 'KV_OAI_AG03', 'KV_OAI_AG04', 'KV_OAI_AG05']),
  Object.freeze(['KV_OAI_ACT06', 'KV_OAI_ACT07', 'KV_OAI_ACT08', 'KV_OAI_ACT09']),
  Object.freeze(['KV_OAI_ACT10', 'KV_OAI_ACT11', 'KV_OAI_ACT12']),
])
const CODEX_NATIVE_ENCODER = Object.freeze(['KV_OAI_ENC_CC', 'KV_OAI_ENC_CW', 'KV_OAI_ENC_CLK'])

function keycodeCell(keycode) {
  return { keycode }
}

function exactKeycodeCells(cells, expected) {
  return Array.isArray(cells)
    && cells.length === expected.length
    && cells.every((cell, index) => hasExactKeys(cell, ['keycode']) && cell.keycode === expected[index])
}

function exactKeycodeRows(rows, expected) {
  return Array.isArray(rows)
    && rows.length === expected.length
    && rows.every((row, index) => exactKeycodeCells(row, expected[index]))
}

/**
 * Build Work Louder Input's layer-import envelope, not the on-device
 * keymap.json format. This is an unofficial interoperability artifact derived
 * from independently published, hardware-observed profiles; generating it is
 * offline and confers no authority to import or activate it.
 */
function generateCodexNativeRecoveryLayer() {
  return {
    keyboard: 'creator_micro_v2',
    language: 'us',
    layer: {
      id: 0,
      name: CODEX_NATIVE_RECOVERY_LAYER_NAME,
      color: '#FF0000',
      layout: {
        base: CODEX_NATIVE_KEYMAP.map((row) => row.map(keycodeCell)),
        encoders: [[...CODEX_NATIVE_ENCODER].map(keycodeCell)],
        joystick: { type: 'VENDOR', sectors: [] },
      },
      os: 0,
      lights: structuredClone(DEFAULT_LIGHTS),
    },
    actions: [],
    multiactions: [],
    actionGroups: [{ id: 0, name: CODEX_NATIVE_RECOVERY_LAYER_NAME, actionIds: [] }],
    multiactionGroups: [{ id: 0, name: CODEX_NATIVE_RECOVERY_LAYER_NAME, actionIds: [] }],
  }
}

function layerHasExactCodexNativeLayout(layer) {
  if (!layer || layer.os !== 0 || layer.layout?.joystick?.type !== 'VENDOR') return false
  if (!Array.isArray(layer.layout.joystick.sectors) || layer.layout.joystick.sectors.length !== 0) return false
  const rows = layer.layout.base
  const encoder = layer.layout.encoders?.[0]
  return exactKeycodeRows(rows, CODEX_NATIVE_KEYMAP)
    && exactKeycodeCells(encoder, CODEX_NATIVE_ENCODER)
}

function hasExactKeys(value, keys) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
}

function hasExactLights(lights) {
  if (!hasExactKeys(lights, ['backlight', 'underglow'])) return false
  return ['backlight', 'underglow'].every((channel) => {
    const value = lights[channel]
    if (!hasExactKeys(value, ['effect', 'brightness', 'speed', 'magic', 'color'])) return false
    try {
      return JSON.stringify(safeLights({ backlight: lights.backlight, underglow: lights.underglow })[channel]) === JSON.stringify(value)
    } catch {
      return false
    }
  })
}

function inspectCodexNativeRecovery(value) {
  if (!value || value.keyboard !== 'creator_micro_v2' || value.language !== 'us') {
    return { status: 'mismatch', reason: 'expected_us_creator_micro_v2', matchingLayers: 0 }
  }
  const layers = value.layer ? [value.layer] : value.profile?.layers
  if (!Array.isArray(layers) || layers.length < 1 || layers.length > 6) {
    return { status: 'mismatch', reason: 'missing_bounded_layers', matchingLayers: 0 }
  }
  const matchingLayers = layers.filter(layerHasExactCodexNativeLayout)
  return matchingLayers.length === 1
    ? { status: 'match', reason: 'exact_native_layout', matchingLayers: 1 }
    : { status: 'mismatch', reason: matchingLayers.length === 0 ? 'native_layout_missing_or_changed' : 'native_layout_ambiguous', matchingLayers: matchingLayers.length }
}

function writeGeneratedCodexNativeRecoveryLayer(outputPath) {
  const output = `${JSON.stringify(generateCodexNativeRecoveryLayer(), null, 2)}\n`
  writeFileSync(outputPath, output, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return {
    outputPath,
    schema: 'work_louder_input_layer_import_unofficial',
    sha256: createHash('sha256').update(output).digest('hex'),
    physicalSwitches: 13,
    agentKeys: 6,
    actionKeys: 7,
    mutatesInputOrDevice: false,
  }
}

function safeLights(value) {
  if (value === undefined) return structuredClone(DEFAULT_LIGHTS)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Profile export has unsupported lighting data')
  const result = {}
  for (const channel of ['backlight', 'underglow']) {
    const source = value[channel]
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Profile export has unsupported lighting data')
    if (typeof source.effect !== 'string' || !/^[a-z0-9_-]{1,32}$/i.test(source.effect)) throw new Error('Profile export has unsupported lighting data')
    if (![source.brightness, source.speed, source.magic].every((item) => Number.isFinite(item) && item >= 0 && item <= 1)) throw new Error('Profile export has unsupported lighting data')
    if (typeof source.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(source.color)) throw new Error('Profile export has unsupported lighting data')
    result[channel] = {
      effect: source.effect,
      brightness: source.brightness,
      speed: source.speed,
      magic: source.magic,
      color: source.color.toUpperCase(),
    }
  }
  return result
}

function generateInputProfile(source, variant = 'daily') {
  if (!['daily', 'diagnostic'].includes(variant)) throw new Error('Variant must be daily or diagnostic')
  const variantProfile = ONE_LAYER_PROFILE_VARIANTS[variant]
  if (source?.keyboard !== 'creator_micro_v2' || source.language !== 'us') throw new Error('Expected a US Creator Micro V2 export')
  if (!source.profile || !Array.isArray(source.profile.layers) || !source.profile.layers[0]?.layout?.base) throw new Error('Profile export is missing its base layout')
  if (source.profile.layers.some((layer) => JSON.stringify(layer).includes('KV_OAI_'))) {
    throw new Error('Refusing to transform a profile that contains a protected KV_OAI layer; export an ordinary profile instead')
  }

  const sourceLayer = source.profile.layers[0]
  const sourceOs = sourceLayer.os ?? 0
  if (!Number.isInteger(sourceOs) || sourceOs < 0 || sourceOs > 3) throw new Error('Profile export has an unsupported OS value')
  // Construct the output from an explicit schema. Unknown source fields never
  // cross into the artifact that the operator may later import into Input.
  const profile = {
    keyboard: 'creator_micro_v2',
    language: 'us',
    profile: {
      id: 0,
      name: variantProfile.profileName,
      layers: [],
    },
    actions: [],
    actionGroups: [],
    multiactions: [],
    multiactionGroups: [{ id: 0, name: 'Default', actionIds: [] }],
    smartActions: [],
    smartActionGroups: [{ id: 0, name: 'Default', actionIds: [] }],
  }
  profile.actions = shortcutActions.map(([name, keycode], id) => ({
    id,
    name: `Ashlr ${name}`,
    color: null,
    keyInputs: [
      { keycode: 'KC_LCTL', delay: 0, actionType: 1 },
      { keycode: 'KC_LALT', delay: 0, actionType: 1 },
      { keycode: 'KC_LGUI', delay: 0, actionType: 1 },
      { keycode, delay: 0, actionType: 2 },
      { keycode: 'KC_LGUI', delay: 0, actionType: 0 },
      { keycode: 'KC_LALT', delay: 0, actionType: 0 },
      { keycode: 'KC_LCTL', delay: 0, actionType: 0 },
    ],
  }))
  profile.actionGroups = [{ id: 0, name: 'Ashlr Agent Board', actionIds: profile.actions.map((action) => action.id) }]

  const action = (id) => ({ keycode: `KA_${id}` })
  const layer = {
    id: 0,
    name: variantProfile.layerName,
    color: variantProfile.color,
    os: sourceOs,
    lights: safeLights(sourceLayer.lights),
    layout: {},
  }
  layer.layout.base = [
    [action(0), action(1)],
    [action(2), action(3), action(4), action(5)],
    [action(6), action(7), action(8), action(9)],
    [action(10), action(11), action(12)],
  ]
  // Work Louder Input serializes encoder positions clockwise, counterclockwise,
  // press. The user-facing action list is left, right, press, so the first two
  // references must swap in the export.
  layer.layout.encoders = [[action(18), action(17), action(19)]]
  layer.layout.joystick = {
    type: 'RADIAL',
    sectors: [
      { k: 'KA_15', a1: 0.1875, a2: 0.3125 }, { k: 'KC_NONE', a1: 0.3125, a2: 0.4375 },
      { k: 'KA_16', a1: 0.4375, a2: 0.5625 }, { k: 'KC_NONE', a1: 0.5625, a2: 0.6875 },
      { k: 'KA_13', a1: 0.6875, a2: 0.8125 }, { k: 'KC_NONE', a1: 0.8125, a2: 0.9375 },
      { k: 'KA_14', a1: 0.9375, a2: 0.0625 }, { k: 'KC_NONE', a1: 0.0625, a2: 0.1875 },
    ],
  }
  profile.profile.layers = [layer]
  return profile
}

function layerHasExactAshlrDailyLayout(layer) {
  if (!layer || layer.name !== 'Ashlr Daily' || layer.os !== 0 || layer.layout?.joystick?.type !== 'RADIAL') return false
  const base = layer.layout.base
  const encoders = layer.layout.encoders?.[0]
  const sectors = layer.layout.joystick.sectors
  return exactKeycodeRows(base, [
    ['KA_0', 'KA_1'],
    ['KA_2', 'KA_3', 'KA_4', 'KA_5'],
    ['KA_6', 'KA_7', 'KA_8', 'KA_9'],
    ['KA_10', 'KA_11', 'KA_12'],
  ])
    && exactKeycodeCells(encoders, ['KA_18', 'KA_17', 'KA_19'])
    && JSON.stringify(sectors) === JSON.stringify([
      { k: 'KA_15', a1: 0.1875, a2: 0.3125 }, { k: 'KC_NONE', a1: 0.3125, a2: 0.4375 },
      { k: 'KA_16', a1: 0.4375, a2: 0.5625 }, { k: 'KC_NONE', a1: 0.5625, a2: 0.6875 },
      { k: 'KA_13', a1: 0.6875, a2: 0.8125 }, { k: 'KC_NONE', a1: 0.8125, a2: 0.9375 },
      { k: 'KA_14', a1: 0.9375, a2: 0.0625 }, { k: 'KC_NONE', a1: 0.0625, a2: 0.1875 },
    ])
}

function hasExactShortcutActions(actions) {
  if (!Array.isArray(actions) || actions.length !== shortcutActions.length) return false
  return shortcutActions.every(([name, keycode], id) => {
    const action = actions[id]
    return action?.id === id
      && hasExactKeys(action, ['id', 'name', 'color', 'keyInputs'])
      && action.name === `Ashlr ${name}`
      && action.color === null
      && Array.isArray(action.keyInputs)
      && action.keyInputs.every((keyInput) => hasExactKeys(keyInput, ['keycode', 'delay', 'actionType']))
      && JSON.stringify(action.keyInputs) === JSON.stringify([
        { keycode: 'KC_LCTL', delay: 0, actionType: 1 },
        { keycode: 'KC_LALT', delay: 0, actionType: 1 },
        { keycode: 'KC_LGUI', delay: 0, actionType: 1 },
        { keycode, delay: 0, actionType: 2 },
        { keycode: 'KC_LGUI', delay: 0, actionType: 0 },
        { keycode: 'KC_LALT', delay: 0, actionType: 0 },
        { keycode: 'KC_LCTL', delay: 0, actionType: 0 },
      ])
  })
}

function layerHasExactAshlrShortcutLayout(layer, variant) {
  const expected = ONE_LAYER_PROFILE_VARIANTS[variant]
  if (!expected
    || !layer
    || layer.name !== expected.layerName
    || !Number.isInteger(layer.os)
    || layer.os < 0
    || layer.os > 3
    || layer.layout?.joystick?.type !== 'RADIAL') return false
  return exactKeycodeRows(layer.layout.base, [
    ['KA_0', 'KA_1'],
    ['KA_2', 'KA_3', 'KA_4', 'KA_5'],
    ['KA_6', 'KA_7', 'KA_8', 'KA_9'],
    ['KA_10', 'KA_11', 'KA_12'],
  ])
    && exactKeycodeCells(layer.layout.encoders?.[0], ['KA_18', 'KA_17', 'KA_19'])
    && JSON.stringify(layer.layout.joystick.sectors) === JSON.stringify([
      { k: 'KA_15', a1: 0.1875, a2: 0.3125 }, { k: 'KC_NONE', a1: 0.3125, a2: 0.4375 },
      { k: 'KA_16', a1: 0.4375, a2: 0.5625 }, { k: 'KC_NONE', a1: 0.5625, a2: 0.6875 },
      { k: 'KA_13', a1: 0.6875, a2: 0.8125 }, { k: 'KC_NONE', a1: 0.8125, a2: 0.9375 },
      { k: 'KA_14', a1: 0.9375, a2: 0.0625 }, { k: 'KC_NONE', a1: 0.0625, a2: 0.1875 },
    ])
}

/**
 * Verify only the exact one-layer artifact emitted by generateInputProfile.
 * A match describes the selected JSON file; it does not attest that Input
 * imported, activated, synchronized, or physically emitted the profile.
 */
function inspectGeneratedInputProfile(value, variant = 'daily') {
  const expected = ONE_LAYER_PROFILE_VARIANTS[variant]
  if (!expected) return { status: 'mismatch', reason: 'expected_daily_or_diagnostic_variant' }
  if (!value || value.keyboard !== 'creator_micro_v2' || value.language !== 'us') {
    return { status: 'mismatch', reason: 'expected_us_creator_micro_v2' }
  }
  if (!hasExactKeys(value, ['keyboard', 'language', 'profile', 'actions', 'actionGroups', 'multiactions', 'multiactionGroups', 'smartActions', 'smartActionGroups'])
    || !hasExactKeys(value.profile, ['id', 'name', 'layers'])
    || value.profile.id !== 0
    || value.profile.name !== expected.profileName
    || !Array.isArray(value.profile.layers)
    || value.profile.layers.length !== 1) {
    return { status: 'mismatch', reason: `expected_exact_${variant}_one_layer_profile` }
  }
  const [layer] = value.profile.layers
  const exactActionGroups = JSON.stringify(value.actionGroups) === JSON.stringify([{ id: 0, name: 'Ashlr Agent Board', actionIds: shortcutActions.map((_, id) => id) }])
  const exactEmptyGroups = JSON.stringify(value.multiactions) === '[]'
    && JSON.stringify(value.smartActions) === '[]'
    && JSON.stringify(value.multiactionGroups) === JSON.stringify([{ id: 0, name: 'Default', actionIds: [] }])
    && JSON.stringify(value.smartActionGroups) === JSON.stringify([{ id: 0, name: 'Default', actionIds: [] }])
  if (!hasExactKeys(layer, ['id', 'name', 'color', 'layout', 'os', 'lights'])
    || layer.id !== 0
    || layer.color !== expected.color
    || !hasExactKeys(layer.layout, ['base', 'encoders', 'joystick'])
    || !hasExactLights(layer.lights)
    || !layerHasExactAshlrShortcutLayout(layer, variant)
    || !hasExactShortcutActions(value.actions)
    || !exactActionGroups
    || !exactEmptyGroups) {
    return { status: 'mismatch', reason: `ashlr_${variant}_profile_content_missing_or_changed` }
  }
  return { status: 'match', reason: `exact_${variant}_one_layer_profile` }
}

/**
 * Build one bounded profile with Codex's protected native layout first and the
 * provider-neutral Ashlr shortcut layout second. The touch surface remains the
 * firmware-owned layer selector; this artifact does not add app links or write
 * Input/device state.
 */
function generateDualPlaneInputProfile(source) {
  const daily = generateInputProfile(source, 'daily')
  if (daily.profile.layers[0].os !== 0) throw new Error('Dual Plane currently supports only a macOS source export')
  const nativeLayer = structuredClone(generateCodexNativeRecoveryLayer().layer)
  nativeLayer.id = 0
  nativeLayer.lights = structuredClone(daily.profile.layers[0].lights)
  const dailyLayer = structuredClone(daily.profile.layers[0])
  dailyLayer.id = 1
  return {
    ...daily,
    profile: {
      id: 0,
      name: DUAL_PLANE_PROFILE_NAME,
      layers: [nativeLayer, dailyLayer],
    },
  }
}

/**
 * Build an experimental first layer that leaves the six Agent keys on Codex's
 * vendor protocol while routing every other bindable control through the same
 * ordinary shortcuts as Ashlr Daily. The unchanged all-shortcut layer remains
 * second as a provider-neutral fallback.
 *
 * This function only creates an offline import artifact. It does not establish
 * that ChatGPT accepts a mixed layer or that Input synchronized it to a device.
 */
function generateHybridNativeInputProfile(source) {
  const daily = generateInputProfile(source, 'daily')
  if (daily.profile.layers[0].os !== 0) throw new Error('Hybrid Native currently supports only a macOS source export')
  const hybridLayer = structuredClone(daily.profile.layers[0])
  hybridLayer.id = 0
  hybridLayer.name = HYBRID_NATIVE_LAYER_NAME
  hybridLayer.layout.base[0] = CODEX_NATIVE_KEYMAP[0].map(keycodeCell)
  hybridLayer.layout.base[1] = CODEX_NATIVE_KEYMAP[1].map(keycodeCell)
  const dailyLayer = structuredClone(daily.profile.layers[0])
  dailyLayer.id = 1
  return {
    ...daily,
    profile: {
      id: 0,
      name: HYBRID_NATIVE_PROFILE_NAME,
      layers: [hybridLayer, dailyLayer],
    },
  }
}

function layerHasExactHybridNativeLayout(layer) {
  if (!layer || layer.name !== HYBRID_NATIVE_LAYER_NAME || layer.os !== 0 || layer.layout?.joystick?.type !== 'RADIAL') return false
  const base = layer.layout.base
  const encoders = layer.layout.encoders?.[0]
  const sectors = layer.layout.joystick.sectors
  return exactKeycodeRows(base, [
    ['KV_OAI_AG00', 'KV_OAI_AG01'],
    ['KV_OAI_AG02', 'KV_OAI_AG03', 'KV_OAI_AG04', 'KV_OAI_AG05'],
    ['KA_6', 'KA_7', 'KA_8', 'KA_9'],
    ['KA_10', 'KA_11', 'KA_12'],
  ])
    && exactKeycodeCells(encoders, ['KA_18', 'KA_17', 'KA_19'])
    && JSON.stringify(sectors) === JSON.stringify([
      { k: 'KA_15', a1: 0.1875, a2: 0.3125 }, { k: 'KC_NONE', a1: 0.3125, a2: 0.4375 },
      { k: 'KA_16', a1: 0.4375, a2: 0.5625 }, { k: 'KC_NONE', a1: 0.5625, a2: 0.6875 },
      { k: 'KA_13', a1: 0.6875, a2: 0.8125 }, { k: 'KC_NONE', a1: 0.8125, a2: 0.9375 },
      { k: 'KA_14', a1: 0.9375, a2: 0.0625 }, { k: 'KC_NONE', a1: 0.0625, a2: 0.1875 },
    ])
}

function inspectHybridNativeInputProfile(value) {
  if (!value || value.keyboard !== 'creator_micro_v2' || value.language !== 'us') {
    return { status: 'mismatch', reason: 'expected_us_creator_micro_v2' }
  }
  if (!hasExactKeys(value, ['keyboard', 'language', 'profile', 'actions', 'actionGroups', 'multiactions', 'multiactionGroups', 'smartActions', 'smartActionGroups'])
    || !hasExactKeys(value.profile, ['id', 'name', 'layers'])
    || value.profile.id !== 0
    || value.profile.name !== HYBRID_NATIVE_PROFILE_NAME
    || !Array.isArray(value.profile.layers)
    || value.profile.layers.length !== 2) {
    return { status: 'mismatch', reason: 'expected_exact_hybrid_two_layer_profile' }
  }
  const [hybridLayer, dailyLayer] = value.profile.layers
  if (!hasExactKeys(hybridLayer, ['id', 'name', 'color', 'layout', 'os', 'lights'])
    || hybridLayer.id !== 0
    || hybridLayer.color !== '#4E70FF'
    || !hasExactKeys(hybridLayer.layout, ['base', 'encoders', 'joystick'])
    || !hasExactLights(hybridLayer.lights)
    || !layerHasExactHybridNativeLayout(hybridLayer)) {
    return { status: 'mismatch', reason: 'hybrid_native_layer_missing_or_changed' }
  }
  const exactActionGroups = JSON.stringify(value.actionGroups) === JSON.stringify([{ id: 0, name: 'Ashlr Agent Board', actionIds: shortcutActions.map((_, id) => id) }])
  const exactEmptyGroups = JSON.stringify(value.multiactions) === '[]'
    && JSON.stringify(value.smartActions) === '[]'
    && JSON.stringify(value.multiactionGroups) === JSON.stringify([{ id: 0, name: 'Default', actionIds: [] }])
    && JSON.stringify(value.smartActionGroups) === JSON.stringify([{ id: 0, name: 'Default', actionIds: [] }])
  if (!hasExactKeys(dailyLayer, ['id', 'name', 'color', 'layout', 'os', 'lights'])
    || dailyLayer.id !== 1
    || dailyLayer.color !== '#4E70FF'
    || !hasExactKeys(dailyLayer.layout, ['base', 'encoders', 'joystick'])
    || !hasExactLights(dailyLayer.lights)
    || JSON.stringify(hybridLayer.lights) !== JSON.stringify(dailyLayer.lights)
    || !layerHasExactAshlrDailyLayout(dailyLayer)
    || !hasExactShortcutActions(value.actions)
    || !exactActionGroups
    || !exactEmptyGroups) {
    return { status: 'mismatch', reason: 'ashlr_daily_layer_missing_or_changed' }
  }
  return { status: 'match', reason: 'exact_hybrid_native_profile' }
}

function writeGeneratedHybridNativeProfile(sourcePath, outputPath) {
  const source = readSourceProfile(sourcePath)
  const generated = generateHybridNativeInputProfile(source)
  const output = `${JSON.stringify(generated, null, 2)}\n`
  writeFileSync(outputPath, output, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return {
    outputPath,
    schema: 'work_louder_input_profile_import_unofficial',
    sha256: createHash('sha256').update(output).digest('hex'),
    layers: 2,
    hybridLayer: 1,
    sharedLayer: 2,
    nativeAgentKeys: 6,
    shortcutGestures: 14,
    physicalGestures: 20,
    mutatesInputOrDevice: false,
  }
}

function inspectDualPlaneInputProfile(value) {
  if (!value || value.keyboard !== 'creator_micro_v2' || value.language !== 'us') {
    return { status: 'mismatch', reason: 'expected_us_creator_micro_v2' }
  }
  if (!hasExactKeys(value, ['keyboard', 'language', 'profile', 'actions', 'actionGroups', 'multiactions', 'multiactionGroups', 'smartActions', 'smartActionGroups'])
    || !hasExactKeys(value.profile, ['id', 'name', 'layers'])
    || value.profile.id !== 0
    || value.profile?.name !== DUAL_PLANE_PROFILE_NAME
    || !Array.isArray(value.profile.layers)
    || value.profile.layers.length !== 2) {
    return { status: 'mismatch', reason: 'expected_exact_two_layer_profile' }
  }
  const [nativeLayer, dailyLayer] = value.profile.layers
  if (!hasExactKeys(nativeLayer, ['id', 'name', 'color', 'layout', 'os', 'lights'])
    || nativeLayer.id !== 0
    || nativeLayer.name !== CODEX_NATIVE_RECOVERY_LAYER_NAME
    || !hasExactKeys(nativeLayer.layout, ['base', 'encoders', 'joystick'])
    || !hasExactLights(nativeLayer.lights)
    || !layerHasExactCodexNativeLayout(nativeLayer)) {
    return { status: 'mismatch', reason: 'native_layer_must_be_first' }
  }
  const exactActionGroups = JSON.stringify(value.actionGroups) === JSON.stringify([{ id: 0, name: 'Ashlr Agent Board', actionIds: shortcutActions.map((_, id) => id) }])
  const exactEmptyGroups = JSON.stringify(value.multiactions) === '[]'
    && JSON.stringify(value.smartActions) === '[]'
    && JSON.stringify(value.multiactionGroups) === JSON.stringify([{ id: 0, name: 'Default', actionIds: [] }])
    && JSON.stringify(value.smartActionGroups) === JSON.stringify([{ id: 0, name: 'Default', actionIds: [] }])
  if (!hasExactKeys(dailyLayer, ['id', 'name', 'color', 'layout', 'os', 'lights'])
    || dailyLayer.id !== 1
    || !hasExactKeys(dailyLayer.layout, ['base', 'encoders', 'joystick'])
    || !hasExactLights(dailyLayer.lights)
    || JSON.stringify(nativeLayer.lights) !== JSON.stringify(dailyLayer.lights)
    || !layerHasExactAshlrDailyLayout(dailyLayer)
    || !hasExactShortcutActions(value.actions)
    || !exactActionGroups
    || !exactEmptyGroups) {
    return { status: 'mismatch', reason: 'ashlr_daily_layer_missing_or_changed' }
  }
  return { status: 'match', reason: 'exact_dual_plane_profile' }
}

function writeGeneratedDualPlaneProfile(sourcePath, outputPath) {
  const source = readSourceProfile(sourcePath)
  const generated = generateDualPlaneInputProfile(source)
  const output = `${JSON.stringify(generated, null, 2)}\n`
  writeFileSync(outputPath, output, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return {
    outputPath,
    schema: 'work_louder_input_profile_import_unofficial',
    sha256: createHash('sha256').update(output).digest('hex'),
    layers: 2,
    nativeLayer: 1,
    sharedLayer: 2,
    physicalGestures: 20,
    mutatesInputOrDevice: false,
  }
}

function readSourceProfileArtifact(sourcePath) {
  let descriptor
  try {
    descriptor = openSync(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.size < 2 || stats.size > MAX_SOURCE_BYTES) throw new Error('Profile export must be a JSON file no larger than 512 KiB')
    const bytes = readFileSync(descriptor)
    return {
      value: JSON.parse(bytes.toString('utf8')),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function readSourceProfile(sourcePath) {
  return readSourceProfileArtifact(sourcePath).value
}

function writeGeneratedProfile(sourcePath, outputPath, variant = 'daily') {
  const source = readSourceProfileArtifact(sourcePath)
  const output = `${JSON.stringify(generateInputProfile(source.value, variant), null, 2)}\n`
  // A generated repair is always a new private artifact. It never modifies the
  // source export, Input's cache, or the device.
  writeFileSync(outputPath, output, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return {
    outputPath,
    variant,
    sourceSha256: source.sha256,
    sha256: createHash('sha256').update(output).digest('hex'),
    actions: shortcutActions.length,
    physicalGestures: 20,
    emittedSignals: 20,
  }
}

module.exports = {
  CODEX_NATIVE_ENCODER,
  CODEX_NATIVE_KEYMAP,
  CODEX_NATIVE_RECOVERY_LAYER_NAME,
  DUAL_PLANE_PROFILE_NAME,
  HYBRID_NATIVE_LAYER_NAME,
  HYBRID_NATIVE_PROFILE_NAME,
  DEFAULT_LIGHTS,
  MAX_SOURCE_BYTES,
  generateCodexNativeRecoveryLayer,
  generateDualPlaneInputProfile,
  generateHybridNativeInputProfile,
  generateInputProfile,
  inspectDualPlaneInputProfile,
  inspectHybridNativeInputProfile,
  inspectGeneratedInputProfile,
  inspectCodexNativeRecovery,
  layerHasExactAshlrDailyLayout,
  layerHasExactCodexNativeLayout,
  layerHasExactHybridNativeLayout,
  readSourceProfile,
  readSourceProfileArtifact,
  safeLights,
  writeGeneratedCodexNativeRecoveryLayer,
  writeGeneratedDualPlaneProfile,
  writeGeneratedHybridNativeProfile,
  writeGeneratedProfile,
}
