import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { DesignStyleDeclaration } from '../types'

const px = (value: number) => `${value}px`

/** The fields one axis of a placed layer reads and the CSS properties it writes. */
const PLACEMENT_AXES = [
  {
    constraint: 'horizontalConstraint',
    offset: 'x',
    size: 'width',
    start: 'left',
    end: 'right'
  },
  {
    constraint: 'verticalConstraint',
    offset: 'y',
    size: 'height',
    start: 'top',
    end: 'bottom'
  }
] as const

const percent = (fraction: number) => `${Math.round(fraction * 10_000) / 100}%`

/**
 * Pin a placed layer along one axis as its constraint does when the parent resizes: to the
 * start (Left/Top) by default, to the end (Right/Bottom), to the centre at the same offset, to
 * both edges so it stretches, or in proportion to the parent (Scale).
 */
function addConstrainedPlacement(
  style: DesignStyleDeclaration,
  node: SceneNode,
  parent: SceneNode | undefined,
  axis: (typeof PLACEMENT_AXES)[number]
): void {
  const offset = node[axis.offset]
  const room = parent?.[axis.size] ?? 0
  const end = room - offset - node[axis.size]
  const constraint = room > 0 ? node[axis.constraint] : 'MIN'
  if (constraint === 'MAX') {
    style[axis.end] = px(end)
  } else if (constraint === 'CENTER') {
    // The layer's start stays as far from the parent's centre as the design draws it.
    const fromCentre = offset - room / 2
    style[axis.start] =
      fromCentre === 0
        ? '50%'
        : `calc(50% ${fromCentre < 0 ? '-' : '+'} ${px(Math.abs(fromCentre))})`
  } else if (constraint === 'STRETCH') {
    style[axis.start] = px(offset)
    style[axis.end] = px(end)
    // Both edges are pinned, so the size follows the parent's.
    if (axis.size === 'width') delete style.width
    else delete style.height
  } else if (constraint === 'SCALE') {
    style[axis.start] = percent(offset / room)
    if (Object.hasOwn(style, axis.size)) style[axis.size] = percent(node[axis.size] / room)
  } else {
    style[axis.start] = px(offset)
  }
}

/**
 * Place a layer at its coordinates when its parent does not lay it out: it is absolutely
 * positioned, or its parent frame has no auto layout. Its constraints decide which edges it is
 * pinned to, so it moves and resizes with its parent as it does on the canvas. A frame without
 * auto layout becomes the containing block of the children it places.
 */
export function addPositioning(
  style: DesignStyleDeclaration,
  node: SceneNode,
  parent: SceneNode | undefined
): void {
  const placed =
    node.layoutPositioning === 'ABSOLUTE' ||
    (parent !== undefined && parent.type !== 'CANVAS' && parent.layoutMode === 'NONE')
  if (placed) {
    style.position = 'absolute'
    for (const axis of PLACEMENT_AXES) addConstrainedPlacement(style, node, parent, axis)
  } else if (node.layoutMode === 'NONE' && node.type !== 'TEXT' && node.childIds.length > 0) {
    style.position = 'relative'
  }
}

/**
 * Whether an auto layout frame places some of its layers itself, outside its flow, so it is the
 * containing block they are positioned in, as on the canvas.
 */
export function placesLayersOutsideLayout(graph: SceneGraph, node: SceneNode): boolean {
  return (
    node.layoutMode !== 'NONE' &&
    graph.getChildren(node.id).some((child) => child.layoutPositioning === 'ABSOLUTE')
  )
}
