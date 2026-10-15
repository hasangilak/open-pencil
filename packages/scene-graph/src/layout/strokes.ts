import type { SceneNode, Stroke } from '../types'

/** The room an auto layout frame gives its stroke along each of its sides. */
export interface LayoutStrokeWeights {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * The stroke an auto layout frame makes room for, if any. With `strokesIncludedInLayout`, Figma
 * lays the frame out like CSS `box-sizing: border-box`: its first visible stroke is a border,
 * which insets the frame's children and adds to the size it hugs. Only an inside stroke takes
 * room; a center or outside stroke paints like an outline and never counts in layout.
 */
export function strokeInLayout(node: SceneNode): Stroke | undefined {
  if (!node.strokesIncludedInLayout || node.layoutMode === 'NONE') return undefined
  const stroke = node.strokes.find((candidate) => candidate.visible)
  return stroke?.align === 'INSIDE' ? stroke : undefined
}

/** The weight of each side of the stroke `strokeInLayout` finds, or null without one. */
export function layoutStrokeWeights(node: SceneNode): LayoutStrokeWeights | null {
  const stroke = strokeInLayout(node)
  if (!stroke) return null
  if (!node.independentStrokeWeights) {
    const { weight } = stroke
    return { top: weight, right: weight, bottom: weight, left: weight }
  }
  return {
    top: node.borderTopWeight,
    right: node.borderRightWeight,
    bottom: node.borderBottomWeight,
    left: node.borderLeftWeight
  }
}
