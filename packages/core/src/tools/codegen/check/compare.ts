import type { MarkupMeasurement, MeasuredElement } from '@open-pencil/dom-css/export'
import type { Color } from '@open-pencil/scene-graph'
import { colorToCSS, tryParseColor } from '@open-pencil/scene-graph/color'

import type { DesignLayer } from './design'

export type DifferenceKind =
  | 'missing'
  | 'position'
  | 'size'
  | 'fill'
  | 'text-color'
  | 'font-size'
  | 'font-weight'

/** Where code draws a layer other than the design does. */
export interface CodeDifference {
  layerId: string
  name: string
  kind: DifferenceKind
  /** The design mode it differs in, such as `Theme / Dark`; none for the defaults. */
  mode?: string
  design: string
  code: string
  /** How far apart the two are, in pixels or color steps of 255, which orders the report. */
  delta: number
}

/** Text boxes come from font metrics, which differ a little between the canvas and a browser. */
const TEXT_SIZE_SLACK = 0.06
/** Steps of 255 a color channel may differ by, as rounding between color spaces does. */
const COLOR_STEPS = 2
const ALPHA_SLACK = 0.02

const px = (value: number) => `${Math.round(value * 10) / 10}px`

function geometry(layer: DesignLayer, element: MeasuredElement, tolerance: number) {
  const differences: Omit<CodeDifference, 'layerId' | 'name'>[] = []
  const dx = element.x - layer.x
  const dy = element.y - layer.y
  if (Math.max(Math.abs(dx), Math.abs(dy)) > tolerance) {
    differences.push({
      kind: 'position',
      design: `${px(layer.x)}, ${px(layer.y)}`,
      code: `${px(element.x)}, ${px(element.y)}`,
      delta: Math.max(Math.abs(dx), Math.abs(dy))
    })
  }
  const slack = (size: number) =>
    layer.type === 'TEXT' ? Math.max(tolerance, size * TEXT_SIZE_SLACK) : tolerance
  const dw = element.width - layer.width
  const dh = element.height - layer.height
  if (Math.abs(dw) > slack(layer.width) || Math.abs(dh) > slack(layer.height)) {
    differences.push({
      kind: 'size',
      design: `${px(layer.width)} × ${px(layer.height)}`,
      code: `${px(element.width)} × ${px(element.height)}`,
      delta: Math.max(Math.abs(dw), Math.abs(dh))
    })
  }
  return differences
}

/** How many steps of 255 the furthest channel is apart, alpha weighted the same. */
function colorDelta(design: Color, code: Color): number {
  const channel = (a: number, b: number) => Math.abs(a - b) * 255
  return Math.max(
    channel(design.r, code.r),
    channel(design.g, code.g),
    channel(design.b, code.b),
    Math.abs(design.a - code.a) > ALPHA_SLACK ? channel(design.a, code.a) : 0
  )
}

function color(layer: DesignLayer, element: MeasuredElement) {
  if (!layer.color) return []
  const text = layer.type === 'TEXT'
  const computed = text ? element.styles.color : element.styles.backgroundColor
  // A browser that cannot parse its own color, which never happens, is not a difference.
  const code = tryParseColor(computed)
  if (!code) return []
  const delta = colorDelta(layer.color, code)
  if (delta <= COLOR_STEPS) return []
  return [
    {
      kind: text ? ('text-color' as const) : ('fill' as const),
      design: colorToCSS(layer.color),
      code: computed,
      delta
    }
  ]
}

function type(layer: DesignLayer, element: MeasuredElement) {
  const differences: Omit<CodeDifference, 'layerId' | 'name'>[] = []
  const size = Number.parseFloat(element.styles.fontSize)
  if (layer.fontSize !== null && Number.isFinite(size) && Math.abs(size - layer.fontSize) > 0.5) {
    differences.push({
      kind: 'font-size',
      design: px(layer.fontSize),
      code: element.styles.fontSize,
      delta: Math.abs(size - layer.fontSize)
    })
  }
  const weight = Number(element.styles.fontWeight)
  if (
    layer.fontWeight !== null &&
    Number.isFinite(weight) &&
    Math.abs(weight - layer.fontWeight) >= 100
  ) {
    differences.push({
      kind: 'font-weight',
      design: String(layer.fontWeight),
      code: element.styles.fontWeight,
      delta: Math.abs(weight - layer.fontWeight) / 10
    })
  }
  return differences
}

export interface CompareOptions {
  tolerance: number
  /** Compare only colors, as a mode changes nothing else. */
  colorsOnly?: boolean
  mode?: string
}

/** Every way the browser's element draws its layer other than the design does. */
export function compareLayer(
  layer: DesignLayer,
  element: MeasuredElement,
  { tolerance, colorsOnly = false, mode }: CompareOptions
): CodeDifference[] {
  const found = [
    ...(colorsOnly || layer.rotated ? [] : geometry(layer, element, tolerance)),
    ...color(layer, element),
    ...(colorsOnly ? [] : type(layer, element))
  ]
  return found.map((difference) => ({
    layerId: layer.id,
    name: layer.name,
    ...difference,
    ...(mode ? { mode } : {})
  }))
}

/** A layer the design draws that no element of the code draws, the largest listed first. */
export function missingLayer(layer: DesignLayer): CodeDifference {
  return {
    layerId: layer.id,
    name: layer.name,
    kind: 'missing',
    design: `${px(layer.width)} × ${px(layer.height)} at ${px(layer.x)}, ${px(layer.y)}`,
    code: 'not drawn',
    delta: Math.max(layer.width, layer.height)
  }
}

/** A viewport the page scrolls sideways in, and the layers reaching furthest past it. */
export interface WidthReport {
  width: number
  /** How far the page scrolls sideways, 0 when it fits. */
  scrollsBy: number
  /** The layers whose right edge is furthest past the viewport, furthest first. */
  widest: { layerId: string; name: string; right: number }[]
}

const WIDEST_LISTED = 5

export function overflowAt(
  measurement: MarkupMeasurement,
  layers: readonly (DesignLayer | null)[]
): WidthReport {
  const { width } = measurement
  const scrollsBy = Math.max(0, Math.round(measurement.scrollWidth - width))
  const past = new Map<string, { layerId: string; name: string; right: number }>()
  for (const [index, element] of measurement.elements.entries()) {
    const layer = layers[index]
    const right = element.x + element.width
    if (!layer || right <= width + 1) continue
    const known = past.get(layer.id)
    if (!known || known.right < right)
      past.set(layer.id, { layerId: layer.id, name: layer.name, right: Math.round(right) })
  }
  const widest = [...past.values()].sort((a, b) => b.right - a.right).slice(0, WIDEST_LISTED)
  return { width, scrollsBy, widest: scrollsBy > 0 ? widest : [] }
}
