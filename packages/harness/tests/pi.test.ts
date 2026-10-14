import { expect, test } from 'bun:test'

import { mapPart } from '../src/backends/pi'

test('Pi streams a tool call input before the complete call', () => {
  expect(
    mapPart({
      type: 'tool-input-start',
      id: 'c1',
      toolName: 'mcp__open_pencil_render',
      dynamic: true
    })
  ).toEqual({ type: 'tool-input-start', toolCallId: 'c1', toolName: 'mcp__open_pencil_render' })
  expect(mapPart({ type: 'tool-input-delta', id: 'c1', delta: '{"jsx":"<Frame' })).toEqual({
    type: 'tool-input-delta',
    toolCallId: 'c1',
    delta: '{"jsx":"<Frame'
  })
  expect(mapPart({ type: 'tool-input-end', id: 'c1' })).toBeUndefined()
})
