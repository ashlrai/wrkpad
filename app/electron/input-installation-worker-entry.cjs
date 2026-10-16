const path = require('node:path')
const { isMainThread, parentPort, workerData } = require('node:worker_threads')
const { inspectInputInstallation } = require('./input-installation-diagnostics.cjs')

const MAX_HOME_LENGTH = 4_096

function validRequest(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'home,schemaVersion'
    && value.schemaVersion === 1
    && typeof value.home === 'string'
    && value.home.length > 0
    && value.home.length <= MAX_HOME_LENGTH
    && path.isAbsolute(value.home)
    && !value.home.includes('\0')
}

if (!isMainThread && parentPort) {
  let inspection = { status: 'probe_unavailable', version: null }
  if (validRequest(workerData)) {
    try {
      inspection = inspectInputInstallation({ home: workerData.home })
    } catch {
      inspection = { status: 'probe_unavailable', version: null }
    }
  }
  parentPort.postMessage(inspection)
}

module.exports = { validRequest }
