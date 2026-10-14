import type {
  HarnessAdapterID,
  HarnessProviderCapability,
  HarnessSessionConfiguration,
  HarnessTurnEvent,
  JSONValue
} from '../protocol'

export type HarnessResumeState = {
  type: 'resume-session'
  harnessId: string
  specificationVersion: 'harness-v1'
  data: JSONValue
  continueFrom?: JSONValue
}

export interface BackendSession {
  readonly sessionId: string
  readonly isResume: boolean
  runTurn(prompt: string, signal?: AbortSignal): AsyncIterable<BackendEvent>
  stop(): Promise<HarnessResumeState>
  destroy(): Promise<void>
}

export type BackendEvent = HarnessTurnEvent

export interface HarnessBackend {
  readonly id: HarnessAdapterID
  readonly capabilities: HarnessProviderCapability
  createSession(options: {
    sessionId: string
    resumeState?: HarnessResumeState
    configuration?: HarnessSessionConfiguration
    signal?: AbortSignal
  }): Promise<BackendSession>
}
