function createFlightInterlock() {
  let active = false
  return {
    set(value) { active = value === true; return active },
    isActive() { return active },
  }
}

module.exports = { createFlightInterlock }
