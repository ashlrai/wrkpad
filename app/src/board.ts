export type ControlId =
  | 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent6'
  | 'cmd1' | 'cmd2' | 'cmd3' | 'cmd4' | 'cmd5' | 'cmd6' | 'cmd7'
  | 'joyUp' | 'joyRight' | 'joyDown' | 'joyLeft'
  | 'dialLeft' | 'dialRight' | 'dialPress'

export type ProfileId = 'codex' | 'claude' | 'fleet' | 'ship' | 'emergency'
export type SafetyLevel = 'safe' | 'confirm' | 'hold'

export interface ActionDefinition {
  id: string
  title: string
  shortTitle: string
  description: string
  consequence: string
  safety: SafetyLevel
  cta: string
  icon: string
  executor: string
  nativeOwned?: boolean
}

export interface ExecutionResult {
  ok: boolean
  title: string
  message: string
  timestamp: string
  output?: string
  needsConfirmation?: boolean
  token?: string
  stagedIntent?: { actionId: string; intent: 'voice_capture' | 'focus_attention' }
}

export interface PhysicalSignalEnvelope {
  schemaVersion: 1
  sequence: number
  signalId: ControlId
  source: 'global-shortcut'
  accelerator: string
  receivedAt: string
  monotonicNs: string
}

export interface ShortcutRegistration {
  signalId: ControlId
  accelerator: string
  registered: boolean
}

export interface WorkspaceSnapshot {
  available: boolean
  projectName: string
  root: string
  isGit: boolean
  branch: string | null
  detached: boolean
  statusKnown: boolean
  dirtyFiles: number | null
  stagedFiles: number | null
  unstagedFiles: number | null
  untrackedFiles: number | null
  conflictedFiles: number | null
  headShort: string | null
  headSubject: string | null
  headDate: string | null
  upstream: string | null
  ahead: number | null
  behind: number | null
  packageManager: string | null
  testCommand: string | null
}

export interface SystemStatus {
  boardConnected: boolean
  boardVidPid: string | null
  inputInstalled: boolean
  inputInstallation: InputInstallationStatus
  inputProfile: InputProfileStatus
  inputRuntime: InputRuntimeStatus
  inputMonitoring: 'unverified'
  codex: boolean
  chatgptDesktop: ChatGPTDesktopStatus
  nativeCodexMicro: CodexNativeMicroStatus
  claude: boolean
  ashlr: boolean
  boardRoute: BoardRoute
  workspace: string
  shortcutCount: number
  shortcutRegistrations: ShortcutRegistration[]
  workspaceSnapshot: WorkspaceSnapshot | null
  receiverIdentity: ReceiverIdentity | null
  receiverRuntime: ReceiverRuntimeStatus
  inputApplication?: InputApplicationStatus
}

export interface ChatGPTDesktopStatus {
  status: 'metadata_observed' | 'missing' | 'unavailable'
  version: string | null
  build: string | null
}

export interface InputInstallationStatus {
  status: 'verified' | 'missing' | 'multiple_installations' | 'unsafe' | 'invalid_metadata' | 'publisher_unrecognized' | 'invalid_signature' | 'known_resource_mutation' | 'gatekeeper_rejected' | 'probe_unavailable'
  version: string | null
}

export interface ReceiverRuntimeStatus {
  status: 'not_running' | 'exclusive' | 'contended_same_build' | 'contended_distinct_builds' | 'unavailable'
  instanceCount: number
  distinctBuildCount: number
  currentAsarSha256: string | null
  candidateAsarSha256: string | null
  candidateMatchesCurrent: boolean | null
}

export interface InputApplicationStatus {
  status: 'running' | 'not_running' | 'unavailable'
}

