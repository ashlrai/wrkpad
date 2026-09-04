function assertFunction(options, name) {
  if (typeof options?.[name] !== 'function') throw new TypeError(`${name} must be a function`)
}

function createShortcutOwnershipController(options) {
  for (const name of [
    'clearApprovals',
    'inspectRuntime',
    'expectedRegistrationCount',
    'registerShortcuts',
    'registrationsAreActive',
    'resetFlight',
    'runtimeOwnsShortcuts',
    'routeOwnsShortcuts',
    'shortcutsAreReleased',
    'unregisterAll',
  ]) assertFunction(options, name)
  let registrations = []
  let registrationRoute = null
  let runtime = null

  function deactivate(forceUnregister = false) {
    try {
      if (forceUnregister || registrations.length) options.unregisterAll()
    } finally {
      registrations = []
      registrationRoute = null
      options.resetFlight()
      options.clearApprovals()
    }
    return options.shortcutsAreReleased()
  }

  function synchronize(boardRoute) {
    runtime = options.inspectRuntime()
    if (!options.routeOwnsShortcuts(boardRoute) || !options.runtimeOwnsShortcuts(runtime, boardRoute)) {
      const released = deactivate(!options.routeOwnsShortcuts(boardRoute))
      return { runtime, registrations: [...registrations], released }
    }

    const expectedRegistrationCount = options.expectedRegistrationCount(boardRoute)
    if (!Number.isInteger(expectedRegistrationCount) || expectedRegistrationCount < 1) {
      deactivate(true)
      return { runtime, registrations: [], released: false }
    }
    const complete = registrationRoute === boardRoute
      && registrations.length === expectedRegistrationCount
      && registrations.every((registration) => registration?.registered === true)
      && options.registrationsAreActive(registrations, boardRoute)
    if (!complete) {
      const replacingOwnedRoute = registrationRoute !== null || registrations.length > 0
      if (registrations.length) options.unregisterAll()
      registrations = []
      registrationRoute = null
      if (replacingOwnedRoute) {
        options.resetFlight()
        options.clearApprovals()
      }
      try {
        registrations = options.registerShortcuts(boardRoute)
        if (!Array.isArray(registrations)) throw new TypeError('registerShortcuts must return an array')
        const registeredEveryShortcut = registrations.length === expectedRegistrationCount
          && registrations.every((registration) => registration?.registered === true)
          && options.registrationsAreActive(registrations, boardRoute)
        if (!registeredEveryShortcut) deactivate(true)
        else registrationRoute = boardRoute
      } catch {
        // Electron can throw after registering only part of the map. Remove every
        // application shortcut immediately rather than waiting for the next poll.
        deactivate(true)
      }
    }
    return { runtime, registrations: [...registrations], released: false }
  }

  function finalize(boardRoute) {
    const active = options.routeOwnsShortcuts(boardRoute)
      && registrationRoute === boardRoute
      && registrations.length > 0
      && registrations.every((registration) => registration?.registered === true)
      && options.registrationsAreActive(registrations, boardRoute)
    if (active) return { runtime, registrations: [...registrations], released: false, active: true }

    // Registration return values are historical. If the final Electron
    // liveness check disagrees, release the complete set and clear the
    // controller's records before status or callback delivery can use them.
    const released = registrations.length > 0
      ? deactivate(true)
      : options.shortcutsAreReleased()
    return { runtime, registrations: [], released, active: false }
  }

  return Object.freeze({ finalize, synchronize })
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

module.exports = { createShortcutCallbackGuard, createShortcutOwnershipController }
