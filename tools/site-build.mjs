#!/usr/bin/env node
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'site')
const output = path.join(root, 'dist-site')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
const deployFiles = ['index.html', 'styles.css', 'app.js', 'capabilities.json', 'llms.txt', 'robots.txt', 'favicon.svg']
for (const file of deployFiles) copyFileSync(path.join(source, file), path.join(output, file))
writeFileSync(path.join(output, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://ashlrai.github.io/wrkpad/</loc></url></urlset>\n')
writeFileSync(path.join(output, '.nojekyll'), '')
console.log(`Built static site in ${path.relative(root, output)}/`)
