const ACTIVE_SHORTCUT_ROUTE = 'ashlr_layer'

function assertFunction(options, name) {
  if (typeof options?.[name] !== 'function') throw new TypeError(`${name} must be a function`)
}

function createShortcutOwnershipController(options) {
  for (const name of [
    'clearApprovals',
    'inspectRuntime',
    'registerShortcuts',
    'registrationsAreActive',
    'resetFlight',
    'runtimeOwnsShortcuts',
    'shortcutsAreReleased',
    'unregisterAll',
  ]) assertFunction(options, name)
  if (!Number.isInteger(options.expectedRegistrationCount) || options.expectedRegistrationCount < 1) {
    throw new TypeError('expectedRegistrationCount must be a positive integer')
  }

  let registrations = []
  let runtime = null

  function deactivate(forceUnregister = false) {
    try {
      if (forceUnregister || registrations.length) options.unregisterAll()
    } finally {
      registrations = []
      options.resetFlight()
      options.clearApprovals()
    }
    return options.shortcutsAreReleased()
  }

  function synchronize(boardRoute) {
    runtime = options.inspectRuntime()
    if (boardRoute !== ACTIVE_SHORTCUT_ROUTE || !options.runtimeOwnsShortcuts(runtime)) {
      const released = deactivate(boardRoute !== ACTIVE_SHORTCUT_ROUTE)
      return { runtime, registrations: [...registrations], released }
    }

    const complete = registrations.length === options.expectedRegistrationCount
      && registrations.every((registration) => registration?.registered === true)
      && options.registrationsAreActive(registrations)
    if (!complete) {
      if (registrations.length) options.unregisterAll()
      try {
        registrations = options.registerShortcuts()
        if (!Array.isArray(registrations)) throw new TypeError('registerShortcuts must return an array')
        const registeredEveryShortcut = registrations.length === options.expectedRegistrationCount
          && registrations.every((registration) => registration?.registered === true)
          && options.registrationsAreActive(registrations)
        if (!registeredEveryShortcut) deactivate(true)
      } catch {
        // Electron can throw after registering only part of the map. Remove every
        // application shortcut immediately rather than waiting for the next poll.
        deactivate(true)
      }
    }
    return { runtime, registrations: [...registrations], released: false }
  }

  return Object.freeze({ synchronize })
}

function createShortcutCallbackGuard() {
  let enabled = false
  let generation = 0

  return Object.freeze({
    bind(callback) {
      if (typeof callback !== 'function') throw new TypeError('shortcut callback must be a function')
      const boundGeneration = generation
      return (...args) => {
        if (!enabled || boundGeneration !== generation) return false
        callback(...args)
        return true
      }
    },
    enable() { enabled = true },
    invalidate() { enabled = false; generation += 1 },
  })
}

module.exports = { ACTIVE_SHORTCUT_ROUTE, createShortcutCallbackGuard, createShortcutOwnershipController }
