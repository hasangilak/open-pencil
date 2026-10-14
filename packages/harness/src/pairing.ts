/**
 * The pairing link `openpencil-harness-serve` prints and the browser app reads:
 * `<origin>/#openpencil-harness=<port>.<token>.<mcpToken>`. It names only a port; the app always
 * connects to loopback. Browser-safe: no Node imports.
 */
export const PAIRING_FRAGMENT_KEY = 'openpencil-harness'

const TOKEN = /^[\w-]{16,128}$/

export type HarnessPairing = {
  /** The companion's WebSocket port on 127.0.0.1. */
  port: number
  /** What the app sends as its connection's first message. */
  token: string
  /** The bearer token of the MCP server that gives the agent the tab's canvas tools. */
  mcpToken: string
}

export function pairingLink(origin: string, pairing: HarnessPairing): string {
  const base = origin.replace(/\/+$/, '')
  return `${base}/#${PAIRING_FRAGMENT_KEY}=${pairing.port}.${pairing.token}.${pairing.mcpToken}`
}

export function isHarnessPairing(value: {
  port: number
  token: string
  mcpToken: string
}): value is HarnessPairing {
  return (
    Number.isInteger(value.port) &&
    value.port >= 1024 &&
    value.port <= 65535 &&
    TOKEN.test(value.token) &&
    TOKEN.test(value.mcpToken)
  )
}

/** The pairing in a location hash, or null when it carries none or a malformed one. */
export function parsePairingFragment(hash: string): HarnessPairing | null {
  const prefix = `#${PAIRING_FRAGMENT_KEY}=`
  if (!hash.startsWith(prefix)) return null
  const parts = hash.slice(prefix.length).split('.')
  if (parts.length !== 3) return null
  const [port = '', token = '', mcpToken = ''] = parts
  if (!/^\d{4,5}$/.test(port)) return null
  const pairing = { port: Number(port), token, mcpToken }
  return isHarnessPairing(pairing) ? pairing : null
}
