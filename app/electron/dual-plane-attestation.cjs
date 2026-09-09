const MAX_ATTESTATION_AGE_MS = 30_000
const MAX_FUTURE_SKEW_MS = 5_000

function hasFreshExactDualPlaneAshlrAttestation(attestation, now = Date.now()) {
  const attestedAt = typeof attestation?.attestedAt === 'string' ? Date.parse(attestation.attestedAt) : Number.NaN
  return attestation !== null
    && typeof attestation === 'object'
    && !Array.isArray(attestation)
    && Object.keys(attestation).length === 2
    && attestation.dualPlaneAshlrLayerSelected === true
    && Number.isFinite(attestedAt)
    && attestedAt <= now + MAX_FUTURE_SKEW_MS
    && attestedAt >= now - MAX_ATTESTATION_AGE_MS
}

module.exports = { MAX_ATTESTATION_AGE_MS, MAX_FUTURE_SKEW_MS, hasFreshExactDualPlaneAshlrAttestation }
