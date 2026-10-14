import * as v from 'valibot'

import type { HarnessSidecarMessage } from '@open-pencil/harness'

import { parseHarnessSidecarMessage, type HarnessProcess } from './process'

const CONNECT_TIMEOUT_MS = 5000
/** The close code the companion uses for a missing or wrong token. */
const AUTHENTICATION_FAILED = 4401

const ReadyJSON = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({ type: v.literal('ready'), version: v.string() })
)

/**
 * The local Harness companion over WebSocket, for the browser app, which cannot start programs.
 * It speaks the same protocol messages as the desktop's stdio process (`process.ts`), one per
 * frame, after the socket's first message proves the app holds the companion's token.
 */
export async function connectHarnessSocket(options: {
  url: string
  token: string
  onUnexpectedClose: () => void
}): Promise<HarnessProcess> {
  const socket = new WebSocket(options.url)
  let controller: ReadableStreamDefaultController<HarnessSidecarMessage> | undefined
  const messages = new ReadableStream<HarnessSidecarMessage>({
    start(streamController) {
      controller = streamController
    }
  })
  let closedByApp = false

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('The local Harness companion did not answer'))
    }, CONNECT_TIMEOUT_MS)
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token: options.token }))
    socket.onmessage = (event) => {
      clearTimeout(timeout)
      if (v.safeParse(ReadyJSON, event.data).success) resolve()
      else reject(new Error('The local Harness companion sent an unexpected greeting'))
    }
    socket.onclose = (event) => {
      clearTimeout(timeout)
      reject(
        new Error(
          event.code === AUTHENTICATION_FAILED
            ? 'The local Harness companion refused this app'
            : 'Could not reach the local Harness companion'
        )
      )
    }
  })

  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return
    const message = parseHarnessSidecarMessage(event.data)
    if (message) controller?.enqueue(message)
  }
  socket.onclose = () => {
    controller?.close()
    controller = undefined
    if (!closedByApp) options.onUnexpectedClose()
  }

  function send(text: string): void {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error('The local Harness companion disconnected')
    }
    socket.send(text)
  }

  return {
    child: {
      async write(data) {
        send(new TextDecoder().decode(new Uint8Array(data)).trimEnd())
      },
      async kill() {
        closedByApp = true
        socket.close()
      }
    },
    messages,
    async send(request) {
      send(JSON.stringify(request))
    }
  }
}
