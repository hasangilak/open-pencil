import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

import type { HarnessSessionConfiguration, JSONValue } from '../protocol'
import { EventQueue } from './queue'
import type { BackendEvent, BackendSession, HarnessBackend, HarnessResumeState } from './types'

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
/** How long a stopped turn may take to wind down before its process is ended instead. */
const INTERRUPT_GRACE_MS = 5000
const STDERR_TAIL_LENGTH = 2000

export interface ClaudeCodeHarnessBackendOptions {
  /** The Claude Code CLI; `claude` on `PATH` by default. */
  command?: string
  /** Arguments placed before the session's own, for a wrapper such as a test double. */
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asJSONValue(value: unknown): JSONValue {
  if (value === undefined) return null
  try {
    return structuredClone(value) as JSONValue
  } catch {
    return null
  }
}

/**
 * Claude Code reaches the canvas only through MCP. A network client chooses these servers, so a
 * server that would start a local command is refused; only HTTP endpoints pass.
 */
export function claudeMCPConfig(servers: HarnessSessionConfiguration['mcpServers'] = {}): {
  config: {
    mcpServers: Record<string, { type: 'http'; url: string; headers?: Record<string, string> }>
  }
  allowedTools: string[]
} {
  const mcpServers: Record<
    string,
    { type: 'http'; url: string; headers?: Record<string, string> }
  > = {}
  for (const [name, server] of Object.entries(servers)) {
    if (!/^[\w-]+$/.test(name)) throw new Error(`Invalid MCP server name: ${name}`)
    const { url, headers } = server
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error(`Claude Code sessions accept only HTTP MCP servers (${name})`)
    }
    const entry: { type: 'http'; url: string; headers?: Record<string, string> } = {
      type: 'http',
      url
    }
    if (isRecord(headers)) {
      entry.headers = Object.fromEntries(
        Object.entries(headers).filter(
          (pair): pair is [string, string] => typeof pair[1] === 'string'
        )
      )
    }
    mcpServers[name] = entry
  }
  // `mcp__<server>` allows every tool of that server and nothing else.
  return {
    config: { mcpServers },
    allowedTools: Object.keys(mcpServers).map((name) => `mcp__${name}`)
  }
}

export function claudeArguments(configuration: HarnessSessionConfiguration): string[] {
  const { config, allowedTools } = claudeMCPConfig(configuration.mcpServers)
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    // No shell, files, or web: the agent works on the canvas through MCP alone.
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify(config),
    // A person's own settings, hooks, and CLAUDE.md stay out of design sessions.
    '--setting-sources',
    '',
    '--no-session-persistence'
  ]
  if (allowedTools.length) args.push('--allowedTools', allowedTools.join(','))
  if (configuration.instructions) args.push('--system-prompt', configuration.instructions)
  const model = configuration.model.trim()
  if (model && model !== 'default') args.push('--model', model)
  const effort = configuration.settings?.effort
  if (typeof effort === 'string' && EFFORT_LEVELS.some((level) => level === effort)) {
    args.push('--effort', effort)
  }
  return args
}

/** Maps one turn's Claude Code `stream-json` output to Harness events. */
export class ClaudeStreamMapper {
  /** Tool calls by content block index, for the message streaming now. */
  private blocks = new Map<number, string>()
  private readonly toolNames = new Map<string, string>()
  private stopReason: string | null = null

  map(message: unknown): { events: BackendEvent[]; done: boolean } {
    if (!isRecord(message)) return { events: [], done: false }
    if (message.type === 'result') return { events: this.mapResult(message), done: true }
    if (message.type === 'stream_event' && isRecord(message.event)) {
      return { events: this.mapStreamEvent(message.event), done: false }
    }
    if (message.type === 'assistant' && isRecord(message.message)) {
      return { events: this.mapToolCalls(message.message), done: false }
    }
    if (message.type === 'user' && isRecord(message.message)) {
      return { events: this.mapToolResults(message.message), done: false }
    }
    return { events: [], done: false }
  }

  /** The complete message: each tool call's final input. */
  private mapToolCalls(message: Record<string, unknown>): BackendEvent[] {
    const events: BackendEvent[] = []
    for (const block of contentBlocks(message)) {
      if (block.type !== 'tool_use' || typeof block.id !== 'string') continue
      const toolName = typeof block.name === 'string' ? block.name : ''
      this.toolNames.set(block.id, toolName)
      events.push({
        type: 'tool-call',
        toolCallId: block.id,
        toolName,
        input: asJSONValue(block.input)
      })
    }
    return events
  }

