'use strict'

const routes = {
  ashlr: {
    label: 'Ashlr Layer',
    summary: 'Shared Codex + Claude/cmux shortcuts. Actions remain guarded.',
    authority: 'Preview only',
  },
  native: {
    label: 'Codex Native',
    summary: 'Codex owns keys and lighting. This screen remains an observer.',
    authority: 'Owned by Codex',
  },
}

const views = {
  hardware: { label: 'Hardware', heading: 'Creator Micro 2 · hardware map' },
  deck: { label: 'Desktop Deck', heading: 'Desktop Deck · keyboard map' },
}

const scenes = {
  build: [
    ['error', 'Needs you', 'Codex', 'Needs your input · review blocked'],
    ['working', 'Working', 'Claude', 'Working · tests running'],
    ['complete', 'Ready', 'Codex', 'Ready to review · diff prepared'],
    ['idle', 'Idle', 'Fleet', 'Idle · repo enrolled'],
    ['', 'Open', 'Available', 'Available slot'],
    ['', 'Open', 'Available', 'Available slot'],
  ],
  review: [
    ['complete', 'Ready', 'Codex', 'Ready to review · accessibility pass'],
    ['error', 'Needs you', 'Claude', 'Needs your input · scope decision'],
    ['complete', 'Ready', 'Fleet', 'Ready to review · three proposals'],
    ['working', 'Working', 'Codex', 'Working · release checks'],
    ['idle', 'Idle', 'Claude', 'Idle · context preserved'],
    ['', 'Open', 'Available', 'Available slot'],
  ],
  quiet: [
    ['idle', 'Idle', 'Codex', 'Idle · context preserved'],
    ['idle', 'Idle', 'Claude', 'Idle · context preserved'],
    ['idle', 'Idle', 'Fleet', 'Idle · queue clear'],
    ['', 'Open', 'Available', 'Available slot'],
    ['', 'Open', 'Available', 'Available slot'],
    ['', 'Open', 'Available', 'Available slot'],
  ],
}

const commissioningProof = {
  device: {
    state: 'Observed, not accepted',
    title: 'Exact USB identity',
    detail: 'An allowlisted Creator Micro 2 is present. That does not establish its active layer, shortcut mapping, or a working key.',
    evidence: 'Bounded USB receipt',
    next: 'Verify local environment',
  },
  input: {
    state: 'Installation trust',
    title: 'Work Louder Input integrity',
    detail: 'Publisher, signature, and Gatekeeper evidence can qualify the installed controller. It does not prove the current profile or board synchronization.',
    evidence: 'Sanitized fixed-path probe',
    next: 'Verify one receiver',
  },
  receiver: {
    state: 'Desktop path only',
    title: 'One trusted shortcut receiver',
    detail: 'Receiver exclusivity and a permitted callback establish the laptop path. They do not prove that the physical board emitted the shortcut.',
    evidence: 'Receiver and callback receipt',
    next: 'Protect the current setup',
  },
  baseline: {
    state: 'Human action required',
    title: 'Rollback point',
    detail: 'A real export from Work Louder Input must be saved before device-controlled work. The vendor cache is not relabeled as a backup.',
    evidence: 'Not created by this preview',
    next: 'Export an ordinary profile',
  },
  candidate: {
    state: 'Offline evidence',
    title: 'Validated candidate',
    detail: 'The managed artifact can be checked and hashed without opening Input. Validation does not import, activate, or synchronize it.',
    evidence: 'Private artifact digest',
    next: 'Complete the manual handoff',
  },
  physical: {
    state: 'Final acceptance gate',
    title: 'Fresh real-key proof',
    detail: 'Only a new Flight Check shows that the intended physical gesture reached the receiver. A green cache state cannot substitute for it.',
    evidence: 'Pending physical receipt',
    next: 'Press each highlighted control',
  },
}

const board = document.querySelector('#demo-board')
const routeButtons = [...document.querySelectorAll('[data-route]')]
const viewButtons = [...document.querySelectorAll('[data-view]:not(#demo-board)')]
const sceneButtons = [...document.querySelectorAll('[data-scene]:not(#demo-board)')]
const controls = [...document.querySelectorAll('[data-control]')]
const heroControls = [...document.querySelectorAll('[data-hero-target]')]
const agents = [...document.querySelectorAll('[data-slot]')]
const announcement = document.querySelector('#demo-announcement')
const proofButtons = [...document.querySelectorAll('[data-proof]')]
const commissionerAnnouncement = document.querySelector('#commissioner-announcement')
let route = 'ashlr'
let view = 'hardware'
let scene = 'build'
let selected = controls.find((control) => control.classList.contains('selected')) ?? controls[0]

function announce(message) {
  announcement.textContent = message
}

function renderSelection() {
  if (!selected) return
  controls.forEach((control) => {
    const isSelected = control === selected
    control.classList.toggle('selected', isSelected)
    control.setAttribute('aria-pressed', String(isSelected))
  })
  document.querySelector('#control-name').textContent = selected.dataset.control
  document.querySelector('#control-detail').textContent = route === 'native'
    ? 'Synthetic mapping hidden. Verify native behavior in Codex Settings.'
    : selected.dataset.detail
  document.querySelector('#control-route').textContent = routes[route].label
  document.querySelector('#control-authority').textContent = routes[route].authority
  document.querySelector('#control-surface').textContent = views[view].label
}

function chooseRoute(next) {
  if (!routes[next]) return
  route = next
  document.body.classList.toggle('native-demo', next === 'native')
  routeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.route === next)))
  document.querySelector('#route-summary').textContent = routes[next].summary
  renderSelection()
  announce(`${routes[next].label} synthetic route selected. No provider or hardware action occurred.`)
}

