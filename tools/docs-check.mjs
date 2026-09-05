#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { platform } from 'node:os'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')

function markdownFiles(root) {
  const output = execFileSync(platform() === 'win32' ? 'git.exe' : '/usr/bin/git', [
    'ls-files', '--cached', '--others', '--exclude-standard', '*.md',
  ], { cwd: root, encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024 })
  return output.split('\n').filter(Boolean)
}

export function githubSlug(value) {
  let visible = ''
  let insideTag = false
  for (const character of value) {
    if (character === '<') insideTag = true
    else if (character === '>') insideTag = false
    else if (!insideTag) visible += character
  }
  return visible
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
}

export function markdownAnchors(source) {
  const counts = new Map()
  const anchors = new Set()
  for (const line of source.split('\n')) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    const base = githubSlug(match[2])
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    anchors.add(count === 0 ? base : `${base}-${count}`)
  }
  return anchors
}

export function localLinks(source) {
  const links = []
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g
  for (const match of source.matchAll(pattern)) {
    let target = match[1].trim()
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    target = target.split(/\s+["']/)[0]
    if (!target || /^(?:https?:|mailto:|tel:)/i.test(target)) continue
    links.push(target)
  }
  return links
}

export function validateMarkdown(root, files) {
  const failures = []
  const sourceCache = new Map()
  const read = (path) => {
    if (!sourceCache.has(path)) sourceCache.set(path, readFileSync(path, 'utf8'))
    return sourceCache.get(path)
  }

  for (const relative of files) {
    const documentPath = resolve(root, relative)
    const source = read(documentPath)
    for (const rawTarget of localLinks(source)) {
      const [pathPart, fragment] = rawTarget.split('#', 2)
      const targetPath = pathPart ? resolve(dirname(documentPath), decodeURIComponent(pathPart)) : documentPath
      if (!existsSync(targetPath)) {
        failures.push(`${relative}: missing local target ${rawTarget}`)
        continue
      }
      if (fragment && extname(targetPath).toLowerCase() === '.md') {
        const anchors = markdownAnchors(read(targetPath))
        const decoded = decodeURIComponent(fragment).toLowerCase()
        if (!anchors.has(decoded)) failures.push(`${relative}: missing anchor ${rawTarget}`)
      }
    }
  }
  return failures
}

export function validateCanonicalCommands(root) {
  const failures = []
  const support = readFileSync(resolve(root, 'app', 'SUPPORT.md'), 'utf8')
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
  const agents = readFileSync(resolve(root, 'AGENTS.md'), 'utf8')
  const packageJson = JSON.parse(readFileSync(resolve(root, 'app', 'package.json'), 'utf8'))

  if (!support.includes('npm --prefix app run doctor')) failures.push('app/SUPPORT.md: root doctor command must use --prefix app')
  if (!readme.includes('cargo install --path . --locked --root "$HOME/.local"')) failures.push('README.md: stable user-local install command missing')
  for (const route of ['ashlr_layer', 'codex_native', 'hybrid_native']) {
    if (!readme.includes(`--route ${route}`)) failures.push(`README.md: ${route} preflight example missing`)
  }
  for (const script of ['doctor', 'agent:preflight', 'lint', 'test', 'build']) {
    if (typeof packageJson.scripts?.[script] !== 'string') failures.push(`app/package.json: script ${script} missing`)
  }
  for (const path of ['tools/agent-preflight.mjs', 'tools/docs-check.mjs', 'docs/agent-operations.md']) {
    if (!existsSync(resolve(root, path))) failures.push(`AGENTS.md contract target missing: ${path}`)
  }
  if (!agents.includes('cargo deny check')) failures.push('AGENTS.md: Cargo Deny gate missing')
  return failures
}

export function validateUnsignedDistributionPolicy(root) {
  const directory = resolve(root, '.github', 'workflows')
  if (!existsSync(directory)) return []
  const failures = []
  const publicationPatterns = [
    /actions\/upload-artifact/i,
    /\bgh\s+release\b/i,
    /action-gh-release/i,
    /^\s*(?:contents|packages):\s*write\s*$/im,
  ]
  for (const file of readdirSync(directory).filter((name) => /\.ya?ml$/i.test(name))) {
    const source = readFileSync(resolve(directory, file), 'utf8')
    const expectedUnsigned = /unsigned/i.test(source)
      || /developer_id_signed\s*=\s*false/i.test(source)
      || /notarized\s*=\s*false/i.test(source)
    if (!expectedUnsigned) continue
    for (const pattern of publicationPatterns) {
      if (pattern.test(source)) failures.push(`${file}: expected-unsigned workflow must not publish or upload artifacts`)
    }
  }
  return [...new Set(failures)]
}

export function validatePublicSkillClaims(root) {
  const failures = []
  const sources = [
    ['.agents/skills/ashlr-delivery/SKILL.md', 'skill'],
    ['site/index.html', 'landing'],
    ['site/llms.txt', 'llms'],
  ]
  const loaded = Object.fromEntries(sources.map(([relative, key]) => {
    const filename = resolve(root, relative)
    if (!existsSync(filename)) {
      failures.push(`${relative}: required public skill contract file missing`)
      return [key, '']
    }
    return [key, readFileSync(filename, 'utf8')]
  }))
  const { skill, landing, llms } = loaded

  if (!skill.includes('Invoke as `$ashlr-delivery <mode>`')) failures.push('.agents/skills/ashlr-delivery/SKILL.md: canonical invocation missing')
  for (const mode of ['Amplify', 'Verify', 'Polish', 'Advance']) {
    if (!skill.includes(`**${mode}:**`)) failures.push(`.agents/skills/ashlr-delivery/SKILL.md: ${mode} mode missing`)
  }
  for (const [path, source] of [['site/index.html', landing], ['site/llms.txt', llms]]) {
    if (!source.includes('$ashlr-delivery')) failures.push(`${path}: implemented delivery skill must be named`)
    if (!/(?:automatic|provider) discovery[\s\S]*(?:unverified|runtime verification|runtime acceptance)/i.test(source)) failures.push(`${path}: provider discovery boundary missing`)
    if (/(?:contract is being prepared|contract is proposed|Proposed contract:)/i.test(source)) failures.push(`${path}: implemented delivery skill is described as merely proposed`)
  }
  return failures
}

export function validatePackageClaims(root) {
  const failures = []
  const readRequired = (relative) => {
    const filename = resolve(root, relative)
    if (!existsSync(filename)) {
      failures.push(`${relative}: required package contract file missing`)
      return ''
    }
    return readFileSync(filename, 'utf8')
  }
  let packageJson = {}
  const packageSource = readRequired('app/package.json')
  try { packageJson = packageSource ? JSON.parse(packageSource) : {} } catch { failures.push('app/package.json: invalid JSON') }
  const afterPack = readRequired('app/scripts/after-pack.cjs')
  const packageCommand = packageJson.scripts?.['package:mac'] ?? ''
  if (!packageCommand.includes('WRKPAD_ADHOC_PREVIEW=1') || !afterPack.includes("['--force', '--deep', '--sign', '-', bundle]")) {
    failures.push('app/package.json: local preview must enable the fixed ad-hoc bundle seal')
  }
  if (!packageCommand.includes('CSC_IDENTITY_AUTO_DISCOVERY=false') || !packageCommand.includes('--config.mac.identity=null')) {
    failures.push('app/package.json: local preview must disable signing identity discovery and set identity null')
  }
  const documents = ['README.md', 'app/README.md', 'app/docs/release-readiness.md', 'ORGANIZATIONS.md', 'site/index.html', 'site/capabilities.json']
  for (const relative of documents) {
    const source = readRequired(relative)
    if (!/ad-hoc/i.test(source) || !/Developer ID/i.test(source)) failures.push(`${relative}: ad-hoc seal and Developer ID boundary must both be explicit`)
  }
  return failures
}

function main() {
  const failures = [
    ...validateMarkdown(REPO_ROOT, markdownFiles(REPO_ROOT)),
    ...validateCanonicalCommands(REPO_ROOT),
    ...validateUnsignedDistributionPolicy(REPO_ROOT),
    ...validatePublicSkillClaims(REPO_ROOT),
    ...validatePackageClaims(REPO_ROOT),
  ]
  if (failures.length > 0) {
    for (const failure of failures) console.error(failure)
    process.exitCode = 1
    return
  }
  console.log('Documentation links, anchors, and canonical commands passed.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
