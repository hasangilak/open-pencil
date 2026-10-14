import { groupBy } from 'es-toolkit/array'

import { es } from '@open-pencil/emit'
import { isIconModified, readIcon, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import type { ComponentModel, ComponentNode } from '../components/model'
import { serializeNode } from '../html'
import type { VectorElementRenderer } from '../projection'
import type { ProjectFile } from './types'

/** Where the app registers the glyphs, which `src/main.tsx` imports before it draws. */
export const ICONS_MODULE = './icons'

/** An icon as Iconify takes it: the drawing inside its view box. */
interface IconData {
  body: string
  left?: number
  top?: number
  width: number
  height: number
}

/** The attributes of an icon's `<svg>` that only size or name it, which Iconify writes itself. */
const OWN_ATTRIBUTE = /^(width|height|viewBox|xmlns(:.+)?|class|style|data-.+)$/

/** Each icon a component draws with Iconify, by name, with the layer that draws it there. */
function usedIcons(models: readonly ComponentModel[]): Map<string, string | undefined> {
  const icons = new Map<string, string | undefined>()
  const visit = (node: ComponentNode) => {
    if (node.type === 'icon' && !icons.get(node.icon)) icons.set(node.icon, node.layerId)
    if (node.type === 'element') for (const child of node.children) visit(child)
  }
  for (const model of models) visit(model.tree)
  return icons
}

/** A layer that draws the icon as its set does, which an edited one no longer does. */
function glyphLayer(
  graph: SceneGraph,
  name: string,
  layerId: string | undefined
): SceneNode | undefined {
  const draws = (node: SceneNode | undefined): node is SceneNode =>
    !!node && readIcon(node)?.name === name && !isIconModified(graph, node)
  const placed = layerId ? graph.getNode(layerId) : undefined
  if (draws(placed)) return placed
  for (const node of graph.getAllNodes()) if (draws(node)) return node
  return undefined
}

/** The icon's glyph as the design draws it, its tinted paths in `currentColor`. */
function iconData(
  graph: SceneGraph,
  node: SceneNode,
  vectorElement: VectorElementRenderer
): IconData | null {
  const svg = vectorElement(graph, node)
  const box =
    svg?.attrs.viewBox
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? []
  const [left = 0, top = 0, width = node.width, height = node.height] = box
  if (!svg || ![left, top, width, height].every(Number.isFinite)) return null
  // Paint set on the `<svg>` itself, which Iconify replaces with its own, moves to a group.
  const paint = Object.entries(svg.attrs).filter(([name]) => !OWN_ATTRIBUTE.test(name))
  const drawn =
    paint.length > 0
      ? [{ ...svg, tagName: 'g', attrs: Object.fromEntries(paint), inlineStyle: {} }]
      : svg.children
  const data: IconData = {
    body: drawn.map((child) => serializeNode(child)).join(''),
    width,
    height
  }
  // Iconify's view box starts at 0, 0 unless the icon says otherwise.
  if (left !== 0) data.left = left
  if (top !== 0) data.top = top
  return data
}

const REGISTER = es.parseModule('import { addCollection } from "@iconify/react";').body

const ADD_COLLECTION = es.parseModule('addCollection($collection);')

/**
 * `src/icons.ts`, which registers the glyph of every icon the components draw, as the design
 * draws it, with Iconify: its `Icon` then shows them at once and offline rather than fetching
 * the set's current version from Iconify's API. Null when no icon has a glyph to give.
 */
export function iconsFile(
  graph: SceneGraph,
  models: readonly ComponentModel[],
  vectorElement: VectorElementRenderer | undefined
): ProjectFile | null {
  if (!vectorElement) return null
  const icons = [...usedIcons(models)].flatMap(([name, layerId]) => {
    const node = glyphLayer(graph, name, layerId)
    const data = node && iconData(graph, node, vectorElement)
    const separator = name.indexOf(':')
    return data ? [{ prefix: name.slice(0, separator), name: name.slice(separator + 1), data }] : []
  })
  if (icons.length === 0) return null
  const collections = Object.entries(groupBy(icons, (icon) => icon.prefix)).map(
    ([prefix, inSet]) => ({
      prefix,
      icons: Object.fromEntries(inSet.map((icon) => [icon.name, icon.data]))
    })
  )
  const body = [
    ...REGISTER,
    ...collections.flatMap(
      (collection) => es.fill(ADD_COLLECTION, { $collection: es.json(collection) }).body
    )
  ]
  const module = es.printModule({ type: 'Program', sourceType: 'module', body })
  return { path: 'src/icons.ts', content: `${module}\n` }
}
