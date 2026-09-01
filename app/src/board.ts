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
  inputInstalled: boolean
  inputMonitoring: 'unverified'
  codex: boolean
  nativeCodexMicro: CodexNativeMicroStatus
  claude: boolean
  ashlr: boolean
  boardRoute: BoardRoute
  workspace: string
  shortcutCount: number
  shortcutRegistrations: ShortcutRegistration[]
  workspaceSnapshot: WorkspaceSnapshot | null
}

export interface CodexNativeMicroStatus {
  status: 'connected' | 'firmware_rpc_missing' | 'connection_failed' | 'not_observed' | 'log_unavailable'
  observedAt: string | null
  detail: string
  fresh?: boolean
}

export type BoardRoute = 'unknown' | 'codex_native' | 'ashlr_layer'

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
  span?: number
  pairedWith?: ControlId
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
  action('mic_setup', 'Voice prompt key', 'Voice prompt', 'The factory Mic cap spans two switches but should produce one daily action.', 'Configure push-to-talk on ACT10 and set ACT11 to None in the daily Work Louder Input layer. A separate paired mapping is only for the log-only diagnostic.', 'safe', 'mic', 'native', true),
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
    { id: 'touchProfile', label: 'Bluetooth host profile', row: 4, column: 1, bindable: false, leds: 3 },
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
    { id: 'cmd5', hardwareId: 'ACT10 + ACT11', kind: 'action', row: 4, column: 2, span: 2, pairedWith: 'cmd6' },
    { id: 'cmd7', hardwareId: 'ACT12', kind: 'action', row: 4, column: 4 },
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

const profileMap: Record<ProfileId, Profile> = {
  codex: { id: 'codex', name: 'Attention', shortLabel: 'CODEX + CLAUDE', color: '#4e70ff', description: 'One stable six-slot runway for live Codex and Claude Code work, regardless of the active lens.', mapping: map({
    ...liveAgents,
    cmd1: 'open_codex', cmd2: 'open_claude', cmd3: 'copy_plan_brief', cmd4: 'copy_review_brief', cmd5: 'mic_setup', cmd6: 'mic_setup', cmd7: 'ashlr_tui',
    joyUp: 'fleet_status', joyDown: 'copy_test_brief',
  }) },
  claude: { id: 'claude', name: 'Pair', shortLabel: 'CLAUDE + CODEX', color: '#d97857', description: 'Provider launch, resumption, agent visibility, and reusable guarded briefs.', mapping: map({
    ...liveAgents,
    cmd1: 'git_status', cmd2: 'git_diff', cmd3: 'copy_test_brief', cmd4: 'run_tests', cmd5: 'mic_setup', cmd6: 'mic_setup', cmd7: 'ashlr_tui',
    joyUp: 'copy_plan_brief', joyDown: 'copy_test_brief',
  }) },
  fleet: { id: 'fleet', name: 'Fleet', shortLabel: 'ORCHESTRATE', color: '#7b5cff', description: 'Exception-first oversight for local proposal fleets and human review.', mapping: map({
    ...liveAgents,
    cmd1: 'git_status', cmd2: 'git_diff', cmd3: 'copy_plan_brief', cmd4: 'copy_review_brief', cmd5: 'mic_setup', cmd6: 'mic_setup', cmd7: 'pause_fleet',
    joyUp: 'fleet_direction', joyDown: 'fleet_status',
  }) },
  ship: { id: 'ship', name: 'Proof', shortLabel: 'VERIFY CHANGE', color: '#24a77a', description: 'Evidence before release: inspect, test, and review without binding publication.', mapping: map({
    ...liveAgents,
    cmd1: 'tool_health', cmd2: 'fleet_doctor', cmd3: 'open_codex', cmd4: 'start_codex', cmd5: 'mic_setup', cmd6: 'mic_setup', cmd7: 'copy_test_brief',
    joyUp: 'git_log', joyDown: 'git_status',
  }) },
  emergency: { id: 'emergency', name: 'Recovery', shortLabel: 'GUARDED STOPS', color: '#ef4d6f', description: 'Deliberate stops, diagnostics, and recovery controls—isolated from daily actions.', mapping: map({
    ...liveAgents,
    cmd1: 'pause_fleet', cmd2: 'daemon_stop', cmd3: 'fleet_status', cmd4: 'fleet_doctor', cmd5: 'mic_setup', cmd6: 'mic_setup', cmd7: 'tool_health',
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
