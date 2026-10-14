import { expect, test } from 'bun:test'

import type { HarnessSidecarMessage } from '@open-pencil/harness'

import { HarnessChatTransport } from '@/app/ai/harness/transport'

test('failed session stop kills the process without deleting resume state', async () => {
  let output: ReadableStreamDefaultController<HarnessSidecarMessage> | undefined
  const methods: string[] = []
  let kills = 0
  const transport = new HarnessChatTransport(
    'test-session',
    {
      adapter: 'pi',
      sandbox: 'just-bash',
      model: 'test',
      settings: {},
      instructions: '',
      mcpServers: {}
    },
    {},
    async () => ({
      child: {
        write: async () => undefined,
        kill: async () => {
          kills++
          output?.close()
        }
      },
      messages: new ReadableStream({
        start(controller) {
          output = controller
        }
      }),
      send: async (request) => {
        if (
          !('id' in request) ||
          !('method' in request) ||
          typeof request.id !== 'string' ||
          typeof request.method !== 'string'
        )
          throw new Error('Invalid request')
        methods.push(request.method)
        output?.enqueue({
          type: 'response',
          id: request.id,
          ...(request.method === 'session.stop'
            ? { error: 'Resume storage failed' }
            : { result: {} })
        })
      }
    })
  )
  const stream = await transport.sendMessages({
    chatId: 'test',
    trigger: 'submit-message',
    messageId: undefined,
    messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    abortSignal: undefined
  })
  const reader = stream.getReader()
  while (!(await reader.read()).done) {
    /* Drain the completed turn. */
  }
  await expect(transport.stop()).rejects.toThrow('Resume storage failed')
  expect(kills).toBe(1)
  expect(methods).toContain('session.stop')
  expect(methods).not.toContain('session.destroy')
  await transport.stop()
  expect(kills).toBe(1)
})

const configuration = {
  adapter: 'pi',
  sandbox: 'just-bash',
  model: 'test',
  settings: {},
  instructions: '',
  mcpServers: {}
} as const

/**
 * A companion that answers session requests at once and holds each turn open, so the test
 * decides when its events and its answer arrive, as Pi's do after a Stop.
 */
function fakeCompanion({ turnsFail = false } = {}) {
  let output: ReadableStreamDefaultController<HarnessSidecarMessage> | undefined
  const methods: string[] = []
  const turns: string[] = []
  let spawns = 0
  const spawn = async () => {
    spawns++
    return {
      child: { write: async () => undefined, kill: async () => output?.close() },
      messages: new ReadableStream<HarnessSidecarMessage>({
        start(controller) {
          output = controller
        }
      }),
      send: async (request: object) => {
        if (!('id' in request) || !('method' in request)) throw new Error('Invalid request')
        const { id, method } = request
        if (typeof id !== 'string' || typeof method !== 'string') throw new Error('Invalid request')
        methods.push(method)
        if (method === 'session.turn' && turnsFail) throw new Error('Pipe closed')
        if (method === 'session.turn') turns.push(id)
        else output?.enqueue({ type: 'response', id, result: {} })
      }
    }
  }
  return {
    spawn,
    methods,
    get spawns() {
      return spawns
    },
    /** The turn's next event or its final answer, as the companion would send it. */
    text: (turn: string, text: string) =>
      output?.enqueue({ type: 'turn.event', id: turn, event: { type: 'text-delta', text } }),
    complete: (turn: string) =>
      output?.enqueue({ type: 'response', id: turn, result: { completed: true } }),
    turns
  }
}

function send(transport: HarnessChatTransport, abortSignal?: AbortSignal) {
  return transport.sendMessages({
    chatId: 'test',
    trigger: 'submit-message',
    messageId: undefined,
    messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
    abortSignal
  })
}

test('stopping a turn keeps the session, and its late events and answer are ignored', async () => {
  const companion = fakeCompanion()
  const transport = new HarnessChatTransport('stop-session', configuration, {}, companion.spawn)
  const stop = new AbortController()
  const reader = (await send(transport, stop.signal)).getReader()
  await Promise.resolve()
  const [first = ''] = companion.turns
  companion.text(first, 'one')

  // As the AI SDK's Chat.stop does: abort the request, then drop the reader.
  stop.abort()
  await reader.cancel()
  companion.text(first, 'two')
  companion.complete(first)
  await Promise.resolve()

  const next = (await send(transport)).getReader()
  await Promise.resolve()
  const second = companion.turns.at(1) ?? ''
  companion.text(second, 'pong')
  companion.complete(second)
  const chunks: string[] = []
  for (let read = await next.read(); !read.done; read = await next.read()) {
    if (read.value.type === 'text-delta') chunks.push(read.value.delta)
  }

  expect(chunks).toEqual(['pong'])
  expect(companion.spawns).toBe(1)
  expect(companion.methods.filter((method) => method === 'session.create')).toHaveLength(1)
  expect(companion.methods.filter((method) => method === 'session.cancel')).toHaveLength(1)
  await transport.destroy()
})

