const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, screen, shell } = require('electron')
const { spawn } = require('node:child_process')
const { createHash, randomUUID } = require('node:crypto')
const { existsSync, lstatSync, mkdirSync, renameSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { ACTION_SPECS, executeSpec } = require('./action-registry.cjs')
const { requireCompactAction, requireCompactWorkflowAction } = require('./compact-action-policy.cjs')
const { readCompactDeckBounds, readCompactDeckSettings, validateCompactDeckSettings, writeCompactDeckSettings } = require('./compact-deck-settings.cjs')
const { projectCompactActionResult, projectCompactSnapshot } = require('./compact-snapshot.cjs')
const { detectCreatorMicro2 } = require('./creator-micro-identity.cjs')
const { inspectCodexMicroLogs } = require('./codex-micro-diagnostics.cjs')
const { inspectChatGptInstallationAsync } = require('./chatgpt-installation.cjs')
const { createInputInstallationInspector } = require('./input-installation-async.cjs')
const { inspectInputProfile } = require('./input-profile-diagnostics.cjs')
const { inspectInputRuntime } = require('./input-runtime-diagnostics.cjs')
const { createCachedAsarHasher, inspectPackagedReceiverPeers, inspectReceiverRuntime, shouldRegisterShortcuts } = require('./receiver-runtime-diagnostics.cjs')
const { writeGeneratedProfile } = require('./input-profile-generator.cjs')
const { buildRecoveryChecklist, observeRecoveryArtifact, readRecoveryReceipt, recoveryChecklistText, recoveryReceiptPath, removeRecoveryReceipt, writeRecoveryReceipt } = require('./recovery-receipt.cjs')
const { acceptNativeAcceptance, evaluateNativeAcceptance, prepareNativeAcceptance, readNativeAcceptanceReceipt, removeNativeAcceptanceReceipt, stageNativeAcceptance, writeNativeAcceptanceReceipt } = require('./native-acceptance-receipt.cjs')
const { createNativeAcceptanceOperationCoordinator } = require('./native-acceptance-operations.cjs')
const { createNativeControlCheck, readNativeControlCheck, writeNativeControlCheck } = require('./native-control-check.cjs')
const { holdSatisfied } = require('./approval-guard.cjs')
const { evaluateFlightSignals } = require('./flight-receipt.cjs')
const { createFlightSession } = require('./flight-session.cjs')
const { createFlightOperationCoordinator, saveBoundFlightReceipt } = require('./flight-operations.cjs')
const { evaluateFlightGates } = require('./flight-gates.cjs')
const { inspectWorkspace } = require('./workspace-inspector.cjs')
const { appForProvider, collectMissionControl } = require('./mission-control.cjs')
const { configuredRendererUrl, trustedRendererUrl } = require('./renderer-trust.cjs')
const { appSettingsPath, readWorkspaceSettings, saveBoardRouteSettings, saveWorkspaceSettings, validBoardRoute } = require('./settings.cjs')
const { passiveRouteActionResult, routeAllowsConfiguredActions } = require('./action-route-policy.cjs')
const { createShortcutCallbackGuard, createShortcutOwnershipController } = require('./shortcut-ownership.cjs')
const { resolveTool } = require('./tool-resolver.cjs')

const PROFILE_IDS = new Set(['codex', 'claude', 'fleet', 'ship', 'emergency'])
const HOTKEYS = {
  agent1:'Control+Alt+Command+1',agent2:'Control+Alt+Command+2',agent3:'Control+Alt+Command+3',agent4:'Control+Alt+Command+4',agent5:'Control+Alt+Command+5',agent6:'Control+Alt+Command+6',
  cmd1:'Control+Alt+Command+A',cmd2:'Control+Alt+Command+B',cmd3:'Control+Alt+Command+C',cmd4:'Control+Alt+Command+D',cmd5:'Control+Alt+Command+E',cmd6:'Control+Alt+Command+F',cmd7:'Control+Alt+Command+G',
  joyUp:'Control+Alt+Command+Up',joyRight:'Control+Alt+Command+Right',joyDown:'Control+Alt+Command+Down',joyLeft:'Control+Alt+Command+Left',
  dialLeft:'Control+Alt+Command+Q',dialRight:'Control+Alt+Command+W',dialPress:'Control+Alt+Command+R',
}
let mainWindow; let rendererUrl; let compactWindow; let compactRendererUrl; let compactSnapshotTimer; let compactBoundsTimer; let currentProfile = 'codex'; let signalSequence = 0; let shortcutRegistrations = []
let missionCache = null; let missionCacheAt = 0; let missionInFlight = null
const approvals = new Map()
const flightSession = createFlightSession()
const flightOperations = createFlightOperationCoordinator(flightSession)
const cachedReceiverAsarHash = createCachedAsarHasher({ ttlMs: 30_000, maxEntries: 32 })
const inspectInputInstallationAsync = createInputInstallationInspector()
const shortcutCallbackGuard = createShortcutCallbackGuard()

function settingsPath() { return appSettingsPath(app.getPath('appData')) }
function compactSettingsPath() { return path.join(path.dirname(settingsPath()), 'compact-deck.json') }
function handoffPath() { return recoveryReceiptPath(settingsPath()) }
function readSettings() { return readWorkspaceSettings(settingsPath(), app.getPath('home')) }
function ensureSettingsDirectory() {
  const directory = path.dirname(settingsPath())
  if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 })
  const status = lstatSync(directory)
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('Agent Board settings directory is unsafe')
  return directory
}
function saveWorkspace(workspace) { ensureSettingsDirectory(); saveWorkspaceSettings(settingsPath(), workspace, app.getPath('home')) }
function saveBoardRoute(boardRoute) { ensureSettingsDirectory(); saveBoardRouteSettings(settingsPath(), boardRoute, app.getPath('home')) }

