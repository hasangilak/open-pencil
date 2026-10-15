import { afterEach, describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { materializeDocument } from '@open-pencil/fig'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import { SceneGraph, type SceneNode, type Stroke } from '@open-pencil/scene-graph'
import { colorToFill } from '@open-pencil/scene-graph/color'

import { createEditor } from '#core/editor'
import { FigmaAPI, type FigmaNodeProxy } from '#core/figma-api'
import { computeAllLayouts, computeLayout, setTextMeasurer } from '#core/layout'

/** A black inside stroke 4 wide. */
function black(fields: Partial<Pick<Stroke, 'weight' | 'visible'>> = {}): Stroke & SolidPaint {
  return { ...colorToFill('#000000'), weight: 4, align: 'INSIDE', ...fields }
}

/**
 * A Hug row with padding and gap 10 around a 60 × 40 and a 50 × 30 rectangle, with a black
 * stroke. Without its stroke the row hugs 140 × 60 and its first child sits at (10, 10).
 */
function strokedRow(align: Stroke['align'] = 'INSIDE') {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  const layout = () => computeAllLayouts(graph, graph.getPages()[0].id)
  const row = figma.createFrame()
  row.layoutMode = 'HORIZONTAL'
  row.paddingLeft = row.paddingRight = row.paddingTop = row.paddingBottom = 10
  row.itemSpacing = 10
  row.strokes = [black()]
  row.strokeWeight = 4
  row.strokeAlign = align
  const first = figma.createRectangle()
  first.resize(60, 40)
  row.appendChild(first)
  const second = figma.createRectangle()
  second.resize(50, 30)
  row.appendChild(second)
  row.layoutSizingHorizontal = 'HUG'
  row.layoutSizingVertical = 'HUG'
  layout()
  return { figma, row, first, second, layout }
}

const place = (node: FigmaNodeProxy) => [node.x, node.y]
const size = (node: FigmaNodeProxy) => [node.width, node.height]

// With strokes included, Figma lays an auto layout frame out like CSS `box-sizing: border-box`,
// and only an inside stroke counts. Frames saved by Figma with included inside strokes put their
// first child at padding plus stroke weight and hug their content plus both sides' weights.
describe('strokes included in auto layout', () => {
  test('a stroke left out of layout lets the children sit on it', () => {
    const { row, first, second } = strokedRow()
    expect(row.strokesIncludedInLayout).toBe(false)
    expect([place(first), place(second), size(row)]).toEqual([
      [10, 10],
      [80, 10],
      [140, 60]
    ])
  })

  test('an included stroke insets the children and grows the hug by its weight', () => {
    const { row, first, second, layout } = strokedRow()
    row.strokesIncludedInLayout = true
    layout()
    expect([place(first), place(second), size(row)]).toEqual([
      [14, 14],
      [84, 14],
      [148, 68]
    ])
  })

  test('each side takes its own weight', () => {
    const { row, first, second, layout } = strokedRow()
    row.strokesIncludedInLayout = true
    row.strokeTopWeight = 1
    row.strokeRightWeight = 2
    row.strokeBottomWeight = 3
    row.strokeLeftWeight = 4
    layout()
    expect([place(first), place(second), size(row)]).toEqual([
      [14, 11],
      [84, 11],
      [146, 64]
    ])
  })

  test('a fixed frame shares what its padding and stroke leave with a fill child', () => {
    const { row, first, second, layout } = strokedRow()
    row.strokesIncludedInLayout = true
    row.layoutSizingHorizontal = 'FIXED'
    row.resize(200, row.height)
    second.layoutSizingHorizontal = 'FILL'
    layout()
    // 200 less 10 padding and 4 stroke a side, the first child, and the gap.
    expect([place(second), second.width]).toEqual([[84, 14], 102])
    expect(first.x).toBe(14)
  })

  test('a frame inside auto layout hugs its children and its stroke', () => {
    const { figma, row, first, layout } = strokedRow()
    row.strokesIncludedInLayout = true
    const column = figma.createFrame()
    column.layoutMode = 'VERTICAL'
    column.layoutSizingHorizontal = 'HUG'
    column.layoutSizingVertical = 'HUG'
    column.appendChild(row)
    layout()
    expect([place(first), size(row), size(column)]).toEqual([
      [14, 14],
      [148, 68],
      [148, 68]
    ])
  })

  test('center and outside strokes paint over the layout without taking room', () => {
    for (const align of ['CENTER', 'OUTSIDE'] as const) {
      const { row, first, layout } = strokedRow(align)
      row.strokesIncludedInLayout = true
      layout()
      expect([align, place(first), size(row)]).toEqual([align, [10, 10], [140, 60]])
    }
  })

  test('hidden strokes take no room', () => {
    const { row, first, layout } = strokedRow()
    row.strokesIncludedInLayout = true
    row.strokes = [black({ visible: false })]
    layout()
    expect([place(first), size(row)]).toEqual([
      [10, 10],
      [140, 60]
    ])
  })

  test('a grid insets its cells by an included stroke', () => {
    const graph = new SceneGraph()
    const grid = graph.createNode('FRAME', graph.getPages()[0].id, {
      layoutMode: 'GRID',
      width: 200,
      height: 100,
      gridTemplateColumns: [{ sizing: 'FR', value: 1 }],
      gridTemplateRows: [{ sizing: 'FR', value: 1 }],
      paddingLeft: 10,
      paddingTop: 10,
      strokes: [black({ weight: 5 })],
      strokesIncludedInLayout: true
    })
    const cell = graph.createNode('RECTANGLE', grid.id, { width: 20, height: 20 })
    computeLayout(graph, grid.id)
    expect([graph.getNode(cell.id)?.x, graph.getNode(cell.id)?.y]).toEqual([15, 15])
  })
})

/**
 * A Hug row as Figma saves one with a 2 px inside stroke in its layout: padding and gap 10 around
 * a 60 × 40 and a 50 × 30 rectangle, the first at padding plus stroke, hugging both strokes.
 */
function savedStrokedRow() {
  const guid = (localID: number) => ({ sessionID: 1, localID })
  const at = (x: number, y: number) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y })
  const paint: NodeChange['fillPaints'] = [
    { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }
  ]
  const rectangle = (localID: number, position: string, x: number, size: NodeChange['size']) => ({
    guid: guid(localID),
    type: 'RECTANGLE',
    parentIndex: { guid: guid(2), position },
    size,
    transform: at(x, 12),
    fillPaints: paint
  })
  const { graph, sources } = materializeDocument([
    { guid: guid(0), type: 'DOCUMENT' },
    { guid: guid(1), type: 'CANVAS', parentIndex: { guid: guid(0), position: '!' } },
    {
      guid: guid(2),
      type: 'FRAME',
      parentIndex: { guid: guid(1), position: '!' },
      size: { x: 144, y: 64 },
      transform: at(0, 0),
      stackMode: 'HORIZONTAL',
      stackCounterSizing: 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE',
      stackSpacing: 10,
      stackPadding: 10,
      strokePaints: paint,
      strokeWeight: 2,
      strokeAlign: 'INSIDE',
      bordersTakeSpace: true
    },
    rectangle(3, '!', 12, { x: 60, y: 40 }),
    rectangle(4, '"', 82, { x: 50, y: 30 })
  ])
  const node = (id: string) => expectDefined(graph.getNode(expectDefined(sources.get(id))))
  // Opening a file lays its pages out.
  graph.applyDerivedLayoutDuring(() => computeAllLayouts(graph, graph.getPages()[0].id))
  return {
    editor: createEditor({ graph }),
    row: node('1:2'),
    first: node('1:3'),
    second: node('1:4')
  }
}

