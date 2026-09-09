const DEFAULT_MAX_APPROVALS = 64

function createApprovalStore(options = {}) {
  const now = options.now ?? Date.now
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_APPROVALS
  if (typeof now !== 'function' || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1024) {
    throw new TypeError('Approval store options are invalid')
  }
  const entries = new Map()

  function prune() {
    const current = now()
    if (!Number.isFinite(current)) {
      entries.clear()
      return false
    }
    for (const [token, approval] of entries) {
      if (!approval || !Number.isFinite(approval.expires) || approval.expires <= current) entries.delete(token)
    }
    return true
  }

  return Object.freeze({
    set(token, approval) {
      if (typeof token !== 'string' || token.length === 0 || !approval || typeof approval !== 'object') return false
      if (!prune()) return false
      if (!entries.has(token) && entries.size >= maxEntries) return false
      entries.set(token, approval)
      return true
    },
    get(token) {
      if (!prune()) return undefined
      return entries.get(token)
    },
    consume(token) {
      if (!prune()) return undefined
      const approval = entries.get(token)
      entries.delete(token)
      return approval
    },
    delete(token) {
      if (!prune()) return false
      return entries.delete(token)
    },
    clear() {
      entries.clear()
    },
    size() {
      return prune() ? entries.size : 0
    },
  })
}

module.exports = { DEFAULT_MAX_APPROVALS, createApprovalStore }
