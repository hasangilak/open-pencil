import { componentSet } from '#dom-css-tests/behaviours/fixtures'
import { BLUE_500, card, designSystem } from '#dom-css-tests/export/token-fixtures'
import type { VectorElementRenderer } from '#dom-css/export'

import { emptyBehaviour, type Fill } from '@open-pencil/scene-graph'

/** A 1×1 transparent PNG, as an image fill stores it. */
export const PIXEL_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 248, 15, 4, 0, 9, 251, 3, 253,
  227, 85, 242, 156, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
])

const WHITE: Fill = { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }

/**
 * A small product: the design system's tokens with Light, Dark, and a media-query Contrast
 * mode, a Button set filled with Primary, and a Home screen that uses the button, a card,
 * a photo, an arrow icon, and a badge pinned to its top-right corner.
 */
export function projectDesign() {
  const graph = designSystem()
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected a page')
  const { set: button } = componentSet(
    'Button',
    { Interaction: ['Default', 'Hover'] },
    {
      ...emptyBehaviour('button'),
      states: { propertyId: 'interaction', rest: 'Default', hover: 'Hover' }
    },
    (g, variant, { Interaction }) => {
      g.updateNode(variant, {
        width: 160,
        height: 48,
        cornerRadius: 8,
        layoutMode: 'HORIZONTAL',
        primaryAxisAlign: 'CENTER',
        counterAxisAlign: 'CENTER',
        fills: [
          { ...WHITE, color: Interaction === 'Hover' ? { r: 0.1, g: 0.3, b: 0.8, a: 1 } : BLUE_500 }
        ],
        boundVariables: Interaction === 'Hover' ? {} : { 'fills/0/color': 'primary' }
      })
      g.createNode('TEXT', variant, {
        name: 'Label',
        text: 'Get started',
        fontSize: 16,
        fontWeight: 600,
        textAutoResize: 'WIDTH_AND_HEIGHT',
        width: 90,
        height: 20,
        fills: [WHITE]
      })
    },
    undefined,
    graph
  )
  const home = graph.createNode('FRAME', page.id, {
    name: 'Home',
    x: 400,
    width: 1440,
    height: 900,
    layoutMode: 'VERTICAL',
    itemSpacing: 24,
    paddingTop: 64,
    paddingLeft: 64,
    fills: [WHITE]
  })
  graph.createNode('TEXT', home.id, {
    name: 'Title',
    text: 'Welcome',
    fontSize: 56,
    fontWeight: 700,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    width: 240,
    height: 68
  })
  card(graph, home.id, BLUE_500, { name: 'Hero card' })
  const rest = graph.getChildren(button.id)[0]
  if (!rest) throw new Error('Expected a button variant')
  graph.createInstance(rest.id, home.id)
  graph.images.set('pixel', PIXEL_PNG)
  graph.createNode('RECTANGLE', home.id, {
    name: 'Photo',
    width: 320,
    height: 180,
    fills: [{ ...WHITE, type: 'IMAGE', imageHash: 'pixel', imageScaleMode: 'FILL' }]
  })
  graph.createNode('VECTOR', home.id, { name: 'Arrow', width: 12, height: 12 })
  graph.createNode('RECTANGLE', home.id, {
    name: 'Badge',
    x: 1336,
    y: 40,
    width: 64,
    height: 24,
    cornerRadius: 12,
    layoutPositioning: 'ABSOLUTE',
    horizontalConstraint: 'MAX',
    fills: [{ ...WHITE, color: BLUE_500 }]
  })
  return { graph, button, home }
}

/** Draws a vector as the engine's SVG export does, with SVG's dashed attribute names. */
export const vectorElement: VectorElementRenderer = (_graph, node) => ({
  type: 'element',
  tagName: 'svg',
  attrs: {
    width: String(node.width),
    height: String(node.height),
    viewBox: `0 0 ${node.width} ${node.height}`
  },
  children: [
    {
      type: 'element',
      tagName: 'path',
      attrs: { d: 'M0 6L12 6', stroke: '#111111', 'stroke-width': '1.5', 'fill-rule': 'evenodd' },
      children: []
    }
  ]
})