const box = (node: SceneNode) => [node.x, node.y, node.width, node.height]

describe('a stroke a .fig file includes in auto layout', () => {
  afterEach(() => setTextMeasurer(null))

  test('opening keeps the geometry Figma saved', () => {
    const { row, first, second } = savedStrokedRow()
    expect([row, first, second].map(box)).toEqual([
      [0, 0, 144, 64],
      [12, 12, 60, 40],
      [82, 12, 50, 30]
    ])
  })

  test('an edit lays the row out again inside its stroke', () => {
    const { editor, row, first, second } = savedStrokedRow()
    editor.updateNodeWithUndo(row.id, { itemSpacing: 20 })
    expect([row.width, first.x, second.x]).toEqual([154, 12, 92])
    editor.dispose()
  })

  test('a new stroke weight lays the row out again', () => {
    const { editor, row, first, second } = savedStrokedRow()
    editor.updateNodeWithUndo(row.id, {
      strokes: row.strokes.map((stroke) => ({ ...stroke, weight: 4 }))
    })
    expect([row, first, second].map(box)).toEqual([
      [0, 0, 148, 68],
      [14, 14, 60, 40],
      [84, 14, 50, 30]
    ])
    editor.dispose()
  })

  test('fill layers keep the widths saved for the room the stroke leaves them', () => {
    const graph = new SceneGraph()
    const row = graph.createNode('FRAME', graph.getPages()[0].id, {
      width: 292,
      height: 44,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      itemSpacing: 16,
      strokes: [black({ weight: 2 })],
      strokesIncludedInLayout: true
    })
    const filled = (width: number, height: number) =>
      graph.createNode('INSTANCE', row.id, {
        width,
        height,
        layoutMode: 'HORIZONTAL',
        layoutGrow: 1,
        derivedLayout: { width, height }
      })
    // Saved shares that differ from the even split flex sizing would give them.
    const first = filled(156, 14)
    const second = filled(116, 40)
    graph.createNode('RECTANGLE', first.id, { width: 156, height: 14 })
    computeAllLayouts(graph)
    expect([first.x, first.width, second.x, second.width]).toEqual([2, 156, 174, 116])
  })

  test('a frame hugging text shaped narrower than saved keeps its stroke around it', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const source = graph.createNode('TEXT', page.id, {
      width: 100,
      height: 20,
      text: 'Chart heading',
      textAutoResize: 'WIDTH_AND_HEIGHT'
    })
    graph.updateNode(source.id, { source: { ...source.source, format: 'fig', id: '1:8' } })
    const column = graph.createNode('FRAME', page.id, {
      width: 124,
      height: 80,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'HUG',
      paddingLeft: 10,
      paddingRight: 10,
      counterAxisAlign: 'STRETCH',
      strokes: [black({ weight: 2 })],
      strokesIncludedInLayout: true,
      componentId: 'column',
      derivedLayout: { width: 124, height: 80 }
    })
    graph.createNode('TEXT', column.id, {
      width: 100,
      height: 20,
      text: source.text,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      componentId: source.id,
      derivedLayout: { width: 100, height: 20 }
    })
    const divider = graph.createNode('RECTANGLE', column.id, {
      width: 100,
      height: 10,
      derivedLayout: { width: 100, height: 10 }
    })
    setTextMeasurer(() => ({ width: 80, height: 20 }))
    computeAllLayouts(graph)
    expect([graph.getNode(column.id)?.width, graph.getNode(divider.id)?.width]).toEqual([104, 80])
  })
})
