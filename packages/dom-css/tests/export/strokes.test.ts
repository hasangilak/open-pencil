import { describe, expect, it } from 'bun:test'

import { sceneNodeToDesignDocument } from '#dom-css/index'

import {
  createShaderPaint,
  SceneGraph,
  withShaderPaints,
  type SceneNode,
  type Stroke
} from '@open-pencil/scene-graph'

const RED = { r: 1, g: 0, b: 0, a: 1 }
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function stroke(align: Stroke['align'], weight = 2): Stroke {
  return { type: 'SOLID', color: RED, opacity: 1, visible: true, weight, align }
}

function sides(top: number, right: number, bottom: number, left: number): Partial<SceneNode> {
  return {
    independentStrokeWeights: true,
    borderTopWeight: top,
    borderRightWeight: right,
    borderBottomWeight: bottom,
    borderLeftWeight: left
  }
}

function styleIn(graph: SceneGraph, id: string): Record<string, string> {
  const [element] = sceneNodeToDesignDocument(graph, id).children
  if (element?.type !== 'element') throw new Error('Expected an element')
  return element.inlineStyle ?? {}
}

function styleOf(fields: Partial<SceneNode>, type: SceneNode['type'] = 'FRAME') {
  const graph = new SceneGraph()
  const node = graph.createNode(type, graph.getPages()[0].id, {
    name: 'Layer',
    width: 100,
    height: 60,
    ...fields
  })
  return styleIn(graph, node.id)
}

/** Declarations that give a box room in its layout, which a stroke must not add. */
function roomTaken(style: Record<string, string>): string[] {
  return Object.keys(style).filter(
    (property) =>
      (property.startsWith('border') && !property.endsWith('radius')) || property === 'box-sizing'
  )
}

