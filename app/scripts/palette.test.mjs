import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const layoutPath = fileURLToPath(new URL('../../layouts/creator-micro-2.json', import.meta.url))
const rustPath = fileURLToPath(new URL('../../src/lighting.rs', import.meta.url))
const cssPath = fileURLToPath(new URL('../src/App.css', import.meta.url))

const expected = {
  error: '#FF1744',
  needs_input: '#FFAB00',
  working: '#2979FF',
  unread: '#00E676',
  idle: '#7C4DFF',
  off: '#000000',
}

test('black-opaque layout defaults every visible switch away from frosted caps', () => {
  const layout = JSON.parse(readFileSync(layoutPath, 'utf8'))
  assert.equal(layout.appearance.profile, 'black-opaque')
  assert.equal(layout.controls.some((control) => control.cap === 'frosted_hero'), false)
  assert.deepEqual(layout.appearance.optional_cap_variants, ['frosted_hero'])
})

test('layout uses the exact native private keycode families for agent and action switches', () => {
  const layout = JSON.parse(readFileSync(layoutPath, 'utf8'))
  const switches = layout.controls.filter((item) => item.kind === 'switch')
  assert.equal(switches.length, 13)
  assert.deepEqual(
    switches.map((control) => control.id),
    ['AG00', 'AG01', 'AG02', 'AG03', 'AG04', 'AG05', 'ACT06', 'ACT07', 'ACT08', 'ACT09', 'ACT10', 'ACT11', 'ACT12'],
  )
  for (const control of layout.controls.filter((item) => /^AG0[0-5]$/.test(item.id))) {
    assert.equal(control.private_keycode, `KV_OAI_${control.id}`)
  }
  for (const control of layout.controls.filter((item) => /^ACT(?:0[6-9]|1[0-2])$/.test(item.id))) {
    assert.equal(control.private_keycode, `KV_OAI_${control.id}`)
  }
})

test('layout, renderer, and Rust use one black-opaque semantic palette', () => {
  const layout = JSON.parse(readFileSync(layoutPath, 'utf8'))
  const rust = readFileSync(rustPath, 'utf8')
  const cssSource = readFileSync(cssPath, 'utf8')
  const css = cssSource.toUpperCase()
  for (const [state, hex] of Object.entries(expected)) {
    assert.equal(layout.appearance.states[state].rgb, hex)
    assert.equal(css.includes(hex), true, `renderer missing ${state} ${hex}`)
  }
  for (const tuple of ['0xFF, 0x17, 0x44', '0xFF, 0xAB, 0x00', '0x29, 0x79, 0xFF', '0x00, 0xE6, 0x76', '0x7C, 0x4D, 0xFF']) {
    assert.equal(rust.includes(tuple), true, `Rust palette missing ${tuple}`)
  }
  const selectorVariables = {
    error: '--state-error', needs_input: '--state-needs-input', working: '--state-working',
    unread: '--state-unread', idle: '--state-idle', off: '--state-off',
  }
  for (const [state, variable] of Object.entries(selectorVariables)) {
    const escapedState = state.replace('_', '\\_')
    assert.match(
      cssSource,
      new RegExp(`\\.board-key\\.agent\\.state-${escapedState} \\.key-light\\{[^}]*background:var\\(${variable}\\)`),
      `key light for ${state} must use ${variable}`,
    )
  }
})
