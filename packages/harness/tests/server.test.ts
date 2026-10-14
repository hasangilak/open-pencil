import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WebSocket } from 'ws'

import type {
  BackendEvent,
  BackendSession,
  HarnessBackend,
  HarnessResumeState
} from '../src/backends/types'
import { HARNESS_SOCKET_PATH } from '../src/constants'
import { startHarnessServer } from '../src/server'

const ORIGIN = 'http://localhost:1420'
const TOKEN = 'test-token'

class EchoSession implements BackendSession {
  readonly isResume = false
  constructor(readonly sessionId: string) {}

  async *runTurn(prompt: string): AsyncIterable<BackendEvent> {
    yield { type: 'tool-input-start', toolCallId: 'c1', toolName: 'mcp__open-pencil__render' }
    yield { type: 'tool-input-delta', toolCallId: 'c1', delta: '{"jsx":"<Frame/>"}' }
    yield { type: 'text-delta', text: `echo:${prompt}` }
    yield { type: 'finish', finishReason: 'stop' }
  }

  async stop(): Promise<HarnessResumeState> {
    return {
      type: 'resume-session',
      harnessId: 'claude-code',
      specificationVersion: 'harness-v1',
      data: null
    }
  }

  async destroy(): Promise<void> {
    // Nothing to release.
  }
}

const backend: HarnessBackend = {
  id: 'claude-code',
  capabilities: {
    adapter: 'claude-code',
    sandboxes: ['none'],
    structuredOutput: false,
    sessionResume: 'live-process',
    turnContinuation: true
  },
  async createSession({ sessionId }) {
    return new EchoSession(sessionId)
  }
}

let server: ReturnType<typeof startHarnessServer>
let port = 0
let stateRoot = ''

beforeAll(async () => {
  stateRoot = await mkdtemp(join(tmpdir(), 'harness-server-'))
  server = startHarnessServer({
    port: 0,
    token: TOKEN,
    origins: [ORIGIN],
    backends: new Map([[backend.id, backend]]),
    stateRoot,
    claudeCodeInstalled: () => true
  })
  port = await server.listening
})

afterAll(async () => {
  await server.close()
  await rm(stateRoot, { recursive: true, force: true })
})

/** Browsers always send `Origin`; Bun's `ws` client sends it only as an explicit header. */
function connect(origin: string): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}${HARNESS_SOCKET_PATH}`, {
    headers: { Origin: origin }
  })
}

/** Messages a socket receives until `stop` returns true for one. */
function readUntil(socket: WebSocket, stop: (message: Record<string, unknown>) => boolean) {
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const seen: Record<string, unknown>[] = []
    socket.on('message', (data) => {
      const message: unknown = JSON.parse(data.toString())
      if (typeof message !== 'object' || message === null) return
      const record = Object.fromEntries(Object.entries(message))
      seen.push(record)
      if (stop(record)) resolve(seen)
    })
    socket.on('close', (code) => reject(new Error(`closed ${code}`)))
  })
}

describe('Harness WebSocket server', () => {
  test('health lists the adapters for an allowed origin and refuses other origins', async () => {
    const allowed = await fetch(`http://127.0.0.1:${port}/health`, { headers: { origin: ORIGIN } })
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(await allowed.json()).toMatchObject({
      ok: true,
      adapters: ['claude-code'],
      claudeCode: true
    })
    const refused = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { origin: 'https://evil.example' }
    })
    expect(refused.status).toBe(403)
  })

  test('refuses a WebSocket from another origin', async () => {
    const socket = connect('https://evil.example')
    const status = await new Promise<number>((resolve) => {
      socket.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
      socket.on('error', () => resolve(-1))
    })
    expect(status).not.toBe(101)
  })

  test('closes a connection whose first message has the wrong token', async () => {
    const socket = connect(ORIGIN)
    await new Promise((resolve) => {
      socket.once('open', resolve)
    })
    socket.send(JSON.stringify({ type: 'auth', token: 'wrong' }))
    const code = await new Promise<number>((resolve) => {
      socket.once('close', resolve)
    })
    expect(code).toBe(4401)
  })

  test('runs a turn for an authenticated connection, streaming tool input', async () => {
    const socket = connect(ORIGIN)
    await new Promise((resolve) => {
      socket.once('open', resolve)
    })
    const ready = readUntil(socket, (message) => message.type === 'ready')
    socket.send(JSON.stringify({ type: 'auth', token: TOKEN }))
    await ready

    const created = readUntil(socket, (message) => message.id === 'create')
    socket.send(
      JSON.stringify({
        id: 'create',
        method: 'session.create',
        params: {
          sessionId: 'session-1',
          configuration: { adapter: 'claude-code', sandbox: 'none', model: 'default' }
        }
      })
    )
    expect((await created).at(-1)).toEqual({
      type: 'response',
      id: 'create',
      result: { isResume: false }
    })

    const turn = readUntil(
      socket,
      (message) => message.type === 'response' && message.id === 'turn'
    )
    socket.send(
      JSON.stringify({
        id: 'turn',
        method: 'session.turn',
        params: { sessionId: 'session-1', prompt: 'hi' }
      })
    )
    const events = (await turn)
      .filter((message) => message.type === 'turn.event')
      .map((message) => message.event)
    expect(events).toEqual([
      { type: 'tool-input-start', toolCallId: 'c1', toolName: 'mcp__open-pencil__render' },
      { type: 'tool-input-delta', toolCallId: 'c1', delta: '{"jsx":"<Frame/>"}' },
      { type: 'text-delta', text: 'echo:hi' },
      { type: 'finish', finishReason: 'stop' }
    ])
    socket.close()
  })
})
