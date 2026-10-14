/**
 * The Harness companion for the browser app: the same JSONL protocol as `stdio.ts`, one JSON
 * message per WebSocket frame. It listens on loopback only, accepts connections from the origins
 * it is given, and serves a connection only after it sends the token as its first message.
 */

import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { WebSocketServer } from 'ws'
import type { RawData, WebSocket } from 'ws'

import packageJSON from '../package.json' with { type: 'json' }
import type { HarnessBackend } from './backends/types'
import { HARNESS_SOCKET_PATH } from './constants'
import { createHarnessHost } from './host'
import { MAX_PROTOCOL_LINE_BYTES } from './protocol'
import { HarnessSessionService } from './service'
import { FileResumeStateStore } from './session-store'

const AUTH_TIMEOUT_MS = 5000

export interface HarnessServerOptions {
  port: number
  token: string
  /** Browser origins allowed to connect, such as `http://localhost:1420`. */
  origins: readonly string[]
  backends: ReadonlyMap<string, HarnessBackend>
  stateRoot: string
  /** Whether the Claude Code CLI starts, reported by `/health`. */
  claudeCodeInstalled?: () => boolean
}

function tokensMatch(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** A frame's text, whichever buffer shape `ws` delivered it in. */
function frameText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}

function firstMessageToken(data: RawData): unknown {
  try {
    const message: unknown = JSON.parse(frameText(data))
    if (typeof message === 'object' && message !== null && 'token' in message) {
      return message.token
    }
  } catch {
    return undefined
  }
  return undefined
}

export function startHarnessServer(options: HarnessServerOptions) {
  const origins = new Set(options.origins)
  let claudeCodeInstalled: boolean | null = null
  /** Each closed connection's session teardown, which `close()` waits for. */
  const closingConnections = new Set<Promise<void>>()

  function cors(request: IncomingMessage, response: ServerResponse): boolean {
    const origin = request.headers.origin
    if (!origin) return true
    if (!origins.has(origin)) return false
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
    return true
  }

  const server = createServer((request, response) => {
    if (!cors(request, response)) {
      response.writeHead(403).end()
      return
    }
    if (request.method === 'GET' && request.url === '/health') {
      claudeCodeInstalled ??= options.claudeCodeInstalled?.() ?? false
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          ok: true,
          version: packageJSON.version,
          adapters: [...options.backends.keys()],
          claudeCode: claudeCodeInstalled
        })
      )
      return
    }
    response.writeHead(404).end()
  })

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_PROTOCOL_LINE_BYTES })
  // Any web page can open a WebSocket to loopback; only the app's own origins get one here.
  server.on('upgrade', (request, socket, head) => {
    const { origin } = request.headers
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (path !== HARNESS_SOCKET_PATH || !origin || !origins.has(origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    sockets.handleUpgrade(request, socket, head, (client) =>
      sockets.emit('connection', client, request)
    )
  })

  sockets.on('connection', (socket: WebSocket) => {
    const timer = setTimeout(() => socket.close(4401, 'Authentication required'), AUTH_TIMEOUT_MS)
    socket.once('message', (data) => {
      clearTimeout(timer)
      if (!tokensMatch(options.token, firstMessageToken(data))) {
        socket.close(4401, 'Authentication failed')
        return
      }
      serveConnection(socket)
    })
  })

  function serveConnection(socket: WebSocket): void {
    // Each connection owns its sessions; closing it stops them.
    const service = new HarnessSessionService(
      options.backends,
      new FileResumeStateStore(options.stateRoot)
    )
    const host = createHarnessHost({
      service,
      async emit(message) {
        if (socket.readyState !== socket.OPEN) return
        await new Promise<void>((resolve, reject) => {
          socket.send(JSON.stringify(message), (error) => {
            if (error) reject(error)
            else resolve()
          })
        })
      }
    })
    socket.on('message', (data) => host.receive(frameText(data), () => socket.close()))
    socket.on('close', () => {
      const closing = host
        .close()
        .catch((error: unknown) => {
          console.error('[Harness] Closing a connection failed:', error)
        })
        .finally(() => closingConnections.delete(closing))
      closingConnections.add(closing)
    })
    socket.send(JSON.stringify({ type: 'ready', version: packageJSON.version }))
  }

  const listening = new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : options.port)
    })
  })

  return {
    listening,
    async close(): Promise<void> {
      const closed = [...sockets.clients].map(
        (client) =>
          new Promise<void>((resolve) => {
            client.once('close', () => resolve())
          })
      )
      for (const client of sockets.clients) client.close()
      await Promise.all(closed)
      await Promise.allSettled(closingConnections)
      await new Promise<void>((resolve) => {
        sockets.close(() => resolve())
      })
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
  }
}