function compactWorkArea(bounds) {
  const display = bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay()
  return display.workArea
}

function readCompactSettings(bounds) {
  const targetBounds = bounds ?? readCompactDeckBounds(compactSettingsPath())
  return readCompactDeckSettings(compactSettingsPath(), compactWorkArea(targetBounds))
}

function publicChatGptDesktopStatus(inspection) {
  if (inspection?.status === 'installed') return { status: 'metadata_observed', version: inspection.version, build: inspection.build }
  if (inspection?.status === 'missing') return { status: 'missing', version: null, build: null }
  return { status: 'unavailable', version: null, build: null }
}

function projectNativeInitialization(inspection) {
  const parsed = inspection?.observedAt ? new Date(inspection.observedAt) : null
  return {
    status: inspection?.status ?? 'log_unavailable',
    observedAt: parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null,
    fresh: inspection?.fresh === true,
  }
}

async function collectNativeAcceptanceEvidence() {
  const settings = readSettings()
  const home = app.getPath('home')
  let passiveRouteVerified = false
  if (settings.boardRoute === 'codex_native') {
    const shortcutState = synchronizeShortcutOwnership(settings.boardRoute)
    passiveRouteVerified = shortcutState.released === true && shortcutsAreReleased()
  }
  const [board, chatgpt] = await Promise.all([
    boardConnected(),
    inspectChatGptInstallationAsync(),
  ])
  const nativeInitialization = projectNativeInitialization(inspectCodexMicroLogs(home))
  const currentContext = passiveRouteVerified && board && chatgpt.status === 'installed'
    ? {
        route: 'codex_native',
        device: { vidPid: board.vidPid },
        codex: { version: chatgpt.version, build: chatgpt.build },
      }
    : null
  return { currentContext, nativeInitialization }
}

const nativeAcceptanceOperations = createNativeAcceptanceOperationCoordinator({
  acceptReceipt: acceptNativeAcceptance,
  collectEvidence: collectNativeAcceptanceEvidence,
  evaluateReceipt: evaluateNativeAcceptance,
  prepareReceipt: prepareNativeAcceptance,
  readReceipt: () => readNativeAcceptanceReceipt(settingsPath()),
  removeReceipt: (expectedReceipt) => removeNativeAcceptanceReceipt(settingsPath(), expectedReceipt),
  stageReceipt: stageNativeAcceptance,
  writeReceipt: (receipt, expectedReceipt) => writeNativeAcceptanceReceipt(settingsPath(), receipt, expectedReceipt),
})

function createWindow() {
  rendererUrl = configuredRendererUrl(app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL, path.join(__dirname, '..', 'dist-renderer', 'index.html'))
  mainWindow = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1100, minHeight: 760,
    title: 'Ashlr Agent Board', titleBarStyle: 'hiddenInset', backgroundColor: '#d8d7d1',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!trustedRendererUrl(targetUrl, rendererUrl)) event.preventDefault()
  })
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  mainWindow.loadURL(rendererUrl)
  mainWindow.on('closed', () => {
    flightOperations.reset()
    approvals.clear()
    mainWindow = null
  })
}

function stopCompactSnapshotFeed() {
  if (compactSnapshotTimer) clearInterval(compactSnapshotTimer)
  compactSnapshotTimer = null
}

async function sendCompactSnapshot() {
  const target = compactWindow
  if (!target || target.isDestroyed() || !target.isVisible()) return
  const mission = await missionControl(true)
  if (target !== compactWindow || target.isDestroyed() || !target.isVisible()) return
  const preferences = readCompactSettings(target.getBounds())
  const snapshot = projectCompactSnapshot(mission, { showTitles: preferences.showTitles })
  target.webContents.send('compact:snapshot', snapshot)
}

function queueCompactSnapshot() {
  void sendCompactSnapshot().catch(() => {})
}

function startCompactSnapshotFeed() {
  stopCompactSnapshotFeed()
  queueCompactSnapshot()
  compactSnapshotTimer = setInterval(queueCompactSnapshot, 10_000)
}

function persistCompactBoundsNow() {
  if (!compactWindow || compactWindow.isDestroyed()) return
  try {
    const bounds = compactWindow.getBounds()
    const current = readCompactSettings(bounds)
    writeCompactDeckSettings(compactSettingsPath(), { ...current, bounds }, compactWorkArea(bounds))
  } catch {}
}

