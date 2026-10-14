import { useEventListener } from '@vueuse/core'
import * as v from 'valibot'
import { ref } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'
import { HARNESS_SOCKET_PATH } from '@open-pencil/harness/constants'
import { isHarnessPairing, parsePairingFragment } from '@open-pencil/harness/pairing'
import type { HarnessPairing } from '@open-pencil/harness/pairing'

import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'

const PROBE_TIMEOUT_MS = 2000
const PAIRING_CREDENTIAL = credentialRef('local-harness', 'pairing')

/**
 * The Harness companion the dev server starts beside the browser app (`vite/harness.ts`). Other
 * builds leave both empty and use a pairing instead.
 */
const DEV_HARNESS_URL = import.meta.env.DEV ? __OPENPENCIL_LOCAL_HARNESS_URL__ : ''
const DEV_HARNESS_TOKEN = import.meta.env.DEV ? __OPENPENCIL_LOCAL_HARNESS_TOKEN__ : ''

const HealthJSON = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({
    ok: v.literal(true),
    version: v.string(),
    adapters: v.array(v.string()),
    claudeCode: v.boolean()
  })
)

const PairingJSON = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({ port: v.number(), token: v.string(), mcpToken: v.string() }),
  v.check(isHarnessPairing, 'Invalid local companion pairing')
)

export type LocalHarnessConnection = { url: string; token: string }

export type LocalHarnessStatus = {
  /** The companion answered. */
  reachable: boolean
  /** It offers Claude Code and found the `claude` CLI. */
  claudeCode: boolean
}

export const localHarness = ref<LocalHarnessStatus>({ reachable: false, claudeCode: false })
const paired = ref<HarnessPairing | null>(null)
const pairedListeners = new Set<() => void>()

/** The companion always listens on loopback; a pairing chooses only the port. */
function loopbackSocketURL(port: number): string {
  return `ws://127.0.0.1:${port}${HARNESS_SOCKET_PATH}`
}

export function localHarnessConnection(): LocalHarnessConnection | null {
  if (DEV_HARNESS_URL && DEV_HARNESS_TOKEN)
    return { url: DEV_HARNESS_URL, token: DEV_HARNESS_TOKEN }
  const pairing = paired.value
  return pairing ? { url: loopbackSocketURL(pairing.port), token: pairing.token } : null
}

/**
 * The bearer token of the companion's MCP server, which gives a paired tab's agent its canvas
 * tools; null without a pairing (the desktop app and the dev server run their own).
 */
export function pairedCanvasToken(): string | null {
  return paired.value?.mcpToken ?? null
}

/** Runs `listener` when a pairing link opens in a tab already running, so its canvas tools connect. */
export function onLocalHarnessPaired(listener: () => void): () => void {
  pairedListeners.add(listener)
  return () => pairedListeners.delete(listener)
}

export function localHarnessConfigured(): boolean {
  return localHarnessConnection() !== null
}

/**
 * Takes a pairing from the address the companion printed, then forgets it there so it does not
 * stay in history or a shared link. Returns whether the page carried one.
 */
async function acceptPairingLink(): Promise<boolean> {
  if (!IS_BROWSER) return false
  const pairing = parsePairingFragment(location.hash)
  if (!pairing) return false
  history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  await appCredentialServices.manager.set(PAIRING_CREDENTIAL, JSON.stringify(pairing))
  return true
}

async function loadPairing(): Promise<HarnessPairing | null> {
  const stored = await appCredentialServices.resolver.resolve(PAIRING_CREDENTIAL)
  if (!stored) return null
  const pairing = v.safeParse(PairingJSON, stored)
  return pairing.success ? pairing.output : null
}

/** Reads a pairing link or a saved pairing, then asks the companion what it can run. */
export async function loadLocalHarness(): Promise<LocalHarnessStatus> {
  if (!DEV_HARNESS_URL) {
    try {
      await acceptPairingLink()
      paired.value = await loadPairing()
    } catch (error) {
      console.warn('[Harness] Could not read the local companion pairing:', error)
    }
  }
  return probeLocalHarness()
}

// A pairing link opened in this tab after it started changes only the hash.
if (IS_BROWSER && !DEV_HARNESS_URL) {
  useEventListener(window, 'hashchange', () => {
    if (!parsePairingFragment(location.hash)) return
    void loadLocalHarness().then(() => {
      if (paired.value) for (const listener of pairedListeners) listener()
      return undefined
    })
  })
}

function healthURL(socketURL: string): string {
  const url = new URL(socketURL)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = '/health'
  return url.href
}

/** Asks the companion what it can run; the answer updates `localHarness`. */
export async function probeLocalHarness(): Promise<LocalHarnessStatus> {
  const connection = localHarnessConnection()
  if (!connection) return localHarness.value
  let status: LocalHarnessStatus = { reachable: false, claudeCode: false }
  try {
    const response = await fetch(healthURL(connection.url), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    const health = v.safeParse(HealthJSON, await response.text())
    if (response.ok && health.success) {
      status = {
        reachable: true,
        claudeCode: health.output.claudeCode && health.output.adapters.includes('claude-code')
      }
    }
  } catch (error) {
    // The companion is not running; chats that need it say so.
    console.warn('[Harness] The local companion is unreachable:', error)
  }
  localHarness.value = status
  return status
}