  /** Claude Code reports tool results as a user message, in the shape MCP clients show. */
  private mapToolResults(message: Record<string, unknown>): BackendEvent[] {
    const events: BackendEvent[] = []
    for (const block of contentBlocks(message)) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      const content =
        typeof block.content === 'string'
          ? [{ type: 'text', text: block.content }]
          : (block.content ?? [])
      events.push({
        type: 'tool-result',
        toolCallId: block.tool_use_id,
        toolName: this.toolNames.get(block.tool_use_id) ?? '',
        output: { content: asJSONValue(content), isError: block.is_error === true }
      })
    }
    return events
  }

  private mapResult(message: Record<string, unknown>): BackendEvent[] {
    const failed = message.is_error === true || message.subtype !== 'success'
    const events: BackendEvent[] = []
    if (this.stopReason === 'refusal') {
      events.push({ type: 'error', message: 'The model declined this request.' })
    } else if (failed) {
      const detail = typeof message.result === 'string' && message.result ? message.result : null
      events.push({
        type: 'error',
        message: detail ?? `Claude Code ended the turn: ${String(message.subtype)}`
      })
    }
    events.push({ type: 'finish', finishReason: failed ? 'error' : 'stop' })
    return events
  }

  private mapStreamEvent(event: Record<string, unknown>): BackendEvent[] {
    const index = typeof event.index === 'number' ? event.index : -1
    if (event.type === 'message_start') {
      this.blocks = new Map()
    } else if (event.type === 'content_block_start' && isRecord(event.content_block)) {
      return this.mapBlockStart(index, event.content_block)
    } else if (event.type === 'content_block_delta' && isRecord(event.delta)) {
      return this.mapDelta(index, event.delta)
    } else if (event.type === 'message_delta' && isRecord(event.delta)) {
      if (typeof event.delta.stop_reason === 'string') this.stopReason = event.delta.stop_reason
    }
    return []
  }

  private mapBlockStart(index: number, block: Record<string, unknown>): BackendEvent[] {
    if (block.type !== 'tool_use' || typeof block.id !== 'string') return []
    const toolName = typeof block.name === 'string' ? block.name : ''
    this.blocks.set(index, block.id)
    this.toolNames.set(block.id, toolName)
    return [{ type: 'tool-input-start', toolCallId: block.id, toolName }]
  }

  private mapDelta(index: number, delta: Record<string, unknown>): BackendEvent[] {
    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      return [{ type: 'text-delta', text: delta.text }]
    }
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
      return [{ type: 'reasoning-delta', text: delta.thinking }]
    }
    if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const toolCallId = this.blocks.get(index)
      if (toolCallId && delta.partial_json) {
        return [{ type: 'tool-input-delta', toolCallId, delta: delta.partial_json }]
      }
    }
    return []
  }
}

function contentBlocks(message: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(message.content) ? message.content.filter(isRecord) : []
}

class ClaudeCodeSession implements BackendSession {
  readonly isResume = false
  private child: ChildProcessWithoutNullStreams | null = null
  private turn: { queue: EventQueue<BackendEvent>; mapper: ClaudeStreamMapper } | null = null
  private claudeSessionId: string | null = null
  private stderr = ''
  private requestCount = 0

  constructor(
    readonly sessionId: string,
    private readonly command: string,
    private readonly args: string[],
    private readonly options: ClaudeCodeHarnessBackendOptions
  ) {}

