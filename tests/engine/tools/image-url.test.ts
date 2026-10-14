import { afterEach, describe, expect, test } from 'bun:test'

import * as v from 'valibot'

import { ALL_TOOLS, FigmaAPI, SceneGraph } from '@open-pencil/core'

import { expectDefined } from '#tests/helpers/assert'

const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const originalFetch = globalThis.fetch

const tool = expectDefined(
  ALL_TOOLS.find((t) => t.name === 'set_image_fill_from_url'),
  'set_image_fill_from_url tool'
)

function setup() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const rect = figma.createRectangle()
  const frame = figma.createFrame()
  frame.appendChild(figma.createRectangle())
  return { figma, rect, frame }
}

function serve(responses: Record<string, () => Response>) {
  const requested: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    requested.push(url)
    return responses[url]?.() ?? new Response('missing', { status: 404 })
  }) as typeof fetch
  return requested
}

const png = () => new Response(PNG_MAGIC, { headers: { 'content-type': 'image/png' } })

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('set_image_fill_from_url tool', () => {
  test('downloads each image and fills its layer', async () => {
    const { figma, rect } = setup()
    const requested = serve({ 'https://images.example/poster.png': png })
    const result = await tool.execute(figma, {
      images: [{ id: rect.id, url: 'https://images.example/poster.png' }]
    })
    expect(result).toMatchObject({ applied: 1, failed: 0 })
    expect(requested).toEqual(['https://images.example/poster.png'])
    const fill = rect.fills[0]
    expect(fill?.type).toBe('IMAGE')
    expect(fill?.imageScaleMode).toBe('FILL')
  })

  test('reports each failure and still fills the layers that worked', async () => {
    const { figma, rect, frame } = setup()
    const requested = serve({
      'https://images.example/ok.png': png,
      'https://images.example/page.html': () =>
        new Response('<html>', { headers: { 'content-type': 'text/html' } })
    })
    const result = (await tool.execute(figma, {
      images: [
        { id: rect.id, url: 'https://images.example/ok.png' },
        { id: frame.id, url: 'https://images.example/ok.png' },
        { id: rect.id, url: 'https://images.example/page.html' },
        { id: rect.id, url: 'https://images.example/gone.png' },
        { id: '9:9', url: 'https://images.example/ok.png' }
      ]
    })) as { applied: number; failed: number; results: { error?: string }[] }
    expect(result.applied).toBe(1)
    expect(result.failed).toBe(4)
    // A URL used for several layers is downloaded once.
    expect(requested.filter((url) => url.endsWith('/ok.png'))).toHaveLength(1)
    expect(result.results.map((entry) => entry.error)).toEqual([
      undefined,
      expect.stringContaining('has children'),
      'Not a PNG, JPEG, WebP, or GIF image (text/html)',
      'Download failed: HTTP 404',
      'Not found'
    ])
  })

  test('accepts only HTTPS URLs and a bounded batch', () => {
    const accepts = (input: unknown) => v.safeParse(tool.input, input).success
    expect(accepts({ images: [{ id: '0:1', url: 'https://a.example/x.jpg' }] })).toBe(true)
    expect(accepts({ images: [{ id: '0:1', url: 'http://a.example/x.jpg' }] })).toBe(false)
    expect(accepts({ images: [{ id: '0:1', url: 'file:///etc/passwd' }] })).toBe(false)
    expect(accepts({ images: [] })).toBe(false)
    expect(
      accepts({
        images: Array.from({ length: 25 }, () => ({ id: '0:1', url: 'https://a.example/x.jpg' }))
      })
    ).toBe(false)
  })
})
