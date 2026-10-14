import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import process from 'node:process'

import type { Plugin } from 'vite'

import { DEFAULT_HARNESS_PORT, HARNESS_SOCKET_PATH } from '@open-pencil/harness/constants'

import { automationCORSOrigin } from './automation'

export type LocalHarnessRoute = {
  /** What the browser app connects to; empty when the dev server starts no companion. */
  url: string
  token: string
  port: number
  origins: string[]
}

/**
 * The Harness companion `bun run dev` starts so the browser app can run Claude Code with the
 * developer's own sign-in. `OPENPENCIL_DEV_HARNESS=0` turns it off.
 */
export function localHarnessRoute(command: string, host: string | undefined): LocalHarnessRoute {
  const port = Number(process.env.OPENPENCIL_DEV_HARNESS_PORT ?? DEFAULT_HARNESS_PORT)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('OPENPENCIL_DEV_HARNESS_PORT must be an integer between 1024 and 65535')
  }
  const enabled = command === 'serve' && process.env.OPENPENCIL_DEV_HARNESS !== '0'
  const origins = [process.env.OPENPENCIL_DEV_ORIGIN ?? automationCORSOrigin(host)]
  if (process.env.PORTLESS_URL) origins.push(new URL(process.env.PORTLESS_URL).origin)
  return {
    url: enabled ? `ws://127.0.0.1:${port}${HARNESS_SOCKET_PATH}` : '',
    token: enabled ? randomUUID() : '',
    port,
    origins
  }
}

export function openPencilHarnessPlugin(route: LocalHarnessRoute): Plugin {
  let child: ChildProcess | null = null
  return {
    name: 'open-pencil-harness',
    apply: 'serve',
    configureServer(server) {
      if (!route.url) return
      // Under Bun, run the companion with the same Bun; otherwise find Bun on PATH.
      const bun = process.versions.bun ? process.execPath : 'bun'
      child = spawn(bun, ['run', 'packages/harness/src/serve.ts'], {
        stdio: ['ignore', 'inherit', 'pipe'],
        env: {
          ...process.env,
          OPENPENCIL_HARNESS_PORT: String(route.port),
          OPENPENCIL_HARNESS_TOKEN: route.token,
          OPENPENCIL_HARNESS_ORIGINS: route.origins.join(','),
          // The automation plugin runs the dev MCP server and gives the app its token.
          OPENPENCIL_HARNESS_MCP: '0'
        }
      })
      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        if (text.includes('EADDRINUSE')) {
          console.error(
            `\x1b[31m[Harness] Port ${route.port} is in use. Is another OpenPencil dev server running? Set OPENPENCIL_DEV_HARNESS_PORT to use another.\x1b[0m`
          )
          return
        }
        process.stderr.write(data)
      })
      child.on('error', (error) => {
        console.error(`[Harness] Failed to start the companion: ${error.message}`)
      })
      server.httpServer?.once('close', () => {
        child?.kill()
        child = null
      })
    }
  }
}
