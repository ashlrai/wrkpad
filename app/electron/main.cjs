const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const { createHash, randomUUID } = require('node:crypto')
const { existsSync, renameSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { ACTION_SPECS, executeSpec } = require('./action-registry.cjs')
const { detectCreatorMicro2 } = require('./creator-micro-identity.cjs')
const { inspectCodexMicroLogs } = require('./codex-micro-diagnostics.cjs')
const { inspectInputProfile } = require('./input-profile-diagnostics.cjs')
const { writeGeneratedProfile } = require('./input-profile-generator.cjs')
const { holdSatisfied } = require('./approval-guard.cjs')
const { evaluateFlightSignals } = require('./flight-receipt.cjs')
const { createFlightSession } = require('./flight-session.cjs')
const { inspectWorkspace } = require('./workspace-inspector.cjs')
const { appForProvider, collectMissionControl } = require('./mission-control.cjs')
const { configuredRendererUrl, trustedRendererUrl } = require('./renderer-trust.cjs')
const { readWorkspaceSettings, saveBoardRouteSettings, saveWorkspaceSettings, validBoardRoute } = require('./settings.cjs')
const { resolveTool } = require('./tool-resolver.cjs')

const PROFILE_IDS = new Set(['codex', 'claude', 'fleet', 'ship', 'emergency'])
const HOTKEYS = {
  agent1:'Control+Alt+Command+1',agent2:'Control+Alt+Command+2',agent3:'Control+Alt+Command+3',agent4:'Control+Alt+Command+4',agent5:'Control+Alt+Command+5',agent6:'Control+Alt+Command+6',
  cmd1:'Control+Alt+Command+A',cmd2:'Control+Alt+Command+B',cmd3:'Control+Alt+Command+C',cmd4:'Control+Alt+Command+D',cmd5:'Control+Alt+Command+E',cmd6:'Control+Alt+Command+F',cmd7:'Control+Alt+Command+G',
  joyUp:'Control+Alt+Command+Up',joyRight:'Control+Alt+Command+Right',joyDown:'Control+Alt+Command+Down',joyLeft:'Control+Alt+Command+Left',
  dialLeft:'Control+Alt+Command+Q',dialRight:'Control+Alt+Command+W',dialPress:'Control+Alt+Command+R',
}
let mainWindow; let rendererUrl; let currentProfile = 'codex'; let signalSequence = 0; let shortcutRegistrations = []
let missionCache = null; let missionCacheAt = 0; let missionInFlight = null
const approvals = new Map()
const flightSession = createFlightSession()

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json') }
function readSettings() { return readWorkspaceSettings(settingsPath(), app.getPath('home')) }
function saveWorkspace(workspace) { saveWorkspaceSettings(settingsPath(), workspace, app.getPath('home')) }
function saveBoardRoute(boardRoute) { saveBoardRouteSettings(settingsPath(), boardRoute, app.getPath('home')) }

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
    flightSession.reset()
    approvals.clear()
    mainWindow = null
  })
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

