import type { HarnessRequest, HarnessSidecarMessage } from './protocol'
import { parseHarnessRequest } from './protocol'
import type { HarnessSessionService } from './service'

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Answers protocol requests for one connection: the stdio companion's single parent, or one
 * WebSocket client. Turns run concurrently; every other request waits for the one before it.
 */
export function createHarnessHost({
  service,
  emit
}: {
  service: HarnessSessionService
  emit: (message: HarnessSidecarMessage) => Promise<void>
}) {
  let queue = Promise.resolve(true)
  const activeTurns = new Set<Promise<boolean>>()
  let closing: Promise<void> | undefined

  async function dispatch(line: string): Promise<boolean> {
    let requestId = 'unknown'
    try {
      const request = parseHarnessRequest(line)
      requestId = request.id
      if (request.method === 'service.capabilities') {
        await emit({ type: 'response', id: request.id, result: service.capabilities() })
        return true
      }
      if (request.method === 'session.create') {
        const result = await service.createSession(
          request.params.sessionId,
          request.params.configuration
        )
        await emit({ type: 'response', id: request.id, result: { isResume: result.isResume } })
        return true
      }
      if (request.method === 'session.turn') {
        const { sessionId, prompt } = request.params
        for await (const event of service.runTurn(sessionId, prompt)) {
          await emit({ type: 'turn.event', id: request.id, event })
        }
        // A cancelled turn ends its stream quietly; its answer says it was cancelled.
        const cancelled = service.lastTurnCancelled(sessionId)
        await emit({
          type: 'response',
          id: request.id,
          result: cancelled ? { cancelled: true } : { completed: true }
        })
        return true
      }
      if (request.method === 'session.cancel') {
        service.cancelTurn(request.params.sessionId)
        await emit({ type: 'response', id: request.id, result: { cancelled: true } })
        return true
      }
      if (request.method === 'session.stop') {
        await service.stopSession(request.params.sessionId)
        await emit({ type: 'response', id: request.id, result: { stopped: true } })
        return true
      }
      if (request.method === 'session.destroy') {
        await service.destroySession(request.params.sessionId)
        await emit({ type: 'response', id: request.id, result: { destroyed: true } })
        return true
      }
      await service.shutdown()
      await emit({ type: 'response', id: request.id, result: { shutdown: true } })
      return false
    } catch (error) {
      await emit({ type: 'response', id: requestId, error: messageFor(error) })
      return true
    }
  }

  return {
    /** Handles one request line; `onShutdown` runs after a `service.shutdown` request. */
    receive(line: string, onShutdown: () => void): void {
      let request: HarnessRequest | undefined
      try {
        request = parseHarnessRequest(line)
      } catch (error) {
        console.warn('Deferring malformed Harness request to protocol error handling:', error)
      }
      if (request?.method === 'session.turn') {
        const turn = dispatch(line).finally(() => activeTurns.delete(turn))
        activeTurns.add(turn)
        return
      }
      queue = queue.then(async (keepRunning) => {
        if (!keepRunning) return false
        const next = await dispatch(line)
        if (!next) onShutdown()
        return next
      })
    },

    /** Lets requests in flight finish, then stops every session this connection started. */
    async close(): Promise<void> {
      closing ??= queue.then(async () => {
        await Promise.allSettled(activeTurns)
        await service.shutdown()
        return undefined
      })
      await closing
    }
  }
}
