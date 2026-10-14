import { isValid, toUint8Array } from 'js-base64'

import type { ProjectFile } from './types'

const DATA_IMAGE = /data:image\/(png|jpeg|webp|gif|avif|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})/g

const EXTENSIONS: Record<string, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
  avif: 'avif',
  'svg+xml': 'svg'
}

/** Moves inlined images out of generated sources into the files they become. */
export interface ImageAssets {
  /** The source with each inlined image replaced by the URL the page serves it at. */
  extract: (source: string) => string
  /** The image files, under `public/`, one per distinct image. */
  files: ProjectFile[]
}

/**
 * Images the export inlines as data URLs become files the page serves from `/assets/images/`,
 * so components hold a short URL rather than the image's bytes. The same image is one file.
 */
export function imageAssets(): ImageAssets {
  const urls = new Map<string, string>()
  const files: ProjectFile[] = []
  const extract = (source: string) =>
    source.replace(DATA_IMAGE, (dataURL, mime: string, base64: string) => {
      const known = urls.get(dataURL)
      if (known) return known
      if (!isValid(base64)) return dataURL
      const name = `image-${urls.size + 1}.${EXTENSIONS[mime] ?? 'bin'}`
      const url = `/assets/images/${name}`
      urls.set(dataURL, url)
      files.push({ path: `public/assets/images/${name}`, content: toUint8Array(base64) })
      return url
    })
  return { extract, files }
}