function registerShortcuts() {
  shortcutRegistrations = []
  for (const [control, accelerator] of Object.entries(HOTKEYS)) {
    const registered = globalShortcut.register(accelerator, () => {
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
    })
    shortcutRegistrations.push({ signalId: control, accelerator, registered })
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
    let output = ''; child.stdout.on('data', (chunk) => { output += chunk })
    child.on('error', () => resolve(null)); child.on('close', () => resolve(detectCreatorMicro2(output)))
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

ipcMain.handle('board:getStatus', trustedIpc(async () => {
  const settings = readSettings()
  const home = app.getPath('home')
  const codexExecutable = resolveTool('codex', { home })
  const claudeExecutable = resolveTool('claude', { home })
  const ashlrExecutable = resolveTool('ashlr', { home })
  const [board, codex, claude, ashlr, workspaceSnapshot] = await Promise.all([
    boardConnected(), codexExecutable ? commandExists(codexExecutable) : false,
    claudeExecutable ? commandExists(claudeExecutable) : false,
    ashlrExecutable ? commandExists(ashlrExecutable) : false,
    inspectWorkspace(settings.workspace),
  ])
  return {
    boardConnected: Boolean(board),
    inputInstalled: existsSync('/Applications/Input.app'),
    inputProfile: inspectInputProfile(home, board?.storageId),
    inputMonitoring: 'unverified',
    codex,
    nativeCodexMicro: inspectCodexMicroLogs(home),
    claude,
    ashlr,
    boardRoute: settings.boardRoute,
    workspace: settings.workspace,
    shortcutCount: shortcutRegistrations.filter((registration) => registration.registered).length,
    shortcutRegistrations,
    workspaceSnapshot,
  }
}))
ipcMain.handle('board:getMissionControl', trustedIpc(() => missionControl()))
ipcMain.handle('board:setBoardRoute', trustedIpc((_event, boardRoute) => {
  if (!validBoardRoute(boardRoute)) throw new TypeError('Unsupported board route declaration')
  saveBoardRoute(boardRoute)
  return boardRoute
}))
ipcMain.handle('board:focusAgentSlot', trustedIpc(async (_event, slot) => {
  if (flightSession.isActive()) return { ok:false,title:'Flight Check interlock',message:'Agent focus is disabled until hardware acceptance ends.',timestamp:new Date().toISOString() }
  if (!Number.isInteger(slot) || slot < 1 || slot > 6) return { ok:false,title:'Slot unavailable',message:'Choose one of the six physical agent slots.',timestamp:new Date().toISOString() }
  const snapshot = await missionControl(true)
  const agent = snapshot.agents.find((candidate) => candidate.slot === slot)
  if (!agent?.provider || agent.state === 'off') return { ok:false,title:`Agent ${slot} is empty`,message:'This slot has no live provider receipt yet. Start or resume a session, then try again.',timestamp:new Date().toISOString() }
  const appName = appForProvider(agent.provider)
  if (!appName) return { ok:false,title:'Focus unavailable',message:'This session does not advertise a safe local focus target.',timestamp:new Date().toISOString() }
  const opened = await openFixedApp(appName)
  if (!opened) return { ok:false,title:`Could not open ${appName}`,message:'The provider app was not available. No fallback terminal or command was launched.',timestamp:new Date().toISOString() }
  const message = agent.provider === 'claude'
    ? 'cmux is foregrounded. Exact pane correlation is not available in the installed cmux build, so no terminal input was sent.'
    : 'Codex Desktop is foregrounded. No prompt, approval, or task was submitted.'
  return { ok:true,title:`Opened ${appName} for ${agent.title}`,message,timestamp:new Date().toISOString() }
}))
ipcMain.handle('board:setProfile', trustedIpc((_event, profile) => { if (PROFILE_IDS.has(profile)) currentProfile = profile; return currentProfile }))
ipcMain.handle('board:setFlightCheck', trustedIpc((_event, active) => {
  const state = active === true ? flightSession.start() : flightSession.stop()
  if (state.active) approvals.clear()
  return { acknowledged: true, active: state.active, startedAt: state.startedAt }
}))
ipcMain.handle('board:restartFlightCheck', trustedIpc(() => {
  const state = flightSession.restart()
  if (state.active) approvals.clear()
  return { acknowledged: state.active, active: state.active, startedAt: state.startedAt }
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
    return {
      status: 'saved',
      filePath: artifact.outputPath,
      sha256: artifact.sha256,
      message: 'Corrected profile saved. Input and the Creator Micro were not modified.',
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
ipcMain.handle('board:saveFlightReceipt', trustedIpc(async (_event, receipt) => {
  const flight = flightSession.snapshot()
  if (!flight.active || !flight.startedAt) return null
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null
  if (Buffer.byteLength(JSON.stringify(receipt), 'utf8') > 200_000) return null
  if (!Array.isArray(receipt.receivedSignals) || !Array.isArray(receipt.missingSignals) || !Array.isArray(receipt.events)) return null
  if (receipt.events.length > 100 || receipt.receivedSignals.length > 20 || receipt.missingSignals.length > 20) return null
  const allowedSignals = new Set(Object.keys(HOTKEYS))
  if (![...receipt.receivedSignals, ...receipt.missingSignals].every((signal) => allowedSignals.has(signal))) return null
  if (!receipt.events.every((item) => item && allowedSignals.has(item.signal) && typeof item.receivedAt === 'string')) return null
  const variant = receipt.profileKind === 'diagnostic' ? 'diagnostic' : 'daily'
  const evaluation = evaluateFlightSignals(variant, flight.rawEvents)
  const usbDetected = Boolean(await boardConnected())
  const registeredCount = shortcutRegistrations.filter((item) => item.registered).length
  const status = evaluation.status === 'passed' && usbDetected && registeredCount === Object.keys(HOTKEYS).length ? 'passed' : evaluation.status === 'incomplete' ? 'incomplete' : 'failed'
  const payload = {
    schema: 'ai.ashlr.agent-board.flight-check/v2',
    receiptId: randomUUID(),
    profileKind: variant,
    status,
    startedAt: flight.startedAt,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    device: { expectedName: 'Creator Micro 2', usbDetected },
    configuration: { registrations: shortcutRegistrations, registeredCount },
    evaluation,
    rawEvents: flight.rawEvents,
    disclaimer: 'Operator-guided global-shortcut receipt; not a cryptographic device-identity attestation.',
  }
  const canonical = JSON.stringify(payload)
  const document = { ...payload, sha256: createHash('sha256').update(canonical).digest('hex') }
  const suggestedName = `ashlr-agent-board-flight-check-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  const result = await dialog.showSaveDialog(mainWindow, { title: 'Save Flight Check receipt', defaultPath: path.join(app.getPath('documents'), suggestedName), filters: [{ name: 'JSON receipt', extensions: ['json'] }] })
  if (result.canceled || !result.filePath) return null
  const temporaryPath = `${result.filePath}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  renameSync(temporaryPath, result.filePath)
  return result.filePath
}))
ipcMain.handle('board:requestAction', trustedIpc(async (_event, actionId) => {
  if (flightSession.isActive()) return { ok:false,title:'Flight Check interlock',message:'Mapped actions are disabled until hardware acceptance ends.',timestamp:new Date().toISOString() }
  const spec = ACTION_SPECS[actionId]
  if (!spec) return { ok:false,title:'Action unavailable',message:'This action is not allowlisted.',timestamp:new Date().toISOString() }
  if (spec.safety !== 'safe') {
    const settings = readSettings()
    const issuedAt = Date.now()
    const token = randomUUID()
    approvals.set(token, {
      actionId,
      workspace: settings.workspace,
      webContentsId: _event.sender.id,
      safety: spec.safety,
      holdStartedAt: null,
      expires: issuedAt + 30_000,
    })
    return { ok:true,title:'Confirmation required',message:'Review the consequence before continuing.',needsConfirmation:true,token,timestamp:new Date().toISOString() }
  }
  return executeSpec(actionId, readSettings().workspace, { clipboard, home: app.getPath('home') })
}))
ipcMain.handle('board:beginHold', trustedIpc((_event, actionId, token) => {
  const approval = approvals.get(token)
  if (!approval || approval.actionId !== actionId || approval.safety !== 'hold' || approval.webContentsId !== _event.sender.id || approval.expires < Date.now() || flightSession.isActive()) return false
  approval.holdStartedAt = Date.now()
  return true
}))
ipcMain.handle('board:cancelHold', trustedIpc((_event, actionId, token) => {
  const approval = approvals.get(token)
  if (!approval || approval.actionId !== actionId || approval.webContentsId !== _event.sender.id) return false
  approval.holdStartedAt = null
  return true
}))
ipcMain.handle('board:confirmAction', trustedIpc(async (_event, actionId, token) => {
  if (flightSession.isActive()) { approvals.delete(token); return { ok:false,title:'Flight Check interlock',message:'The pending approval was canceled when hardware acceptance began.',timestamp:new Date().toISOString() } }
  const approval = approvals.get(token); approvals.delete(token)
  const settings = readSettings()
  if (!approval || approval.actionId !== actionId || approval.expires < Date.now()) return { ok:false,title:'Approval expired',message:'Select the action again to create a fresh authorization.',timestamp:new Date().toISOString() }
  if (approval.webContentsId !== _event.sender.id) return { ok:false,title:'Approval rejected',message:'The confirmation came from a different window.',timestamp:new Date().toISOString() }
  if (approval.workspace !== settings.workspace) return { ok:false,title:'Workspace changed',message:'Review the action again for the newly selected working directory.',timestamp:new Date().toISOString() }
  if (approval.safety === 'hold' && !holdSatisfied(approval)) return { ok:false,title:'Hold incomplete',message:'Keep holding continuously until the authorization indicator completes.',timestamp:new Date().toISOString() }
  return executeSpec(actionId, approval.workspace, { clipboard, home: app.getPath('home') })
}))

app.whenReady().then(() => { app.setName('Ashlr Agent Board'); createWindow(); registerShortcuts() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('will-quit', () => { flightSession.reset(); globalShortcut.unregisterAll() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