export interface InputProfileStatus {
  cacheStatus: 'available' | 'missing' | 'invalid' | 'unsafe'
  activeProfile: string | null
  activeLayer: string | null
  encoderDirection: 'correct' | 'reversed' | 'unrecognized' | 'unavailable'
  configuredLayers?: Array<{
    name: string | null
    mapping: 'ashlr_daily' | 'codex_native' | 'hybrid_native' | 'unknown'
    encoderDirection: 'correct' | 'reversed' | 'unrecognized' | 'unavailable'
  }>
}

export interface InputRuntimeStatus {
  status: 'unresolved_profile_layer' | 'not_observed' | 'log_missing' | 'log_unsafe' | 'log_unavailable'
  profileIndex: number | null
  layerIndex: number | null
  observedAt: string | null
  fresh: boolean
  codexProtocolTraffic?: {
    status: 'recurring_unresolved_response' | 'not_observed' | 'log_missing' | 'log_unsafe' | 'log_unavailable'
    observedAt: string | null
    fresh: boolean
  }
}

export interface ReceiverIdentity {
  appVersion: string
  packaged: boolean
  appAsarSha256?: string | null
}

export const dualPlaneInputProfileConfigured = (profile: InputProfileStatus): boolean =>
  profile.activeProfile === 'Ashlr Dual Plane (UNOFFICIAL)'
  && profile.activeLayer === null
  && profile.configuredLayers?.length === 2
  && profile.configuredLayers[0]?.name === 'Codex Native Recovery (UNOFFICIAL)'
  && profile.configuredLayers[0]?.mapping === 'codex_native'
  && profile.configuredLayers[1]?.name === 'Ashlr Daily'
  && profile.configuredLayers[1]?.mapping === 'ashlr_daily'
  && profile.configuredLayers[1]?.encoderDirection === 'correct'

export const hybridNativeInputProfileConfigured = (profile: InputProfileStatus): boolean =>
  profile.activeProfile === 'Ashlr Hybrid Dual Plane (UNOFFICIAL)'
  && profile.activeLayer === null
  && profile.configuredLayers?.length === 2
  && profile.configuredLayers[0]?.name === 'Ashlr Hybrid Native (UNOFFICIAL)'
  && profile.configuredLayers[0]?.mapping === 'hybrid_native'
  && profile.configuredLayers[0]?.encoderDirection === 'correct'
  && profile.configuredLayers[1]?.name === 'Ashlr Daily'
  && profile.configuredLayers[1]?.mapping === 'ashlr_daily'
  && profile.configuredLayers[1]?.encoderDirection === 'correct'

export const correctedInputProfileObservedForVariant = (profile: InputProfileStatus, variant: 'daily' | 'diagnostic', dualPlaneAshlrLayerAttested = false): boolean =>
  variant === 'daily'
    ? (profile.activeProfile === 'Ashlr Agent Board Corrected'
        && profile.activeLayer === 'Ashlr Daily'
        && profile.encoderDirection === 'correct')
      || (dualPlaneAshlrLayerAttested && dualPlaneInputProfileConfigured(profile))
    : profile.activeProfile === 'Ashlr Flight Check Corrected - diagnostic'
      && profile.activeLayer === 'Ashlr Diagnostic'
      && profile.encoderDirection === 'correct'

export const correctedInputProfileObserved = (profile: InputProfileStatus): boolean =>
  correctedInputProfileObservedForVariant(profile, 'daily')

export interface ProfileRepairResult {
  status: 'saved' | 'canceled' | 'failed'
  message: string
  filePath?: string
  sha256?: string
  handoffPersisted?: boolean
  recoverySteps?: string[]
}

export interface CodexNativeMicroStatus {
  status: 'connected' | 'firmware_rpc_missing' | 'connection_failed' | 'not_observed' | 'log_unavailable'
  observedAt: string | null
  detail: string
  fresh?: boolean
}

export type NativeAcceptanceStatus = 'not_prepared' | 'invalid' | 'pending' | 'initialization_observed' | 'accepted'

export interface NativeAcceptanceAttestations {
  settingsConnected: boolean
  dial: boolean
  joystick: boolean
  agentKeys: boolean
  actionKeys: boolean
  microphone: boolean
  lighting: boolean
}

