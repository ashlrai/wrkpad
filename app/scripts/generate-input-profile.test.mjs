import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { generateInputProfile, writeGeneratedProfile } from './generate-input-profile.mjs'
import {
  generateCodexNativeRecoveryLayer,
  inspectCodexNativeRecovery,
  writeGeneratedCodexNativeRecoveryLayer,
} from './generate-codex-native-recovery-layer.mjs'
import {
  generateDualPlaneInputProfile,
  inspectDualPlaneInputProfile,
  writeGeneratedDualPlaneProfile,
} from './generate-dual-plane-profile.mjs'
import {
  generateHybridNativeInputProfile,
  inspectHybridNativeInputProfile,
  writeGeneratedHybridNativeProfile,
} from './generate-hybrid-native-profile.mjs'

const source = () => ({
  keyboard: 'creator_micro_v2',
  language: 'us',
  profile: { id: 9, name: 'Source', layers: [{ id: 4, name: 'Layer', color: '#000000', layout: { base: [[]], encoders: [[]], joystick: {} } }] },
})

test('generates the safe daily profile with Work Louder encoder ordering', () => {
  const profile = generateInputProfile(source(), 'daily')
  assert.equal(profile.profile.name, 'Ashlr Agent Board Corrected')
  assert.equal(profile.profile.layers[0].name, 'Ashlr Daily')
  assert.deepEqual(profile.profile.layers[0].layout.encoders, [[{ keycode: 'KA_18' }, { keycode: 'KA_17' }, { keycode: 'KA_19' }]])
  assert.equal(profile.actions[17].name, 'Ashlr dialLeft')
  assert.equal(profile.actions[18].name, 'Ashlr dialRight')
  assert.equal(profile.actions[10].name, 'Ashlr cmd5')
  assert.equal(profile.actions[11].name, 'Ashlr cmd6')
  assert.equal(profile.profile.layers[0].layout.base[3][0].keycode, 'KA_10')
  assert.equal(profile.profile.layers[0].layout.base[3][1].keycode, 'KA_11')
})

test('diagnostic profile preserves both bottom keys without changing encoder order', () => {
  const profile = generateInputProfile(source(), 'diagnostic')
  assert.equal(profile.profile.layers[0].layout.base[3][1].keycode, 'KA_11')
  assert.deepEqual(profile.profile.layers[0].layout.encoders.map((row) => row.map((item) => item.keycode)), [['KA_18', 'KA_17', 'KA_19']])
})

test('refuses protected native layers and unsupported exports', () => {
  const protectedSource = source()
  protectedSource.profile.layers[0].layout.base = [[{ keycode: 'KV_OAI_AG00' }]]
  assert.throws(() => generateInputProfile(protectedSource), /protected KV_OAI layer/)
  assert.throws(() => generateInputProfile({ ...source(), keyboard: 'other' }), /US Creator Micro V2/)
})

