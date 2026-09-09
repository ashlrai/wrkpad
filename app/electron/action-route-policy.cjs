const ACTIVE_ACTION_ROUTES = new Set(['ashlr_layer', 'hybrid_native'])

function routeAllowsConfiguredActions(settings) {
  return typeof settings?.boardRoute === 'string' && ACTIVE_ACTION_ROUTES.has(settings.boardRoute)
}

function passiveRouteActionResult(now = () => new Date()) {
  const timestamp = now()
  if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
    throw new TypeError('now must return a valid Date')
  }
  return {
    ok: false,
    title: 'Ashlr actions unavailable',
    message: 'Configured actions are disabled unless an explicit Ashlr shortcut route is active.',
    timestamp: timestamp.toISOString(),
  }
}

module.exports = { ACTIVE_ACTION_ROUTES, passiveRouteActionResult, routeAllowsConfiguredActions }
