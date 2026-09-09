#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHA = /^[0-9a-f]{40}$/

export function parseCommitRecords(value) {
  return value
    .split('\x1e')
    .filter((record) => record.trim())
    .map((record) => {
      const [sha, authorName, authorEmail, ...body] = record.replace(/^\n/, '').split('\x00')
      return { sha, authorName, authorEmail, body: body.join('\x00') }
    })
}

export function missingSignoffs(commits) {
  return commits.filter((commit) => {
    const signoffs = [...commit.body.matchAll(/^Signed-off-by:\s*(.+?)\s*<([^<>]+)>\s*$/gmi)]
    return !signoffs.some((match) => (
      match[1].trim().toLowerCase() === commit.authorName.trim().toLowerCase()
      && match[2].trim().toLowerCase() === commit.authorEmail.trim().toLowerCase()
    ))
  })
}

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function main() {
  const base = argument('--base')
  const head = argument('--head')
  if (!SHA.test(base ?? '') || !SHA.test(head ?? '')) {
    console.error('usage: check-dco.mjs --base <40-hex-sha> --head <40-hex-sha>')
    process.exitCode = 2
    return
  }
  const git = platform() === 'win32' ? 'git.exe' : '/usr/bin/git'
  const output = execFileSync(git, [
    'log', '--no-merges', '--format=%H%x00%an%x00%ae%x00%B%x1e', `${base}..${head}`,
  ], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 })
  const commits = parseCommitRecords(output)
  const missing = missingSignoffs(commits)
  if (missing.length > 0) {
    for (const commit of missing) console.error(`${commit.sha}: missing matching Signed-off-by for ${commit.authorName} <${commit.authorEmail}>`)
    process.exitCode = 1
    return
  }
  console.log(`DCO sign-off passed for ${commits.length} commit(s).`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