describe('strokes in DOM/CSS export', () => {
  it('draws a stroke as spread shadow at its alignment, taking no room', () => {
    const inside = styleOf({ strokes: [stroke('INSIDE')], cornerRadius: 12 })
    expect(inside['box-shadow']).toBe('inset 0 0 0 2px #FF0000')
    expect(inside['border-radius']).toBe('12px')
    expect(roomTaken(inside)).toEqual([])
    expect(inside.outline).toBeUndefined()

    expect(styleOf({ strokes: [stroke('CENTER')] })['box-shadow']).toBe(
      'inset 0 0 0 1px #FF0000, 0 0 0 1px #FF0000'
    )
    expect(styleOf({ strokes: [stroke('OUTSIDE')] })['box-shadow']).toBe('0 0 0 2px #FF0000')
  })

  it('leaves an auto layout frame its padding alone, so its children sit where the design does', () => {
    const graph = new SceneGraph()
    const frame = graph.createNode('FRAME', graph.getPages()[0].id, {
      width: 200,
      height: 100,
      layoutMode: 'VERTICAL',
      paddingTop: 16,
      paddingLeft: 16,
      paddingRight: 16,
      paddingBottom: 16,
      strokes: [stroke('INSIDE', 1)]
    })
    graph.createNode('FRAME', frame.id, { name: 'Child', width: 40, height: 40 })
    const style = styleIn(graph, frame.id)

    expect(style.padding).toBe('16px')
    // Border-box for the padding alone: the stroke adds no border inside it.
    expect(roomTaken(style)).toEqual(['box-sizing'])
    expect(style['box-shadow']).toBe('inset 0 0 0 1px #FF0000')
  })

  it('draws side weights as a band along each side', () => {
    expect(styleOf({ strokes: [stroke('INSIDE')], ...sides(1, 0, 2, 0) })['box-shadow']).toBe(
      'inset 0 1px 0 0 #FF0000, inset 0 -2px 0 0 #FF0000'
    )
    expect(styleOf({ strokes: [stroke('OUTSIDE')], ...sides(0, 3, 0, 0) })['box-shadow']).toBe(
      '3px 0 0 0 #FF0000'
    )
    const center = styleOf({ strokes: [stroke('CENTER')], ...sides(0, 0, 0, 4) })
    expect(center['box-shadow']).toBe('inset 2px 0 0 0 #FF0000, -2px 0 0 0 #FF0000')
    expect(roomTaken(center)).toEqual([])
  })

  it('draws side weights that are all the same as one ring', () => {
    expect(styleOf({ strokes: [stroke('INSIDE')], ...sides(1, 1, 1, 1) })['box-shadow']).toBe(
      'inset 0 0 0 1px #FF0000'
    )
  })

  it('puts the stroke beneath inner shadows and above drop shadows, as the canvas paints them', () => {
    const shade = { r: 0, g: 0, b: 0, a: 0.25 }
    const style = styleOf({
      strokes: [stroke('OUTSIDE')],
      effects: [
        {
          type: 'DROP_SHADOW',
          color: shade,
          offset: { x: 0, y: 4 },
          radius: 8,
          spread: 0,
          visible: true
        },
        {
          type: 'INNER_SHADOW',
          color: shade,
          offset: { x: 0, y: 1 },
          radius: 2,
          spread: 0,
          visible: true
        }
      ]
    })
    expect(style['box-shadow']).toBe(
      'inset 0px 1px 2px 0px rgba(0, 0, 0, 0.25), 0 0 0 2px #FF0000, 0px 4px 8px 0px rgba(0, 0, 0, 0.25)'
    )
  })

  it('gives a stroke room as a border where the design includes it in auto layout', () => {
    const included = styleOf({
      strokes: [stroke('INSIDE')],
      layoutMode: 'VERTICAL',
      strokesIncludedInLayout: true
    })
    expect(included.border).toBe('2px solid #FF0000')
    expect(included['box-sizing']).toBe('border-box')
    expect(included['box-shadow']).toBeUndefined()

    const sideIncluded = styleOf({
      strokes: [stroke('INSIDE')],
      ...sides(0, 0, 1, 0),
      layoutMode: 'HORIZONTAL',
      strokesIncludedInLayout: true
    })
    expect(sideIncluded).toMatchObject({ 'border-bottom-width': '1px', 'border-top-width': '0px' })

    // Figma includes strokes in the layout of auto layout frames only.
    const placed = styleOf({ strokes: [stroke('INSIDE')], strokesIncludedInLayout: true })
    expect(roomTaken(placed)).toEqual([])
    expect(placed['box-shadow']).toBe('inset 0 0 0 2px #FF0000')
  })

  it('gives a fractional stroke its room as padding, as a border would draw it in whole pixels', () => {
    const padded = {
      layoutMode: 'VERTICAL',
      strokesIncludedInLayout: true,
      paddingTop: 12,
      paddingRight: 16,
      paddingBottom: 12,
      paddingLeft: 16
    } satisfies Partial<SceneNode>
    const included = styleOf({ strokes: [stroke('INSIDE', 0.5)], ...padded })
    expect(included).toMatchObject({
      'box-shadow': 'inset 0 0 0 0.5px #FF0000',
      'padding-block': '12.5px',
      'padding-inline': '16.5px',
      'box-sizing': 'border-box'
    })
    expect(roomTaken(included)).toEqual(['box-sizing'])

    const bottom = styleOf({
      strokes: [stroke('INSIDE')],
      ...sides(0, 0, 0.5, 0),
      layoutMode: 'HORIZONTAL',
      strokesIncludedInLayout: true
    })
    expect(bottom).toMatchObject({
      'box-shadow': 'inset 0 -0.5px 0 0 #FF0000',
      'padding-bottom': '0.5px'
    })
    expect(roomTaken(bottom)).toEqual(['box-sizing'])

    // Dashes are an outline; dashed side weights, which nothing else draws, a border.
    const dashed = styleOf({ strokes: [stroke('INSIDE', 0.5)], dashPattern: [2, 2], ...padded })
    expect(dashed).toMatchObject({
      outline: '0.5px dashed #FF0000',
      'outline-offset': '-0.5px',
      'padding-block': '12.5px'
    })
    const dashedSides = styleOf({
      strokes: [stroke('INSIDE')],
      dashPattern: [2, 2],
      ...sides(0, 0, 0.5, 0),
      ...padded
    })
    expect(dashedSides).toMatchObject({ 'border-bottom-width': '0.5px', 'padding-block': '12px' })
  })

  it('leaves center and outside strokes out of layout, as Figma does', () => {
    const included = (align: Stroke['align']) =>
      styleOf({ strokes: [stroke(align)], layoutMode: 'VERTICAL', strokesIncludedInLayout: true })
    expect(roomTaken(included('CENTER'))).toEqual([])
    expect(included('CENTER')['box-shadow']).toBe('inset 0 0 0 1px #FF0000, 0 0 0 1px #FF0000')
    expect(roomTaken(included('OUTSIDE'))).toEqual([])
    expect(included('OUTSIDE')['box-shadow']).toBe('0 0 0 2px #FF0000')
  })

  it('draws the first visible stroke, past hidden ones', () => {
    const hidden = { ...stroke('INSIDE', 6), visible: false }
    const style = styleOf({
      strokes: [hidden, stroke('INSIDE')],
      layoutMode: 'HORIZONTAL',
      strokesIncludedInLayout: true
    })
    expect(style.border).toBe('2px solid #FF0000')
  })

  it('draws dashes as an outline offset as far in as the stroke is aligned', () => {
    const dashed = (align: Stroke['align']) =>
      styleOf({ strokes: [stroke(align)], dashPattern: [6, 4] })
    expect(dashed('INSIDE')).toMatchObject({
      outline: '2px dashed #FF0000',
      'outline-offset': '-2px'
    })
    expect(dashed('CENTER')['outline-offset']).toBe('-1px')
    expect(dashed('OUTSIDE')['outline-offset']).toBeUndefined()
    expect(roomTaken(dashed('INSIDE'))).toEqual([])
  })

  it('draws dashed side weights as a border, as no outline or shadow draws them', () => {
    const style = styleOf({
      strokes: [stroke('INSIDE')],
      dashPattern: [6, 4],
      ...sides(1, 0, 2, 0)
    })
    expect(style).toMatchObject({
      'border-style': 'dashed',
      'border-top-width': '1px',
      'border-right-width': '0px',
      'border-bottom-width': '2px',
      'border-left-width': '0px'
    })
  })

  it('draws a stroke over an image or a shader as an outline, which their content does not cover', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0].id
    graph.images.set('photo', PNG)
    const photo = (align: Stroke['align']) =>
      graph.createNode('RECTANGLE', page, {
        width: 100,
        height: 60,
        fills: [
          {
            type: 'IMAGE',
            imageHash: 'photo',
            imageScaleMode: 'FILL',
            color: RED,
            opacity: 1,
            visible: true
          }
        ],
        strokes: [stroke(align)]
      }).id
    expect(styleIn(graph, photo('INSIDE'))).toMatchObject({
      outline: '2px solid #FF0000',
      'outline-offset': '-2px'
    })
    // An outer shadow is drawn outside the image, where nothing covers it.
    expect(styleIn(graph, photo('OUTSIDE'))['box-shadow']).toBe('0 0 0 2px #FF0000')

    const { paint, shader } = createShaderPaint({ components: [{ type: 'Aurora', props: {} }] })
    graph.images.set(shader.image, PNG)
    const glow = graph.createNode('FRAME', page, {
      width: 100,
      height: 60,
      fills: [paint],
      strokes: [stroke('CENTER')]
    })
    graph.updateNode(glow.id, { pluginData: withShaderPaints(glow, [paint], [shader]) })
    expect(styleIn(graph, glow.id)).toMatchObject({
      outline: '2px solid #FF0000',
      'outline-offset': '-1px'
    })
  })

  it('draws a line as half its weight to either side, or dashed as its top border', () => {
    const line = styleOf({ height: 0, strokes: [stroke('CENTER', 1)] }, 'LINE')
    expect(line['box-shadow']).toBe('0 0 0 0.5px #FF0000')
    expect(roomTaken(line)).toEqual([])

    const dashed = styleOf(
      { height: 0, strokes: [stroke('CENTER', 1)], dashPattern: [4, 4] },
      'LINE'
    )
    expect(dashed).toMatchObject({
      'border-style': 'dashed',
      'border-top-width': '1px',
      'border-bottom-width': '0px'
    })
  })

  it('scales a weight bound to a variable in CSS', () => {
    const graph = new SceneGraph()
    graph.addCollection({
      id: 'sizes',
      name: 'Sizes',
      modes: [{ modeId: 'one', name: 'One' }],
      defaultModeId: 'one',
      variableIds: []
    })
    graph.addVariable({
      id: 'hairline',
      name: 'Hairline',
      type: 'FLOAT',
      collectionId: 'sizes',
      valuesByMode: { one: 2 },
      scopes: ['STROKE_FLOAT'],
      codeSyntax: { WEB: 'var(--hairline)' },
      description: '',
      hiddenFromPublishing: false
    })
    const bound = (align: Stroke['align'], fields: Partial<SceneNode> = {}) =>
      styleIn(
        graph,
        graph.createNode('FRAME', graph.getPages()[0].id, {
          width: 100,
          height: 60,
          strokeWeight: 2,
          strokes: [stroke(align)],
          boundVariables: { strokeWeight: 'hairline' },
          ...fields
        }).id
      )

    expect(bound('CENTER')['box-shadow']).toBe(
      'inset 0 0 0 calc(var(--hairline) * 0.5) #FF0000, 0 0 0 calc(var(--hairline) * 0.5) #FF0000'
    )
    expect(bound('INSIDE', { dashPattern: [6, 4] })['outline-offset']).toBe(
      'calc(var(--hairline) * -1)'
    )

    graph.addVariable({
      id: 'thin',
      name: 'Thin',
      type: 'FLOAT',
      collectionId: 'sizes',
      valuesByMode: { one: 0.5 },
      scopes: ['STROKE_FLOAT'],
      codeSyntax: { WEB: 'var(--thin)' },
      description: '',
      hiddenFromPublishing: false
    })
    const included = bound('INSIDE', {
      strokeWeight: 0.5,
      strokes: [stroke('INSIDE', 0.5)],
      boundVariables: { strokeWeight: 'thin' },
      layoutMode: 'VERTICAL',
      strokesIncludedInLayout: true,
      paddingTop: 8,
      paddingBottom: 8
    })
    expect(included['padding-block']).toBe('calc(8px + var(--thin))')
    expect(included['padding-inline']).toBe('var(--thin)')
  })
})