function persistCompactBounds() {
  if (!compactWindow || compactWindow.isDestroyed()) return
  if (compactBoundsTimer) clearTimeout(compactBoundsTimer)
  compactBoundsTimer = setTimeout(() => {
    compactBoundsTimer = null
    persistCompactBoundsNow()
  }, 250)
}

function createCompactWindow() {
  if (compactWindow && !compactWindow.isDestroyed()) return compactWindow
  const preferences = readCompactSettings()
  compactRendererUrl = app.isPackaged
    ? configuredRendererUrl(undefined, path.join(__dirname, '..', 'dist-renderer', 'compact.html'))
    : new URL('compact.html', rendererUrl).href
  compactWindow = new BrowserWindow({
    ...preferences.bounds,
    minWidth: 340,
    minHeight: 240,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: preferences.alwaysOnTop,
    skipTaskbar: true,
    title: 'Ashlr Compact Deck',
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'compact-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'ashlr-compact-deck' },
  })
  compactWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  compactWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!trustedRendererUrl(targetUrl, compactRendererUrl)) event.preventDefault()
  })
  compactWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())
  compactWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  compactWindow.once('ready-to-show', () => {
    compactWindow?.show()
    compactWindow?.focus()
  })
  compactWindow.on('show', startCompactSnapshotFeed)
  compactWindow.on('hide', stopCompactSnapshotFeed)
  compactWindow.on('move', persistCompactBounds)
  compactWindow.on('resize', persistCompactBounds)
  compactWindow.on('close', persistCompactBoundsNow)
  compactWindow.on('closed', () => {
    stopCompactSnapshotFeed()
    if (compactBoundsTimer) clearTimeout(compactBoundsTimer)
    compactBoundsTimer = null
    compactWindow = null
  })
  const loadingWindow = compactWindow
  void loadingWindow.loadURL(compactRendererUrl).catch(() => {
    if (compactWindow === loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.destroy()
  })
  return compactWindow
}

function showCompactDeck() {
  const window = createCompactWindow()
  if (window.webContents.isLoadingMainFrame()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function trustedIpc(handler) {
  return (event, ...args) => {
    const frame = event.senderFrame
    if (!mainWindow || event.sender !== mainWindow.webContents || !frame || frame !== event.sender.mainFrame || !trustedRendererUrl(frame.url, rendererUrl)) {
      throw new Error('Rejected IPC from an untrusted renderer')
    }
    return handler(event, ...args)
  }
}

function trustedCompactIpc(handler) {
  return (event, ...args) => {
    const frame = event.senderFrame
    if (!compactWindow || event.sender !== compactWindow.webContents || !frame || frame !== event.sender.mainFrame || !trustedRendererUrl(frame.url, compactRendererUrl)) {
      throw new Error('Rejected IPC from an untrusted Compact Deck renderer')
    }
    return handler(event, ...args)
  }
}

function registerShortcuts() {
  shortcutCallbackGuard.invalidate()
  const registrations = []
  for (const [control, accelerator] of Object.entries(HOTKEYS)) {
    const registered = globalShortcut.register(accelerator, shortcutCallbackGuard.bind(() => {
      const envelope = {
      schemaVersion: 1,
      sequence: ++signalSequence,
      signalId: control,
      source: 'global-shortcut',
      accelerator,
      receivedAt: new Date().toISOString(),
      monotonicNs: process.hrtime.bigint().toString(),
      }
      flightSession.record(envelope)
      mainWindow?.webContents.send('board:control', envelope)
    }))
    registrations.push({ signalId: control, accelerator, registered })
  }
  return registrations
}

function inspectCurrentReceiverRuntime() {
  if (!app.isPackaged) {
    const peers = inspectPackagedReceiverPeers()
    if (peers.status === 'none') {
      return { status: 'exclusive', instanceCount: 1, distinctBuildCount: 1, currentAsarSha256: null, candidateAsarSha256: null, candidateMatchesCurrent: null }
    }
    return { status: 'unavailable', instanceCount: peers.status === 'present' ? peers.instanceCount + 1 : 0, distinctBuildCount: 0, currentAsarSha256: null, candidateAsarSha256: null, candidateMatchesCurrent: null }
  }
  return inspectReceiverRuntime({ currentPid: process.pid, hashAsar: cachedReceiverAsarHash })
}

function receiverOwnsShortcuts(runtime) {
  return app.isPackaged ? shouldRegisterShortcuts(runtime) : runtime?.status === 'exclusive'
}

function registrationsAreActive(registrations) {
  if (registrations.length !== Object.keys(HOTKEYS).length) return false
  try {
    return registrations.every(({ accelerator, registered }) => registered === true && globalShortcut.isRegistered(accelerator))
  } catch {
    return false
  }
}

function shortcutsAreReleased() {
  try {
    return Object.values(HOTKEYS).every((accelerator) => !globalShortcut.isRegistered(accelerator))
  } catch {
    return false
  }
}

const shortcutOwnership = createShortcutOwnershipController({
  clearApprovals: () => approvals.clear(),
  expectedRegistrationCount: Object.keys(HOTKEYS).length,
  inspectRuntime: inspectCurrentReceiverRuntime,
  registerShortcuts,
  registrationsAreActive,
  resetFlight: () => flightOperations.reset(),
  runtimeOwnsShortcuts: receiverOwnsShortcuts,
  shortcutsAreReleased,
  unregisterAll: () => globalShortcut.unregisterAll(),
})

function synchronizeShortcutOwnership(boardRoute) {
  if (boardRoute !== 'ashlr_layer') shortcutCallbackGuard.invalidate()
  try {
    const state = shortcutOwnership.synchronize(boardRoute)
    shortcutRegistrations = state.registrations
    if (boardRoute === 'ashlr_layer' && registrationsAreActive(shortcutRegistrations)) shortcutCallbackGuard.enable()
    else shortcutCallbackGuard.invalidate()
    return state
  } catch (error) {
    shortcutRegistrations = []
    shortcutCallbackGuard.invalidate()
    throw error
  }
}

async function commandExists(executable, args = ['--version']) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { stdio: 'ignore' })
    child.once('error', () => resolve(false)); child.once('exit', (code) => resolve(code === 0))
    setTimeout(() => { child.kill(); resolve(false) }, 2500)
  })
}
async function boardConnected() {
  return new Promise((resolve) => {
    const child = spawn('/usr/sbin/ioreg', ['-p', 'IOUSB', '-n', 'Creator Micro 2', '-r', '-l'])
    let output = ''; let settled = false
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value) } }
    child.stdout.on('data', (chunk) => {
      if (Buffer.byteLength(output, 'utf8') + chunk.length > 512 * 1024) {
        child.kill('SIGTERM'); finish(null); return
      }
      output += chunk
    })
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(null) }, 3_000)
    child.on('error', () => finish(null)); child.on('close', () => finish(detectCreatorMicro2(output)))
  })
}

