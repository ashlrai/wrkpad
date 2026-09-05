const { contextBridge } = require('electron')

const clone = (value) => JSON.parse(JSON.stringify(value))

const status = {
  boardConnected: false,
  inputInstalled: false,
  inputInstallation: { status: 'probe_unavailable', version: null },
  inputProfile: { cacheStatus: 'missing', activeProfile: null, activeLayer: null, encoderDirection: 'unavailable' },
  inputRuntime: { status: 'not_observed', profileIndex: null, layerIndex: null, observedAt: null, fresh: false },
  inputMonitoring: 'unverified',
  codex: false,
  nativeCodexMicro: { status: 'not_observed', observedAt: null, detail: 'Documentation fixture; native connection not inspected.' },
  claude: false,
  ashlr: false,
  boardRoute: 'unknown',
  workspace: 'No workspace selected',
  shortcutCount: 0,
  shortcutRegistrations: [],
  workspaceSnapshot: null,
  receiverIdentity: null,
  receiverRuntime: { status: 'unavailable', instanceCount: 0, distinctBuildCount: 0, currentAsarSha256: null, candidateAsarSha256: null, candidateMatchesCurrent: null },
}

const mission = {
  schemaVersion: 1,
  observedAt: '2026-08-31T12:00:00.000Z',
  agentSource: 'unavailable',
  fleetSource: 'unavailable',
  agents: [
    { slot: 1, provider: 'codex', state: 'error', title: 'API recovery', updatedAt: '2026-08-31T11:55:00.000Z' },
    { slot: 2, provider: 'claude', state: 'needs_input', title: 'Review request', updatedAt: '2026-08-31T11:56:00.000Z' },
    { slot: 3, provider: 'codex', state: 'working', title: 'Test matrix', updatedAt: '2026-08-31T11:57:00.000Z' },
    { slot: 4, provider: 'claude', state: 'unread', title: 'Docs polish', updatedAt: '2026-08-31T11:58:00.000Z' },
    { slot: 5, provider: 'codex', state: 'idle', title: 'Design pass', updatedAt: '2026-08-31T11:59:00.000Z' },
    { slot: 6, provider: null, state: 'off', title: 'Available slot', updatedAt: null },
  ],
  fleet: {
    daemonRunning: false,
    daemonPhase: 'offline',
    killed: false,
    backlogItems: 0,
    eligibleItems: 0,
    repairBlockedItems: 0,
    pendingProposals: 0,
    activeGoals: 0,
    operatingMode: 'Observe only',
    directive: 'No remote authority in this documentation capture',
    blocker: {
      severity: 'low',
      label: 'Synthetic documentation fixture',
      detail: 'No hardware, provider, RGB, or Fleet acceptance is represented.',
    },
    nextAction: 'Read the on-screen black-cap legend',
    nextActionSafety: 'read-only',
    guardBlocked: false,
    generatedAt: '2026-08-31T12:00:00.000Z',
  },
  unassignedActiveSessions: 0,
  operatorNotices: [{
    code: 'documentation_fixture',
    severity: 'low',
    label: 'Synthetic documentation data',
    detail: 'No live sessions, local paths, device writes, or remote authority are shown.',
  }],
}

const fixtureResult = {
  ok: false,
  title: 'Documentation fixture',
  message: 'Actions are disabled in the public screenshot harness.',
  timestamp: '2026-08-31T12:00:00.000Z',
}

contextBridge.exposeInMainWorld('agentBoard', {
  getStatus: async () => clone(status),
  getMissionControl: async () => clone(mission),
  focusAgentSlot: async () => clone(fixtureResult),
  setProfile: async () => {},
  setFlightCheck: async () => ({ acknowledged: false, active: false, startedAt: null }),
  restartFlightCheck: async () => ({ acknowledged: false, active: false, startedAt: null }),
  requestAction: async () => clone(fixtureResult),
  confirmAction: async () => clone(fixtureResult),
  beginHold: async () => false,
  cancelHold: async () => true,
  chooseWorkspace: async () => null,
  saveFlightReceipt: async () => null,
  onControl: () => () => {},
})
