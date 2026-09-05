#!/usr/bin/env node
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const generator = require('../electron/input-profile-generator.cjs')

export const {
  generateCodexNativeRecoveryLayer,
  inspectCodexNativeRecovery,
  writeGeneratedCodexNativeRecoveryLayer,
} = generator

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [commandOrPath, candidatePath] = process.argv.slice(2)
  if (commandOrPath === '--verify') {
    if (!candidatePath) throw new Error('Usage: npm run profile:check-native -- INPUT_EXPORT.json')
    const candidate = generator.readSourceProfile(candidatePath)
    const result = inspectCodexNativeRecovery(candidate)
    console.log(JSON.stringify(result, null, 2))
    if (result.status !== 'match') process.exitCode = 2
  } else {
    if (!commandOrPath || candidatePath) throw new Error('Usage: npm run profile:generate-native -- OUTPUT-layer.json')
    console.log(JSON.stringify(writeGeneratedCodexNativeRecoveryLayer(commandOrPath), null, 2))
  }
}
