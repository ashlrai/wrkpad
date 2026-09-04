const test = require('node:test')
const assert = require('node:assert/strict')
const { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const {
  COMPACT_SETTINGS_SCHEMA,
  MAX_COMPACT_SETTINGS_BYTES,
  clampCompactBounds,
  defaultCompactDeckSettings,
  readCompactDeckBounds,
  readCompactDeckSettings,
  validateChord,
  validateCompactDeckSettings,
  validateTarget,
  writeCompactDeckSettings,
} = require('./compact-deck-settings.cjs')

const workArea = { x: 0, y: 24, width: 1440, height: 876 }

test('ships privacy-first, hardware-optional numpad defaults', () => {
  const settings = defaultCompactDeckSettings(workArea)
  assert.equal(settings.schema, COMPACT_SETTINGS_SCHEMA)
  assert.equal(settings.openAtLaunch, false)
  assert.equal(settings.alwaysOnTop, true)
  assert.equal(settings.showTitles, false)
  assert.equal(settings.shortcuts.length, 12)
  assert.deepEqual(new Set(settings.shortcuts.map((binding) => binding.scope)), new Set(['window']))
  assert.deepEqual(settings.shortcuts.slice(0, 6).map((binding) => binding.chord.code), [
    'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6',
  ])
  assert.deepEqual(settings.shortcuts.slice(0, 6).map((binding) => binding.target.slot), [1, 2, 3, 4, 5, 6])
  assert.equal(settings.shortcuts.find((binding) => binding.chord.code === 'NumpadEnter').target.kind, 'attention')
  assert.equal(settings.shortcuts.find((binding) => binding.chord.code === 'NumpadDecimal').target.kind, 'privacy')
  assert.deepEqual(settings.shortcuts.filter((binding) => binding.target.kind === 'skill').map((binding) => binding.target.actionId), [
    'copy_amplify_skill', 'copy_verify_skill', 'copy_polish_skill', 'copy_advance_skill',
  ])
})

test('clamps restored bounds completely inside the selected display work area', () => {
  assert.deepEqual(
    clampCompactBounds({ x: -900, y: 10_000, width: 2_000, height: 100 }, workArea),
    { x: 0, y: 660, width: 1440, height: 240 },
  )
  const tinyDisplay = { x: -800, y: 0, width: 300, height: 200 }
  assert.deepEqual(
    clampCompactBounds({ x: 900, y: -900, width: 10, height: 10 }, tinyDisplay),
    { x: -800, y: 0, width: 300, height: 200 },
  )
})

test('accepts numpad and function keys but requires modifiers for letter and number-row keys', () => {
  assert.equal(validateChord({ code: 'Numpad4', ctrl: false, alt: false, shift: false, meta: false }).code, 'Numpad4')
  assert.equal(validateChord({ code: 'F9', ctrl: false, alt: false, shift: false, meta: false }).code, 'F9')
  assert.equal(validateChord({ code: 'KeyA', ctrl: false, alt: true, shift: false, meta: false }).code, 'KeyA')
  assert.throws(() => validateChord({ code: 'KeyA', ctrl: false, alt: false, shift: false, meta: false }), /Unknown or unsafe/)
  assert.throws(() => validateChord({ code: 'Digit1', ctrl: false, alt: false, shift: false, meta: false }), /Unknown or unsafe/)
})

test('rejects reserved, unknown, malformed, and command-shaped shortcuts', () => {
  for (const code of ['Escape', 'Tab', 'Enter', 'Space', 'ArrowUp', 'Backspace', 'Delete']) {
    assert.throws(
      () => validateChord({ code, ctrl: false, alt: false, shift: false, meta: false }),
      /reserved for navigation or editing/,
      code,
    )
  }
  assert.throws(
    () => validateChord({ code: 'MediaPlayPause', ctrl: false, alt: false, shift: false, meta: false }),
    /Unknown or unsafe/,
  )
  assert.throws(
    () => validateChord({ code: 'Numpad1', ctrl: false, alt: false, shift: false, meta: false, command: 'codex' }),
    /only code and boolean modifier fields/,
  )
  assert.throws(() => validateTarget({ kind: 'command', command: 'claude --dangerously-skip-permissions' }), /Unknown shortcut target/)
  assert.throws(() => validateTarget({ kind: 'skill', actionId: 'start_codex' }), /allowlisted Compact Deck action/)
})

test('rejects duplicate chords and unknown settings fields', () => {
  const candidate = defaultCompactDeckSettings(workArea)
  candidate.shortcuts[1] = { ...candidate.shortcuts[1], chord: { ...candidate.shortcuts[0].chord } }
  assert.throws(() => validateCompactDeckSettings(candidate, workArea), /Duplicate Compact Deck shortcut/)

  const withCommand = { ...defaultCompactDeckSettings(workArea), command: 'rm -rf' }
  assert.throws(() => validateCompactDeckSettings(withCommand, workArea), /missing or unknown fields/)

  const globalBinding = defaultCompactDeckSettings(workArea)
  globalBinding.shortcuts[0] = { ...globalBinding.shortcuts[0], scope: 'global' }
  assert.throws(() => validateCompactDeckSettings(globalBinding, workArea), /must remain window-scoped/)

  const missingScope = defaultCompactDeckSettings(workArea)
  delete missingScope.shortcuts[0].scope
  assert.throws(() => validateCompactDeckSettings(missingScope, workArea), /window scope, chord, and target/)
})

test('writes validated settings atomically with private permissions and reads them back', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'compact-deck-settings-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const filePath = path.join(root, 'compact-deck.json')
  const candidate = defaultCompactDeckSettings(workArea)
  candidate.openAtLaunch = true
  candidate.showTitles = true
  candidate.bounds = { x: 9_000, y: -4_000, width: 500, height: 300 }

  const written = writeCompactDeckSettings(filePath, candidate, workArea)
  assert.deepEqual(written.bounds, { x: 940, y: 24, width: 500, height: 300 })
  assert.equal(statSync(filePath).mode & 0o777, 0o600)
  assert.deepEqual(JSON.parse(readFileSync(filePath, 'utf8')), written)
  assert.deepEqual(readCompactDeckBounds(filePath), written.bounds)
  assert.deepEqual(readCompactDeckSettings(filePath, workArea), written)

  chmodSync(filePath, 0o644)
  assert.deepEqual(readCompactDeckSettings(filePath, workArea), defaultCompactDeckSettings(workArea))
  writeCompactDeckSettings(filePath, candidate, workArea)
  assert.equal(statSync(filePath).mode & 0o777, 0o600)
})

