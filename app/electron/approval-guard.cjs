const HOLD_DURATION_MS = 1500

function holdSatisfied(approval, now = Date.now()) {
  return Number.isFinite(approval?.holdStartedAt) && now - approval.holdStartedAt >= HOLD_DURATION_MS
}

module.exports = { HOLD_DURATION_MS, holdSatisfied }
