import type { BoardRoute, ExecutionResult, MissionControlSnapshot, PhysicalSignalEnvelope, ProfileId, ProfileRepairResult, SystemStatus } from './board'

declare global {
  interface AgentBoardRecoveryHandoff {
    schema: 'ai.ashlr.agent-board.input-recovery/v1'
    artifactPath: string
    sha256: string
    createdAt: string
  }

  interface AgentBoardRecoveryGuide {
    handoff: AgentBoardRecoveryHandoff | null
    artifact: {
      status: 'available' | 'missing' | 'unsafe' | 'hash_mismatch' | 'unavailable' | 'invalid'
      available: boolean
    }
    steps: string[]
  }

  interface AgentBoardRecoveryActionResult {
    ok: boolean
    message: string
  }

  interface Window {
    agentBoard?: {
      getStatus(): Promise<SystemStatus>
      getMissionControl(): Promise<MissionControlSnapshot>
      getRecoveryGuide?(): Promise<AgentBoardRecoveryGuide>
      setBoardRoute(boardRoute: BoardRoute): Promise<BoardRoute>
      focusAgentSlot(slot: number): Promise<ExecutionResult>
      setProfile(profile: ProfileId): Promise<void>
      setFlightCheck(active: boolean): Promise<{ acknowledged: boolean; active: boolean; startedAt: string | null }>
      restartFlightCheck(): Promise<{ acknowledged: boolean; active: boolean; startedAt: string | null }>
      requestAction(actionId: string): Promise<ExecutionResult>
      confirmAction(actionId: string, token: string): Promise<ExecutionResult>
      beginHold(actionId: string, token: string): Promise<boolean>
      cancelHold(actionId: string, token: string): Promise<boolean>
      chooseWorkspace(): Promise<string | null>
      createCorrectedInputProfile(): Promise<ProfileRepairResult>
      revealRecoveryArtifact?(): Promise<AgentBoardRecoveryActionResult>
      copyRecoveryChecklist?(): Promise<AgentBoardRecoveryActionResult>
      dismissRecoveryHandoff?(): Promise<AgentBoardRecoveryActionResult>
      openInputMonitoringSettings?(): Promise<AgentBoardRecoveryActionResult>
      saveFlightReceipt(receipt: Record<string, unknown>): Promise<string | null>
      onControl(callback: (signal: PhysicalSignalEnvelope) => void): () => void
    }
  }
}

export {}