test('strips non-daily command surfaces and writes a private new artifact only', () => {
  const input = source()
  input.unexpectedRoot = { command: 'do-not-copy' }
  input.profile.fpLayer = { layout: { base: [[{ keycode: 'KC_PWR' }]] } }
  input.profile.unexpectedProfile = true
  input.profile.layers[0].linkedAppId = 99
  input.profile.layers[0].unexpectedLayer = { executable: '/tmp/nope' }
  input.multiactions = [{ id: 7, name: 'unexpected' }]
  input.smartActions = [{ id: 8, name: 'unexpected' }]
  const generated = generateInputProfile(input)
  assert.equal('fpLayer' in generated.profile, false)
  assert.equal('unexpectedRoot' in generated, false)
  assert.equal('unexpectedProfile' in generated.profile, false)
  assert.equal('linkedAppId' in generated.profile.layers[0], false)
  assert.equal('unexpectedLayer' in generated.profile.layers[0], false)
  assert.deepEqual(generated.multiactions, [])
  assert.deepEqual(generated.smartActions, [])

  const directory = mkdtempSync(join(tmpdir(), 'ashlr-profile-'))
  const sourcePath = join(directory, 'source.json')
  const outputPath = join(directory, 'output.json')
  try {
    writeFileSync(sourcePath, JSON.stringify(input))
    writeGeneratedProfile(sourcePath, outputPath)
    assert.equal(statSync(outputPath).mode & 0o777, 0o600)
    assert.equal(JSON.parse(readFileSync(outputPath, 'utf8')).profile.name, 'Ashlr Agent Board Corrected')
    assert.throws(() => writeGeneratedProfile(sourcePath, outputPath), /EEXIST/)
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('bounds the selected source export before parsing or writing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ashlr-profile-bounded-'))
  const sourcePath = join(directory, 'oversized.json')
  const outputPath = join(directory, 'output.json')
  try {
    writeFileSync(sourcePath, 'x'.repeat(512 * 1024 + 1))
    assert.throws(() => writeGeneratedProfile(sourcePath, outputPath), /no larger than 512 KiB/)
    assert.throws(() => readFileSync(outputPath), /ENOENT/)
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('generates and verifies a native-first dual-plane profile', () => {
  const profile = generateDualPlaneInputProfile(source())
  assert.match(profile.profile.name, /UNOFFICIAL/)
  assert.equal(profile.profile.layers.length, 2)
  assert.equal(profile.profile.layers[0].name, 'Codex Native Recovery (UNOFFICIAL)')
  assert.equal(profile.profile.layers[1].name, 'Ashlr Daily')
  assert.equal(profile.profile.layers[0].id, 0)
  assert.equal(profile.profile.layers[1].id, 1)
  assert.equal(profile.profile.layers[0].layout.base[0][0].keycode, 'KV_OAI_AG00')
  assert.equal(profile.profile.layers[1].layout.base[0][0].keycode, 'KA_0')
  assert.deepEqual(inspectDualPlaneInputProfile(profile), { status: 'match', reason: 'exact_dual_plane_profile' })

  const reversed = structuredClone(profile)
  reversed.profile.layers.reverse()
  assert.deepEqual(inspectDualPlaneInputProfile(reversed), { status: 'mismatch', reason: 'native_layer_must_be_first' })

  const changed = structuredClone(profile)
  changed.actions[0].keyInputs[3].keycode = 'KC_9'
  assert.deepEqual(inspectDualPlaneInputProfile(changed), { status: 'mismatch', reason: 'ashlr_daily_layer_missing_or_changed' })
})

test('dual-plane verifier rejects ownership surfaces, renamed layers, and changed IDs', () => {
  const candidate = generateDualPlaneInputProfile(source())
  for (const mutate of [
    (value) => { value.profile.layers[0].name = 'Native' },
    (value) => { value.profile.layers[1].id = 7 },
    (value) => { value.linkedApps = [{ bundle: 'untrusted' }] },
    (value) => { value.smartActions = [{ id: 1 }] },
    (value) => { value.multiactions = [{ id: 1 }] },
    (value) => { value.actions[0].keyInputs = null },
    (value) => { value.actions[0].keyInputs = { keycode: 'KC_1' } },
  ]) {
    const changed = structuredClone(candidate)
    mutate(changed)
    assert.doesNotThrow(() => inspectDualPlaneInputProfile(changed))
    assert.equal(inspectDualPlaneInputProfile(changed).status, 'mismatch')
  }
})

test('dual-plane writer is private, exclusive, bounded, and macOS-only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ashlr-dual-profile-'))
  const sourcePath = join(directory, 'source.json')
  const outputPath = join(directory, 'dual.json')
  try {
    writeFileSync(sourcePath, JSON.stringify(source()))
    const receipt = writeGeneratedDualPlaneProfile(sourcePath, outputPath)
    assert.equal(receipt.layers, 2)
    assert.equal(receipt.nativeLayer, 1)
    assert.equal(receipt.sharedLayer, 2)
    assert.equal(receipt.mutatesInputOrDevice, false)
    assert.equal(statSync(outputPath).mode & 0o777, 0o600)
    assert.equal(inspectDualPlaneInputProfile(JSON.parse(readFileSync(outputPath, 'utf8'))).status, 'match')
    assert.throws(() => writeGeneratedDualPlaneProfile(sourcePath, outputPath), /EEXIST/)

    const unsupported = source()
    unsupported.profile.layers[0].os = 1
    assert.throws(() => generateDualPlaneInputProfile(unsupported), /only a macOS source export/)
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('generates a hybrid-native first layer with one unchanged Ashlr Daily fallback', () => {
  const input = source()
  const daily = generateInputProfile(input, 'daily')
  const profile = generateHybridNativeInputProfile(input)
  const [hybridLayer, dailyLayer] = profile.profile.layers

  assert.match(profile.profile.name, /UNOFFICIAL/)
  assert.equal(hybridLayer.id, 0)
  assert.match(hybridLayer.name, /UNOFFICIAL/)
  assert.deepEqual(hybridLayer.layout.base.map((row) => row.map((cell) => cell.keycode)), [
    ['KV_OAI_AG00', 'KV_OAI_AG01'],
    ['KV_OAI_AG02', 'KV_OAI_AG03', 'KV_OAI_AG04', 'KV_OAI_AG05'],
    ['KA_6', 'KA_7', 'KA_8', 'KA_9'],
    ['KA_10', 'KA_11', 'KA_12'],
  ])
  assert.deepEqual(hybridLayer.layout.encoders, daily.profile.layers[0].layout.encoders)
  assert.deepEqual(hybridLayer.layout.joystick, daily.profile.layers[0].layout.joystick)
  assert.deepEqual(dailyLayer, { ...daily.profile.layers[0], id: 1 })
  assert.deepEqual(profile.actions, daily.actions)
  assert.deepEqual(inspectHybridNativeInputProfile(profile), { status: 'match', reason: 'exact_hybrid_native_profile' })
})

test('hybrid-native verifier rejects changed native, shortcut, motion, and ownership surfaces', () => {
  const candidate = generateHybridNativeInputProfile(source())
  const mutations = [
    (value) => { value.profile.layers[0].layout.base[0][0].keycode = 'KA_0' },
    (value) => { value.profile.layers[0].layout.base[2][0].keycode = 'KV_OAI_ACT06' },
    (value) => { value.profile.layers[0].layout.encoders[0][0].keycode = 'KV_OAI_ENC_CC' },
    (value) => { value.profile.layers[0].layout.joystick = { type: 'VENDOR', sectors: [] } },
    (value) => { value.profile.layers[1].layout.base[0][0].keycode = 'KV_OAI_AG00' },
    (value) => { value.profile.layers[1].color = '#123456' },
    (value) => { value.actions[6].keyInputs[3].keycode = 'KC_Z' },
    (value) => { value.linkedApps = [] },
    (value) => { value.smartActions = [{ id: 1 }] },
    (value) => { value.profile.layers[0].lights.backlight.color = '#123456' },
  ]
  for (const mutate of mutations) {
    const changed = structuredClone(candidate)
    mutate(changed)
    assert.doesNotThrow(() => inspectHybridNativeInputProfile(changed))
    assert.equal(inspectHybridNativeInputProfile(changed).status, 'mismatch')
  }
})

test('hybrid-native writer is private, exclusive, bounded, and macOS-only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ashlr-hybrid-profile-'))
  const sourcePath = join(directory, 'source.json')
  const outputPath = join(directory, 'hybrid.json')
  try {
    writeFileSync(sourcePath, JSON.stringify(source()))
    const receipt = writeGeneratedHybridNativeProfile(sourcePath, outputPath)
    assert.deepEqual({
      layers: receipt.layers,
      hybridLayer: receipt.hybridLayer,
      sharedLayer: receipt.sharedLayer,
      nativeAgentKeys: receipt.nativeAgentKeys,
      shortcutGestures: receipt.shortcutGestures,
      physicalGestures: receipt.physicalGestures,
      mutatesInputOrDevice: receipt.mutatesInputOrDevice,
    }, {
      layers: 2,
      hybridLayer: 1,
      sharedLayer: 2,
      nativeAgentKeys: 6,
      shortcutGestures: 14,
      physicalGestures: 20,
      mutatesInputOrDevice: false,
    })
    assert.equal(statSync(outputPath).mode & 0o777, 0o600)
    assert.equal(inspectHybridNativeInputProfile(JSON.parse(readFileSync(outputPath, 'utf8'))).status, 'match')
    assert.throws(() => writeGeneratedHybridNativeProfile(sourcePath, outputPath), /EEXIST/)

    const unsupported = source()
    unsupported.profile.layers[0].os = 1
    assert.throws(() => generateHybridNativeInputProfile(unsupported), /only a macOS source export/)
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test('generates the exact unofficial macOS Codex Native layer envelope', () => {
  const artifact = generateCodexNativeRecoveryLayer()
  assert.deepEqual(Object.keys(artifact), [
    'keyboard', 'language', 'layer', 'actions', 'multiactions', 'actionGroups', 'multiactionGroups',
  ])
  assert.equal(artifact.keyboard, 'creator_micro_v2')
  assert.equal(artifact.language, 'us')
  assert.equal(artifact.layer.os, 0)
  assert.match(artifact.layer.name, /UNOFFICIAL/)
  assert.deepEqual(
    artifact.layer.layout.base.map((row) => row.map((cell) => cell.keycode)),
    [
      ['KV_OAI_AG00', 'KV_OAI_AG01'],
      ['KV_OAI_AG02', 'KV_OAI_AG03', 'KV_OAI_AG04', 'KV_OAI_AG05'],
      ['KV_OAI_ACT06', 'KV_OAI_ACT07', 'KV_OAI_ACT08', 'KV_OAI_ACT09'],
      ['KV_OAI_ACT10', 'KV_OAI_ACT11', 'KV_OAI_ACT12'],
    ],
  )
  assert.deepEqual(
    artifact.layer.layout.encoders[0].map((cell) => cell.keycode),
    ['KV_OAI_ENC_CC', 'KV_OAI_ENC_CW', 'KV_OAI_ENC_CLK'],
  )
  assert.deepEqual(artifact.layer.layout.joystick, { type: 'VENDOR', sectors: [] })
  const switchKeycodes = artifact.layer.layout.base.flat().map((cell) => cell.keycode)
  assert.equal(switchKeycodes.length, 13)
  assert.equal(new Set(switchKeycodes).size, 13)
  const canonicalLayoutPath = fileURLToPath(new URL('../../layouts/creator-micro-2.json', import.meta.url))
  const canonicalLayout = JSON.parse(readFileSync(canonicalLayoutPath, 'utf8'))
  assert.deepEqual(switchKeycodes, canonicalLayout.controls
    .filter((control) => control.kind === 'switch')
    .map((control) => control.private_keycode))
  assert.deepEqual(inspectCodexNativeRecovery(artifact), {
    status: 'match', reason: 'exact_native_layout', matchingLayers: 1,
  })
})

test('checked-in native recovery layer is generator-identical and rejects stripped exports', () => {
  const artifactPath = fileURLToPath(new URL('../profiles/UNOFFICIAL-creator-micro-2-codex-native-recovery-layer.json', import.meta.url))
  const checkedIn = JSON.parse(readFileSync(artifactPath, 'utf8'))
  assert.deepEqual(checkedIn, generateCodexNativeRecoveryLayer())

  const stripped = structuredClone(checkedIn)
  stripped.layer.layout.base[0][0].keycode = 'KC_A'
  assert.deepEqual(inspectCodexNativeRecovery(stripped), {
    status: 'mismatch', reason: 'native_layout_missing_or_changed', matchingLayers: 0,
  })
  assert.equal(inspectCodexNativeRecovery({ ...checkedIn, keyboard: 'other' }).reason, 'expected_us_creator_micro_v2')

  const postImportExport = {
    keyboard: 'creator_micro_v2',
    language: 'us',
    profile: { id: 3, name: 'Recovery candidate', layers: [checkedIn.layer] },
  }
  assert.equal(inspectCodexNativeRecovery(postImportExport).status, 'match')
  postImportExport.profile.layers.push(structuredClone(checkedIn.layer))
  assert.deepEqual(inspectCodexNativeRecovery(postImportExport), {
    status: 'mismatch', reason: 'native_layout_ambiguous', matchingLayers: 2,
  })
})

test('writes an offline native layer as a private new file only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-native-layer-'))
  const outputPath = join(directory, 'native-layer.json')
  try {
    const result = writeGeneratedCodexNativeRecoveryLayer(outputPath)
    assert.equal(result.schema, 'work_louder_input_layer_import_unofficial')
    assert.equal(result.mutatesInputOrDevice, false)
    assert.equal(statSync(outputPath).mode & 0o777, 0o600)
    assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), generateCodexNativeRecoveryLayer())
    assert.throws(() => writeGeneratedCodexNativeRecoveryLayer(outputPath), /EEXIST/)
  } finally {
    rmSync(directory, { recursive: true })
  }
})
