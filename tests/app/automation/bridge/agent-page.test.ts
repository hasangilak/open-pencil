import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import * as layoutModule from '@open-pencil/core/layout'

import { endAgentSession, restAgents, type AgentSession } from '@/app/automation/agents'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import { presenceOf } from '@/app/presence/registry'
import { appPreferences } from '@/app/settings/preferences/store'
import { createTab, getActiveStore } from '@/app/tabs'

import { asDouble } from '#tests/helpers/doubles'

const { handleRequest } = createAutomationCommandHandlers(makeFigmaFromStore)

/** Claude Code chatting through the Harness companion, as in the report. */
const harness: AgentSession = { session: 'harness-chat', kind: 'harness', client: 'claude-code' }
const outside: AgentSession = { session: 'outside-client', kind: 'mcp', client: 'cursor' }

type ToolResponse = {
  ok: boolean
  result: Record<string, unknown>
  target: { pageId: string }
}

/** A tool call as the MCP server forwards it: target fields beside the tool's own arguments. */
function tool(
  session: AgentSession | undefined,
  name: string,
  args: Record<string, unknown> = {},
  target: { page_id?: string } = {}
): Promise<ToolResponse> {
  return handleRequest(getActiveStore(), 'tool', {
    ...target,
    name,
    args,
    agent: session
  }) as Promise<ToolResponse>
}

function render(session: AgentSession | undefined, target: { page_id?: string } = {}) {
  return tool(session, 'render', { jsx: '<Frame name="Home" w={390} h={844} />' }, target)
}

beforeEach(() => {
  globalThis.window = asDouble<Window & typeof globalThis>({
    innerWidth: 1024,
    innerHeight: 768,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    },
    cancelAnimationFrame: vi.fn(),
    openPencil: {},
    location: { href: 'http://localhost/' } as Location,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
  globalThis.document = asDouble<Document>({
    fonts: { add: vi.fn(), ready: Promise.resolve() }
  })
  vi.spyOn(layoutModule, 'computeAllLayouts').mockReturnValue(undefined)
  appPreferences.value.chat.followAgents = false
})

afterEach(() => {
  endAgentSession(harness.session)
  endAgentSession(outside.session)
  appPreferences.value.chat.followAgents = true
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'document')
})

/** A new document where the agent made a "Netflix" page and switched to it. */
async function agentOnNewPage() {
  const { store } = createTab()
  const viewed = store.state.currentPageId
  const created = await tool(harness, 'create_page', { name: 'Netflix' })
  const netflix = String(created.result.id)
  await tool(harness, 'switch_page', { page: 'Netflix' })
  const parentOf = (response: ToolResponse) =>
    store.graph.getNode(String(response.result.id))?.parentId
  return { store, viewed, netflix, parentOf }
}

describe("an agent session's switch_page", () => {
  test('moves where its later calls work, while your view stays on your page', async () => {
    const { store, viewed, netflix, parentOf } = await agentOnNewPage()

    const rendered = await render(harness)

    expect(parentOf(rendered)).toBe(netflix)
    expect(rendered.target.pageId).toBe(netflix)
    expect(store.graph.getChildren(viewed)).toEqual([])
    expect((await tool(harness, 'get_current_page')).result).toEqual({
      id: netflix,
      name: 'Netflix'
    })
    expect(store.state.currentPageId).toBe(viewed)
    expect(presenceOf(store).agents.value).toMatchObject([{ pageId: netflix }])
  })

  test('takes its cursor off the page it left', async () => {
    const { store } = createTab()
    const viewed = store.state.currentPageId
    const other = store.graph.addPage('Other').id
    await render(harness)
    expect(presenceOf(store).agents.value).toMatchObject([{ cursor: { pageId: viewed } }])

    await tool(harness, 'switch_page', { page: other })

    expect(presenceOf(store).agents.value).toMatchObject([{ pageId: other, cursor: undefined }])
  })

  test('leaves other sessions and calls without a session on the page you view', async () => {
    const { viewed, parentOf } = await agentOnNewPage()

    expect(parentOf(await render(outside))).toBe(viewed)
    expect(parentOf(await render(undefined))).toBe(viewed)
  })

  test('gives way to a page_id the call names', async () => {
    const { viewed, netflix, parentOf } = await agentOnNewPage()

    expect(parentOf(await render(harness, { page_id: viewed }))).toBe(viewed)
    expect(parentOf(await render(harness))).toBe(netflix)
  })

  test('stops counting once that page is deleted', async () => {
    const { store, viewed, netflix, parentOf } = await agentOnNewPage()
    store.graph.deleteNode(netflix)

    expect(parentOf(await render(harness))).toBe(viewed)
  })

  test("lasts for an app chat's reply: the next reply starts on the page you view", async () => {
    const { viewed, parentOf } = await agentOnNewPage()

    restAgents('harness')

    expect(parentOf(await render(harness))).toBe(viewed)
  })

  test('with Follow agents on, your view follows the agent once it edits there', async () => {
    appPreferences.value.chat.followAgents = true
    const { store, viewed, netflix } = await agentOnNewPage()
    expect(presenceOf(store).followPage).toBe(viewed)

    await render(harness)

    expect(presenceOf(store).followPage).toBe(netflix)
  })
})
