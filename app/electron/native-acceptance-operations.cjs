const { isDeepStrictEqual } = require('node:util')

const PREPARE_CONTEXT_MESSAGE = 'Codex Native, the USB board, and bounded ChatGPT Desktop metadata are required. No handoff was written.'
const PREPARE_CHANGED_MESSAGE = 'The native context or handoff changed while preparation was in progress. No handoff was written.'
const PREPARE_FAILED_MESSAGE = 'The private native handoff could not be prepared. No acceptance was recorded.'
const PREPARE_SUCCESS_MESSAGE = 'Private native handoff prepared. No device, Desktop setting, or firmware was changed.'
const ACCEPT_CONTEXT_MESSAGE = 'A matching prepared handoff and current native context are required. No acceptance was recorded.'
const ACCEPT_CHANGED_MESSAGE = 'The native context or handoff changed while acceptance was in progress. No acceptance was recorded.'
const ACCEPT_FAILED_MESSAGE = 'Fresh ordered initialization and all seven observations are required. No acceptance was recorded.'
const ACCEPT_SUCCESS_MESSAGE = 'Operator attestation saved for this VID:PID class and observed Desktop metadata.'
const CLEAR_SUCCESS_MESSAGE = 'The local native handoff was cleared. No device, Desktop setting, or firmware was changed.'
const CLEAR_FAILED_MESSAGE = 'The local native handoff could not be cleared safely. No device, Desktop setting, or firmware was changed.'

function assertDependencies(options) {
  for (const name of [
    'acceptReceipt',
    'collectEvidence',
    'evaluateReceipt',
    'prepareReceipt',
    'readReceipt',
    'removeReceipt',
    'stageReceipt',
    'writeReceipt',
  ]) {
    if (typeof options?.[name] !== 'function') throw new TypeError(`${name} must be a function`)
  }
}

function createNativeAcceptanceOperationCoordinator(options) {
  assertDependencies(options)
  let operationTail = Promise.resolve()

  function enqueue(operation) {
    const result = operationTail.then(operation, operation)
    operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  async function captureInputs() {
    const evidence = await options.collectEvidence()
    const receipt = options.readReceipt()
    if (receipt && typeof receipt.then === 'function') throw new TypeError('readReceipt must be synchronous')
    return { receipt, evidence }
  }

  function evaluate(receipt, evidence) {
    return options.evaluateReceipt(receipt, {
      currentContext: evidence?.currentContext ?? null,
      nativeInitialization: evidence?.nativeInitialization,
    })
  }

  async function currentSnapshot() {
    try {
      const { receipt, evidence } = await captureInputs()
      return { receipt, evaluation: evaluate(receipt, evidence) }
    } catch {
      return {
        receipt: null,
        evaluation: options.evaluateReceipt(null, {
          currentContext: null,
          nativeInitialization: undefined,
        }),
      }
    }
  }

  async function changedResult(message) {
    return { ok: false, message, snapshot: await currentSnapshot() }
  }

  async function stableInputs() {
    const initial = await captureInputs()
    const current = await captureInputs()
    return {
      changed: !isDeepStrictEqual(initial.receipt, current.receipt)
        || !isDeepStrictEqual(initial.evidence?.currentContext ?? null, current.evidence?.currentContext ?? null),
      current,
    }
  }

  async function prepareOperation() {
    try {
      const { changed, current } = await stableInputs()
      if (changed) return changedResult(PREPARE_CHANGED_MESSAGE)
      if (!current.evidence?.currentContext) return changedResult(PREPARE_CONTEXT_MESSAGE)

      const written = await options.writeReceipt(options.prepareReceipt(current.evidence.currentContext), current.receipt)
      const snapshot = await currentSnapshot()
      const persisted = isDeepStrictEqual(snapshot.receipt, written)
      const contextCurrent = isDeepStrictEqual(snapshot.receipt?.context ?? null, current.evidence.currentContext)
        && !['invalid', 'not_prepared'].includes(snapshot.evaluation?.status)
      if (!persisted || !contextCurrent) return { ok: false, message: PREPARE_CHANGED_MESSAGE, snapshot }
      return { ok: true, message: PREPARE_SUCCESS_MESSAGE, snapshot }
    } catch {
      return changedResult(PREPARE_FAILED_MESSAGE)
    }
  }

  async function acceptOperation(attestations) {
    try {
      const { changed, current } = await stableInputs()
      if (changed) return changedResult(ACCEPT_CHANGED_MESSAGE)
      if (!current.receipt || !current.evidence?.currentContext) return changedResult(ACCEPT_CONTEXT_MESSAGE)

      const staged = options.stageReceipt(current.receipt, {
        attestations,
        currentContext: current.evidence.currentContext,
        nativeInitialization: current.evidence.nativeInitialization,
      })
      const stagedWritten = await options.writeReceipt(staged, current.receipt)
      const promotion = await captureInputs()
      const promotionSnapshot = {
        receipt: promotion.receipt,
        evaluation: evaluate(promotion.receipt, promotion.evidence),
      }
      if (!isDeepStrictEqual(promotion.receipt, stagedWritten)) {
        return { ok: false, message: ACCEPT_CHANGED_MESSAGE, snapshot: promotionSnapshot }
      }

      const accepted = options.acceptReceipt(promotion.receipt, {
        currentContext: promotion.evidence?.currentContext ?? null,
        nativeInitialization: promotion.evidence?.nativeInitialization,
      })
      const acceptedEvaluation = evaluate(accepted, promotion.evidence)
      if (acceptedEvaluation?.status !== 'accepted') {
        return { ok: false, message: ACCEPT_CHANGED_MESSAGE, snapshot: promotionSnapshot }
      }
      const written = await options.writeReceipt(accepted, promotion.receipt)
      return {
        ok: true,
        message: ACCEPT_SUCCESS_MESSAGE,
        snapshot: { receipt: written, evaluation: acceptedEvaluation },
      }
    } catch {
      return changedResult(ACCEPT_FAILED_MESSAGE)
    }
  }

  async function clearOperation() {
    try {
      const expected = options.readReceipt()
      if (expected && typeof expected.then === 'function') throw new TypeError('readReceipt must be synchronous')
      const removed = await options.removeReceipt(expected)
      const snapshot = await currentSnapshot()
      const cleared = removed === true && snapshot.receipt === null
      return {
        ok: cleared,
        message: cleared ? CLEAR_SUCCESS_MESSAGE : CLEAR_FAILED_MESSAGE,
        snapshot,
      }
    } catch {
      return changedResult(CLEAR_FAILED_MESSAGE)
    }
  }

  return Object.freeze({
    get: () => enqueue(currentSnapshot),
    prepare: () => enqueue(prepareOperation),
    accept: (attestations) => enqueue(() => acceptOperation(attestations)),
    clear: () => enqueue(clearOperation),
    mutateContext: (operation) => {
      if (typeof operation !== 'function') return Promise.reject(new TypeError('context mutation must be a function'))
      return enqueue(operation)
    },
  })
}

module.exports = { createNativeAcceptanceOperationCoordinator }