export interface NativeAcceptanceContext {
  route: 'codex_native'
  device: {
    vidPid: string
  }
  codex: {
    version: string
    build: string
  }
}

export interface NativeAcceptanceReceipt {
  schema: 'ai.ashlr.agent-board.native-acceptance/v1'
  state: 'prepared' | 'accepting' | 'accepted'
  preparedAt: string
  initializationObservedAt: string | null
  acceptedAt: string | null
  context: NativeAcceptanceContext
  attestations: NativeAcceptanceAttestations
}

export interface NativeAcceptanceEvaluation {
  status: NativeAcceptanceStatus
  reason: string
  preparedAt?: string
  initializationObservedAt?: string | null
  acceptedAt?: string | null
  attestations?: NativeAcceptanceAttestations
}

export interface NativeAcceptanceSnapshot {
  receipt: NativeAcceptanceReceipt | null
  evaluation: NativeAcceptanceEvaluation
}

export interface NativeAcceptanceActionResult {
  ok: boolean
  message: string
  snapshot: NativeAcceptanceSnapshot
}

export type BoardRoute = 'unknown' | 'codex_native' | 'ashlr_layer' | 'hybrid_native'

export type AgentProvider = 'codex' | 'claude' | 'manual' | 'unknown'
export type AgentState = 'off' | 'idle' | 'unread' | 'working' | 'needs_input' | 'error'

export interface AgentSlotSummary {
  slot: number
  provider: AgentProvider | null
  state: AgentState
  title: string
  updatedAt: string | null
}

export interface FleetBrief {
  daemonRunning: boolean
  daemonPhase: string
  killed: boolean
  backlogItems: number
  eligibleItems: number
  repairBlockedItems: number
  pendingProposals: number
  activeGoals: number
  operatingMode: string
  directive: string
  blocker: { severity: string; label: string; detail: string } | null
  nextAction: string | null
  nextActionSafety: 'read-only' | 'control-plane' | 'manual' | 'unknown' | null
  guardBlocked: boolean
  generatedAt: string | null
}

export interface MissionControlSnapshot {
  schemaVersion: 1
  observedAt: string
  agentSource: 'observer_online' | 'invalid' | 'unavailable'
  fleetSource: 'status_receipt' | 'invalid' | 'unavailable'
  agents: AgentSlotSummary[]
  fleet: FleetBrief | null
  unassignedActiveSessions: number
  operatorNotices: Array<{ code: string; severity: 'high' | 'medium' | 'low'; label: string; detail: string }>
}

export interface PhysicalControl {
  id: ControlId
  hardwareId: string
  kind: 'agent' | 'action' | 'dial' | 'joystick'
  row: number
  column: number
  cap?: 'black_opaque' | 'transparent'
}

const action = (
  id: string,
  title: string,
  shortTitle: string,
  description: string,
  consequence: string,
  safety: SafetyLevel,
  icon: string,
  executor = id,
  nativeOwned = false,
): ActionDefinition => ({
  id, title, shortTitle, description, consequence, safety,
  cta: safety === 'safe' ? 'Run action' : safety === 'confirm' ? 'Review and run' : 'Arm action',
  icon, executor, nativeOwned,
})

