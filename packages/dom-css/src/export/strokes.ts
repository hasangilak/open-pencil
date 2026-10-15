import type { SceneNode, Stroke } from '@open-pencil/scene-graph'

import type { DesignStyleDeclaration } from '../types'
import { strokeColorToCSS } from './css'

/** A field's CSS: its token reference where one is faithful, otherwise the literal value. */
type FieldCSS = (field: string, literal: string) => string

/** A stroke weight as CSS writes it, and the number it stands for. */
interface Weight {
  css: string
  value: number
}

type StrokeWeights = { uniform: Weight } | { sides: Weight[] }

/** A layer's stroke as CSS draws it. */
export interface StrokeCSS {
  /** A border where the stroke takes room, an outline or border where no shadow draws it. */
  style: DesignStyleDeclaration
  /** `box-shadow` layers that draw it otherwise, which the layer's own shadows join. */
  shadows: string[]
}

const NONE: StrokeCSS = { style: {}, shadows: [] }

/** Each side's weight field, and the direction from its edge into the layer. */
const SIDES = [
  { field: 'borderTopWeight', x: 0, y: 1 },
  { field: 'borderRightWeight', x: -1, y: 0 },
  { field: 'borderBottomWeight', x: 0, y: -1 },
  { field: 'borderLeftWeight', x: 1, y: 0 }
] as const

const px = (value: number) => `${value}px`

/** A weight times a factor: a length stays one, a token reference becomes a `calc()`. */
function scale(weight: Weight, factor: number): string {
  if (factor === 1) return weight.css
  if (weight.css === px(weight.value)) return px(weight.value * factor)
  return `calc(${weight.css} * ${factor})`
}

/** Sides compare by their CSS, so a token and a literal of the same size stay separate. */
function strokeWeights(node: SceneNode, stroke: Stroke, css: FieldCSS): StrokeWeights {
  if (!node.independentStrokeWeights)
    return { uniform: { css: css('strokeWeight', px(stroke.weight)), value: stroke.weight } }
  const sides = SIDES.map(({ field }) => ({ css: css(field, px(node[field])), value: node[field] }))
  const [top] = sides
  if (sides.every((side) => side.css === top.css)) return { uniform: top }
  return { sides }
}

/**
 * Whether a stroke takes room in its layer's layout. Figma's `strokesIncludedInLayout` does on
 * an auto layout frame, which then behaves like `box-sizing: border-box`, as a CSS border does.
 */
function takesSpace(node: SceneNode): boolean {
  return node.strokesIncludedInLayout && node.layoutMode !== 'NONE'
}

function border(weights: StrokeWeights, color: string, dashed: boolean): DesignStyleDeclaration {
  const borderStyle = dashed ? 'dashed' : 'solid'
  if ('uniform' in weights) return { border: `${weights.uniform.css} ${borderStyle} ${color}` }
  const [top, right, bottom, left] = weights.sides
  return {
    'border-style': borderStyle,
    'border-color': color,
    'border-top-width': top.css,
    'border-right-width': right.css,
    'border-bottom-width': bottom.css,
    'border-left-width': left.css
  }
}

/** One weight on every side, offset into the layer as far as its alignment draws it there. */
function outline(
  weight: Weight,
  align: Stroke['align'],
  color: string,
  dashed: boolean
): DesignStyleDeclaration {
  const style: DesignStyleDeclaration = {
    outline: `${weight.css} ${dashed ? 'dashed' : 'solid'} ${color}`
  }
  if (align === 'INSIDE') style['outline-offset'] = scale(weight, -1)
  if (align === 'CENTER') style['outline-offset'] = scale(weight, -0.5)
  return style
}

/** How much of a stroke lies inside its layer's edge and how much outside. */
function parts(align: Stroke['align']): { inside: number; outside: number } {
  if (align === 'INSIDE') return { inside: 1, outside: 0 }
  if (align === 'OUTSIDE') return { inside: 0, outside: 1 }
  return { inside: 0.5, outside: 0.5 }
}

/**
 * Spread shadows: a ring of each part for one weight, and for side weights, a band along each
 * side, a shadow offset by the weight away from the side it shows at.
 */
function shadows(weights: StrokeWeights, align: Stroke['align'], color: string): string[] {
  const { inside, outside } = parts(align)
  if ('uniform' in weights) {
    const ring = (factor: number, inset: string) =>
      factor > 0 ? [`${inset}0 0 0 ${scale(weights.uniform, factor)} ${color}`] : []
    return [...ring(inside, 'inset '), ...ring(outside, '')]
  }
  const offset = (weight: Weight, factor: number) => (factor === 0 ? '0' : scale(weight, factor))
  return SIDES.flatMap(({ x, y }, index) => {
    const weight = weights.sides[index]
    if (weight.value <= 0) return []
    // Inside, a band is an inset shadow moved in from its side; outside, a shadow moved out.
    const band = (factor: number, inset: string) =>
      `${inset}${offset(weight, x * factor)} ${offset(weight, y * factor)} 0 0 ${color}`
    return [
      ...(inside > 0 ? [band(inside, 'inset ')] : []),
      ...(outside > 0 ? [band(-outside, '')] : [])
    ]
  })
}

/**
 * A line has no inside and no height: its stroke spreads half its weight to either side of it,
 * past its ends as a square cap would. Dashes, which no spread draws and an outline around a box
 * without height draws twice, are its top border.
 */
function lineStroke(weight: Weight, color: string, dashed: boolean): StrokeCSS {
  if (!dashed) return { style: {}, shadows: [`0 0 0 ${scale(weight, 0.5)} ${color}`] }
  const none = { css: px(0), value: 0 }
  return { style: border({ sides: [weight, none, none, none] }, color, true), shadows: [] }
}

/**
 * A layer's first stroke, drawn where the design draws it without taking room the design does
 * not give it: as `box-shadow` spread, which follows the corners, takes no room, and paints
 * beneath the layer's children, as the canvas and Figma draw a frame's stroke. A stroke that
 * takes room is a border. A dashed one, or one inside a layer whose own content covers an inset
 * shadow (`coversInset`: an image or a shader), is an outline offset into the layer, which has
 * one weight; with side weights it stays a border.
 */
export function strokeToCSS(node: SceneNode, css: FieldCSS, coversInset: boolean): StrokeCSS {
  const stroke = node.strokes.at(0)
  const literalColor = strokeColorToCSS(stroke)
  if (!literalColor || !stroke) return NONE
  const color = css('strokes/0/color', literalColor)
  const weights = strokeWeights(node, stroke, css)
  const dashed = node.dashPattern.length > 0
  if (node.type === 'LINE' && 'uniform' in weights)
    return lineStroke(weights.uniform, color, dashed)
  if (takesSpace(node)) return { style: border(weights, color, dashed), shadows: [] }
  if (dashed || (coversInset && stroke.align !== 'OUTSIDE')) {
    const style =
      'uniform' in weights
        ? outline(weights.uniform, stroke.align, color, dashed)
        : border(weights, color, dashed)
    return { style, shadows: [] }
  }
  return { style: {}, shadows: shadows(weights, stroke.align, color) }
}
