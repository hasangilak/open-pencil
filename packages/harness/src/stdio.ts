#!/usr/bin/env node

import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { createDefaultBackends } from '#harness/backends/defaults'
import { createHarnessHost } from '#harness/host'
import { reserveProtocolOutput } from '#harness/output'
import type { HarnessSidecarMessage } from '#harness/protocol'
import { HarnessSessionService } from '#harness/service'
import { FileResumeStateStore } from '#harness/session-store'
import { loadTypeScriptDependencies } from '#harness/typescript-dependencies'

import packageJSON from '../package.json' with { type: 'json' }

// The app reads this to check that the companion matches it, before anything else starts.
if (process.argv.includes('--version')) {
  process.stdout.write(`${packageJSON.version}\n`)
  process.exit(0)
}

const writeProtocol = reserveProtocolOutput()
loadTypeScriptDependencies()

const stateRoot =
  process.env.OPENPENCIL_HARNESS_STATE_DIR ?? join(homedir(), '.open-pencil', 'harness-sessions')
const service = new HarnessSessionService(
  createDefaultBackends(),
  new FileResumeStateStore(stateRoot)
)

async function emit(message: HarnessSidecarMessage): Promise<void> {
  if (writeProtocol(`${JSON.stringify(message)}\n`)) return
  await new Promise<void>((resolve) => {
    process.stdout.once('drain', resolve)
  })
}

const host = createHarnessHost({ service, emit })
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => host.receive(line, () => input.close()))
input.on('close', () => {
  host.close().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
})
process.on('SIGTERM', () => input.close())
process.on('SIGINT', () => input.close())
