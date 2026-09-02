#!/usr/bin/env node
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const generator = require('../electron/input-profile-generator.cjs')

export const { generateInputProfile, writeGeneratedProfile } = generator

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sourcePath, outputPath, variant = 'daily'] = process.argv.slice(2)
  if (!sourcePath || !outputPath) throw new Error('Usage: npm run profile:generate -- SOURCE.json OUTPUT.json [daily|diagnostic]')
  console.log(JSON.stringify(writeGeneratedProfile(sourcePath, outputPath, variant), null, 2))
}
