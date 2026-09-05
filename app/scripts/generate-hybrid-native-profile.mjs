#!/usr/bin/env node
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const generator = require('../electron/input-profile-generator.cjs')

export const {
  generateHybridNativeInputProfile,
  inspectHybridNativeInputProfile,
  writeGeneratedHybridNativeProfile,
} = generator

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [commandOrSource, sourceOrOutput, outputPath] = process.argv.slice(2)
  if (commandOrSource === '--verify') {
    if (!sourceOrOutput || outputPath) throw new Error('Usage: npm run profile:check-hybrid -- PROFILE.json')
    const candidate = generator.readSourceProfile(sourceOrOutput)
    const result = inspectHybridNativeInputProfile(candidate)
    console.log(JSON.stringify(result, null, 2))
    if (result.status !== 'match') process.exitCode = 2
  } else {
    if (!commandOrSource || !sourceOrOutput || outputPath) throw new Error('Usage: npm run profile:generate-hybrid -- SOURCE.json OUTPUT.json')
    console.log(JSON.stringify(writeGeneratedHybridNativeProfile(commandOrSource, sourceOrOutput), null, 2))
  }
}