const actionEntries = [
  action('native_agent', 'Native agent slot', 'Agent slot', 'A live Codex thread slot with hardware RGB feedback.', 'Codex focuses the assigned thread. The app does not intercept or imitate the native HID event.', 'safe', 'sparkles', 'native', true),
  action('native_action', 'Native Codex action', 'Codex action', 'A command owned by Codex and configured in Codex Micro settings.', 'Codex runs the action configured for this physical key.', 'safe', 'command', 'native', true),
  action('mic_setup', 'Native voice key', 'Voice', 'A native Codex voice control configured on one physical bottom-row switch.', 'Choose the intended key in Codex settings, then verify ACT10 and ACT11 independently. This app never assumes they share an action.', 'safe', 'mic', 'native', true),
  ...Array.from({ length: 6 }, (_, index) => action(
    `focus_agent_${index + 1}`,
    `Open agent surface ${index + 1}`,
    `Agent ${index + 1}`,
    'Open the fixed local provider app for the session currently assigned to this slot.',
    'Foregrounds Codex Desktop or cmux. Exact task or pane focus is reported as unavailable until the provider exposes a verified locator; no prompt is submitted.',
    'safe',
    'sparkles',
    `focus_agent_${index + 1}`,
  )),
  action('open_codex', 'Open Codex workspace', 'Open Codex', 'Bring the current project into the Codex desktop app.', 'Opens Codex at the selected working directory. No task is submitted.', 'safe', 'sparkles'),
  action('start_codex', 'Start guarded Codex session', 'New session', 'Start an interactive Codex CLI session in this workspace.', 'Opens Terminal and starts Codex with normal approval behavior. Model usage may begin after you send a prompt.', 'confirm', 'terminal'),
  action('resume_codex', 'Resume latest Codex session', 'Resume', 'Continue the most recent Codex CLI session for this project.', 'Opens Terminal and resumes the last session. Existing approval settings remain in force.', 'confirm', 'refresh'),
  action('codex_review', 'Review uncommitted work', 'Review', 'Ask Codex to inspect the current working tree.', 'Opens a review session; it does not commit, push, merge, or deploy.', 'confirm', 'git'),
  action('copy_plan_brief', 'Copy planning brief', 'Plan brief', 'Put Ashlr’s investigation-first planning prompt on the clipboard.', 'Copies text only. Nothing is submitted to an agent.', 'safe', 'command'),
  action('copy_test_brief', 'Copy verification brief', 'Verify brief', 'Prepare a rigorous end-to-end verification prompt.', 'Copies text only. It requests evidence and forbids unapproved release actions.', 'safe', 'shield'),
  action('open_claude', 'Open Claude', 'Open Claude', 'Bring Claude Desktop to the foreground.', 'Opens Claude Desktop. No message is sent.', 'safe', 'bot'),
  action('start_claude', 'Start guarded Claude Code', 'New Claude', 'Start Claude Code in the selected workspace.', 'Opens an interactive terminal session with standard permissions. Model usage may begin after you send a prompt.', 'confirm', 'terminal'),
  action('resume_claude', 'Resume Claude Code', 'Resume', 'Continue the latest Claude Code session in this directory.', 'Opens Terminal and asks Claude Code to continue the most recent local conversation.', 'confirm', 'refresh'),
  action('claude_agents', 'Open Claude agent monitor', 'Agents', 'Open Claude Code’s background-agent view.', 'Opens a read/control view in Terminal; it does not dispatch a new agent.', 'confirm', 'bot'),
  action('copy_review_brief', 'Copy independent review brief', 'Review brief', 'Prepare a fresh-agent code review prompt with security and edge-case checks.', 'Copies the brief only. No changes or review requests are sent.', 'safe', 'shield'),
  action('copy_amplify_skill', 'Amplify the work', 'Amplify', 'Copy the reusable Ashlr delivery skill that expands investigation and parallel coverage.', 'Copies `$ashlr-delivery Amplify` only. Nothing is pasted, submitted, pushed, or deployed.', 'safe', 'sparkles'),
  action('copy_verify_skill', 'Verify the whole story', 'Verify', 'Copy the reusable Ashlr delivery skill for evidence-backed end-to-end verification.', 'Copies `$ashlr-delivery Verify` only. Nothing is pasted or submitted.', 'safe', 'shield'),
  action('copy_polish_skill', 'Polish to release quality', 'Polish', 'Copy the reusable Ashlr delivery skill for quality, accessibility, security, and documentation passes.', 'Copies `$ashlr-delivery Polish` only. Nothing is pasted, committed, or published.', 'safe', 'sparkles'),
  action('copy_advance_skill', 'Advance the next gate', 'Advance', 'Copy the reusable Ashlr delivery skill that selects the safest highest-value incomplete step.', 'Copies `$ashlr-delivery Advance` only. Existing authorization gates remain intact.', 'safe', 'activity'),
  action('stage_voice', 'Voice capture', 'Voice', 'Stage a voice-capture intent for a trusted provider surface.', 'No microphone permission is changed and no prompt is submitted. Provider-specific capture remains an explicit user action.', 'safe', 'mic'),
  action('copy_guarded_continue', 'Guarded Continue', 'Continue', 'Copy a bounded continuation prompt that preserves release and authority gates.', 'Copies text only. It never sends Enter or writes into a terminal or agent composer.', 'safe', 'send'),
  action('stage_attention', 'Open highest-priority agent', 'Attention', 'Resolve error, needs-input, working, unread, then idle across the six current slots.', 'Uses the current bounded snapshot to foreground the provider app. It does not guess a task, send a prompt, or approve anything.', 'safe', 'attention'),
  action('fleet_status', 'Inspect fleet status', 'Fleet status', 'Read the current Ashlr fleet snapshot.', 'Runs `ashlr fleet status --json` read-only and shows the evidence here.', 'safe', 'fleet'),
  action('fleet_direction', 'Inspect fleet direction', 'Direction', 'Read the current autonomous direction report.', 'Runs `ashlr fleet direction --json` read-only.', 'safe', 'fleet'),
  action('fleet_doctor', 'Run fleet preflight', 'Doctor', 'Check engine readiness and blocked control surfaces.', 'Runs the read-only Ashlr fleet doctor and returns its evidence.', 'safe', 'shield'),
  action('ashlr_inbox', 'Open proposal inbox', 'Inbox', 'Review agent proposals waiting for a human decision.', 'Opens the Ashlr inbox in Terminal. It does not approve a proposal.', 'confirm', 'command'),
  action('ashlr_tui', 'Open Ashlr command center', 'Command center', 'Launch the local-first Ashlr terminal interface.', 'Opens an interactive Ashlr interface without changing fleet authority.', 'confirm', 'fleet'),
  action('pause_fleet', 'Pause autonomous fleet', 'Pause fleet', 'Engage Ashlr’s fleet kill switch.', 'Stops new autonomous fleet work. Existing process cleanup follows Ashlr’s own orderly controls.', 'hold', 'stop'),
  action('resume_fleet', 'Resume autonomous fleet', 'Resume fleet', 'Release Ashlr’s fleet kill switch.', 'Allows eligible proposal-only fleet work to resume under its configured authority.', 'hold', 'refresh'),
  action('daemon_stop', 'Stop Ashlr daemon', 'Stop daemon', 'Request an orderly shutdown of the local Ashlr daemon.', 'Stops the resident proposal-only daemon. This may interrupt queued local automation.', 'hold', 'stop'),
  action('git_status', 'Inspect working tree', 'Git status', 'See branch, staged work, and local modifications.', 'Runs `git status --short --branch` read-only.', 'safe', 'git'),
  action('git_diff', 'Inspect change summary', 'Diff summary', 'Measure the current uncommitted change surface.', 'Runs `git diff --stat` read-only. It does not stage or alter files.', 'safe', 'git'),
  action('git_log', 'Inspect recent history', 'Recent commits', 'Read the eight most recent commits.', 'Runs a compact `git log` read-only.', 'safe', 'git'),
  action('run_tests', 'Run project tests', 'Run tests', 'Start the repository’s configured test command.', 'Opens Terminal and runs the detected package test script. Tests may write normal caches or snapshots.', 'confirm', 'activity'),
  action('tool_health', 'Check agent toolchain', 'Tool health', 'Verify the installed Codex, Claude Code, and Ashlr CLI versions.', 'Runs local version commands only and displays the output.', 'safe', 'activity'),
  action('effort_down', 'Reduce reasoning depth', 'Faster', 'Move toward faster, lower-cost agent reasoning.', 'Updates the board’s displayed brainpower level. Native Codex can own this dial in its profile.', 'safe', 'activity'),
  action('effort_up', 'Increase reasoning depth', 'Deeper', 'Move toward deeper reasoning for harder work.', 'Updates the board’s displayed brainpower level. Native Codex can own this dial in its profile.', 'safe', 'activity'),
  action('profile_next', 'Next board profile', 'Next profile', 'Move to the next Ashlr control layer.', 'Changes only the Agent Board app profile.', 'safe', 'refresh'),
  action('profile_previous', 'Previous board profile', 'Previous', 'Move to the previous Ashlr control layer.', 'Changes only the Agent Board app profile.', 'safe', 'refresh'),
]