function inspectCurrentInputInstallation(force = false) {
  return inspectInputInstallationAsync({ home: app.getPath('home'), force })
}

async function verifyFlightGates(variant, forceInput = true) {
  const home = app.getPath('home')
  const inputInstallation = await inspectCurrentInputInstallation(forceInput)
  const board = await boardConnected()
  // Admission evidence is intentionally sampled after both bounded hardware
  // probes, so a route mutation or newly competing receiver cannot be admitted
  // from state captured while either probe was still pending.
  const settings = readSettings()
  const currentReceiverRuntime = synchronizeShortcutOwnership(settings.boardRoute).runtime
  return evaluateFlightGates({
    variant,
    boardRoute: settings.boardRoute,
    usbDetected: Boolean(board),
    inputInstallation,
    inputProfile: inspectInputProfile(home, board?.storageId),
    receiverRuntime: currentReceiverRuntime,
    shortcutRegistrations,
    expectedSignals: Object.keys(HOTKEYS),
  })
}

async function missionControl(force = false) {
  if (!force && missionCache && Date.now() - missionCacheAt < 8_000) return missionCache
  if (missionInFlight) return missionInFlight
  missionInFlight = collectMissionControl(app.getPath('home')).then((snapshot) => {
    missionCache = snapshot
    missionCacheAt = Date.now()
    return snapshot
  }).finally(() => { missionInFlight = null })
  return missionInFlight
}

function openFixedApp(name) {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/open', ['-a', name], { stdio: 'ignore' })
    let settled = false
    const finish = (ok) => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok) } }
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(false) }, 4_000)
    child.once('error', () => finish(false))
    child.once('close', (code) => finish(code === 0))
  })
}

async function focusAgentFromSnapshot(slot, snapshot) {
  if (flightSession.isActive()) return { ok:false,title:'Flight Check interlock',message:'Agent focus is disabled until hardware acceptance ends.',timestamp:new Date().toISOString() }
  if (!Number.isInteger(slot) || slot < 1 || slot > 6) return { ok:false,title:'Slot unavailable',message:'Choose one of the six agent slots.',timestamp:new Date().toISOString() }
  const agent = snapshot.agents.find((candidate) => candidate.slot === slot)
  if (!agent?.provider || agent.state === 'off') return { ok:false,title:`Agent ${slot} is empty`,message:'This slot has no live provider receipt yet. Start or resume a session, then try again.',timestamp:new Date().toISOString() }
  const appName = appForProvider(agent.provider)
  if (!appName) return { ok:false,title:'Focus unavailable',message:'This session does not advertise a safe local focus target.',timestamp:new Date().toISOString() }
  const opened = await openFixedApp(appName)
  if (!opened) return { ok:false,title:`Could not open ${appName}`,message:'The provider app was not available. No fallback terminal or command was launched.',timestamp:new Date().toISOString() }
  const message = agent.provider === 'claude'
    ? 'cmux is foregrounded. Agent Board cannot select or verify an exact pane, so no terminal input was sent.'
    : 'Codex Desktop is foregrounded. Agent Board cannot select or verify an exact task, so no prompt or approval was submitted.'
  return { ok:true,title:`Opened ${appName}`,message,timestamp:new Date().toISOString() }
}

async function focusAgentSlotResult(slot) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 6) return focusAgentFromSnapshot(slot, { agents: [] })
  return focusAgentFromSnapshot(slot, await missionControl(true))
}

