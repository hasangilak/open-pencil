import { fromUint8Array } from 'js-base64'
import * as v from 'valibot'

import type { MarkupMeasurer } from '@open-pencil/dom-css/export'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { FigmaAPI } from '#core/figma-api'
import { toolNumber } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'

import { compareLayer, overflowAt, type CodeDifference, type WidthReport } from './compare'
import { checkedModes, designLayer, type DesignLayer } from './design'

export type { CodeDifference, WidthReport } from './compare'

/** The most differences a report lists; the largest come first. */
const LISTED_DIFFERENCES = 40
const DEFAULT_TOLERANCE = 2

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml'
}

/** The markup with the images it points at inlined, since nothing serves them to the check. */
function inlineImages(
  html: string,
  images: readonly { path: string; content: string | Uint8Array }[]
) {
  let inlined = html
  for (const image of images) {
    if (typeof image.content === 'string') continue
    const type =
      IMAGE_TYPES[image.path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
    inlined = inlined.replaceAll(
      `"${image.path}"`,
      `"data:${type};base64,${fromUint8Array(image.content)}"`
    )
  }
  return inlined
}

export interface CodeCheckOptions {
  /** Viewport widths to lay the screen out at besides its own. */
  widths?: readonly number[]
  /** Also check each mode a variable collection switches to. Default true. */
  modes?: boolean
  /** Pixels a box may differ by. */
  tolerance?: number
}

export interface CodeCheckReport {
  pass: boolean
  summary: string
  screen: { id: string; name: string; width: number; height: number }
  /** The fonts the screen's text uses loaded before the browser laid it out. */
  fontsLoaded: boolean
  checked: { layers: number; widths: number[]; modes: string[] }
  differences: CodeDifference[]
  responsive: WidthReport[]
  notes: string[]
}

function summarize(report: Omit<CodeCheckReport, 'summary' | 'pass'>, total: number): string {
  const { screen, differences, responsive } = report
  const defaults = differences.filter((difference) => !difference.mode)
  const differing = new Set(defaults.map((difference) => difference.layerId)).size
  const parts = [
    differing === 0
      ? `All ${report.checked.layers} layers match the design at ${screen.width}px.`
      : `${report.checked.layers - differing} of ${report.checked.layers} layers match the design at ${screen.width}px; ${differing} differ.`
  ]
  for (const mode of report.checked.modes) {
    const count = differences.filter((difference) => difference.mode === mode).length
    parts.push(count === 0 ? `${mode}: colors match.` : `${mode}: ${count} colors differ.`)
  }
  for (const width of responsive)
    if (width.scrollsBy > 0)
      parts.push(`At ${width.width}px the page scrolls sideways by ${width.scrollsBy}px.`)
  if (total > differences.length)
    parts.push(`The ${differences.length} largest of ${total} differences are listed.`)
  return parts.join(' ')
}

/**
 * Lays the code the project export writes for a screen out in a real browser and compares it
 * with the design: every layer's box, color, and type at the screen's own width, its colors in
 * each mode a collection switches to, and whether the page scrolls sideways at other widths.
 */
export async function checkScreenCode(
  graph: SceneGraph,
  screen: SceneNode,
  measure: MarkupMeasurer,
  options: CodeCheckOptions = {}
): Promise<CodeCheckReport> {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
  const [dom, { vectorElement }] = await Promise.all([
    import('@open-pencil/dom-css/export'),
    import('#core/io/formats/html/vectors')
  ])
  const markup = await dom.layerMarkup(graph, [screen.id], {
    styling: 'tailwind',
    fillViewport: true,
    vectorElement
  })
  const html = inlineImages(markup.html, markup.images)
  const css =
    graph.variables.size > 0 ? (await dom.tokenStylesheet(graph, { format: 'tailwind' })).css : ''
  const families = new Map<string, ReturnType<typeof dom.designFontRequests>>()
  for (const request of dom.designFontRequests(
    dom.sceneNodeToDesignDocument(graph, screen.id, { includeSourceIds: false })
  ))
    families.set(request.family, [...(families.get(request.family) ?? []), request])
  const fontStylesheets = [...families].map(([family, requests]) =>
    dom.googleFontsURL(family, requests)
  )
  const layout = (width: number, rootAttributes?: Record<string, string>) =>
    measure({ html, css, tailwind: true, width, rootAttributes, fontStylesheets })

  const layerOf = (
    id: string | null,
    mode: Parameters<typeof designLayer>[3] = null
  ): DesignLayer | null => {
    const node = id ? graph.getNode(id) : undefined
    return node ? designLayer(graph, screen, node, mode) : null
  }
  const notes: string[] = []
  const differences: CodeDifference[] = []
  const atDesign = await layout(screen.width)
  const layers = markup.layerIds.map((id) => layerOf(id))
  const aligned = atDesign.elements.length === layers.length
  if (!aligned) {
    notes.push(
      `The browser built ${atDesign.elements.length} elements from markup of ${layers.length}, so layers could not be matched to elements; only page widths were checked.`
    )
  }
  const compared = (
    found: (DesignLayer | null)[],
    elements: typeof atDesign.elements,
    mode?: string
  ) =>
    found.flatMap((layer, index) => {
      const element = elements.at(index)
      return layer && element
        ? compareLayer(layer, element, { tolerance, colorsOnly: !!mode, mode })
        : []
    })
  if (aligned) differences.push(...compared(layers, atDesign.elements))

  const modes: string[] = []
  if (options.modes !== false && aligned) {
    for (const mode of checkedModes(graph, dom)) {
      if (!mode.attribute) {
        notes.push(
          `${mode.label} applies under ${mode.condition}, which a check cannot switch to, so it was not checked.`
        )
        continue
      }
      const shown = await layout(screen.width, { [mode.attribute.name]: mode.attribute.value })
      modes.push(mode.label)
      differences.push(
        ...compared(
          markup.layerIds.map((id) => layerOf(id, mode)),
          shown.elements,
          mode.label
        )
      )
    }
  }

  const responsive: WidthReport[] = [overflowAt(atDesign, layers)]
  for (const width of new Set(options.widths)) {
    if (width === screen.width) continue
    responsive.push(overflowAt(await layout(width), layers))
  }
  if (!atDesign.fontsLoaded) {
    notes.push('Some fonts did not load in the browser, so text measured in a fallback font.')
  }

  const ordered = differences.sort((a, b) => b.delta - a.delta)
  const report = {
    screen: { id: screen.id, name: screen.name, width: screen.width, height: screen.height },
    fontsLoaded: atDesign.fontsLoaded,
    checked: {
      layers: layers.filter((layer) => layer !== null).length,
      widths: responsive.map((width) => width.width),
      modes
    },
    differences: ordered.slice(0, LISTED_DIFFERENCES),
    responsive,
    notes
  }
  return {
    pass: aligned && ordered.length === 0 && responsive.every((width) => width.scrollsBy === 0),
    summary: summarize(report, ordered.length),
    ...report
  }
}

const widthInput = toolNumber(v.pipe(v.number(), v.minValue(240), v.maxValue(3840)))

export const checkCode = defineTool({
  name: 'check_code',
  description:
    "Check the React and Tailwind code export_react_project writes for a screen against its design, in a real browser. Lays the screen out at the frame's own width and compares every layer's position, size, fill, text color, font size, and weight with the design; shows each mode a variable collection switches to, such as Dark, and compares colors again; lays it out at any other widths given and reports where the page scrolls sideways and which layers reach past the viewport. Run it after designing or changing a screen and before handing code over: fix what it reports in the design and check again until it passes.",
  execution: { kind: 'async', mutation: 'none' },
  input: v.strictObject({
    id: v.pipe(
      v.string(),
      v.description('The screen: a top-level frame the export writes as a screen')
    ),
    widths: v.optional(
      v.pipe(
        v.array(widthInput),
        v.maxLength(6),
        v.description('Other viewport widths to lay it out at, such as [390, 768, 1280]')
      )
    ),
    modes: v.optional(
      v.pipe(
        v.boolean(),
        v.description('Also check each mode a collection switches to (default true)')
      ),
      true
    ),
    tolerance: v.optional(
      toolNumber(
        v.pipe(
          v.number(),
          v.minValue(0),
          v.maxValue(50),
          v.description('Pixels a box may differ by before it is reported (default 2)')
        )
      ),
      DEFAULT_TOLERANCE
    )
  }),
  execute: async (figma: FigmaAPI, args) => {
    if (!figma.measureMarkup) {
      return {
        error:
          'check_code lays code out in a browser, which this environment does not have; run it in the OpenPencil app'
      }
    }
    const screen = figma.graph.getNode(args.id)
    if (!screen) return { error: `Node "${args.id}" not found` }
    return checkScreenCode(figma.graph, screen, figma.measureMarkup, {
      widths: args.widths,
      modes: args.modes,
      tolerance: args.tolerance
    })
  }
})
