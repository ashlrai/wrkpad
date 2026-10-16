import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { collectRequireClosure, missingArchiveModules, staticRelativeRequires } = require('./verify-packaged-requires.cjs')

test('finds the transitive static relative require closure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-board-closure-'))
  fs.mkdirSync(path.join(root, 'electron'))
  fs.writeFileSync(path.join(root, 'electron', 'main.cjs'), "require('./first.cjs')\nrequire('electron')\n")
  fs.writeFileSync(path.join(root, 'electron', 'preload.cjs'), '')
  fs.writeFileSync(path.join(root, 'electron', 'input-installation-worker-entry.cjs'), '')
  fs.writeFileSync(path.join(root, 'electron', 'first.cjs'), "require('./second.cjs')\n")
  fs.writeFileSync(path.join(root, 'electron', 'second.cjs'), '')

  assert.deepEqual(collectRequireClosure(root), [
    'electron/first.cjs',
    'electron/input-installation-worker-entry.cjs',
    'electron/main.cjs',
    'electron/preload.cjs',
    'electron/second.cjs',
  ])
  fs.rmSync(root, { recursive: true })
})

test('reports a required module omitted from the archive', () => {
  assert.deepEqual(missingArchiveModules(['electron/main.cjs', 'electron/helper.cjs'], ['/electron/main.cjs']), ['electron/helper.cjs'])
})

test('ignores package imports and finds only literal relative requires', () => {
  assert.deepEqual(staticRelativeRequires("require('node:fs'); require('./ok.cjs'); require(name)"), ['./ok.cjs'])
})
