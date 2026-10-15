import { compact, uniq } from 'es-toolkit/array'
import { fromUint8Array } from 'js-base64'
import * as v from 'valibot'

import type * as DOMExport from '@open-pencil/dom-css/export'
import type {
  MarkupMeasurement,
  MarkupMeasurer,
  ProjectFile,
  ReactProject
} from '@open-pencil/dom-css/export'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { FigmaAPI } from '#core/figma-api'
import { exportReactProjectFiles } from '#core/tools/codegen/project'
import { toolNumber } from '#core/tools/input'
import { defineTool } from '#core/tools/schema'

import {
  compareLayer,
  missingLayer,
  overflowAt,
  type CodeDifference,
  type WidthReport
} from './compare'
import { checkedModes, designLayer, type CheckedMode } from './design'
import { LAYER_ATTRIBUTE, screenApp, ScreenCodeError, type AppModules } from './render'

export type { CodeDifference, WidthReport } from './compare'
export { LAYER_ATTRIBUTE, type AppModules } from './render'

/** The most differences a report lists; the largest come first. */
const LISTED_DIFFERENCES = 40
const DEFAULT_TOLERANCE = 2

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml'
}

/** Files under `public/`, which the page serves from its root. */
const PUBLIC = 'public/'

/**
 * The images the project serves, by the address the page asks for them at, as data URLs,
 * since nothing serves them to the check: `public/assets/x.png` is the page's `/assets/x.png`.
 */