test('stopping a turn that already ended does not cancel the next one', async () => {
  const companion = fakeCompanion()
  const transport = new HarnessChatTransport('late-stop', configuration, {}, companion.spawn)
  const stop = new AbortController()
  const reader = (await send(transport, stop.signal)).getReader()
  await Promise.resolve()
  companion.complete(companion.turns[0] ?? '')
  while (!(await reader.read()).done);

  const next = (await send(transport)).getReader()
  await Promise.resolve()
  stop.abort()
  const second = companion.turns.at(1) ?? ''
  companion.text(second, 'pong')
  companion.complete(second)
  const chunks: string[] = []
  for (let read = await next.read(); !read.done; read = await next.read()) {
    if (read.value.type === 'text-delta') chunks.push(read.value.delta)
  }

  expect(chunks).toEqual(['pong'])
  expect(companion.methods).not.toContain('session.cancel')
  await transport.destroy()
})

test('a turn the companion could not be sent ends with an error', async () => {
  const companion = fakeCompanion({ turnsFail: true })
  const transport = new HarnessChatTransport('broken-pipe', configuration, {}, companion.spawn)
  const reader = (await send(transport)).getReader()
  const types: string[] = []
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    types.push(read.value.type)
  }

  expect(types.at(-1)).toBe('error')
  await transport.destroy()
})

test('streamed render input reaches the chat and the canvas preview until its layers exist', async () => {
  let output: ReadableStreamDefaultController<HarnessSidecarMessage> | undefined
  const previews: string[] = []
  const transport = new HarnessChatTransport(
    'preview-session',
    { ...configuration, adapter: 'claude-code', sandbox: 'none' },
    {},
    async () => ({
      child: { write: async () => undefined, kill: async () => output?.close() },
      messages: new ReadableStream({
        start(controller) {
          output = controller
        }
      }),
      send: async (request) => {
        if (!('id' in request) || typeof request.id !== 'string') throw new Error('Invalid request')
        const id = request.id
        if (!('method' in request) || request.method !== 'session.turn') {
          output?.enqueue({ type: 'response', id, result: {} })
          return
        }
        const events = [
          { type: 'tool-input-start', toolCallId: 'r1', toolName: 'mcp__open-pencil__render' },
          { type: 'tool-input-delta', toolCallId: 'r1', delta: '{"jsx": "<Frame' },
          { type: 'tool-input-delta', toolCallId: 'r1', delta: ' w={320} />"}' },
          {
            type: 'tool-call',
            toolCallId: 'r1',
            toolName: 'mcp__open-pencil__render',
            input: { jsx: '<Frame w={320} />' }
          },
          {
            type: 'tool-result',
            toolCallId: 'r1',
            toolName: 'mcp__open-pencil__render',
            output: { content: [], isError: false }
          }
        ] as const
        for (const event of events) output?.enqueue({ type: 'turn.event', id, event })
        output?.enqueue({ type: 'response', id, result: { completed: true } })
      }
    }),
    {
      start: (id) => previews.push(`start:${id}`),
      delta: (id, text) => previews.push(`delta:${id}:${text}`),
      finish: (id) => previews.push(`finish:${id}`),
      clear: () => previews.push('clear')
    }
  )
  const stream = await transport.sendMessages({
    chatId: 'test',
    trigger: 'submit-message',
    messageId: undefined,
    messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Draw a card' }] }],
    abortSignal: undefined
  })
  const chunks = []
  const reader = stream.getReader()
  for (let next = await reader.read(); !next.done; next = await reader.read())
    chunks.push(next.value)

  expect(chunks.filter((chunk) => chunk.type.startsWith('tool-'))).toEqual([
    {
      type: 'tool-input-start',
      toolCallId: 'r1',
      toolName: 'mcp__open-pencil__render',
      providerExecuted: true
    },
    { type: 'tool-input-delta', toolCallId: 'r1', inputTextDelta: '{"jsx": "<Frame' },
    { type: 'tool-input-delta', toolCallId: 'r1', inputTextDelta: ' w={320} />"}' },
    {
      type: 'tool-input-available',
      toolCallId: 'r1',
      toolName: 'mcp__open-pencil__render',
      input: { jsx: '<Frame w={320} />' },
      providerExecuted: true
    },
    {
      type: 'tool-output-available',
      toolCallId: 'r1',
      output: { content: [], isError: false },
      providerExecuted: true
    }
  ])
  // The preview holds through the complete call and ends with its result.
  expect(previews).toEqual([
    'start:r1',
    'delta:r1:{"jsx": "<Frame',
    'delta:r1: w={320} />"}',
    'finish:r1'
  ])
  await transport.destroy()
})

test('render previews whichever way the agent names the MCP tool', async () => {
  const { isRenderTool } = await import('@/app/ai/harness/transport')
  expect(isRenderTool('mcp__open-pencil__render')).toBe(true)
  expect(isRenderTool('mcp__open_pencil_render')).toBe(true)
  expect(isRenderTool('render')).toBe(true)
  expect(isRenderTool('mcp__open-pencil__render_preview')).toBe(false)
  expect(isRenderTool('mcp__other__render')).toBe(false)
})
