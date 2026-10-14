import * as v from 'valibot'

import { fetchPastFontProxy } from '#core/text/web-fonts'

import { defineTool } from './schema'
import { applyImageFill, photoTargetError } from './stock-photo/apply'

const MAX_IMAGES = 24
const MAX_IMAGE_BYTES = 16 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 20_000
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

type ImageURLResult = { id: string; imageHash?: string; bytes?: number; error?: string }

async function download(url: string): Promise<Uint8Array | string> {
  let response: Response
  try {
    response = await fetchPastFontProxy(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  } catch (error) {
    // In a browser, a host that does not allow cross-origin requests fails here too.
    return `Download failed: ${error instanceof Error ? error.message : String(error)}`
  }
  if (!response.ok) return `Download failed: HTTP ${response.status}`
  const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (mediaType && !IMAGE_MEDIA_TYPES.has(mediaType)) {
    return `Not a PNG, JPEG, WebP, or GIF image (${mediaType})`
  }
  if (Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) {
    return 'Image exceeds the 16 MB limit'
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  return bytes.byteLength > MAX_IMAGE_BYTES ? 'Image exceeds the 16 MB limit' : bytes
}

export const setImageFillFromURL = defineTool({
  name: 'set_image_fill_from_url',

  description:
    'Fill leaf layers with images downloaded from HTTPS URLs, cropped to cover each layer: ' +
    'photos, posters, avatars, and other imagery in generated designs. The app downloads each ' +
    'image itself, so in a browser the host must allow cross-origin requests. Containers with ' +
    'content, text, lines, and structural nodes are rejected; use an image placeholder layer.',
  execution: { kind: 'async', mutation: 'document' },
  capabilities: ['document:write', 'network:access'],
  input: v.strictObject({
    images: v.pipe(
      v.array(
        v.strictObject({
          id: v.pipe(v.string(), v.description('Layer to fill')),
          url: v.pipe(
            v.string(),
            v.url(),
            v.startsWith('https://'),
            v.description('HTTPS URL of a PNG, JPEG, WebP, or GIF image')
          )
        })
      ),
      v.minLength(1),
      v.maxLength(MAX_IMAGES),
      v.description('One {id, url} per layer, at most 24')
    )
  }),
  execute: async (figma, { images }) => {
    // Downloads run together, once per URL; the document changes once they are all in.
    const byURL = new Map<string, Promise<Uint8Array | string>>()
    for (const { url } of images) if (!byURL.has(url)) byURL.set(url, download(url))
    const downloads = await Promise.all(images.map(({ url }) => byURL.get(url)))
    const results: ImageURLResult[] = images.map(({ id }, index) => {
      const node = figma.getNodeById(id)
      if (!node) return { id, error: 'Not found' }
      const targetError = photoTargetError(node, 'image')
      if (targetError) return { id, error: targetError }
      const bytes = downloads[index]
      if (typeof bytes === 'string' || bytes === undefined)
        return { id, error: bytes ?? 'No image' }
      return { id, imageHash: applyImageFill(figma, node, bytes), bytes: bytes.byteLength }
    })
    const applied = results.filter((result) => result.imageHash).length
    return { applied, failed: results.length - applied, results }
  }
})
