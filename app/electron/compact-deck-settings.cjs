const {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { COMPACT_ACTION_IDS } = require('./compact-action-policy.cjs')

const COMPACT_SETTINGS_SCHEMA = 'ai.ashlr.agent-board.compact-deck/v1'
const MAX_COMPACT_SETTINGS_BYTES = 32 * 1024
const MAX_SHORTCUTS = 24
const MIN_WIDTH = 340
const MIN_HEIGHT = 240
const DEFAULT_WIDTH = 390
const DEFAULT_HEIGHT = 286
const MAX_RAW_BOUND_MAGNITUDE = 1_000_000

const RESERVED_CODES = new Set([
  'Backspace',
  'Delete',
  'Enter',
  'Escape',
  'Space',
  'Tab',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
])
const NUMPAD_CODES = new Set([
  ...Array.from({ length: 10 }, (_, index) => `Numpad${index}`),
  'NumpadAdd',
  'NumpadDecimal',
  'NumpadDivide',
  'NumpadEnter',
  'NumpadMultiply',
  'NumpadSubtract',
])
const FUNCTION_CODES = new Set(Array.from({ length: 12 }, (_, index) => `F${index + 1}`))
const MODIFIED_CODES = new Set([
  ...Array.from({ length: 26 }, (_, index) => `Key${String.fromCharCode(65 + index)}`),
  ...Array.from({ length: 10 }, (_, index) => `Digit${index}`),
])
const ROOT_KEYS = ['alwaysOnTop', 'bounds', 'openAtLaunch', 'schema', 'shortcuts', 'showTitles']
const CHORD_KEYS = ['alt', 'code', 'ctrl', 'meta', 'shift']
const SLOT_TARGET_KEYS = ['kind', 'slot']
const SKILL_TARGET_KEYS = ['actionId', 'kind']
const SIMPLE_TARGET_KEYS = ['kind']

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value, expected) {
  return isPlainObject(value)
    && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0')
}

function finiteInteger(value) {
  return Number.isSafeInteger(value) && Number.isFinite(value)
}

function normalizeWorkArea(workArea) {
  if (!hasExactKeys(workArea, ['height', 'width', 'x', 'y'])) {
    throw new TypeError('Compact Deck work area must contain only x, y, width, and height')
  }
  if (![workArea.x, workArea.y, workArea.width, workArea.height].every(finiteInteger)
    || workArea.width <= 0 || workArea.height <= 0) {
    throw new TypeError('Compact Deck work area must use finite integer geometry')
  }
  return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height }
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum)
}

function clampCompactBounds(bounds, rawWorkArea) {
  const workArea = normalizeWorkArea(rawWorkArea)
  if (!hasExactKeys(bounds, ['height', 'width', 'x', 'y'])
    || ![bounds.x, bounds.y, bounds.width, bounds.height].every(finiteInteger)) {
    throw new TypeError('Compact Deck bounds must contain finite integer x, y, width, and height')
  }

  const minimumWidth = Math.min(MIN_WIDTH, workArea.width)
  const minimumHeight = Math.min(MIN_HEIGHT, workArea.height)
  const width = clamp(bounds.width, minimumWidth, workArea.width)
  const height = clamp(bounds.height, minimumHeight, workArea.height)
  const x = clamp(bounds.x, workArea.x, workArea.x + workArea.width - width)
  const y = clamp(bounds.y, workArea.y, workArea.y + workArea.height - height)
  return { x, y, width, height }
}

function defaultBounds(rawWorkArea) {
  const workArea = normalizeWorkArea(rawWorkArea)
  const width = Math.min(DEFAULT_WIDTH, workArea.width)
  const height = Math.min(DEFAULT_HEIGHT, workArea.height)
  return {
    x: Math.max(workArea.x, workArea.x + workArea.width - width - 24),
    y: Math.min(workArea.y + 24, workArea.y + workArea.height - height),
    width,
    height,
  }
}

function chord(code, modifiers = {}) {
  return {
    code,
    ctrl: modifiers.ctrl === true,
    alt: modifiers.alt === true,
    shift: modifiers.shift === true,
    meta: modifiers.meta === true,
  }
}

