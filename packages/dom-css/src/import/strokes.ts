import type { Color, Effect, SceneNode, Stroke } from '@open-pencil/scene-graph'
import { parseCSSColor, parseCSSNumber, parseCSSShadows } from '@open-pencil/scene-graph/css'

import type { DesignStyleDeclaration } from '../types'
import { pickStyle } from './css-values'

/** A stroke as CSS draws it, and the weight of each side, top, right, bottom, left. */
export interface CSSStroke {
  stroke: Stroke
  sides: [number, number, number, number]
  /** Whether it takes room in the layout, as a border does and an outline or shadow does not. */
  takesSpace: boolean
}

/** The stroke an element's CSS draws, and its shadows besides the ones that draw the stroke. */
export interface StrokeAndEffects {
  stroke: CSSStroke | null
  effects: Effect[]
}

const SIDE_NAMES = ['top', 'right', 'bottom', 'left'] as const

function cssNumber(style: DesignStyleDeclaration, property: string): number | null {
  return parseCSSNumber(pickStyle(style, property))
}

function solidStroke(
  color: Color,
  weight: number,
  align: Stroke['align'],
  dashPattern: number[]
): Stroke {
  const stroke: Stroke = { type: 'SOLID', color, weight, opacity: color.a, visible: true, align }
  if (dashPattern.length > 0) stroke.dashPattern = dashPattern
  return stroke
}

/** Figma's look of a dashed or dotted CSS line of a weight. */
function dashPatternOf(lineStyle: string | undefined, weight: number): number[] {
  if (lineStyle === 'dashed') return [weight * 3, weight * 2]
  if (lineStyle === 'dotted') return [weight, weight]
  return []
}

/** The line style of a border, its own or the first side's. */
export function borderStyleFromCSS(style: DesignStyleDeclaration): string | undefined {
  return (
    pickStyle(style, 'border-style') ??
    SIDE_NAMES.map((side) => pickStyle(style, `border-${side}-style`)).find(Boolean)
  )
}

/** A border, as Figma's inside stroke that takes room; sides it leaves out take its weight. */
function borderStroke(style: DesignStyleDeclaration): CSSStroke | null {
  const color = parseCSSColor(
    pickStyle(style, 'border-color') ??
      SIDE_NAMES.map((side) => pickStyle(style, `border-${side}-color`)).find(Boolean)
  )
  const sideWidths = SIDE_NAMES.map((side) => cssNumber(style, `border-${side}-width`))
  const known = sideWidths.filter((width): width is number => width !== null)
  const weight = cssNumber(style, 'border-width') ?? (known.length > 0 ? Math.max(...known) : null)
  if (!color || weight === null || weight <= 0) return null
  const [top = weight, right = weight, bottom = weight, left = weight] = sideWidths.map(
    (width) => width ?? weight
  )
  return {
    stroke: solidStroke(color, weight, 'INSIDE', dashPatternOf(borderStyleFromCSS(style), weight)),
    sides: [top, right, bottom, left],
    takesSpace: true
  }
}

/** Where an outline offset into its box by `offset` draws a stroke of a weight. */
function alignOfOffset(offset: number, weight: number): Stroke['align'] {
  if (offset <= -weight * 0.75) return 'INSIDE'
  if (offset < -weight * 0.25) return 'CENTER'
  return 'OUTSIDE'
}

/** An outline, one weight on every side, aligned by how far its offset moves it in. */
function outlineStroke(style: DesignStyleDeclaration): CSSStroke | null {
  const lineStyle = pickStyle(style, 'outline-style')?.trim().toLowerCase()
  if (!lineStyle || lineStyle === 'none' || lineStyle === 'hidden') return null
  const color = parseCSSColor(pickStyle(style, 'outline-color'))
  const weight = cssNumber(style, 'outline-width')
  if (!color || weight === null || weight <= 0) return null
  const align = alignOfOffset(cssNumber(style, 'outline-offset') ?? 0, weight)
  return {
    stroke: solidStroke(color, weight, align, dashPatternOf(lineStyle, weight)),
    sides: [weight, weight, weight, weight],
    takesSpace: false
  }
}

/**
 * A shadow that draws a stroke rather than a shade: unblurred, either a ring spread evenly round
 * the box or a band moved straight off one side.
 */
function isStrokeShadow(effect: Effect): boolean {
  if (effect.radius !== 0) return false
  const { x, y } = effect.offset
  if (x === 0 && y === 0) return effect.spread > 0
  return effect.spread === 0 && (x === 0) !== (y === 0)
}

const sameColor = (a: Color, b: Color) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a

/** A stroke with parts inside its box's edge, outside it, or both. */
function alignOfParts(inside: boolean, outside: boolean): Stroke['align'] {
  if (inside && outside) return 'CENTER'
  return inside ? 'INSIDE' : 'OUTSIDE'
}

/** One inset ring, one outer ring, or one of each as wide: inside, outside, or centered. */
function ringStroke(rings: Effect[], color: Color): CSSStroke | null {
  const inside = rings.filter((ring) => ring.type === 'INNER_SHADOW')
  const outside = rings.filter((ring) => ring.type === 'DROP_SHADOW')
  if (inside.length > 1 || outside.length > 1) return null
  const inner = inside.at(0)
  const outer = outside.at(0)
  if (inner && outer && inner.spread !== outer.spread) return null
  const weight = (inner?.spread ?? 0) + (outer?.spread ?? 0)
  return {
    stroke: solidStroke(color, weight, alignOfParts(Boolean(inner), Boolean(outer)), []),
    sides: [weight, weight, weight, weight],
    takesSpace: false
  }
}

