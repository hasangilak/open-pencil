#!/usr/bin/env node

/**
 * Starts the browser companion, `openpencil-harness-serve` (see `server.ts`). Run on its own, it
 * also starts OpenPencil's MCP server, which gives the agent the canvas tools of the browser tab
 * it pairs with, and prints the pairing link that tab opens.
 */

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { createDefaultBackends } from '#harness/backends/defaults'
import { DEFAULT_HARNESS_PORT, HARNESS_SOCKET_PATH } from '#harness/constants'
import { pairingLink } from '#harness/pairing'
import { startHarnessServer } from '#harness/server'
import { loadTypeScriptDependencies } from '#harness/typescript-dependencies'

import packageJSON from '../package.json' with { type: 'json' }

/** The hosted app, the default origin allowed to pair. */
const DEFAULT_ORIGIN = 'https://app.openpencil.dev'
const DEFAULT_MCP_PORT = 7600

function claudeCodeInstalled(command: string): boolean {
  try {
    return spawnSync(command, ['--version'], { stdio: 'ignore', timeout: 10_000 }).status === 0
  } catch {
    return false
  }
}

function portFrom(value: string | undefined, fallback: number, name: string): number {
  const port = Number(value ?? fallback)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${name} must be a port number`)
  }
  return port
}

/**
 * OpenPencil's MCP server for the paired tab, kept apart from the desktop app's: its own socket
 * and discovery file, so neither replaces the other's.
 */
async function startCanvasServer(origins: string[], stateDir: string) {
  process.env.OPENPENCIL_MCP_DISCOVERY_PATH ??= join(stateDir, 'mcp.json')
  const { startServer } = await import('@open-pencil/mcp')
  const authToken = randomBytes(32).toString('hex')
  const server = await startServer({
    httpPort: portFrom(
      process.env.OPENPENCIL_HARNESS_MCP_PORT,
      DEFAULT_MCP_PORT,
      'OPENPENCIL_HARNESS_MCP_PORT'
    ),
    withTcp: true,
    socketPath: join(stateDir, 'mcp.sock'),
    authToken,
    corsOrigin: origins
  })
  return { server, authToken }
}

async function main(): Promise<void> {
  if (process.argv.includes('--version')) {
    process.stdout.write(`${packageJSON.version}\n`)
    return
  }
  // Pi's MCP adapter publishes TypeScript sources, as for the stdio companion.
  loadTypeScriptDependencies()
  // Without a token from whoever started it, the companion makes one and shows it only in
  // the pairing link.
  const token = process.env.OPENPENCIL_HARNESS_TOKEN || randomBytes(24).toString('hex')
  const origins = (process.env.OPENPENCIL_HARNESS_ORIGINS ?? DEFAULT_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
  if (!origins.length) {
    throw new Error('Set OPENPENCIL_HARNESS_ORIGINS to the app origins allowed to connect')
  }
  const port = portFrom(
    process.env.OPENPENCIL_HARNESS_PORT,
    DEFAULT_HARNESS_PORT,
    'OPENPENCIL_HARNESS_PORT'
  )
  const stateDir =
    process.env.OPENPENCIL_HARNESS_STATE_DIR ?? join(homedir(), '.open-pencil', 'harness')
  // Browser sessions run Claude Code only unless the companion is told otherwise.
  const offered = new Set((process.env.OPENPENCIL_HARNESS_ADAPTERS ?? 'claude-code').split(','))
  const backends = new Map([...createDefaultBackends()].filter(([id]) => offered.has(id)))
  const claudeCommand = process.env.OPENPENCIL_HARNESS_CLAUDE_COMMAND ?? 'claude'
  // The dev server runs its own MCP server and hands the app its tokens itself.
  const canvas =
    process.env.OPENPENCIL_HARNESS_MCP === '0' ? null : await startCanvasServer(origins, stateDir)
  const server = startHarnessServer({
    port,
    token,
    origins,
    backends,
    stateRoot: join(stateDir, 'sessions'),
    claudeCodeInstalled: () => claudeCodeInstalled(claudeCommand)
  })
  const bound = await server.listening
  console.error(`[Harness] Listening on ws://127.0.0.1:${bound}${HARNESS_SOCKET_PATH}`)
  if (canvas) {
    console.error(`[Harness] Canvas tools on http://127.0.0.1:${canvas.server.httpPort}/mcp`)
    console.error('[Harness] Open this link to pair OpenPencil with this companion:')
    for (const origin of origins) {
      console.error(`  ${pairingLink(origin, { port: bound, token, mcpToken: canvas.authToken })}`)
    }
  }
  if (process.env.OPENPENCIL_HARNESS_READY_MARKER) {
    console.error(process.env.OPENPENCIL_HARNESS_READY_MARKER)
  }
  const shutdown = () => {
    void Promise.allSettled([server.close(), canvas?.server.close()]).finally(() => process.exit(0))
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
