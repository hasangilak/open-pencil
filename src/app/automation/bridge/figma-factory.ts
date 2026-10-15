import { FigmaAPI } from '@open-pencil/core/figma-api'
import { createCanvasKitRasterCodec } from '@open-pencil/core/io/formats/raster'

import { measureMarkup } from '@/app/code/measure'
import { loadAppModules } from '@/app/code/modules'
import type { EditorStore } from '@/app/editor/active-store'
import { listFamilies, listFonts, loadFont } from '@/app/editor/fonts'

export function makeFigmaFromStore(
  store: EditorStore,
  pageId = store.state.currentPageId
): FigmaAPI {
  const api = new FigmaAPI(store.graph)
  api.setRenderer(store.renderer ?? null)
  api.icons = store.iconProvider
  api.theme = store.state.theme ?? 'light'
  api.currentPage = api.wrapNode(pageId)
  // The user's selection belongs to the page on screen.
  api.currentPage.selection =
    pageId === store.state.currentPageId
      ? [...store.state.selectedIds]
          .map((id) => api.getNodeById(id))
          .filter((n): n is NonNullable<typeof n> => n !== null)
      : []
  api.viewport = {
    center: {
      x: (-store.state.panX + window.innerWidth / 2) / store.state.zoom,
      y: (-store.state.panY + window.innerHeight / 2) / store.state.zoom
    },
    zoom: store.state.zoom
  }
  api.exportImage = (nodeIds, opts) =>
    store.renderExportImage(nodeIds, opts.scale ?? 1, opts.format ?? 'PNG', opts.pageId ?? pageId)
  if (store.renderer) api.rasterCodec = createCanvasKitRasterCodec(store.renderer.ck)
  api.measureMarkup = measureMarkup
  api.loadAppModules = loadAppModules
  api.loadFontAsync = async ({ family, style }) => {
    await loadFont(family, style).catch(() => null)
  }
  api.listAvailableFontsAsync = async () => {
    const [systemFonts, familyOptions] = await Promise.all([listFonts(), listFamilies()])
    const fonts = systemFonts.flatMap(({ family, styles }) =>
      styles.map((style) => ({ fontName: { family, style } }))
    )
    const seenFamilies = new Set(systemFonts.map(({ family }) => family))
    for (const { family } of familyOptions) {
      if (!seenFamilies.has(family)) fonts.push({ fontName: { family, style: 'Regular' } })
    }
    return fonts
  }
  return api
}
