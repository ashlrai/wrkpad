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

function projectCommissioningSnapshot(status, candidate, observedAt = new Date().toISOString()) {
  if (!status || status.boardRoute !== 'ashlr_layer') {
    throw new TypeError('Ashlr Layer must be declared before commissioning')
  }
  const cacheSha256 = status.inputProfile?.inputCacheSha256 ?? null
  const cacheStatus = status.inputProfile?.cacheStatus === 'missing'
    ? 'missing'
    : cacheSha256 && candidate?.status === 'verified' && cacheSha256 === candidate.sha256
      ? 'candidate'
    : cacheSha256
      ? 'different'
      : 'unknown'
  const callbackObserved = status.shortcutTelemetry?.totalObserved > 0
    && status.shortcutTelemetry?.last?.outcome === 'allowed'

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
      // A current allowed callback proves that this receiver can receive the
      // shortcut path. It does not prove that the board emitted the event.
      inputMonitoring: callbackObserved ? 'granted' : 'unknown',
    },
    candidate,
    // The vendor cache is deliberately not relabeled as a rollback baseline.
    baseline: { status: 'missing', sha256: null },
    physicalAcceptance: { status: 'pending', candidateSha256: null, acceptedAt: null },
  }, observedAt)
}

module.exports = { projectCommissioningSnapshot }
