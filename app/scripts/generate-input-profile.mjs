#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const shortcutActions = [
  ['agent1', 'KC_1'], ['agent2', 'KC_2'], ['agent3', 'KC_3'], ['agent4', 'KC_4'], ['agent5', 'KC_5'], ['agent6', 'KC_6'],
  ['cmd1', 'KC_A'], ['cmd2', 'KC_B'], ['cmd3', 'KC_C'], ['cmd4', 'KC_D'], ['wideMic', 'KC_E'], ['cmd6Diagnostic', 'KC_F'], ['cmd7', 'KC_G'],
  ['joyUp', 'KC_UP'], ['joyRight', 'KC_RGHT'], ['joyDown', 'KC_DOWN'], ['joyLeft', 'KC_LEFT'],
  ['dialLeft', 'KC_Q'], ['dialRight', 'KC_W'], ['dialPress', 'KC_R'],
]

export function generateInputProfile(source, variant = 'daily') {
  if (!['daily', 'diagnostic'].includes(variant)) throw new Error('Variant must be daily or diagnostic')
  if (source.keyboard !== 'creator_micro_v2' || source.language !== 'us') throw new Error('Expected a US Creator Micro V2 export')
  if (!source.profile || !Array.isArray(source.profile.layers) || !source.profile.layers[0]?.layout?.base) throw new Error('Profile export is missing its base layout')
  if (source.profile.layers.some((layer) => JSON.stringify(layer).includes('KV_OAI_'))) {
    throw new Error('Refusing to transform a profile that contains a protected KV_OAI layer; export an ordinary profile instead')
  }

  const profile = structuredClone(source)
  profile.profile.id = 0
  profile.profile.name = variant === 'daily' ? 'Ashlr Agent Board' : 'Ashlr Flight Check - diagnostic'
  delete profile.profile.fpLayer
  profile.multiactions = []
  profile.multiactionGroups = [{ id: 0, name: 'Default', actionIds: [] }]
  profile.smartActions = []
  profile.smartActionGroups = [{ id: 0, name: 'Default', actionIds: [] }]
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
  const none = () => ({ keycode: 'KC_NONE' })
  const layer = structuredClone(profile.profile.layers[0])
  layer.id = 0
  delete layer.linkedAppId
  layer.name = variant === 'daily' ? 'Ashlr Daily' : 'Ashlr Diagnostic'
  layer.color = variant === 'daily' ? '#4E70FF' : '#ED9B4A'
  layer.layout.base = [
    [action(0), action(1)],
    [action(2), action(3), action(4), action(5)],
    [action(6), action(7), action(8), action(9)],
    [action(10), variant === 'diagnostic' ? action(11) : none(), action(12)],
  ]
  // Input serializes encoder positions as clockwise, counterclockwise, press.
  // The user-facing action list is left, right, press, so the first two swap.
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

export function writeGeneratedProfile(sourcePath, outputPath, variant = 'daily') {
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
  const output = `${JSON.stringify(generateInputProfile(source, variant), null, 2)}\n`
  writeFileSync(outputPath, output, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return {
    outputPath,
    variant,
    sha256: createHash('sha256').update(output).digest('hex'),
    actions: shortcutActions.length,
    physicalGestures: 19,
    emittedSignals: variant === 'daily' ? 19 : 20,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sourcePath, outputPath, variant = 'daily'] = process.argv.slice(2)
  if (!sourcePath || !outputPath) throw new Error('Usage: npm run profile:generate -- SOURCE.json OUTPUT.json [daily|diagnostic]')
  console.log(JSON.stringify(writeGeneratedProfile(sourcePath, outputPath, variant), null, 2))
}
