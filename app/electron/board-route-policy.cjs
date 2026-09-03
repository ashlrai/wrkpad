const ASHLR_LAYER_ROUTE = 'ashlr_layer'
const CODEX_NATIVE_ROUTE = 'codex_native'
const HYBRID_NATIVE_ROUTE = 'hybrid_native'

const ASHLR_LAYER_SIGNAL_IDS = Object.freeze([
  'agent1', 'agent2', 'agent3', 'agent4', 'agent5', 'agent6',
  'cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6', 'cmd7',
  'joyUp', 'joyRight', 'joyDown', 'joyLeft',
  'dialLeft', 'dialRight', 'dialPress',
])

// Keep this order shared with Hybrid Native Flight Check. The six Agent keys
// are deliberately absent: their KV_OAI_AGxx reports remain native-owned.
const HYBRID_NATIVE_SIGNAL_IDS = Object.freeze([
  'cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6', 'cmd7',
  'joyUp', 'joyRight', 'joyDown', 'joyLeft',
  'dialLeft', 'dialRight', 'dialPress',
])

function shortcutSignalsForRoute(route) {
  if (route === ASHLR_LAYER_ROUTE) return [...ASHLR_LAYER_SIGNAL_IDS]
  if (route === HYBRID_NATIVE_ROUTE) return [...HYBRID_NATIVE_SIGNAL_IDS]
  return []
}

function routeOwnsShortcuts(route) {
  return route === ASHLR_LAYER_ROUTE || route === HYBRID_NATIVE_ROUTE
}

module.exports = {
  ASHLR_LAYER_ROUTE,
  ASHLR_LAYER_SIGNAL_IDS,
  CODEX_NATIVE_ROUTE,
  HYBRID_NATIVE_ROUTE,
  HYBRID_NATIVE_SIGNAL_IDS,
  routeOwnsShortcuts,
  shortcutSignalsForRoute,
}
