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
      name: variant === 'daily' ? 'Ashlr Agent Board Corrected' : 'Ashlr Flight Check Corrected - diagnostic',
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
    name: variant === 'daily' ? 'Ashlr Daily' : 'Ashlr Diagnostic',
    color: variant === 'daily' ? '#4E70FF' : '#ED9B4A',
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

function readSourceProfile(sourcePath) {
  let descriptor
  try {
    descriptor = openSync(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.size < 2 || stats.size > MAX_SOURCE_BYTES) throw new Error('Profile export must be a JSON file no larger than 512 KiB')
    return JSON.parse(readFileSync(descriptor, 'utf8'))
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function writeGeneratedProfile(sourcePath, outputPath, variant = 'daily') {
  const source = readSourceProfile(sourcePath)
  const output = `${JSON.stringify(generateInputProfile(source, variant), null, 2)}\n`
  // A generated repair is always a new private artifact. It never modifies the
  // source export, Input's cache, or the device.
  writeFileSync(outputPath, output, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return {
    outputPath,
    variant,
    sha256: createHash('sha256').update(output).digest('hex'),
    actions: shortcutActions.length,
    physicalGestures: 20,
    emittedSignals: 20,
  }
}

module.exports = {
  DEFAULT_LIGHTS,
  MAX_SOURCE_BYTES,
  generateInputProfile,
  readSourceProfile,
  safeLights,
  writeGeneratedProfile,
}
