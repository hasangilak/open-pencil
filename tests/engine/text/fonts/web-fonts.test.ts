import { describe, expect, test } from 'bun:test'

import {
  normalizedCoverageText,
  WebFontResolver,
  webFontSubsetsForText
} from '@open-pencil/core/text'

describe('web font coverage requests', () => {
  test('normalizes coverage without splitting supplementary code points', () => {
    expect(normalizedCoverageText('界A界𠀀A')).toBe(normalizedCoverageText('A界𠀀'))
    expect(Array.from(normalizedCoverageText('𠀀'))).toEqual(['𠀀'])
  })

  test('aborts a font load queued behind an active provider request', async () => {
    const resolver = new WebFontResolver()
    resolver.setEnabled({ google: true })
    const started = Promise.withResolvers<undefined>()
    const blocked = Promise.withResolvers<Response>()
    resolver.setRemoteFetch(async () => {
      started.resolve(undefined)
      return blocked.promise
    })
    const first = resolver.listFamilies('google')
    await started.promise
    const abort = new AbortController()
    const queued = resolver.fetchFont(['Inter'], 'Regular', '', abort.signal)

    abort.abort()

    await expect(queued).rejects.toHaveProperty('name', 'AbortError')
    blocked.resolve(new Response('{}', { status: 200 }))
    await first
  })

  test('aborts promptly while provider resolution is pending', async () => {
    const resolver = new WebFontResolver()
    resolver.setEnabled({ google: true })
    const started = Promise.withResolvers<undefined>()
    const blocked = Promise.withResolvers<Response>()
    resolver.setRemoteFetch(async () => {
      started.resolve(undefined)
      return blocked.promise
    })
    const abort = new AbortController()
    const loading = resolver.fetchFont(['Inter'], 'Regular', '', abort.signal)
    await started.promise

    abort.abort()

    await expect(loading).rejects.toHaveProperty('name', 'AbortError')
    blocked.resolve(new Response('{}', { status: 200 }))
  })

  test('requests script-specific subsets instead of Latin only', () => {
    expect(webFontSubsetsForText('مرحبا')).toContain('arabic')
    expect(webFontSubsetsForText('한글')).toContain('korean')
    expect(webFontSubsetsForText('かな')).toContain('japanese')
    expect(webFontSubsetsForText('你好')).toEqual(
      expect.arrayContaining(['chinese-simplified', 'chinese-traditional', 'japanese'])
    )
  })
})

describe('the fetch swap during a font operation', () => {
  test('lets loopback requests made meanwhile through, and sends remote ones to the font fetcher', async () => {
    const originalFetch = globalThis.fetch
    const direct: string[] = []
    const proxied: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      direct.push(String(input))
      return new Response('{}')
    }) as typeof fetch
    const resolver = new WebFontResolver()
    resolver.setEnabled({ google: true })
    const started = Promise.withResolvers<undefined>()
    const blocked = Promise.withResolvers<Response>()
    resolver.setRemoteFetch(async (url) => {
      proxied.push(String(url))
      started.resolve(undefined)
      return blocked.promise
    })
    try {
      const listing = resolver.listFamilies('google')
      await started.promise
      await globalThis.fetch('http://127.0.0.1:7610/health')
      await globalThis.fetch('http://localhost:7600/health')
      void globalThis.fetch('https://example.com/other')
      expect(direct).toEqual(['http://127.0.0.1:7610/health', 'http://localhost:7600/health'])
      expect(proxied).toContain('https://example.com/other')
      blocked.resolve(Response.json({ familyMetadataList: [] }))
      await listing
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('fetchPastFontProxy', () => {
  test('reaches the original fetch while a font operation has swapped it', async () => {
    const { fetchPastFontProxy } = await import('@open-pencil/core/text')
    const originalFetch = globalThis.fetch
    const direct: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      direct.push(String(input))
      return new Response('{}')
    }) as typeof fetch
    const resolver = new WebFontResolver()
    resolver.setEnabled({ google: true })
    const started = Promise.withResolvers<undefined>()
    const blocked = Promise.withResolvers<Response>()
    resolver.setRemoteFetch(async () => {
      started.resolve(undefined)
      return blocked.promise
    })
    try {
      const listing = resolver.listFamilies('google')
      await started.promise
      await fetchPastFontProxy('https://images.example/poster.jpg')
      expect(direct).toEqual(['https://images.example/poster.jpg'])
      blocked.resolve(Response.json({ familyMetadataList: [] }))
      await listing
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
