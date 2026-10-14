/**
 * Stands in for `claude -p --input-format stream-json --output-format stream-json` in tests: it
 * answers each user message with the events Claude Code prints, recorded from a real session.
 *   "render": streams a render tool call, its result, and a closing text reply.
 *   "wait": streams text, then waits for an interrupt control request.
 *   "crash": exits with an error.
 */
import { createInterface } from 'node:readline'

const send = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`)
const event = (payload: object) =>
  send({ type: 'stream_event', session_id: 'claude-session', event: payload })

function promptOf(message: unknown): string {
  if (typeof message !== 'object' || message === null || !('message' in message)) return ''
  const inner = message.message
  if (typeof inner !== 'object' || inner === null || !('content' in inner)) return ''
  return typeof inner.content === 'string' ? inner.content : ''
}

function render(): void {
  event({ type: 'message_start', message: { model: 'claude-test' } })
  event({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'tool_use', id: 'toolu_1', name: 'mcp__open-pencil__render', input: {} }
  })
  for (const partial of ['', '{"jsx": "<Frame', ' w={320}>', '</Frame>"}']) {
    event({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: partial }
    })
  }
  event({ type: 'content_block_stop', index: 0 })
  send({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'mcp__open-pencil__render',
          input: { jsx: '<Frame w={320}></Frame>' }
        }
      ]
    }
  })
  send({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: [{ type: 'text', text: 'Rendered 1 layer' }]
        }
      ]
    }
  })
  event({ type: 'message_start', message: { model: 'claude-test' } })
  event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } })
  event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })
  send({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Done.',
    session_id: 'claude-session'
  })
}

let waiting = false
send({ type: 'system', subtype: 'init', session_id: 'claude-session', model: 'claude-test' })
createInterface({ input: process.stdin }).on('line', (line) => {
  const message: unknown = JSON.parse(line)
  if (typeof message !== 'object' || message === null || !('type' in message)) return
  if (message.type === 'control_request' && waiting) {
    waiting = false
    send({ type: 'control_response', response: { subtype: 'success' } })
    send({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '' })
    return
  }
  if (message.type !== 'user') return
  const prompt = promptOf(message)
  if (prompt === 'crash') {
    process.stderr.write('boom\n')
    process.exit(3)
  }
  if (prompt === 'wait') {
    event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Working' } })
    waiting = true
    return
  }
  render()
})
