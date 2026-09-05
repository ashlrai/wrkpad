#!/usr/bin/env node
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const generator = require('../electron/input-profile-generator.cjs')

export const { generateInputProfile, inspectGeneratedInputProfile, writeGeneratedProfile } = generator

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [commandOrSource, sourceOrOutput, variant = 'daily', unexpected] = process.argv.slice(2)
  if (commandOrSource === '--verify') {
    if (!sourceOrOutput || unexpected || !['daily', 'diagnostic'].includes(variant)) {
      throw new Error('Usage: npm run profile:check -- PROFILE.json [daily|diagnostic]')
    }
    const candidate = generator.readSourceProfile(sourceOrOutput)
    const result = inspectGeneratedInputProfile(candidate, variant)
    console.log(JSON.stringify(result, null, 2))
    if (result.status !== 'match') process.exitCode = 2
  } else {
    if (!commandOrSource || !sourceOrOutput || unexpected) {
      throw new Error('Usage: npm run profile:generate -- SOURCE.json OUTPUT.json [daily|diagnostic]')
    }
    console.log(JSON.stringify(writeGeneratedProfile(commandOrSource, sourceOrOutput, variant), null, 2))
  }
}