  /** Starts Claude Code now, so a missing CLI fails the session rather than its first turn. */
  async start(): Promise<void> {
    const env = { ...(this.options.env ?? process.env) }
    // Launching from inside a Claude Code session is allowed; the child is its own session.
    delete env.CLAUDECODE
    const child = spawn(this.command, this.args, {
      cwd: this.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    child.stdin.on('error', () => undefined)
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-STDERR_TAIL_LENGTH)
    })
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
      this.onLine(line)
    })
    // `close` comes after stderr is read, so the last line can name what went wrong.
    child.on('close', (code, signal) => {
      if (this.child === child) this.child = null
      const tail = this.stderr.trim().split('\n').pop()
      this.failTurn(`Claude Code exited (${signal ?? `code ${code}`})${tail ? `: ${tail}` : ''}`)
    })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve())
      child.once('error', (error: NodeJS.ErrnoException) => {
        if (this.child === child) this.child = null
        reject(
          error.code === 'ENOENT'
            ? new Error(
                `Claude Code was not found: install it and make sure "${this.command}" is on PATH`
              )
            : error
        )
      })
    })
  }

  async *runTurn(prompt: string, signal?: AbortSignal): AsyncIterable<BackendEvent> {
    if (this.turn) throw new Error('A Claude Code turn is already running')
    if (!this.child) await this.start()
    const child = this.child
    if (!child) throw new Error('Claude Code is not running')
    const queue = new EventQueue<BackendEvent>()
    this.turn = { queue, mapper: new ClaudeStreamMapper() }
    let interruptTimer: ReturnType<typeof setTimeout> | undefined
    // Stop interrupts the turn and keeps the conversation; a turn that does not wind down in
    // time ends the process, and the next turn starts a new one.
    const interrupt = () => {
      this.send({
        type: 'control_request',
        request_id: this.nextRequestId(),
        request: { subtype: 'interrupt' }
      })
      interruptTimer = setTimeout(() => {
        child.kill()
        queue.end()
      }, INTERRUPT_GRACE_MS)
    }
    if (signal?.aborted) interrupt()
    else signal?.addEventListener('abort', interrupt, { once: true })
    try {
      this.send({ type: 'user', message: { role: 'user', content: prompt } })
      for await (const event of queue) {
        // A stopped turn ends quietly: its error is the interruption itself.
        if (signal?.aborted && (event.type === 'error' || event.type === 'finish')) continue
        yield event
      }
    } finally {
      signal?.removeEventListener('abort', interrupt)
      if (interruptTimer) clearTimeout(interruptTimer)
      this.turn = null
    }
  }

  async stop(): Promise<HarnessResumeState> {
    const data = this.claudeSessionId ? { claudeSessionId: this.claudeSessionId } : null
    await this.destroy()
    return {
      type: 'resume-session',
      harnessId: 'claude-code',
      specificationVersion: 'harness-v1',
      data
    }
  }

  async destroy(): Promise<void> {
    const child = this.child
    this.child = null
    if (!child) return
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
    })
    child.stdin.end()
    child.kill()
    await exited
  }

  private send(message: object): void {
    this.child?.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private nextRequestId(): string {
    this.requestCount += 1
    return `openpencil-${this.requestCount}`
  }

  private onLine(line: string): void {
    if (!line.trim()) return
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (isRecord(message) && typeof message.session_id === 'string') {
      this.claudeSessionId = message.session_id
    }
    const turn = this.turn
    if (!turn) return
    const { events, done } = turn.mapper.map(message)
    for (const event of events) turn.queue.push(event)
    if (done) turn.queue.end()
  }

  private failTurn(message: string): void {
    const turn = this.turn
    if (!turn) return
    turn.queue.push({ type: 'error', message })
    turn.queue.push({ type: 'finish', finishReason: 'error' })
    turn.queue.end()
  }
}

/** Runs Claude Code headless with the person's own sign-in, one process per session. */
export class ClaudeCodeHarnessBackend implements HarnessBackend {
  readonly id = 'claude-code'
  readonly capabilities = {
    adapter: 'claude-code',
    sandboxes: ['none'],
    structuredOutput: false,
    sessionResume: 'live-process',
    turnContinuation: true
  } as const

  constructor(private readonly options: ClaudeCodeHarnessBackendOptions = {}) {}

  async createSession(options: {
    sessionId: string
    resumeState?: HarnessResumeState
    configuration?: HarnessSessionConfiguration
    signal?: AbortSignal
  }): Promise<BackendSession> {
    const { configuration } = options
    if (!configuration) throw new Error('Harness configuration is required')
    if (configuration.sandbox !== 'none')
      throw new Error('Claude Code sessions use the none sandbox')
    const session = new ClaudeCodeSession(
      options.sessionId,
      this.options.command ?? 'claude',
      [...(this.options.args ?? []), ...claudeArguments(configuration)],
      this.options
    )
    await session.start()
    return session
  }
}
