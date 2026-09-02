function flightAcknowledgement(session, acknowledged) {
  const state = session.snapshot()
  return {
    acknowledged: acknowledged === true,
    active: state.active === true,
    startedAt: state.active === true && typeof state.startedAt === 'string' ? state.startedAt : null,
  }
}

function createFlightOperationCoordinator(session) {
  if (!session || typeof session.start !== 'function' || typeof session.restart !== 'function'
    || typeof session.stop !== 'function' || typeof session.reset !== 'function'
    || typeof session.snapshot !== 'function') {
    throw new TypeError('A flight session is required')
  }

  let generation = 0n
  let activeGeneration = null

  const advance = () => {
    generation += 1n
    activeGeneration = null
    return generation
  }

  const isCurrent = (candidate) => typeof candidate === 'bigint' && candidate === generation

  const activate = (candidate, state) => {
    if (!isCurrent(candidate) || state?.active !== true || typeof state.startedAt !== 'string') return false
    activeGeneration = candidate
    return true
  }

  const isCaptureCurrent = (capture) => {
    if (!capture || capture.generation !== generation || activeGeneration !== generation) return false
    const state = session.snapshot()
    return state.active === true && state.startedAt === capture.startedAt
  }

  const admit = async (mode, verify) => {
    if (typeof verify !== 'function') throw new TypeError('A gate verifier is required')
    const operationGeneration = advance()
    let admission
    try {
      admission = await verify()
    } catch {
      if (isCurrent(operationGeneration)) session.stop()
      return flightAcknowledgement(session, false)
    }
    if (!isCurrent(operationGeneration)) return flightAcknowledgement(session, false)
    if (admission?.ready !== true) {
      session.stop()
      return flightAcknowledgement(session, false)
    }

    const state = mode === 'restart' ? session.restart() : session.start()
    const activated = activate(operationGeneration, state)
    if (!activated && isCurrent(operationGeneration)) session.stop()
    return flightAcknowledgement(session, activated)
  }

  return {
    start(verify) { return admit('start', verify) },
    restart(verify) { return admit('restart', verify) },
    stop() {
      advance()
      return flightAcknowledgement(session, Boolean(session.stop()))
    },
    reset() {
      advance()
      session.reset()
    },
    capture() {
      const state = session.snapshot()
      if (state.active !== true || typeof state.startedAt !== 'string'
        || activeGeneration !== generation) return null
      return { generation, startedAt: state.startedAt }
    },
    isCaptureCurrent,
    snapshotForCapture(capture) {
      if (!isCaptureCurrent(capture)) return null
      return session.snapshot()
    },
  }
}

async function saveBoundFlightReceipt({
  coordinator,
  verifyGates,
  chooseDestination,
  buildDocument,
  writeDocument,
}) {
  if (!coordinator || typeof coordinator.capture !== 'function'
    || typeof coordinator.isCaptureCurrent !== 'function'
    || typeof coordinator.snapshotForCapture !== 'function') return null
  if (typeof verifyGates !== 'function' || typeof chooseDestination !== 'function'
    || typeof buildDocument !== 'function' || typeof writeDocument !== 'function') return null

  const capture = coordinator.capture()
  if (!capture) return null

  try {
    await verifyGates()
  } catch {
    return null
  }
  if (!coordinator.isCaptureCurrent(capture)) return null

  let destination
  try {
    destination = await chooseDestination()
  } catch {
    return null
  }
  if (!coordinator.isCaptureCurrent(capture)) return null
  if (typeof destination !== 'string' || destination.length === 0) return null

  let finalAdmission
  try {
    finalAdmission = await verifyGates()
  } catch {
    return null
  }
  if (!coordinator.isCaptureCurrent(capture)) return null

  const flight = coordinator.snapshotForCapture(capture)
  if (!flight) return null
  const document = buildDocument({ flight, admission: finalAdmission })

  // No asynchronous work may occur between this final binding check and the
  // synchronous write. A stop/restart therefore cannot commit an older session.
  if (!coordinator.isCaptureCurrent(capture)) return null
  return writeDocument(destination, document)
}

module.exports = { createFlightOperationCoordinator, saveBoundFlightReceipt }