function defaultShortcuts() {
  return [
    ...Array.from({ length: 6 }, (_, index) => ({ scope: 'window', chord: chord(`Numpad${index + 1}`), target: { kind: 'slot', slot: index + 1 } })),
    { scope: 'window', chord: chord('Numpad7'), target: { kind: 'skill', actionId: 'copy_amplify_skill' } },
    { scope: 'window', chord: chord('Numpad8'), target: { kind: 'skill', actionId: 'copy_verify_skill' } },
    { scope: 'window', chord: chord('Numpad9'), target: { kind: 'skill', actionId: 'copy_polish_skill' } },
    { scope: 'window', chord: chord('Numpad0'), target: { kind: 'skill', actionId: 'copy_advance_skill' } },
    { scope: 'window', chord: chord('NumpadEnter'), target: { kind: 'attention' } },
    { scope: 'window', chord: chord('NumpadDecimal'), target: { kind: 'privacy' } },
  ]
}

function defaultCompactDeckSettings(workArea) {
  return {
    schema: COMPACT_SETTINGS_SCHEMA,
    openAtLaunch: false,
    alwaysOnTop: true,
    showTitles: false,
    bounds: defaultBounds(workArea),
    shortcuts: defaultShortcuts(),
  }
}

function validateChord(candidate) {
  if (!hasExactKeys(candidate, CHORD_KEYS)) {
    throw new TypeError('Shortcut chord must contain only code and boolean modifier fields')
  }
  if (typeof candidate.code !== 'string' || candidate.code.length > 32) {
    throw new TypeError('Shortcut code must be a bounded string')
  }
  for (const key of ['ctrl', 'alt', 'shift', 'meta']) {
    if (typeof candidate[key] !== 'boolean') throw new TypeError('Shortcut modifiers must be boolean')
  }
  if (RESERVED_CODES.has(candidate.code)) {
    throw new TypeError(`Shortcut code ${candidate.code} is reserved for navigation or editing`)
  }
  const hasModifier = candidate.ctrl || candidate.alt || candidate.shift || candidate.meta
  const allowed = NUMPAD_CODES.has(candidate.code)
    || FUNCTION_CODES.has(candidate.code)
    || (MODIFIED_CODES.has(candidate.code) && hasModifier)
  if (!allowed) throw new TypeError(`Unknown or unsafe shortcut code: ${candidate.code}`)
  return chord(candidate.code, candidate)
}

function validateTarget(candidate) {
  if (!isPlainObject(candidate) || typeof candidate.kind !== 'string') {
    throw new TypeError('Shortcut target must be a structured object')
  }
  if (candidate.kind === 'slot') {
    if (!hasExactKeys(candidate, SLOT_TARGET_KEYS) || !Number.isInteger(candidate.slot) || candidate.slot < 1 || candidate.slot > 6) {
      throw new TypeError('Slot shortcut target must name one slot from 1 through 6')
    }
    return { kind: 'slot', slot: candidate.slot }
  }
  if (candidate.kind === 'skill') {
    if (!hasExactKeys(candidate, SKILL_TARGET_KEYS) || !COMPACT_ACTION_IDS.includes(candidate.actionId)) {
      throw new TypeError('Skill shortcut target must name an allowlisted Compact Deck action')
    }
    return { kind: 'skill', actionId: candidate.actionId }
  }
  if (candidate.kind === 'attention' || candidate.kind === 'privacy') {
    if (!hasExactKeys(candidate, SIMPLE_TARGET_KEYS)) throw new TypeError('Simple shortcut targets cannot contain extra fields')
    return { kind: candidate.kind }
  }
  throw new TypeError(`Unknown shortcut target kind: ${candidate.kind}`)
}

function chordIdentity(value) {
  return [value.code, value.ctrl, value.alt, value.shift, value.meta].join(':')
}

function validateShortcuts(candidate) {
  if (!Array.isArray(candidate) || candidate.length === 0 || candidate.length > MAX_SHORTCUTS) {
    throw new TypeError(`Compact Deck requires between 1 and ${MAX_SHORTCUTS} shortcuts`)
  }
  const seen = new Set()
  return candidate.map((binding) => {
    if (!hasExactKeys(binding, ['chord', 'scope', 'target'])) {
      throw new TypeError('Shortcut binding must contain only window scope, chord, and target')
    }
    if (binding.scope !== 'window') throw new TypeError('Compact Deck shortcuts must remain window-scoped')
    const validatedChord = validateChord(binding.chord)
    const identity = chordIdentity(validatedChord)
    if (seen.has(identity)) throw new TypeError(`Duplicate Compact Deck shortcut: ${validatedChord.code}`)
    seen.add(identity)
    return { scope: 'window', chord: validatedChord, target: validateTarget(binding.target) }
  })
}