function servedImages(files: readonly ProjectFile[]): Map<string, string> {
  const served = new Map<string, string>()
  for (const file of files) {
    if (typeof file.content === 'string' || !file.path.startsWith(PUBLIC)) continue
    const type =
      IMAGE_TYPES[file.path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
    served.set(
      `/${file.path.slice(PUBLIC.length)}`,
      `data:${type};base64,${fromUint8Array(file.content)}`
    )
  }
  return served
}

/** What a check needs of its host: a browser to lay code out in, and the packages it imports. */
export interface CodeCheckHost {
  measure: MarkupMeasurer
  modules: AppModules
}

export interface CodeCheckOptions {
  /** Viewport widths to lay the screen out at besides its own. */
  widths?: readonly number[]
  /** Also check each mode a variable collection switches to. Default true. */
  modes?: boolean
  /** Pixels a box may differ by. */
  tolerance?: number
  /** The exported project the screen is part of; the export of the document by default. */
  project?: ReactProject
}

export interface CodeCheckReport {
  pass: boolean
  summary: string
  screen: { id: string; name: string; width: number; height: number }
  /** The file of the project that draws the screen, which the check ran. */
  file: string | null
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
  const missing = defaults.filter((difference) => difference.kind === 'missing').length
  const parts = [
    differing === 0
      ? `All ${report.checked.layers} layers match the design at ${screen.width}px.`
      : `${report.checked.layers - differing} of ${report.checked.layers} layers match the design at ${screen.width}px; ${differing} differ.`
  ]
  if (missing > 0) parts.push(`The code does not draw ${missing} of them.`)
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

/** A report for a screen whose code could not be laid out, saying why. */
function unchecked(screen: SceneNode, file: string | null, note: string): CodeCheckReport {
  return {
    pass: false,
    summary: note,
    screen: { id: screen.id, name: screen.name, width: screen.width, height: screen.height },
    file,
    fontsLoaded: false,
    checked: { layers: 0, widths: [], modes: [] },
    differences: [],
    responsive: [],
    notes: [note]
  }
}

/** The stylesheets the page loads its text's fonts from. */
function fontStylesheets(graph: SceneGraph, screen: SceneNode, dom: typeof DOMExport): string[] {
  const families = new Map<string, ReturnType<typeof dom.designFontRequests>>()
  for (const request of dom.designFontRequests(
    dom.sceneNodeToDesignDocument(graph, screen.id, { includeSourceIds: false })
  ))
    families.set(request.family, [...(families.get(request.family) ?? []), request])
  return [...families].map(([family, requests]) => dom.googleFontsURL(family, requests))
}

/**
 * What the browser draws of a layout: the elements it lays out a box for. An element `display:
 * none` hides, such as a closed panel or a label another state shows, draws no layer, so it is
 * neither compared nor counted as drawing one.
 */
const displayedOnly = (measurement: MarkupMeasurement): MarkupMeasurement => ({
  ...measurement,
  elements: measurement.elements.filter((element) => element.displayed)
})

/** Lays the screen's code out at a viewport width, switched to a mode by its attributes. */
type ScreenLayout = (
  width: number,
  rootAttributes?: Record<string, string>
) => Promise<MarkupMeasurement>

interface ScreenComparison {
  graph: SceneGraph
  screen: SceneNode
  file: string
  layout: ScreenLayout
  /** The layers the design draws as elements, each of which the code must draw too. */
  designed: readonly (string | null)[]
  modes: readonly CheckedMode[]
  options: CodeCheckOptions
}

/** Every way the screen's code draws it other than the design, at each width and mode. */
async function compareScreen({
  graph,
  screen,
  file,
  layout,
  designed,
  modes,
  options
}: ScreenComparison): Promise<CodeCheckReport> {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
  const layerOf = (id: string | null | undefined, mode: CheckedMode | null = null) => {
    const node = id ? graph.getNode(id) : undefined
    return node ? designLayer(graph, screen, node, mode) : null
  }
  const compared = (measurement: MarkupMeasurement, mode: CheckedMode | null = null) =>
    measurement.elements.flatMap((element) => {
      const layer = layerOf(element.layer, mode)
      if (!layer) return []
      return compareLayer(layer, element, { tolerance, colorsOnly: !!mode, mode: mode?.label })
    })
  const layersOf = (measurement: MarkupMeasurement) =>
    measurement.elements.map((element) => layerOf(element.layer))

  const atDesign = await layout(screen.width)
  const drawn = new Set(atDesign.elements.map((element) => element.layer))
  const differences: CodeDifference[] = [
    ...compared(atDesign),
    ...uniq(compact(designed))
      .filter((id) => !drawn.has(id))
      .flatMap((id) => {
        const layer = layerOf(id)
        return layer ? [missingLayer(layer)] : []
      })
  ]
  const notes: string[] = []
  const checkedModes: string[] = []
  for (const mode of options.modes === false ? [] : modes) {
    if (!mode.attribute) {
      notes.push(
        `${mode.label} applies under ${mode.condition}, which a check cannot switch to, so it was not checked.`
      )
      continue
    }
    const shown = await layout(screen.width, { [mode.attribute.name]: mode.attribute.value })
    checkedModes.push(mode.label)
    differences.push(...compared(shown, mode))
  }
  const responsive: WidthReport[] = [overflowAt(atDesign, layersOf(atDesign))]
  for (const width of new Set(options.widths)) {
    if (width === screen.width) continue
    const measured = await layout(width)
    responsive.push(overflowAt(measured, layersOf(measured)))
  }
  if (!atDesign.fontsLoaded) {
    notes.push('Some fonts did not load in the browser, so text measured in a fallback font.')
  }

  const ordered = differences.sort((a, b) => b.delta - a.delta)
  const report = {
    screen: { id: screen.id, name: screen.name, width: screen.width, height: screen.height },
    file,
    fontsLoaded: atDesign.fontsLoaded,
    checked: {
      layers: new Set(compact(layersOf(atDesign)).map((layer) => layer.id)).size,
      widths: responsive.map((width) => width.width),
      modes: checkedModes
    },
    differences: ordered.slice(0, LISTED_DIFFERENCES),
    responsive,
    notes
  }
  return {
    pass: ordered.length === 0 && responsive.every((width) => width.scrollsBy === 0),
    summary: summarize(report, ordered.length),
    ...report
  }
}

/**
 * Runs the code the project export writes for a screen, with the components it uses and the
 * icons it registers, lays what it renders out in a real browser, and compares it with the
 * design: every layer's box, color, and type at the screen's own width, the layers the design
 * draws that the code does not, its colors in each mode a collection switches to, and whether
 * the page scrolls sideways at other widths.
 */
export async function checkScreenCode(
  graph: SceneGraph,
  screen: SceneNode,
  host: CodeCheckHost,
  options: CodeCheckOptions = {}
): Promise<CodeCheckReport> {
  const [dom, { vectorElement }] = await Promise.all([
    import('@open-pencil/dom-css/export'),
    import('#core/io/formats/html/vectors')
  ])
  const project = options.project ?? (await exportReactProjectFiles(graph))
  const entry = project.manifest.screens.find((candidate) => candidate.layerId === screen.id)
  if (!entry) return unchecked(screen, null, `The export writes no screen for ${screen.name}.`)
  try {
    const app = screenApp(graph, project, entry, host.modules, servedImages(project.files))
    const tokens = project.files.find((file) => file.path === project.manifest.tokens.file)
    const request = {
      html: app.html,
      css: typeof tokens?.content === 'string' ? tokens.content : '',
      tailwind: true,
      fontStylesheets: fontStylesheets(graph, screen, dom),
      layerAttribute: LAYER_ATTRIBUTE,
      mount: app.mount
    }
    // The layers the design draws as elements, as its own markup draws them.
    const { layerIds: designed } = await dom.layerMarkup(graph, [screen.id], {
      styling: 'tailwind',
      fillViewport: true,
      vectorElement
    })
    return await compareScreen({
      graph,
      screen,
      file: entry.file,
      layout: async (width, rootAttributes) =>
        displayedOnly(await host.measure({ ...request, width, rootAttributes })),
      designed,
      modes: checkedModes(graph, dom),
      options
    })
  } catch (error) {
    if (!(error instanceof ScreenCodeError)) throw error
    return unchecked(screen, entry.file, `${error.message}.`)
  }
}

const widthInput = toolNumber(v.pipe(v.number(), v.minValue(240), v.maxValue(3840)))

export const checkCode = defineTool({
  name: 'check_code',
  description:
    "Check the React and Tailwind code export_react_project writes for a screen against its design, in a real browser. Runs the screen's file with the components it uses and the icons it registers, lays it out at the frame's own width, and compares every layer's position, size, fill, text color, font size, and weight with the design, and reports layers the code does not draw; shows each mode a variable collection switches to, such as Dark, and compares colors again; lays it out at any other widths given and reports where the page scrolls sideways and which layers reach past the viewport. Run it after designing or changing a screen and before handing code over: fix what it reports in the design and check again until it passes.",
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
    if (!figma.measureMarkup || !figma.loadAppModules) {
      return {
        error:
          'check_code runs the code with React and lays it out in a browser, which this environment does not have; run it in the OpenPencil app'
      }
    }
    const screen = figma.graph.getNode(args.id)
    if (!screen) return { error: `Node "${args.id}" not found` }
    const modules = await figma.loadAppModules()
    return checkScreenCode(
      figma.graph,
      screen,
      { measure: figma.measureMarkup, modules },
      { widths: args.widths, modes: args.modes, tolerance: args.tolerance }
    )
  }
})