function chooseView(next) {
  if (!views[next]) return
  view = next
  board.dataset.view = next
  document.body.classList.toggle('deck-demo', next === 'deck')
  viewButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === next)))
  document.querySelector('#surface-name').textContent = views[next].heading
  renderSelection()
  announce(`${views[next].label} surface selected. The control map remains synthetic.`)
}

function chooseScene(next) {
  if (!scenes[next]) return
  scene = next
  board.dataset.scene = next
  sceneButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.scene === next)))
  agents.forEach((agent, index) => {
    const [state, label, provider, detail] = scenes[next][index]
    agent.classList.remove('error', 'working', 'complete', 'idle')
    if (state) agent.classList.add(state)
    agent.querySelector('b').textContent = label
    agent.querySelector('small').textContent = provider
    agent.dataset.detail = detail
    agent.setAttribute('aria-label', `Chat ${index + 1}: ${label}, ${provider}. ${detail}`)
  })
  renderSelection()
  const sceneButton = sceneButtons.find((button) => button.dataset.scene === next)
  announce(`${sceneButton?.textContent ?? next} synthetic workload loaded.`)
}

function chooseControl(control, input = 'Pointer') {
  if (!control) return
  selected = control
  renderSelection()
  const detail = route === 'native' ? 'native mapping remains provider-owned' : control.dataset.detail
  announce(`${input}: ${control.dataset.control}. ${detail}. No action was sent.`)
}

const keyboardControls = new Map([
  ['Digit1', agents[0]], ['Numpad1', agents[0]],
  ['Digit2', agents[1]], ['Numpad2', agents[1]],
  ['Digit3', agents[2]], ['Numpad3', agents[2]],
  ['Digit4', agents[3]], ['Numpad4', agents[3]],
  ['Digit5', agents[4]], ['Numpad5', agents[4]],
  ['Digit6', agents[5]], ['Numpad6', agents[5]],
  ['Digit7', document.querySelector('[data-control="Amplify"]')], ['Numpad7', document.querySelector('[data-control="Amplify"]')],
  ['Digit8', document.querySelector('[data-control="Verify"]')], ['Numpad8', document.querySelector('[data-control="Verify"]')],
  ['Digit9', document.querySelector('[data-control="Polish"]')], ['Numpad9', document.querySelector('[data-control="Polish"]')],
  ['Digit0', document.querySelector('[data-control="Advance"]')], ['Numpad0', document.querySelector('[data-control="Advance"]')],
  ['BracketLeft', document.querySelector('[data-control="Dial left"]')], ['NumpadSubtract', document.querySelector('[data-control="Dial left"]')],
  ['KeyD', document.querySelector('[data-control="Dial press"]')], ['NumpadEnter', document.querySelector('[data-control="Dial press"]')],
  ['BracketRight', document.querySelector('[data-control="Dial right"]')], ['NumpadAdd', document.querySelector('[data-control="Dial right"]')],
  ['ArrowUp', document.querySelector('[data-control="Planar up"]')],
  ['ArrowLeft', document.querySelector('[data-control="Planar left"]')],
  ['ArrowRight', document.querySelector('[data-control="Planar right"]')],
  ['ArrowDown', document.querySelector('[data-control="Planar down"]')],
  ['KeyL', document.querySelector('[data-control="Layer and connection touch"]')],
  ['KeyV', document.querySelector('[data-control="Voice"]')],
  ['KeyN', document.querySelector('[data-control="Copy next brief"]')],
  ['Space', document.querySelector('[data-control="Attention"]')], ['NumpadDecimal', document.querySelector('[data-control="Attention"]')],
])

routeButtons.forEach((button) => button.addEventListener('click', () => chooseRoute(button.dataset.route)))
viewButtons.forEach((button) => button.addEventListener('click', () => chooseView(button.dataset.view)))
sceneButtons.forEach((button) => button.addEventListener('click', () => chooseScene(button.dataset.scene)))
controls.forEach((control) => control.addEventListener('click', () => chooseControl(control)))
heroControls.forEach((heroControl) => heroControl.addEventListener('click', () => {
  const control = controls.find((candidate) => candidate.dataset.control === heroControl.dataset.heroTarget)
  if (!control) return
  chooseControl(control, 'Hero twin')
  document.querySelector('#demo').scrollIntoView()
  control.focus({ preventScroll: true })
}))
proofButtons.forEach((button) => button.addEventListener('click', () => {
  const proof = commissioningProof[button.dataset.proof]
  if (!proof) return
  proofButtons.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)))
  document.querySelector('#proof-state').textContent = proof.state
  document.querySelector('#proof-title').textContent = proof.title
  document.querySelector('#proof-detail').textContent = proof.detail
  document.querySelector('#proof-evidence').textContent = proof.evidence
  document.querySelector('#proof-next').textContent = proof.next
  commissionerAnnouncement.textContent = `${proof.title} selected. Synthetic evidence only; no local or hardware state was read.`
}))

document.addEventListener('keydown', (event) => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
  const interactiveTarget = event.target instanceof Element && event.target.closest('button, a')
  if (interactiveTarget && (event.code === 'Space' || event.code === 'Enter')) return
  const control = keyboardControls.get(event.code)
  if (!control) return
  event.preventDefault()
  chooseControl(control, 'Keyboard')
  control.focus({ preventScroll: true })
})

chooseScene(scene)
chooseView(view)
chooseRoute(route)