export const actions: Record<string, ActionDefinition> = Object.fromEntries(actionEntries.map((entry) => [entry.id, entry]))

const hotkeys: Record<ControlId, string> = {
  agent1: '⌃⌥⌘1', agent2: '⌃⌥⌘2', agent3: '⌃⌥⌘3', agent4: '⌃⌥⌘4', agent5: '⌃⌥⌘5', agent6: '⌃⌥⌘6',
  cmd1: '⌃⌥⌘A', cmd2: '⌃⌥⌘B', cmd3: '⌃⌥⌘C', cmd4: '⌃⌥⌘D', cmd5: '⌃⌥⌘E', cmd6: '⌃⌥⌘F', cmd7: '⌃⌥⌘G',
  joyUp: '⌃⌥⌘↑', joyRight: '⌃⌥⌘→', joyDown: '⌃⌥⌘↓', joyLeft: '⌃⌥⌘←',
  dialLeft: '⌃⌥⌘Q', dialRight: '⌃⌥⌘W', dialPress: '⌃⌥⌘R',
}

export const controls = {
  agent: ['agent1', 'agent2', 'agent3', 'agent4', 'agent5', 'agent6'] as ControlId[],
  command: ['cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6', 'cmd7'] as ControlId[],
  hotkeys,
}

export const hardware = {
  name: 'Creator Micro 2',
  usbName: 'Creator Micro 2',
  mechanicalSwitches: 13,
  touchSensors: 1,
  rotaryEncoders: 1,
  planarJoysticks: 1,
  bindableSignals: 20,
  firmwareControls: [
    { id: 'touchProfile', label: 'Layer and connection selector', row: 4, column: 1, bindable: false, leds: 3 },
  ],
  controls: [
    { id: 'dialPress', hardwareId: 'ENC_CLK', kind: 'dial', row: 1, column: 1 },
    { id: 'agent1', hardwareId: 'AG00', kind: 'agent', row: 1, column: 2 },
    { id: 'agent2', hardwareId: 'AG01', kind: 'agent', row: 1, column: 3 },
    { id: 'joyUp', hardwareId: 'JOY_UP', kind: 'joystick', row: 1, column: 4 },
    { id: 'agent3', hardwareId: 'AG02', kind: 'agent', row: 2, column: 1 },
    { id: 'agent4', hardwareId: 'AG03', kind: 'agent', row: 2, column: 2 },
    { id: 'agent5', hardwareId: 'AG04', kind: 'agent', row: 2, column: 3 },
    { id: 'agent6', hardwareId: 'AG05', kind: 'agent', row: 2, column: 4 },
    { id: 'cmd1', hardwareId: 'ACT06', kind: 'action', row: 3, column: 1 },
    { id: 'cmd2', hardwareId: 'ACT07', kind: 'action', row: 3, column: 2 },
    { id: 'cmd3', hardwareId: 'ACT08', kind: 'action', row: 3, column: 3 },
    { id: 'cmd4', hardwareId: 'ACT09', kind: 'action', row: 3, column: 4 },
    { id: 'cmd5', hardwareId: 'ACT10', kind: 'action', row: 4, column: 2, cap: 'black_opaque' },
    { id: 'cmd6', hardwareId: 'ACT11', kind: 'action', row: 4, column: 3, cap: 'black_opaque' },
    { id: 'cmd7', hardwareId: 'ACT12', kind: 'action', row: 4, column: 4, cap: 'transparent' },
  ] satisfies PhysicalControl[],
} as const