function validateCompactDeckSettings(candidate, workArea) {
  if (!hasExactKeys(candidate, ROOT_KEYS)) {
    throw new TypeError('Compact Deck settings contain missing or unknown fields')
  }
  if (candidate.schema !== COMPACT_SETTINGS_SCHEMA) throw new TypeError('Unsupported Compact Deck settings schema')
  for (const key of ['openAtLaunch', 'alwaysOnTop', 'showTitles']) {
    if (typeof candidate[key] !== 'boolean') throw new TypeError(`Compact Deck setting ${key} must be boolean`)
  }
  const result = {
    schema: COMPACT_SETTINGS_SCHEMA,
    openAtLaunch: candidate.openAtLaunch,
    alwaysOnTop: candidate.alwaysOnTop,
    showTitles: candidate.showTitles,
    bounds: clampCompactBounds(candidate.bounds, workArea),
    shortcuts: validateShortcuts(candidate.shortcuts),
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_COMPACT_SETTINGS_BYTES) {
    throw new TypeError('Compact Deck settings exceed the supported size')
  }
  return result
}

function safeSettingsPath(filePath) {
  return typeof filePath === 'string'
    && path.isAbsolute(filePath)
    && filePath.length <= 4096
    && !filePath.includes('\0')
}

function assertSafeDestination(filePath) {
  if (!safeSettingsPath(filePath)) throw new TypeError('Compact Deck settings path must be an absolute local path')
  const parent = path.dirname(filePath)
  const parentStatus = lstatSync(parent)
  if (!parentStatus.isDirectory() || parentStatus.isSymbolicLink()) {
    throw new Error('Compact Deck settings parent must be a real directory')
  }
  if (existsSync(filePath)) {
    const destinationStatus = lstatSync(filePath)
    if (destinationStatus.isSymbolicLink() || !destinationStatus.isFile()) {
      throw new Error('Compact Deck settings file must be a regular non-symbolic file')
    }
  }
}

function readPrivateSettingsCandidate(filePath) {
  assertSafeDestination(filePath)
  if (!existsSync(filePath)) return null
  const status = statSync(filePath)
  if (!status.isFile() || (status.mode & 0o077) !== 0 || status.size > MAX_COMPACT_SETTINGS_BYTES) return null
  return JSON.parse(readFileSync(filePath, 'utf8'))
}

function readCompactDeckBounds(filePath) {
  try {
    const candidate = readPrivateSettingsCandidate(filePath)
    const bounds = candidate?.bounds
    if (!hasExactKeys(bounds, ['height', 'width', 'x', 'y'])
      || ![bounds.x, bounds.y, bounds.width, bounds.height].every(finiteInteger)
      || [bounds.x, bounds.y, bounds.width, bounds.height].some((value) => Math.abs(value) > MAX_RAW_BOUND_MAGNITUDE)) return null
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  } catch {
    return null
  }
}

function readCompactDeckSettings(filePath, workArea) {
  const fallback = defaultCompactDeckSettings(workArea)
  try {
    const candidate = readPrivateSettingsCandidate(filePath)
    return candidate ? validateCompactDeckSettings(candidate, workArea) : fallback
  } catch {
    return fallback
  }
}

function writeCompactDeckSettings(filePath, candidate, workArea) {
  assertSafeDestination(filePath)
  const settings = validateCompactDeckSettings(candidate, workArea)
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    renameSync(temporaryPath, filePath)
  } catch (error) {
    try { if (existsSync(temporaryPath)) unlinkSync(temporaryPath) } catch {}
    throw error
  }
  return settings
}

module.exports = {
  COMPACT_SETTINGS_SCHEMA,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MAX_COMPACT_SETTINGS_BYTES,
  MAX_SHORTCUTS,
  MIN_HEIGHT,
  MIN_WIDTH,
  RESERVED_CODES,
  chordIdentity,
  clampCompactBounds,
  defaultCompactDeckSettings,
  readCompactDeckSettings,
  readCompactDeckBounds,
  validateChord,
  validateCompactDeckSettings,
  validateShortcuts,
  validateTarget,
  writeCompactDeckSettings,
}
