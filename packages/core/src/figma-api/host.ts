import type { MarkupMeasurer } from '@open-pencil/dom-css/export'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { iconify, type IconProvider } from '#core/icons'
import type { RasterCodec } from '#core/io/formats/raster'

import type { ExportImageOptions } from './types'

/**
 * What the host running scripts and tools lends them beyond the Plugin API: rendering, image
 * codecs, icons, and a browser to lay code out in. A host without one leaves it unset, and the
 * tools that need it say so.
 */
export class FigmaHostServices {
  exportImage?: (nodeIds: string[], options: ExportImageOptions) => Promise<Uint8Array | null>
  /** Where icon tools search and fetch icons; hosts may pass a self-hosted or bundled set. */
  icons: IconProvider = iconify
  rasterCodec?: RasterCodec
  /** The document as it was before the current AI run first edited `pageId`, or null if unedited. */
  changeBaseline?: (pageId: string) => SceneGraph | null
  /**
   * Lays exported markup out in a real browser and reports each element's box and styles,
   * which checking code against its design needs; hosts with a DOM provide it.
   */
  measureMarkup?: MarkupMeasurer
}
