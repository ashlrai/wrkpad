#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const asar = require('@electron/asar')

const STATIC_RELATIVE_REQUIRE = /\brequire\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g
const RUNTIME_ENTRIES = [
  'electron/main.cjs',
  'electron/preload.cjs',
  'electron/compact-preload.cjs',
  'electron/input-installation-worker-entry.cjs',
]

function staticRelativeRequires(source) {
  return [...source.matchAll(STATIC_RELATIVE_REQUIRE)].map((match) => match[2])
}

function collectRequireClosure(projectRoot, entries = RUNTIME_ENTRIES) {
  const root = path.resolve(projectRoot)
  const pending = entries.map((entry) => path.resolve(root, entry))
  const visited = new Set()

  while (pending.length > 0) {
    const filename = pending.pop()
    const relative = path.relative(root, filename)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Runtime module escapes the app root: ${relative}`)
    if (visited.has(filename)) continue
    const stat = fs.lstatSync(filename)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Runtime module is not a regular file: ${relative}`)
    visited.add(filename)
    const source = fs.readFileSync(filename, 'utf8')
    for (const request of staticRelativeRequires(source)) {
      const resolved = path.resolve(path.dirname(filename), request)
      pending.push(path.extname(resolved) ? resolved : `${resolved}.cjs`)
    }
  }

  return [...visited].map((filename) => path.relative(root, filename).split(path.sep).join('/')).sort()
}

function missingArchiveModules(requiredModules, archiveEntries) {
  const packaged = new Set(archiveEntries.map((entry) => entry.replace(/^\/+/, '')))
  return requiredModules.filter((entry) => !packaged.has(entry))
}

function verifyPackagedRequires(asarPath, projectRoot = path.resolve(__dirname, '..')) {
  const required = collectRequireClosure(projectRoot)
  const missing = missingArchiveModules(required, asar.listPackage(asarPath))
  if (missing.length > 0) throw new Error(`Packaged runtime require closure is incomplete: ${missing.join(', ')}`)
  return required
}

if (require.main === module) {
  const archive = process.argv[2]
  if (!archive) {
    console.error('Usage: node scripts/verify-packaged-requires.cjs <app.asar>')
    process.exit(2)
  }
  try {
    const required = verifyPackagedRequires(path.resolve(archive))
    console.log(`Verified ${required.length} packaged runtime modules.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Packaged runtime verification failed.')
    process.exit(1)
  }
}

module.exports = { collectRequireClosure, missingArchiveModules, staticRelativeRequires, verifyPackagedRequires }
