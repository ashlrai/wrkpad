const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { configuredRendererUrl, DEV_RENDERER_URL, trustedRendererUrl } = require('./renderer-trust.cjs')

test('only the exact local Vite development endpoint is accepted from the environment', () => {
  const entry = path.join('/Applications', 'Agent Board.app', 'index.html')
  assert.equal(configuredRendererUrl('http://127.0.0.1:5173', entry), DEV_RENDERER_URL)
  assert.match(configuredRendererUrl('https://attacker.example', entry), /^file:\/\//)
  assert.match(configuredRendererUrl('http://localhost:5173', entry), /^file:\/\//)
})

test('development trust stays on the exact loopback origin', () => {
  assert.equal(trustedRendererUrl('http://127.0.0.1:5173/', DEV_RENDERER_URL), true)
  assert.equal(trustedRendererUrl('http://127.0.0.1:5173/src/main.tsx', DEV_RENDERER_URL), true)
  assert.equal(trustedRendererUrl('http://127.0.0.1:5174/', DEV_RENDERER_URL), false)
  assert.equal(trustedRendererUrl('http://localhost:5173/', DEV_RENDERER_URL), false)
  assert.equal(trustedRendererUrl('http://user@127.0.0.1:5173/', DEV_RENDERER_URL), false)
})

test('packaged renderer trust requires the exact file URL', () => {
  const expected = 'file:///Applications/Agent%20Board.app/index.html'
  assert.equal(trustedRendererUrl(expected, expected), true)
  assert.equal(trustedRendererUrl('file:///tmp/index.html', expected), false)
})

