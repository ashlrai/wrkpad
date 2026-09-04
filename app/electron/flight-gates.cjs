const VARIANTS = new Set(['daily', 'diagnostic'])
const { HYBRID_NATIVE_ROUTE, shortcutSignalsForRoute } = require('./board-route-policy.cjs')

const EXPECTED_PROFILE = Object.freeze({
  daily: Object.freeze({ profile: 'Ashlr Agent Board Corrected', layer: 'Ashlr Daily' }),
  diagnostic: Object.freeze({ profile: 'Ashlr Flight Check Corrected - diagnostic', layer: 'Ashlr Diagnostic' }),
})

const DUAL_PLANE_PROFILE = 'Ashlr Dual Plane (UNOFFICIAL)'
const HYBRID_NATIVE_PROFILE = 'Ashlr Hybrid Dual Plane (UNOFFICIAL)'

function exactDualPlaneLayers(layers) {
  return Array.isArray(layers)
    && layers.length === 2
    && layers[0]?.name === 'Codex Native Recovery (UNOFFICIAL)'
    && layers[0]?.mapping === 'codex_native'
    && layers[1]?.name === 'Ashlr Daily'
    && layers[1]?.mapping === 'ashlr_daily'
    && layers[1]?.encoderDirection === 'correct'
}

function exactHybridLayers(layers) {
  return Array.isArray(layers)
    && layers.length === 2
    && layers[0]?.name === 'Ashlr Hybrid Native (UNOFFICIAL)'
    && layers[0]?.mapping === 'hybrid_native'
    && layers[0]?.encoderDirection === 'correct'
    && layers[1]?.name === 'Ashlr Daily'
    && layers[1]?.mapping === 'ashlr_daily'
    && layers[1]?.encoderDirection === 'correct'
}

function profileReady(profile, route, variant, expected, dualPlaneAshlrLayerSelected) {
  if (!expected || profile?.cacheStatus !== 'available') return false
  if (route === HYBRID_NATIVE_ROUTE) {
    return variant === 'daily'
      && profile.activeProfile === HYBRID_NATIVE_PROFILE
      && profile.activeLayer === null
      && exactHybridLayers(profile.configuredLayers)
  }
  if (profile.activeProfile === expected.profile
    && profile.activeLayer === expected.layer
    && profile.encoderDirection === 'correct') {
    if (variant !== 'daily') return true
    return Array.isArray(profile.configuredLayers)
      && profile.configuredLayers.length === 1
      && profile.configuredLayers[0]?.name === 'Ashlr Daily'
      && profile.configuredLayers[0]?.mapping === 'ashlr_daily'
      && profile.configuredLayers[0]?.encoderDirection === 'correct'
  }
  return variant === 'daily'
    && dualPlaneAshlrLayerSelected === true
    && profile.activeProfile === DUAL_PLANE_PROFILE
    && profile.activeLayer === null
    && exactDualPlaneLayers(profile.configuredLayers)
}

function validVersion(value) {
  return typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(value)
}

function exactRegisteredSignals(registrations, expectedSignals) {
  if (!Array.isArray(registrations) || registrations.length !== expectedSignals.length) return []
  const expected = new Set(expectedSignals)
  const observed = new Set()
  for (const item of registrations) {
    if (!item || item.registered !== true || !expected.has(item.signalId) || observed.has(item.signalId)) return []
    observed.add(item.signalId)
  }
  return observed.size === expected.size ? [...observed] : []
}

function evaluateFlightGates(evidence) {
  const variant = VARIANTS.has(evidence?.variant) ? evidence.variant : null
  const route = evidence?.boardRoute
  const expected = variant ? EXPECTED_PROFILE[variant] : null
  const expectedSignals = shortcutSignalsForRoute(route)
  const registered = exactRegisteredSignals(evidence?.shortcutRegistrations, expectedSignals)
  const input = evidence?.inputInstallation
  const profile = evidence?.inputProfile
  const receiver = evidence?.receiverRuntime
  const profileContentDrift = variant === 'daily'
    && profile?.cacheStatus === 'available'
    && profile?.activeProfile === EXPECTED_PROFILE.daily.profile
    && profile?.activeLayer === EXPECTED_PROFILE.daily.layer
    && Array.isArray(profile?.configuredLayers)
    && profile.configuredLayers.length === 1
    && profile.configuredLayers[0]?.mapping !== 'ashlr_daily'

  const gates = {
    variant: Boolean(variant) && (route !== HYBRID_NATIVE_ROUTE || variant === 'daily'),
    route: expectedSignals.length > 0,
    usb: evidence?.usbDetected === true,
    input: input?.status === 'verified' && validVersion(input?.version),
    profile: profileReady(profile, route, variant, expected, evidence?.dualPlaneAshlrLayerSelected),
    receiver: receiver?.status === 'exclusive'
      && receiver?.instanceCount === 1
      && receiver?.distinctBuildCount === 1,
    shortcuts: expectedSignals.length > 0 && registered.length === expectedSignals.length,
  }
  if (route === HYBRID_NATIVE_ROUTE) gates.inputApplication = evidence?.inputApplication?.status === 'not_running'

  return {
    ready: Object.values(gates).every(Boolean),
    gates,
    evidence: {
      boardRoute: typeof evidence?.boardRoute === 'string' ? evidence.boardRoute : 'unknown',
      dualPlaneAshlrLayerSelected: evidence?.dualPlaneAshlrLayerSelected === true,
      usbDetected: evidence?.usbDetected === true,
      inputInstallation: {
        status: typeof input?.status === 'string' ? input.status : 'probe_unavailable',
        version: validVersion(input?.version) ? input.version : null,
      },
      inputProfile: {
        cacheStatus: typeof profile?.cacheStatus === 'string' ? profile.cacheStatus : 'invalid',
        activeProfile: typeof profile?.activeProfile === 'string' ? profile.activeProfile : null,
        activeLayer: typeof profile?.activeLayer === 'string' ? profile.activeLayer : null,
        encoderDirection: typeof profile?.encoderDirection === 'string' ? profile.encoderDirection : 'unavailable',
        configuredLayers: Array.isArray(profile?.configuredLayers)
          ? profile.configuredLayers.slice(0, 6).map((layer) => ({
            name: typeof layer?.name === 'string' ? layer.name : null,
            mapping: ['ashlr_daily', 'codex_native', 'hybrid_native', 'unknown'].includes(layer?.mapping) ? layer.mapping : 'unknown',
            encoderDirection: typeof layer?.encoderDirection === 'string' ? layer.encoderDirection : 'unavailable',
          }))
          : [],
      },
      profileFailure: profileContentDrift ? 'active_profile_content_drift' : null,
      receiverRuntime: {
        status: typeof receiver?.status === 'string' ? receiver.status : 'unavailable',
        instanceCount: Number.isInteger(receiver?.instanceCount) ? receiver.instanceCount : 0,
        distinctBuildCount: Number.isInteger(receiver?.distinctBuildCount) ? receiver.distinctBuildCount : 0,
        currentAsarSha256: typeof receiver?.currentAsarSha256 === 'string' && /^[0-9a-f]{64}$/.test(receiver.currentAsarSha256)
          ? receiver.currentAsarSha256
          : null,
      },
      inputApplication: { status: ['running', 'not_running', 'unavailable'].includes(evidence?.inputApplication?.status) ? evidence.inputApplication.status : 'unavailable' },
      shortcuts: { registeredCount: registered.length, expectedCount: expectedSignals.length },
    },
  }
}

module.exports = { EXPECTED_PROFILE, evaluateFlightGates, exactHybridLayers }
