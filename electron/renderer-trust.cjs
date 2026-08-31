const { pathToFileURL } = require('node:url')

const DEV_RENDERER_URL = 'http://127.0.0.1:5173/'

function configuredRendererUrl(environmentValue, productionEntryPath) {
  return environmentValue === DEV_RENDERER_URL.slice(0, -1)
    ? DEV_RENDERER_URL
    : pathToFileURL(productionEntryPath).href
}

function trustedRendererUrl(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false
  if (expected === DEV_RENDERER_URL) {
    try {
      const url = new URL(candidate)
      return url.protocol === 'http:'
        && url.hostname === '127.0.0.1'
        && url.port === '5173'
        && url.username === ''
        && url.password === ''
    } catch {
      return false
    }
  }
  return candidate === expected
}

module.exports = { configuredRendererUrl, DEV_RENDERER_URL, trustedRendererUrl }

