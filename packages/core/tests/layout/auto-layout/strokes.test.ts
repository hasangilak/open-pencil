import { describe, expect, test } from 'bun:test'

import { SceneGraph, type Stroke } from '@open-pencil/scene-graph'
import { colorToFill } from '@open-pencil/scene-graph/color'

import { FigmaAPI, type FigmaNodeProxy } from '#core/figma-api'
import { computeAllLayouts, computeLayout } from '#core/layout'

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