async function focusHighestPriorityAgentResult() {
  if (flightSession.isActive()) return focusAgentFromSnapshot(null, { agents: [] })
  const mission = await missionControl(true)
  const slot = projectCompactSnapshot(mission).attentionSlot
  if (slot === null) return { ok:false,title:'No agent needs attention',message:'No occupied agent slot is available to focus.',timestamp:new Date().toISOString() }
  return focusAgentFromSnapshot(slot, mission)
}

ipcMain.handle('board:getStatus', trustedIpc(async () => {
  const settings = readSettings()
  const home = app.getPath('home')
  const codexExecutable = resolveTool('codex', { home })
  const claudeExecutable = resolveTool('claude', { home })
  const ashlrExecutable = resolveTool('ashlr', { home })
  // Start the longest bounded probe before the synchronous receiver check so
  // the renderer's outer deadline covers the complete status operation.
  const inputInstallationPending = inspectCurrentInputInstallation()
  const currentReceiverRuntime = synchronizeShortcutOwnership(settings.boardRoute).runtime
  const [inputInstallation, board, codex, claude, ashlr, workspaceSnapshot, chatgptInspection] = await Promise.all([
    inputInstallationPending, boardConnected(), codexExecutable ? commandExists(codexExecutable) : false,
    claudeExecutable ? commandExists(claudeExecutable) : false,
    ashlrExecutable ? commandExists(ashlrExecutable) : false,
    inspectWorkspace(settings.workspace),
    inspectChatGptInstallationAsync(),
  ])
  return {
    boardConnected: Boolean(board),
    boardVidPid: board?.vidPid ?? null,
    inputInstalled: inputInstallation.status !== 'missing',
    inputInstallation,
    inputProfile: inspectInputProfile(home, board?.storageId),
    inputRuntime: inspectInputRuntime(home),
    inputMonitoring: 'unverified',
    codex,
    chatgptDesktop: publicChatGptDesktopStatus(chatgptInspection),
    nativeCodexMicro: inspectCodexMicroLogs(home),
    claude,
    ashlr,
    boardRoute: settings.boardRoute,
    workspace: settings.workspace,
    shortcutCount: shortcutRegistrations.filter((registration) => registration.registered).length,
    shortcutRegistrations,
    workspaceSnapshot,
    receiverIdentity: {
      appVersion: app.getVersion(),
      packaged: app.isPackaged,
      appAsarSha256: currentReceiverRuntime.currentAsarSha256,
    },
    receiverRuntime: currentReceiverRuntime,
  }
}))
ipcMain.handle('board:getMissionControl', trustedIpc(() => missionControl()))
ipcMain.handle('board:getRecoveryGuide', trustedIpc(() => {
  const handoff = readRecoveryReceipt(handoffPath())
  const artifact = observeRecoveryArtifact(handoff)
  return { handoff, artifact, steps: buildRecoveryChecklist(handoff, artifact) }
}))
ipcMain.handle('board:getNativeAcceptance', trustedIpc(() => nativeAcceptanceOperations.get()))
ipcMain.handle('board:prepareNativeAcceptance', trustedIpc(() => nativeAcceptanceOperations.prepare()))
ipcMain.handle('board:acceptNativeAcceptance', trustedIpc((_event, attestations) => nativeAcceptanceOperations.accept(attestations)))
ipcMain.handle('board:clearNativeAcceptance', trustedIpc(() => nativeAcceptanceOperations.clear()))
ipcMain.handle('board:getNativeControlCheck', trustedIpc(async () => {
  const { currentContext } = await collectNativeAcceptanceEvidence()
  if (!currentContext) return null
  return readNativeControlCheck(settingsPath(), { currentContext })
}))
ipcMain.handle('board:saveNativeControlCheck', trustedIpc(async (_event, report) => {
  const { currentContext } = await collectNativeAcceptanceEvidence()
  if (!currentContext) throw new Error('Native control check requires the current passive Codex Native context')
  const now = new Date()
  const receipt = createNativeControlCheck({
    context: currentContext,
    settings: report?.settings,
    outcomes: report?.outcomes,
    reportedAt: now.toISOString(),
  }, { now })
  return writeNativeControlCheck(settingsPath(), receipt, { currentContext, now })
}))
ipcMain.handle('board:setBoardRoute', trustedIpc((_event, boardRoute) => {
  if (!validBoardRoute(boardRoute)) throw new TypeError('Unsupported board route declaration')
  return nativeAcceptanceOperations.mutateContext(() => {
    if (boardRoute !== 'ashlr_layer') {
      const shortcutState = synchronizeShortcutOwnership(boardRoute)
      if (shortcutState.released !== true) throw new Error('Shortcut release could not be verified')
    }
    saveBoardRoute(boardRoute)
    if (boardRoute === 'ashlr_layer') synchronizeShortcutOwnership(boardRoute)
    return boardRoute
  })
}))
ipcMain.handle('board:focusAgentSlot', trustedIpc((_event, slot) => focusAgentSlotResult(slot)))
ipcMain.handle('board:showCompactDeck', trustedIpc(() => {
  showCompactDeck()
  return { ok: true }
}))

