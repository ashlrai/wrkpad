const ACTIVE_ACTION_ROUTE = 'ashlr_layer'

function routeAllowsConfiguredActions(settings) {
  return settings?.boardRoute === ACTIVE_ACTION_ROUTE
}

function passiveRouteActionResult(now = () => new Date()) {
  const timestamp = now()
  if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
    throw new TypeError('now must return a valid Date')
  }
  return {
    ok: false,
    title: 'Ashlr actions unavailable',
    message: 'Configured actions are disabled unless the Ashlr Layer route is active.',
    timestamp: timestamp.toISOString(),
  }
}

module.exports = { ACTIVE_ACTION_ROUTE, passiveRouteActionResult, routeAllowsConfiguredActions }
