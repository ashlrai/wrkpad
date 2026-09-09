const { createCommissioningSnapshot } = require('./commissioning-snapshot.cjs')

function installationStatus(installation) {
  if (installation?.status === 'verified') return 'trusted'
  if (installation?.status === 'multiple_installations') return 'multiple'
  if (installation?.status === 'missing' || installation?.status === 'probe_unavailable') return 'unavailable'
  return 'untrusted'
}

function receiverStatus(receiver) {
  if (receiver?.status === 'exclusive') {
    return receiver.candidateMatchesCurrent === false ? 'untrusted' : 'single_trusted'
  }
  if (receiver?.status === 'not_running') return 'absent'
  if (receiver?.status === 'contended_same_build' || receiver?.status === 'contended_distinct_builds') return 'multiple'
  return 'unknown'
}

function exactDailyCache(profile) {
  return profile?.cacheStatus === 'available'
    && profile.activeProfile === 'Ashlr Agent Board Corrected'
    && profile.activeLayer === 'Ashlr Daily'
    && profile.encoderDirection === 'correct'
    && Array.isArray(profile.configuredLayers)
    && profile.configuredLayers.length === 1
    && profile.configuredLayers[0]?.name === 'Ashlr Daily'
    && profile.configuredLayers[0]?.mapping === 'ashlr_daily'
    && profile.configuredLayers[0]?.encoderDirection === 'correct'
}

function projectActiveFlightAcceptance(activeAdmission, flight, evaluation, candidate) {
  const pending = { status: 'pending', candidateSha256: null, acceptedAt: null }
  if (activeAdmission?.variant !== 'daily'
    || typeof activeAdmission.candidateSha256 !== 'string'
    || activeAdmission.candidateSha256 !== candidate?.sha256
    || flight?.active !== true
    || flight.invalidated === true
    || evaluation?.status !== 'passed') return pending
  const acceptedAt = flight.rawEvents?.at(-1)?.receivedAt
  return typeof acceptedAt === 'string'
    ? { status: 'accepted', candidateSha256: candidate.sha256, acceptedAt }
    : pending
}

function projectCommissioningSnapshot(
  status,
  candidate,
  baseline = { status: 'missing', sha256: null },
  physicalAcceptance = { status: 'pending', candidateSha256: null, acceptedAt: null },
  observedAt = new Date().toISOString(),
) {
  if (!status || status.boardRoute !== 'ashlr_layer') {
    throw new TypeError('Ashlr Layer must be declared before commissioning')
  }
  const cacheSha256 = status.inputProfile?.inputCacheSha256 ?? null
  const rawCacheStatus = status.inputProfile?.cacheStatus
  const cacheStatus = rawCacheStatus === 'missing'
    ? 'missing'
    : rawCacheStatus === 'invalid' || rawCacheStatus === 'unsafe'
      ? rawCacheStatus
    : rawCacheStatus === 'available' && cacheSha256 && candidate?.status === 'verified' && exactDailyCache(status.inputProfile)
      ? 'candidate'
      : rawCacheStatus === 'available' && cacheSha256
        ? 'different'
        : 'unknown'

  return createCommissioningSnapshot({
    device: status.boardConnected && status.boardVidPid === '303A:8298'
      ? { status: 'exact', vidPid: status.boardVidPid }
      : status.boardConnected && status.boardVidPid
        ? { status: 'unsupported', vidPid: status.boardVidPid }
        : { status: 'absent', vidPid: null },
    input: {
      installation: installationStatus(status.inputInstallation),
      version: status.inputInstallation?.status === 'verified' ? status.inputInstallation.version : null,
      running: status.inputApplication?.status === 'running'
        ? 'running'
        : status.inputApplication?.status === 'not_running'
          ? 'quit'
          : 'unknown',
      cacheStatus,
      inputCacheSha256: cacheSha256,
    },
    receiver: {
      status: receiverStatus(status.receiverRuntime),
      // macOS does not expose a trustworthy read API for this TCC setting. A
      // global shortcut may come from the laptop keyboard, so it is never
      // promoted into permission or physical-board proof.
      inputMonitoring: 'unknown',
    },
    candidate,
    // The vendor cache is deliberately not relabeled as a protected source
    // export or as proof of the current board state.
    baseline,
    physicalAcceptance,
  }, observedAt)
}

module.exports = { exactDailyCache, projectActiveFlightAcceptance, projectCommissioningSnapshot }
