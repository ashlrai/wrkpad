const { spawn } = require('node:child_process')
const { existsSync, readFileSync, statSync } = require('node:fs')
const path = require('node:path')

function run(executable, args, cwd, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let settled = false
    const finish = (value) => { if (!settled) { settled = true; resolve(value) } }
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(null) }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); if (stdout.length > 20_000) stdout = stdout.slice(-20_000) })
    child.on('error', () => { clearTimeout(timer); finish(null) })
    child.on('close', (code) => { clearTimeout(timer); finish(code === 0 ? stdout.trim() : null) })
  })
}

function packageFacts(root) {
  let packageName = path.basename(root)
  let testCommand = null
  const manifestPath = path.join(root, 'package.json')
  if (existsSync(manifestPath) && statSync(manifestPath).size < 1_000_000) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (typeof manifest.name === 'string' && manifest.name.trim()) packageName = manifest.name.trim()
      if (manifest.scripts && typeof manifest.scripts.test === 'string') testCommand = manifest.scripts.test
    } catch {}
  }
  let packageManager = null
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) packageManager = 'pnpm'
  else if (existsSync(path.join(root, 'bun.lock')) || existsSync(path.join(root, 'bun.lockb'))) packageManager = 'bun'
  else if (existsSync(path.join(root, 'yarn.lock'))) packageManager = 'yarn'
  else if (existsSync(path.join(root, 'package-lock.json'))) packageManager = 'npm'
  return { packageName, packageManager, testCommand }
}

function parseStatus(output) {
  if (output === null) return { statusKnown: false, dirtyFiles: null, stagedFiles: null, unstagedFiles: null, untrackedFiles: null, conflictedFiles: null }
  const rows = output ? output.split('\n').filter(Boolean) : []
  let staged = 0; let unstaged = 0; let untracked = 0; let conflicted = 0
  for (const row of rows) {
    const x = row[0]; const y = row[1]
    if (x === '?' && y === '?') { untracked++; continue }
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) conflicted++
    if (x && x !== ' ') staged++
    if (y && y !== ' ') unstaged++
  }
  return { statusKnown: true, dirtyFiles: rows.length, stagedFiles: staged, unstagedFiles: unstaged, untrackedFiles: untracked, conflictedFiles: conflicted }
}

async function inspectWorkspace(workspace) {
  const unavailable = { available: false, projectName: path.basename(workspace || '') || 'No workspace', root: workspace || '', isGit: false, branch: null, detached: false, statusKnown: false, dirtyFiles: null, stagedFiles: null, unstagedFiles: null, untrackedFiles: null, conflictedFiles: null, headShort: null, headSubject: null, headDate: null, upstream: null, ahead: null, behind: null, packageManager: null, testCommand: null }
  try {
    if (!workspace || !existsSync(workspace) || !statSync(workspace).isDirectory()) return unavailable
  } catch { return unavailable }
  const root = await run('/usr/bin/git', ['-C', workspace, 'rev-parse', '--show-toplevel'], workspace)
  if (!root) return { ...unavailable, available: true, ...packageFacts(workspace), projectName: packageFacts(workspace).packageName, root: workspace }
  const [branchName, status, head, upstream, divergence] = await Promise.all([
    run('/usr/bin/git', ['-C', root, 'symbolic-ref', '--quiet', '--short', 'HEAD'], root),
    run('/usr/bin/git', ['-C', root, 'status', '--porcelain=v1', '--untracked-files=normal'], root),
    run('/usr/bin/git', ['-C', root, 'log', '-1', '--format=%h%x00%s%x00%aI'], root),
    run('/usr/bin/git', ['-C', root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], root),
    run('/usr/bin/git', ['-C', root, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD'], root),
  ])
  const [headShort = null, headSubject = null, headDate = null] = head ? head.split('\0') : []
  const [behindText, aheadText] = divergence ? divergence.split(/\s+/) : []
  const packages = packageFacts(root)
  return {
    available: true,
    projectName: packages.packageName,
    root,
    isGit: true,
    branch: branchName || headShort,
    detached: !branchName,
    ...parseStatus(status),
    headShort, headSubject, headDate,
    upstream: upstream || null,
    ahead: Number.isFinite(Number(aheadText)) ? Number(aheadText) : null,
    behind: Number.isFinite(Number(behindText)) ? Number(behindText) : null,
    packageManager: packages.packageManager,
    testCommand: packages.testCommand,
  }
}

module.exports = { inspectWorkspace, packageFacts, parseStatus }
