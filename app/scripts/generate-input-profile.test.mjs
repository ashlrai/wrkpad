import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { generateInputProfile, writeGeneratedProfile } from './generate-input-profile.mjs'

const source = () => ({
  keyboard: 'creator_micro_v2',
  language: 'us',
  profile: { id: 9, name: 'Source', layers: [{ id: 4, name: 'Layer', color: '#000000', layout: { base: [[]], encoders: [[]], joystick: {} } }] },
})

test('generates the safe daily profile with Work Louder encoder ordering', () => {
  const profile = generateInputProfile(source(), 'daily')
  assert.equal(profile.profile.name, 'Ashlr Agent Board')
  assert.equal(profile.profile.layers[0].name, 'Ashlr Daily')
  assert.deepEqual(profile.profile.layers[0].layout.encoders, [[{ keycode: 'KA_18' }, { keycode: 'KA_17' }, { keycode: 'KA_19' }]])
  assert.equal(profile.actions[17].name, 'Ashlr dialLeft')
  assert.equal(profile.actions[18].name, 'Ashlr dialRight')
  assert.equal(profile.profile.layers[0].layout.base[3][1].keycode, 'KC_NONE')
})

test('diagnostic profile exposes the second Mic switch without changing encoder order', () => {
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
  input.profile.fpLayer = { layout: { base: [[{ keycode: 'KC_PWR' }]] } }
  input.profile.layers[0].linkedAppId = 99
  input.multiactions = [{ id: 7, name: 'unexpected' }]
  input.smartActions = [{ id: 8, name: 'unexpected' }]
  const generated = generateInputProfile(input)
  assert.equal('fpLayer' in generated.profile, false)
  assert.equal('linkedAppId' in generated.profile.layers[0], false)
  assert.deepEqual(generated.multiactions, [])
  assert.deepEqual(generated.smartActions, [])

  const directory = mkdtempSync(join(tmpdir(), 'ashlr-profile-'))
  const sourcePath = join(directory, 'source.json')
  const outputPath = join(directory, 'output.json')
  try {
    writeFileSync(sourcePath, JSON.stringify(input))
    writeGeneratedProfile(sourcePath, outputPath)
    assert.equal(statSync(outputPath).mode & 0o777, 0o600)
    assert.equal(JSON.parse(readFileSync(outputPath, 'utf8')).profile.name, 'Ashlr Agent Board')
    assert.throws(() => writeGeneratedProfile(sourcePath, outputPath), /EEXIST/)
  } finally {
    rmSync(directory, { recursive: true })
  }
})
