import type { SceneNode } from '@open-pencil/scene-graph'
import { parseCSSNumber } from '@open-pencil/scene-graph/css'

import type { DesignStyleDeclaration } from '../types'
import { pickStyle } from './css-values'

/** The fields one axis of a placed layer writes and the CSS insets it reads. */
const INSET_AXES = [
  { start: 'left', end: 'right', offset: 'x', size: 'width', constraint: 'horizontalConstraint' },
  { start: 'top', end: 'bottom', offset: 'y', size: 'height', constraint: 'verticalConstraint' }
] as const

/** `50%` or `calc(50% ± Npx)`, a start the export writes for a layer pinned to the centre. */
const CENTRED_INSET = /^calc\(\s*50%\s*([+-])\s*([\d.]+)px\s*\)$/

/** How far from the parent's centre a centred inset puts the layer's start, if it is one. */
function centredOffset(inset: string): number | null {
  if (inset === '50%') return 0
  const match = CENTRED_INSET.exec(inset)
  if (!match) return null
  const distance = Number(match[2])
  return match[1] === '-' ? -distance : distance
}

/**
 * Where insets place a layer along one axis, and the constraint they pin it with, as the export
 * writes them: from the start, from the end (Right/Bottom), from the centre, between both edges
 * without a size (Stretch), or in percent of the parent (Scale). Without the parent's size only
 * a start inset places the layer.
 */
function applyInsets(
  node: SceneNode,
  style: DesignStyleDeclaration,
  parent: SceneNode | undefined,
  axis: (typeof INSET_AXES)[number]
): void {
  const start = pickStyle(style, axis.start)?.trim()
  const end = parseCSSNumber(pickStyle(style, axis.end))
  const room = parent?.[axis.size] ?? 0
  const fromCentre = start && room > 0 ? centredOffset(start) : null
  if (fromCentre !== null) {
    node[axis.offset] = room / 2 + fromCentre
    node[axis.constraint] = 'CENTER'
    return
  }
  if (start?.endsWith('%') && room > 0) {
    node[axis.offset] = (Number.parseFloat(start) / 100) * room
    const size = pickStyle(style, axis.size)?.trim()
    if (size?.endsWith('%')) node[axis.size] = (Number.parseFloat(size) / 100) * room
    node[axis.constraint] = 'SCALE'
    return
  }
  const startOffset = parseCSSNumber(start)
  if (
    startOffset !== null &&
    end !== null &&
    pickStyle(style, axis.size) === undefined &&
    room > 0
  ) {
    node[axis.offset] = startOffset
    node[axis.size] = room - startOffset - end
    node[axis.constraint] = 'STRETCH'
  } else if (startOffset !== null) {
    node[axis.offset] = startOffset
  } else if (end !== null && room > 0) {
    node[axis.offset] = room - end - node[axis.size]
    node[axis.constraint] = 'MAX'
  }
}

export function applyPositioning(
  node: SceneNode,
  style: DesignStyleDeclaration,
  parent: SceneNode | undefined
): void {
  const position = pickStyle(style, 'position')
  if (position === 'absolute' || position === 'fixed') node.layoutPositioning = 'ABSOLUTE'
  for (const axis of INSET_AXES) applyInsets(node, style, parent, axis)
}