test('reads only bounded private geometry for display selection', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'compact-deck-bounds-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const filePath = path.join(root, 'compact-deck.json')
  const candidate = defaultCompactDeckSettings(workArea)
  candidate.bounds = { x: -620, y: 30, width: 390, height: 286 }
  writeFileSync(filePath, JSON.stringify(candidate), { mode: 0o600 })
  assert.deepEqual(readCompactDeckBounds(filePath), candidate.bounds)

  candidate.bounds.x = Number.MAX_SAFE_INTEGER
  writeFileSync(filePath, JSON.stringify(candidate), { mode: 0o600 })
  assert.equal(readCompactDeckBounds(filePath), null)
  chmodSync(filePath, 0o644)
  assert.equal(readCompactDeckBounds(filePath), null)
})

test('falls back without parsing oversized, malformed, or symlinked settings', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'compact-deck-settings-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const filePath = path.join(root, 'compact-deck.json')
  const fallback = defaultCompactDeckSettings(workArea)

  writeFileSync(filePath, '{invalid', 'utf8')
  assert.deepEqual(readCompactDeckSettings(filePath, workArea), fallback)
  writeFileSync(filePath, 'x'.repeat(MAX_COMPACT_SETTINGS_BYTES + 1), 'utf8')
  assert.deepEqual(readCompactDeckSettings(filePath, workArea), fallback)
  rmSync(filePath)
  const target = path.join(root, 'target.json')
  writeFileSync(target, JSON.stringify(fallback), 'utf8')
  symlinkSync(target, filePath)
  assert.deepEqual(readCompactDeckSettings(filePath, workArea), fallback)
  assert.throws(() => writeCompactDeckSettings(filePath, fallback, workArea), /regular non-symbolic file/)
})