type Mapping = Record<ControlId, string>
interface Profile { id: ProfileId; name: string; shortLabel: string; description: string; color: string; mapping: Mapping }
const baseMotion = { joyLeft: 'profile_previous', joyRight: 'profile_next', dialLeft: 'effort_down', dialRight: 'effort_up', dialPress: 'profile_next' }
const map = (values: Partial<Mapping>): Mapping => ({ ...baseMotion, ...values } as Mapping)

const liveAgents = {
  agent1: 'focus_agent_1', agent2: 'focus_agent_2', agent3: 'focus_agent_3',
  agent4: 'focus_agent_4', agent5: 'focus_agent_5', agent6: 'focus_agent_6',
}

const workflowKeys = {
  cmd1: 'copy_amplify_skill', cmd2: 'copy_verify_skill', cmd3: 'copy_polish_skill', cmd4: 'copy_advance_skill',
  cmd5: 'stage_voice', cmd6: 'copy_guarded_continue', cmd7: 'stage_attention',
}

const profileMap: Record<ProfileId, Profile> = {
  codex: { id: 'codex', name: 'Attention', shortLabel: 'CODEX + CLAUDE', color: '#4e70ff', description: 'One stable six-slot runway for live Codex and Claude Code work, regardless of the active lens.', mapping: map({
    ...liveAgents,
    ...workflowKeys,
    joyUp: 'fleet_status', joyDown: 'copy_test_brief',
  }) },
  claude: { id: 'claude', name: 'Pair', shortLabel: 'CLAUDE + CODEX', color: '#d97857', description: 'Provider launch, resumption, agent visibility, and reusable guarded briefs.', mapping: map({
    ...liveAgents,
    ...workflowKeys,
    joyUp: 'copy_plan_brief', joyDown: 'copy_test_brief',
  }) },
  fleet: { id: 'fleet', name: 'Fleet', shortLabel: 'ORCHESTRATE', color: '#7b5cff', description: 'Exception-first oversight for local proposal fleets and human review.', mapping: map({
    ...liveAgents,
    ...workflowKeys,
    joyUp: 'fleet_direction', joyDown: 'fleet_status',
  }) },
  ship: { id: 'ship', name: 'Proof', shortLabel: 'VERIFY CHANGE', color: '#24a77a', description: 'Evidence before release: inspect, test, and review without binding publication.', mapping: map({
    ...liveAgents,
    ...workflowKeys,
    joyUp: 'git_log', joyDown: 'git_status',
  }) },
  emergency: { id: 'emergency', name: 'Recovery', shortLabel: 'GUARDED STOPS', color: '#ef4d6f', description: 'Deliberate stops, diagnostics, and recovery controls—isolated from daily actions.', mapping: map({
    ...liveAgents,
    cmd1: 'pause_fleet', cmd2: 'daemon_stop', cmd3: 'fleet_status', cmd4: 'fleet_doctor', cmd5: 'stage_voice', cmd6: 'copy_guarded_continue', cmd7: 'stage_attention',
    joyUp: 'fleet_doctor', joyDown: 'pause_fleet',
  }) },
}

export const profileOrder: ProfileId[] = ['codex', 'claude', 'fleet', 'ship', 'emergency']
export const profiles = profileMap
export const effortLevels = [
  { label: 'Quick', hint: 'Mechanical tasks' },
  { label: 'Balanced', hint: 'Daily work' },
  { label: 'Deep', hint: 'Architecture' },
  { label: 'Max', hint: 'Critical decisions' },
]
export const allControlIds = Object.keys(hotkeys) as ControlId[]
