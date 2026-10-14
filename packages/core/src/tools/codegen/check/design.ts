import type { Color, SceneGraph, SceneNode, VariableCollection } from '@open-pencil/scene-graph'
import { getAbsolutePosition } from '@open-pencil/scene-graph/coordinate'
import { resolveVariable } from '@open-pencil/scene-graph/variables'

/** A mode of a variable collection a check shows the code in, besides the default ones. */
export interface CheckedMode {
  collectionId: string
  modeId: string
  /** `Theme / Dark`, as reports name it. */
  label: string
  /** The attribute on `<html>` that switches the page to it, or null for a media condition. */
  attribute: { name: string; value: string } | null
  /** The selector or at-rule the export writes its values under. */
  condition: string
}

/** What the design draws a layer as: its box from the screen's corner, its color, its type. */
export interface DesignLayer {
  id: string
  name: string
  type: SceneNode['type']
  x: number
  y: number
  width: number
  height: number
  /** A rotated layer's box is its unrotated one, which a browser's box is not, so it is skipped. */
  rotated: boolean
  /** A box's fill, or a text's color, when it is one solid color. */
  color: Color | null
  fontSize: number | null
  fontWeight: number | null
}

/** The mode a layer is set to for a collection by itself or a layer around it. */
function explicitMode(graph: SceneGraph, node: SceneNode, collectionId: string): string | null {
  for (
    let at: SceneNode | undefined = node;
    at;
    at = at.parentId ? graph.getNode(at.parentId) : undefined
  ) {
    const modeId = at.variableModes[collectionId]
    if (modeId) return modeId
  }
  return null
}

/**
 * The color a layer's first fill draws in, with a bound variable resolved in the mode the
 * check shows: the layer's own mode where it sets one, the checked mode in its collection,
 * and every other collection's default.
 */
function fillColor(graph: SceneGraph, node: SceneNode, mode: CheckedMode | null): Color | null {
  const fill = node.fills.at(0)
  if (!fill?.visible || fill.type !== 'SOLID') return null
  const variableId = node.boundVariables['fills/0/color']
  const variable = variableId ? graph.variables.get(variableId) : undefined
  if (variableId && variable) {
    const collection = graph.variableCollections.get(variable.collectionId)
    const modeId =
      explicitMode(graph, node, variable.collectionId) ??
      (mode?.collectionId === variable.collectionId ? mode.modeId : collection?.defaultModeId)
    const value = resolveVariable(graph, variableId, modeId)
    if (value && typeof value === 'object' && 'r' in value) return value
  }
  return { ...fill.color, a: fill.color.a * fill.opacity }
}

export function designLayer(
  graph: SceneGraph,
  screen: SceneNode,
  node: SceneNode,
  mode: CheckedMode | null = null
): DesignLayer {
  const origin = getAbsolutePosition(screen, graph)
  const at = getAbsolutePosition(node, graph)
  const text = node.type === 'TEXT'
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.id === screen.id ? 0 : at.x - origin.x,
    y: node.id === screen.id ? 0 : at.y - origin.y,
    width: node.width,
    height: node.height,
    rotated: node.rotation !== 0,
    color: fillColor(graph, node, mode),
    fontSize: text ? node.fontSize : null,
    fontWeight: text ? node.fontWeight : null
  }
}

/**
 * The modes besides each collection's default that a page can be in, with how the export
 * switches to each, from the same names and conditions the token stylesheet writes.
 */
export function checkedModes(
  graph: SceneGraph,
  switching: {
    modeAttribute: (
      collection: VariableCollection,
      mode: VariableCollection['modes'][number]
    ) => { name: string; value: string }
    defaultModeCondition: (
      collection: VariableCollection,
      mode: VariableCollection['modes'][number]
    ) => string
  }
): CheckedMode[] {
  return [...graph.variableCollections.values()].flatMap((collection) =>
    collection.modes
      .filter((mode) => mode.modeId !== collection.defaultModeId)
      .map((mode) => ({
        collectionId: collection.id,
        modeId: mode.modeId,
        label: `${collection.name} / ${mode.name}`,
        attribute: mode.condition ? null : switching.modeAttribute(collection, mode),
        condition: mode.condition ?? switching.defaultModeCondition(collection, mode)
      }))
  )
}
