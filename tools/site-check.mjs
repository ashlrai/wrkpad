#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const site = path.join(root, 'site')
const required = ['index.html','styles.css','app.js','capabilities.json','llms.txt','robots.txt','favicon.svg']
const failures = []
for (const file of required) if (!existsSync(path.join(site,file))) failures.push(`missing ${file}`)
if (!existsSync(path.join(root, 'THIRD_PARTY_MEDIA.md'))) failures.push('missing third-party media notice')
const html=readFileSync(path.join(site,'index.html'),'utf8'),css=readFileSync(path.join(site,'styles.css'),'utf8'),js=readFileSync(path.join(site,'app.js'),'utf8')
const record=JSON.parse(readFileSync(path.join(site,'capabilities.json'),'utf8'))
const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1])
for(const id of new Set(ids))if(ids.filter(x=>x===id).length>1)failures.push(`duplicate id ${id}`)
for(const[,target]of html.matchAll(/href="#([^"]+)"/g))if(!ids.includes(target))failures.push(`missing target #${target}`)
for(const tag of ['<header','<nav','<main','<footer'])if(!html.includes(tag))failures.push(`missing landmark ${tag}`)
for(const phrase of ['Developer preview','Synthetic demo','no compliance certification','sets no client-side cookies'])if(!html.toLowerCase().includes(phrase.toLowerCase()))failures.push(`missing truth phrase ${phrase}`)
if(!html.includes('href="https://worklouder.cc/creator-micro-2"'))failures.push('missing official hardware photography link')
if(!html.includes('rel="icon" href="favicon.svg"'))failures.push('missing local favicon reference')
if(/assets\/(?:creator-micro-2\.avif|og-hardware\.jpg)/i.test(html))failures.push('uncleared Work Louder product media reference')
if(!html.includes('href="#main"'))failures.push('missing skip link')
for(const mode of ['data-view="hardware"','data-view="deck"'])if(!html.includes(mode))failures.push(`missing demo mode ${mode}`)
for(const scene of ['data-scene="build"','data-scene="review"','data-scene="quiet"'])if(!html.includes(scene))failures.push(`missing synthetic workload ${scene}`)
if((html.match(/class="key agent/g)??[]).length!==6)failures.push('expected six Agent keys')
if((html.match(/class="key action/g)??[]).length!==4)failures.push('expected four delivery actions')
const physicalOrder=['data-control="Dial left"','data-slot="0"','data-slot="1"','aria-label="Four-direction planar stick on the right"','data-slot="2"','data-slot="3"','data-slot="4"','data-slot="5"','data-control="Amplify"','data-control="Verify"','data-control="Polish"','data-control="Advance"','data-control="Layer and connection touch"','data-control="Voice"','data-control="Copy next brief"','data-control="Attention"']
let cursor=-1
for(const marker of physicalOrder){const next=html.indexOf(marker,cursor+1);if(next<0)failures.push(`missing physical control ${marker}`);else if(next<cursor)failures.push(`physical control out of order ${marker}`);else cursor=next}
if(!html.includes('transparent-key'))failures.push('missing transparent Attention key treatment')
if((html.match(/class="joy-(?:up|right|down|left)"/g)??[]).length!==4)failures.push('expected exactly four planar stick directions')
if(/Planar press|joy-press|aria-keyshortcuts="J"|\['KeyJ'/.test(`${html}\n${css}\n${js}`))failures.push('invented planar stick press binding')
if((html.match(/data-hero-target=/g)??[]).length!==16)failures.push('expected sixteen interactive hero control groups')
if(!html.includes('Original CSS illustration—not a product photograph'))failures.push('missing synthetic hero media boundary')
if(!html.includes('aria-keyshortcuts='))failures.push('missing declared keyboard shortcuts')
if(/role="radio(?:group)?"/.test(html))failures.push('custom radio controls require complete keyboard semantics')
if(/<(?!button\b)[a-z][^>]*\bdata-control=/i.test(html))failures.push('non-button synthetic control')
if(!css.includes(':focus-visible'))failures.push('missing focus treatment')
if(!css.includes('prefers-reduced-motion'))failures.push('missing reduced motion')
if(!css.includes('forced-colors'))failures.push('missing forced colors')
if(!css.includes('min-height:44px')&&!css.includes('min-height: 44px'))failures.push('missing target floor')
if(/(@import|url\(["']?https?:)/i.test(css))failures.push('remote CSS asset')
if(/<(img|script|link)[^>]+(?:src|href)=["']https?:/i.test(html))failures.push('remote page asset')
if(/<form\b/i.test(html))failures.push('unexpected form')
if(/document\.cookie|localStorage|sessionStorage|fetch\(|XMLHttpRequest|WebSocket/i.test(js))failures.push('unexpected persistence or network')
for(const behavior of ['addEventListener(\'keydown\'','Numpad1','Numpad9','Numpad0','event.preventDefault()','event.repeat'])if(!js.includes(behavior))failures.push(`missing accessible interaction ${behavior}`)
for(const claim of ['government-ready','enterprise-grade','battle-tested','mission-critical','fedramp certified','fips validated','cmmc compliant','section 508 compliant','wcag compliant','air-gapped','nothing leaves your device','fully functional'])if(html.toLowerCase().includes(claim))failures.push(`prohibited claim ${claim}`)
const allowed=new Set(['available','manual','planned','unsupported']),capabilityIds=[]
if(record.schema!=='ai.ashlr.wrkpad.capabilities/v1')failures.push('invalid capability schema')
if(!/^\d{4}-\d{2}-\d{2}$/.test(record.last_verified??''))failures.push('invalid verification date')
for(const item of record.capabilities??[]){if(!/^[a-z0-9-]+$/.test(item.id??''))failures.push('invalid capability id');if(!allowed.has(item.status))failures.push(`invalid status ${item.id}`);if(!/^https:\/\/github\.com\/ashlrai\/wrkpad(?:\/|$)/.test(item.evidence??''))failures.push(`invalid evidence ${item.id}`);capabilityIds.push(item.id)}
const rendered=[...html.matchAll(/data-capability="([^"]+)"/g)].map(m=>m[1])
if(JSON.stringify(capabilityIds.sort())!==JSON.stringify(rendered.sort()))failures.push('capability record drift')
if(failures.length){failures.forEach(x=>console.error(`site-check: ${x}`));process.exit(1)}
console.log(`Site contract passed for ${required.length} files and ${capabilityIds.length} capabilities.`)
