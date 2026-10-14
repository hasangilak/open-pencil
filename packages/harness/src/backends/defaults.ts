import { ClaudeCodeHarnessBackend } from './claude-code'
import { PiHarnessBackend } from './pi'
import type { PiHarnessBackendOptions } from './pi'
import type { HarnessBackend } from './types'

/** The backends a companion offers, configured from its environment. */
export function createDefaultBackends(
  env: NodeJS.ProcessEnv = process.env
): Map<string, HarnessBackend> {
  const piOptions: PiHarnessBackendOptions = {}
  if (env.OPENPENCIL_HARNESS_AGENT_DIR) piOptions.agentDir = env.OPENPENCIL_HARNESS_AGENT_DIR
  if (env.OPENPENCIL_HARNESS_API_KEY) piOptions.apiKey = env.OPENPENCIL_HARNESS_API_KEY
  const claudeCommand = env.OPENPENCIL_HARNESS_CLAUDE_COMMAND
  const backends: HarnessBackend[] = [
    new PiHarnessBackend(piOptions),
    new ClaudeCodeHarnessBackend(claudeCommand ? { command: claudeCommand } : {})
  ]
  return new Map(backends.map((backend) => [backend.id, backend]))
}