/** Which side a band shows at and how wide it is: inset bands move in from it, outer ones out. */
function bandSide(band: Effect): { side: number; width: number } {
  const { x, y } = band.offset
  const outward = band.type === 'DROP_SHADOW' ? -1 : 1
  if (y !== 0) return { side: y * outward > 0 ? 0 : 2, width: Math.abs(y) }
  return { side: x * outward > 0 ? 3 : 1, width: Math.abs(x) }
}

/**
 * Bands along sides, as side weights: all inset, inside; all outer, outside; or on each side an
 * inset and an outer band of one width, centered.
 */
function bandStroke(bands: Effect[], color: Color): CSSStroke | null {
  const inside = [0, 0, 0, 0]
  const outside = [0, 0, 0, 0]
  for (const band of bands) {
    const { side, width } = bandSide(band)
    const parts = band.type === 'INNER_SHADOW' ? inside : outside
    if (parts[side] !== 0) return null
    parts[side] = width
  }
  const hasInside = inside.some((width) => width > 0)
  const hasOutside = outside.some((width) => width > 0)
  if (hasInside && hasOutside && inside.some((width, side) => width !== outside[side])) return null
  const [top = 0, right = 0, bottom = 0, left = 0] = inside.map(
    (width, side) => width + (outside[side] ?? 0)
  )
  const weight = Math.max(top, right, bottom, left)
  return {
    stroke: solidStroke(color, weight, alignOfParts(hasInside, hasOutside), []),
    sides: [top, right, bottom, left],
    takesSpace: false
  }
}

/**
 * Spread shadows of one color, as a stroke drawn without room: rings or side bands, as the
 * export writes a stroke and Tailwind's `ring` and `inset-ring` draw one. Shadows that draw a
 * stroke otherwise, or several colors of them, stay shadows.
 */
function shadowStroke(shadows: Effect[]): StrokeAndEffects {
  const drawing = shadows.filter(isStrokeShadow)
  const first = drawing.at(0)
  const none = { stroke: null, effects: shadows }
  if (!first || drawing.some((shadow) => !sameColor(shadow.color, first.color))) return none
  const rings = drawing.filter((shadow) => shadow.spread > 0)
  if (rings.length > 0 && rings.length < drawing.length) return none
  const stroke =
    rings.length > 0 ? ringStroke(rings, first.color) : bandStroke(drawing, first.color)
  if (!stroke) return none
  return { stroke, effects: shadows.filter((shadow) => !drawing.includes(shadow)) }
}

/** How far a length may be off whole pixels and count as whole: browsers round what they report. */
const WHOLE_TOLERANCE = 0.01

const nearWhole = (length: number) => Math.abs(length - Math.round(length)) <= WHOLE_TOLERANCE

/** Each side's padding field and stroke weight field. */
const PADDED_SIDES = [
  { padding: 'paddingTop', weight: 'borderTopWeight' },
  { padding: 'paddingRight', weight: 'borderRightWeight' },
  { padding: 'paddingBottom', weight: 'borderBottomWeight' },
  { padding: 'paddingLeft', weight: 'borderLeftWeight' }
] as const

/**
 * Gives an auto layout frame's inside stroke room again where its padding holds the stroke's
 * weight, as the export writes an included stroke of fractional weights, which a border would
 * snap to whole device pixels: whole pixels plus the weight on each stroked side. Either reading
 * lays the frame out the same, so padding of other sizes stays as it is.
 */
export function includeStrokeInPadding(node: SceneNode): void {
  const stroke = node.strokes.at(0)
  if (stroke?.align !== 'INSIDE' || node.strokesIncludedInLayout || node.layoutMode === 'NONE')
    return
  const sides = PADDED_SIDES.map(({ padding, weight }) => ({
    field: padding,
    weight: node[weight],
    rest: node[padding] - node[weight]
  }))
  // The export writes whole weights as a border.
  if (sides.every(({ weight }) => nearWhole(weight))) return
  const holdsWeight = ({ weight, rest }: (typeof sides)[number]) =>
    weight === 0 || (rest > -WHOLE_TOLERANCE && nearWhole(rest))
  if (!sides.every(holdsWeight)) return
  for (const { field, weight, rest } of sides) {
    if (weight !== 0) node[field] = Math.max(0, Math.round(rest))
  }
  node.strokesIncludedInLayout = true
}

/**
 * The stroke an element's CSS draws: a border, which takes room; otherwise an outline, aligned
 * by its offset; otherwise spread shadows. Its other shadows are its effects.
 */
export function strokeFromCSS(style: DesignStyleDeclaration): StrokeAndEffects {
  const shadows = parseCSSShadows(pickStyle(style, 'box-shadow'))
  const stroke = borderStroke(style) ?? outlineStroke(style)
  if (stroke) return { stroke, effects: shadows }
  return shadowStroke(shadows)
}