ipcMain.handle('compact:getSnapshot', trustedCompactIpc(async () => {
  const mission = await missionControl(true)
  const preferences = readCompactSettings(compactWindow?.getBounds())
  return projectCompactSnapshot(mission, { showTitles: preferences.showTitles })
}))
ipcMain.handle('compact:focusAgentSlot', trustedCompactIpc(async (_event, slot) => projectCompactActionResult(await focusAgentSlotResult(slot))))
ipcMain.handle('compact:focusAttention', trustedCompactIpc(async () => {
  requireCompactWorkflowAction('stage_attention', ACTION_SPECS)
  await executeSpec('stage_attention', readSettings().workspace, { clipboard, home: app.getPath('home') })
  return projectCompactActionResult(await focusHighestPriorityAgentResult())
}))
ipcMain.handle('compact:runSkillAction', trustedCompactIpc(async (_event, actionId) => {
  requireCompactAction(actionId, ACTION_SPECS)
  return projectCompactActionResult(await executeSpec(actionId, readSettings().workspace, { clipboard, home: app.getPath('home') }))
}))
ipcMain.handle('compact:runWorkflowAction', trustedCompactIpc(async (_event, actionId) => {
  requireCompactWorkflowAction(actionId, ACTION_SPECS)
  return projectCompactActionResult(await executeSpec(actionId, readSettings().workspace, { clipboard, home: app.getPath('home') }))
}))
ipcMain.handle('compact:getPreferences', trustedCompactIpc(() => readCompactSettings(compactWindow?.getBounds())))
ipcMain.handle('compact:savePreferences', trustedCompactIpc((_event, candidate) => {
  const bounds = compactWindow?.getBounds()
  const workArea = compactWorkArea(bounds)
  const previous = readCompactSettings(bounds)
  const next = validateCompactDeckSettings({ ...candidate, bounds }, workArea)
  try {
    compactWindow?.setAlwaysOnTop(next.alwaysOnTop)
    app.setLoginItemSettings({ openAtLogin: next.openAtLaunch, args: ['--compact-deck'] })
    const saved = writeCompactDeckSettings(compactSettingsPath(), next, workArea)
    queueCompactSnapshot()
    return saved
  } catch (error) {
    try { compactWindow?.setAlwaysOnTop(previous.alwaysOnTop) } catch {}
    try { app.setLoginItemSettings({ openAtLogin: previous.openAtLaunch, args: ['--compact-deck'] }) } catch {}
    throw error
  }
}))
ipcMain.handle('compact:hide', trustedCompactIpc(() => {
  compactWindow?.hide()
  return { ok: true }
}))
ipcMain.handle('board:setProfile', trustedIpc((_event, profile) => { if (PROFILE_IDS.has(profile)) currentProfile = profile; return currentProfile }))
ipcMain.handle('board:setFlightCheck', trustedIpc(async (_event, active, variant) => {
  const state = active === true
    ? await flightOperations.start(() => verifyFlightGates(variant, true))
    : flightOperations.stop()
  if (state.acknowledged && state.active) approvals.clear()
  return state
}))
ipcMain.handle('board:restartFlightCheck', trustedIpc(async (_event, variant) => {
  const state = await flightOperations.restart(() => verifyFlightGates(variant, true))
  if (state.acknowledged && state.active) approvals.clear()
  return state
}))
ipcMain.handle('board:chooseWorkspace', trustedIpc(async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], title: 'Choose the Agent Board working directory' })
  if (result.canceled || !result.filePaths[0]) return null
  saveWorkspace(result.filePaths[0]); return result.filePaths[0]
}))
ipcMain.handle('board:createCorrectedInputProfile', trustedIpc(async () => {
  if (flightSession.isActive()) {
    return { status: 'failed', message: 'End Flight Check before creating a repair artifact. No file or device setting changed.' }
  }
  const source = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an ordinary Creator Micro 2 profile export',
    properties: ['openFile'],
    filters: [{ name: 'Work Louder Input profile', extensions: ['json'] }],
  })
  if (source.canceled || !source.filePaths[0]) return { status: 'canceled', message: 'No profile selected. Nothing changed.' }

  const suggestedName = `Ashlr-Agent-Board-corrected-${new Date().toISOString().slice(0, 10)}.json`
  const destination = await dialog.showSaveDialog(mainWindow, {
    title: 'Save the corrected Input profile',
    defaultPath: path.join(app.getPath('documents'), suggestedName),
    filters: [{ name: 'Work Louder Input profile', extensions: ['json'] }],
  })
  if (destination.canceled || !destination.filePath) return { status: 'canceled', message: 'No destination selected. Nothing changed.' }

  try {
    const artifact = writeGeneratedProfile(source.filePaths[0], destination.filePath, 'daily')
    let handoffPersisted = true
    try {
      writeRecoveryReceipt(handoffPath(), {
        artifactPath: artifact.outputPath,
        sha256: artifact.sha256,
        createdAt: new Date().toISOString(),
      })
    } catch {
      handoffPersisted = false
    }
    return {
      status: 'saved',
      filePath: artifact.outputPath,
      sha256: artifact.sha256,
      handoffPersisted,
      ...(!handoffPersisted ? { recoverySteps: buildRecoveryChecklist(null) } : {}),
      message: handoffPersisted
        ? 'Corrected profile and private recovery handoff saved. Input and the Creator Micro were not modified.'
        : 'Corrected profile saved, but the private recovery handoff could not be saved. Keep this window open or record the artifact path before quitting. Input and the Creator Micro were not modified.',
    }
  } catch (error) {
    const reason = error?.code === 'EEXIST'
      ? 'Choose a new filename; repair generation never overwrites an existing file.'
      : error instanceof SyntaxError
        ? 'The selected file is not valid JSON.'
        : typeof error?.message === 'string' && /protected KV_OAI/.test(error.message)
          ? 'The selected export contains protected Codex mappings. Export an ordinary Creator Micro 2 profile instead.'
          : typeof error?.message === 'string' && /US Creator Micro V2|missing its base layout|no larger than/.test(error.message)
            ? error.message
            : 'The corrected profile could not be created from that export.'
    return { status: 'failed', message: `${reason} No existing file, Input setting, or device setting changed.` }
  }
}))
ipcMain.handle('board:revealRecoveryArtifact', trustedIpc(() => {
  const handoff = readRecoveryReceipt(handoffPath())
  const artifact = observeRecoveryArtifact(handoff)
  if (!handoff || !artifact.available) {
    return { ok: false, message: `The saved recovery artifact is ${artifact.status.replaceAll('_', ' ')}. Locate and verify it or create a new corrected artifact; no file was opened.` }
  }
  shell.showItemInFolder(handoff.artifactPath)
  return { ok: true, message: 'The corrected profile is selected in Finder.' }
}))
ipcMain.handle('board:copyRecoveryChecklist', trustedIpc(() => {
  const handoff = readRecoveryReceipt(handoffPath())
  const artifact = observeRecoveryArtifact(handoff)
  clipboard.writeText(recoveryChecklistText(handoff, artifact))
  return { ok: true, message: handoff ? 'Recovery checklist, artifact filename, and checksum copied without the full local path.' : 'Recovery checklist copied.' }
}))
ipcMain.handle('board:dismissRecoveryHandoff', trustedIpc(() => {
  const removed = removeRecoveryReceipt(handoffPath())
  return removed
    ? { ok: true, message: 'The saved startup reminder was dismissed. The profile artifact and Input configuration were not changed.' }
    : { ok: false, message: 'The saved reminder could not be dismissed safely. No artifact or Input setting changed.' }
}))
ipcMain.handle('board:openInputMonitoringSettings', trustedIpc(async () => {
  if (process.platform !== 'darwin') return { ok: false, message: 'Open your operating system’s input-monitoring permission settings manually.' }
  try {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent')
    return { ok: true, message: 'Input Monitoring settings opened. Verify the exact receiver shown in Setup manually.' }
  } catch {
    return { ok: false, message: 'Input Monitoring settings could not be opened. Open System Settings → Privacy & Security → Input Monitoring manually.' }
  }
}))
ipcMain.handle('board:saveFlightReceipt', trustedIpc(async (_event, receipt) => {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null
  if (Buffer.byteLength(JSON.stringify(receipt), 'utf8') > 200_000) return null
  if (!Array.isArray(receipt.receivedSignals) || !Array.isArray(receipt.missingSignals) || !Array.isArray(receipt.events)) return null
  if (receipt.events.length > 100 || receipt.receivedSignals.length > 20 || receipt.missingSignals.length > 20) return null
  const allowedSignals = new Set(Object.keys(HOTKEYS))
  if (![...receipt.receivedSignals, ...receipt.missingSignals].every((signal) => allowedSignals.has(signal))) return null
  if (!receipt.events.every((item) => item && allowedSignals.has(item.signal) && typeof item.receivedAt === 'string')) return null
  const variant = receipt.profileKind === 'diagnostic' ? 'diagnostic' : 'daily'
  const suggestedName = `ashlr-agent-board-flight-check-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  return saveBoundFlightReceipt({
    coordinator: flightOperations,
    verifyGates: () => verifyFlightGates(variant, true),
    chooseDestination: async () => {
      const result = await dialog.showSaveDialog(mainWindow, { title: 'Save Flight Check receipt', defaultPath: path.join(app.getPath('documents'), suggestedName), filters: [{ name: 'JSON receipt', extensions: ['json'] }] })
      return result.canceled || !result.filePath ? null : result.filePath
    },
    buildDocument: ({ flight, admission }) => {
      const evaluation = evaluateFlightSignals(variant, flight.rawEvents)
      const usbDetected = admission.evidence.usbDetected
      const registeredCount = shortcutRegistrations.filter((item) => item.registered).length
      const status = evaluation.status === 'passed' && admission.ready ? 'passed' : evaluation.status === 'incomplete' ? 'incomplete' : 'failed'
      const payload = {
        schema: 'ai.ashlr.agent-board.flight-check/v2',
        receiptId: randomUUID(),
        profileKind: variant,
        status,
        startedAt: flight.startedAt,
        exportedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        device: { expectedName: 'Creator Micro 2', usbDetected },
        configuration: { registrations: shortcutRegistrations, registeredCount, admission: admission.evidence, gates: admission.gates },
        evaluation,
        rawEvents: flight.rawEvents,
        disclaimer: 'Operator-guided global-shortcut receipt; not a cryptographic device-identity attestation.',
      }
      const canonical = JSON.stringify(payload)
      return { ...payload, sha256: createHash('sha256').update(canonical).digest('hex') }
    },
    writeDocument: (destination, document) => {
      const temporaryPath = `${destination}.${randomUUID()}.tmp`
      writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      renameSync(temporaryPath, destination)
      return destination
    },
  })
}))
ipcMain.handle('board:requestAction', trustedIpc(async (_event, actionId) => {
  const settings = readSettings()
  if (!routeAllowsConfiguredActions(settings)) {
    approvals.clear()
    return passiveRouteActionResult()
  }
  if (flightSession.isActive()) return { ok:false,title:'Flight Check interlock',message:'Mapped actions are disabled until hardware acceptance ends.',timestamp:new Date().toISOString() }
  const spec = ACTION_SPECS[actionId]
  if (!spec) return { ok:false,title:'Action unavailable',message:'This action is not allowlisted.',timestamp:new Date().toISOString() }
  if (spec.safety !== 'safe') {
    const issuedAt = Date.now()
    const token = randomUUID()
    approvals.set(token, {
      actionId,
      workspace: settings.workspace,
      webContentsId: _event.sender.id,
      boardRoute: settings.boardRoute,
      safety: spec.safety,
      holdStartedAt: null,
      expires: issuedAt + 30_000,
    })
    return { ok:true,title:'Confirmation required',message:'Review the consequence before continuing.',needsConfirmation:true,token,timestamp:new Date().toISOString() }
  }
  return executeSpec(actionId, settings.workspace, { clipboard, home: app.getPath('home') })
}))
ipcMain.handle('board:beginHold', trustedIpc((_event, actionId, token) => {
  const settings = readSettings()
  if (!routeAllowsConfiguredActions(settings)) {
    approvals.delete(token)
    return false
  }
  const approval = approvals.get(token)
  if (!approval || approval.actionId !== actionId || approval.safety !== 'hold' || approval.webContentsId !== _event.sender.id || approval.boardRoute !== settings.boardRoute || approval.expires < Date.now() || flightSession.isActive()) return false
  approval.holdStartedAt = Date.now()
  return true
}))
ipcMain.handle('board:cancelHold', trustedIpc((_event, actionId, token) => {
  const settings = readSettings()
  if (!routeAllowsConfiguredActions(settings)) {
    approvals.delete(token)
    return false
  }
  const approval = approvals.get(token)
  if (!approval || approval.actionId !== actionId || approval.webContentsId !== _event.sender.id || approval.boardRoute !== settings.boardRoute) return false
  approval.holdStartedAt = null
  return true
}))
ipcMain.handle('board:confirmAction', trustedIpc(async (_event, actionId, token) => {
  const approval = approvals.get(token); approvals.delete(token)
  const settings = readSettings()
  if (!routeAllowsConfiguredActions(settings)) return passiveRouteActionResult()
  if (flightSession.isActive()) return { ok:false,title:'Flight Check interlock',message:'The pending approval was canceled when hardware acceptance began.',timestamp:new Date().toISOString() }
  if (!approval || approval.actionId !== actionId || approval.expires < Date.now()) return { ok:false,title:'Approval expired',message:'Select the action again to create a fresh authorization.',timestamp:new Date().toISOString() }
  if (approval.webContentsId !== _event.sender.id) return { ok:false,title:'Approval rejected',message:'The confirmation came from a different window.',timestamp:new Date().toISOString() }
  if (approval.boardRoute !== settings.boardRoute) return { ok:false,title:'Board route changed',message:'Review the action again after selecting the Ashlr Layer route.',timestamp:new Date().toISOString() }
  if (approval.workspace !== settings.workspace) return { ok:false,title:'Workspace changed',message:'Review the action again for the newly selected working directory.',timestamp:new Date().toISOString() }
  if (approval.safety === 'hold' && !holdSatisfied(approval)) return { ok:false,title:'Hold incomplete',message:'Keep holding continuously until the authorization indicator completes.',timestamp:new Date().toISOString() }
  return executeSpec(actionId, approval.workspace, { clipboard, home: app.getPath('home') })
}))

app.setName('Ashlr Agent Board')
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (commandLine.includes('--compact-deck')) { showCompactDeck(); return }
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.whenReady().then(() => {
    ensureSettingsDirectory()
    createWindow()
    synchronizeShortcutOwnership(readSettings().boardRoute)
    if (process.argv.includes('--compact-deck') || readCompactSettings().openAtLaunch) showCompactDeck()
  }).catch(() => app.quit())
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  app.on('will-quit', () => {
    persistCompactBoundsNow()
    stopCompactSnapshotFeed()
    if (compactBoundsTimer) clearTimeout(compactBoundsTimer)
    compactBoundsTimer = null
    flightOperations.reset()
    globalShortcut.unregisterAll()
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
