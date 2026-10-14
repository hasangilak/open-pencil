import { describe, expect, test } from 'bun:test'

import {
  ClaudeCodeHarnessBackend,
  ClaudeStreamMapper,
  claudeArguments,
  claudeMCPConfig
} from '../src/backends/claude-code'
import type { BackendEvent } from '../src/backends/types'
import type { HarnessSessionConfiguration } from '../src/protocol'

const FAKE_CLAUDE = new URL('./fake-claude.ts', import.meta.url).pathname

const configuration: HarnessSessionConfiguration = {
  adapter: 'claude-code',
  sandbox: 'none',
  model: 'default',
  instructions: 'Design on the canvas.',
  settings: { effort: 'low' },
  mcpServers: {
    'open-pencil': {
      url: 'http://127.0.0.1:7600/mcp',
      headers: { 'x-openpencil-agent': 'harness', Authorization: 'Bearer token' },
      auth: false
    }
  }
}

function fakeBackend() {
  return new ClaudeCodeHarnessBackend({ command: process.execPath, args: [FAKE_CLAUDE] })
}

async function collect(events: AsyncIterable<BackendEvent>): Promise<BackendEvent[]> {
  const seen: BackendEvent[] = []
  for await (const event of events) seen.push(event)
  return seen
}

describe('Claude Code MCP configuration', () => {
  test('passes HTTP servers with their headers and allows only their tools', () => {
    const { config, allowedTools } = claudeMCPConfig(configuration.mcpServers)
    expect(config.mcpServers['open-pencil']).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:7600/mcp',
      headers: { 'x-openpencil-agent': 'harness', Authorization: 'Bearer token' }
    })
    expect(allowedTools).toEqual(['mcp__open-pencil'])
  })

  test('refuses a server that would start a local command', () => {
    expect(() => claudeMCPConfig({ shell: { command: 'sh', args: ['-c', 'echo'] } })).toThrow(
      'only HTTP MCP servers'
    )
  })
})

describe('Claude Code arguments', () => {
  test('run without built-in tools, personal settings, or saved sessions', () => {
    const args = claudeArguments(configuration)
    expect(args.slice(0, 7)).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose'
    ])
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('--no-session-persistence')
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('Design on the canvas.')
    expect(args[args.indexOf('--effort') + 1]).toBe('low')
    // "default" leaves the model to Claude Code.
    expect(args).not.toContain('--model')
  })

  test('pass a chosen model and drop an unknown effort', () => {
    const args = claudeArguments({
      ...configuration,
      model: 'claude-opus-5-5',
      settings: { effort: 'huge' }
    })
    expect(args[args.indexOf('--model') + 1]).toBe('claude-opus-5-5')
    expect(args).not.toContain('--effort')
  })
})

describe('Claude stream mapping', () => {
  test('streams tool input, then the complete call and its result', () => {
    const mapper = new ClaudeStreamMapper()
    const map = (message: object) => mapper.map(message).events
    expect(
      map({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 't1', name: 'mcp__open-pencil__render' }
        }
      })
    ).toEqual([
      { type: 'tool-input-start', toolCallId: 't1', toolName: 'mcp__open-pencil__render' }
    ])
    expect(
      map({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"jsx":' }
        }
      })
    ).toEqual([{ type: 'tool-input-delta', toolCallId: 't1', delta: '{"jsx":' }])
    expect(
      map({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }]
        }
      })
    ).toEqual([
      {
        type: 'tool-result',
        toolCallId: 't1',
        toolName: 'mcp__open-pencil__render',
        output: { content: [{ type: 'text', text: 'ok' }], isError: false }
      }
    ])
  })

  test('reports a declined request as an error', () => {
    const mapper = new ClaudeStreamMapper()
    mapper.map({
      type: 'stream_event',
      event: { type: 'message_delta', delta: { stop_reason: 'refusal' } }
    })
    const { events, done } = mapper.map({ type: 'result', subtype: 'success', is_error: false })
    expect(done).toBe(true)
    expect(events).toEqual([
      { type: 'error', message: 'The model declined this request.' },
      { type: 'finish', finishReason: 'stop' }
    ])
  })
})

describe('ClaudeCodeHarnessBackend', () => {
  test('streams a turn from the CLI and keeps the process for the next one', async () => {
    const session = await fakeBackend().createSession({ sessionId: 's1', configuration })
    try {
      const events = await collect(session.runTurn('render'))
      expect(events.map((event) => event.type)).toEqual([
        'tool-input-start',
        'tool-input-delta',
        'tool-input-delta',
        'tool-input-delta',
        'tool-call',
        'tool-result',
        'text-delta',
        'finish'
      ])
      const streamed = events
        .flatMap((event) => (event.type === 'tool-input-delta' ? [event.delta] : []))
        .join('')
      expect(JSON.parse(streamed)).toEqual({ jsx: '<Frame w={320}></Frame>' })
      expect(events.at(-1)).toEqual({ type: 'finish', finishReason: 'stop' })
      // The same process answers the next turn.
      expect((await collect(session.runTurn('render'))).at(-1)).toEqual({
        type: 'finish',
        finishReason: 'stop'
      })
    } finally {
      await session.destroy()
    }
  })

  test('a stopped turn ends quietly and the session keeps working', async () => {
    const session = await fakeBackend().createSession({ sessionId: 's2', configuration })
    try {
      const controller = new AbortController()
      const seen: BackendEvent[] = []
      for await (const event of session.runTurn('wait', controller.signal)) {
        seen.push(event)
        if (event.type === 'text-delta') controller.abort()
      }
      expect(seen).toEqual([{ type: 'text-delta', text: 'Working' }])
      expect((await collect(session.runTurn('render'))).at(-1)).toEqual({
        type: 'finish',
        finishReason: 'stop'
      })
    } finally {
      await session.destroy()
    }
  })

  test('a CLI that exits mid-turn fails the turn with its last stderr line', async () => {
    const session = await fakeBackend().createSession({ sessionId: 's3', configuration })
    const events = await collect(session.runTurn('crash'))
    expect(events[0]).toEqual({ type: 'error', message: 'Claude Code exited (code 3): boom' })
    expect(events.at(-1)).toEqual({ type: 'finish', finishReason: 'error' })
    await session.destroy()
  })

  test('a missing CLI fails the session with a fix', async () => {
    const backend = new ClaudeCodeHarnessBackend({ command: 'openpencil-missing-claude' })
    await expect(backend.createSession({ sessionId: 's4', configuration })).rejects.toThrow(
      'Claude Code was not found'
    )
  })

  test('only the none sandbox is accepted', async () => {
    await expect(
      fakeBackend().createSession({
        sessionId: 's5',
        configuration: { ...configuration, sandbox: 'just-bash' }
      })
    ).rejects.toThrow('none sandbox')
  })
})
