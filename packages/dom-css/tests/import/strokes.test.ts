import { describe, expect, it } from 'bun:test'

import {
  createHeadlessCSSRuntime,
  htmlToSceneGraph,
  sceneNodeToDesignDocument,
  serializeHTML
} from '#dom-css/index'

import { SceneGraph, type SceneNode, type Stroke } from '@open-pencil/scene-graph'

const RED = { r: 1, g: 0, b: 0, a: 1 }

/** The layer an element with `id="box"` and this style imports as. */
async function importBox(style: string): Promise<SceneNode> {
  const graph = await htmlToSceneGraph(
    `<div id="box" style="width:100px;height:60px;${style}"></div>`,
    { runtime: createHeadlessCSSRuntime() }
  )
  const box = [...graph.getAllNodes()].find((node) => node.name === 'box')
  if (!box) throw new Error('Missing box')
  return box
}

/** A layer's stroke, with its weight on each side whether or not the sides differ. */
function strokeOf(node: SceneNode) {
  const [stroke] = node.strokes
  const weight = stroke?.weight ?? 0
  return {
    align: stroke?.align,
    weight,
    sides: node.independentStrokeWeights
      ? [
          node.borderTopWeight,
          node.borderRightWeight,
          node.borderBottomWeight,
          node.borderLeftWeight
        ]
      : [weight, weight, weight, weight],
    independent: node.independentStrokeWeights,
    dashed: node.dashPattern.length > 0,
    takesSpace: node.strokesIncludedInLayout
  }
}

function paddingOf(node: SceneNode): number[] {
  return [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft]
}

describe('strokes in HTML import', () => {
  it('reads a border as an inside stroke that takes room, as CSS gives it', async () => {
    expect(strokeOf(await importBox('display:flex;border:2px solid #f00'))).toEqual({
      align: 'INSIDE',
      weight: 2,
      sides: [2, 2, 2, 2],
      independent: false,
      dashed: false,
      takesSpace: true
    })
  })

  it('reads an outline as a stroke aligned by how far its offset moves it in', async () => {
    const outline = async (offset: string, style = 'solid') =>
      strokeOf(await importBox(`outline:2px ${style} #f00;outline-offset:${offset}`))
    expect(await outline('-2px')).toMatchObject({ align: 'INSIDE', weight: 2, takesSpace: false })
    expect(await outline('-1px')).toMatchObject({ align: 'CENTER', weight: 2 })
    expect(await outline('0px')).toMatchObject({ align: 'OUTSIDE', weight: 2 })
    expect(await outline('-2px', 'dashed')).toMatchObject({ dashed: true })
    expect((await importBox('outline:2px none #f00')).strokes).toEqual([])
  })

  it('reads spread shadows as a stroke and keeps the other shadows as effects', async () => {
    const ring = await importBox('box-shadow:inset 0 0 0 1px #f00, 0 4px 8px rgba(0,0,0,0.25)')
    expect(strokeOf(ring)).toMatchObject({ align: 'INSIDE', weight: 1, takesSpace: false })
    expect(ring.effects).toHaveLength(1)
    expect(ring.effects[0]).toMatchObject({ type: 'DROP_SHADOW', radius: 8 })

    expect(strokeOf(await importBox('box-shadow:0 0 0 3px #f00'))).toMatchObject({
      align: 'OUTSIDE',
      weight: 3
    })
    expect(
      strokeOf(await importBox('box-shadow:inset 0 0 0 1px #f00, 0 0 0 1px #f00'))
    ).toMatchObject({ align: 'CENTER', weight: 2 })
  })

  it('reads bands along sides as side weights', async () => {
    const bands = await importBox('box-shadow:inset 0 1px 0 0 #f00, inset 0 -2px 0 0 #f00')
    expect(strokeOf(bands)).toMatchObject({
      align: 'INSIDE',
      weight: 2,
      sides: [1, 0, 2, 0],
      independent: true
    })
    // A shadow under the box, as pages draw a divider, is an outside bottom stroke.
    expect(strokeOf(await importBox('box-shadow:0 1px 0 0 #f00'))).toMatchObject({
      align: 'OUTSIDE',
      sides: [0, 0, 1, 0]
    })
  })

  it('keeps shadows that are blurred or of several colors as effects', async () => {
    const blurred = await importBox('box-shadow:0 0 2px 1px #f00')
    expect(blurred.strokes).toEqual([])
    expect(blurred.effects).toHaveLength(1)

    const twoColors = await importBox('box-shadow:inset 0 0 0 1px #f00, 0 0 0 1px #00f')
    expect(twoColors.strokes).toEqual([])
    expect(twoColors.effects).toHaveLength(2)
  })

  it('reads padding that holds a fractional inside stroke as the room the stroke takes', async () => {
    const ring = await importBox(
      'display:flex;padding:12.5px 16.5px;box-shadow:inset 0 0 0 0.5px #f00'
    )
    expect(strokeOf(ring)).toMatchObject({ align: 'INSIDE', weight: 0.5, takesSpace: true })
    expect(paddingOf(ring)).toEqual([12, 16, 12, 16])

    const band = await importBox(
      'display:flex;padding-bottom:0.5px;box-shadow:inset 0 -0.5px 0 0 #f00'
    )
    expect(strokeOf(band)).toMatchObject({ sides: [0, 0, 0.5, 0], takesSpace: true })
    expect(paddingOf(band)).toEqual([0, 0, 0, 0])

    // Whole weights and padding a stroke's weight leaves fractional stay as written.
    for (const [style, padding] of [
      ['display:flex;padding:16px;box-shadow:inset 0 0 0 0.5px #f00', 16],
      ['display:flex;padding:16.5px;box-shadow:inset 0 0 0 1px #f00', 16.5],
      ['display:flex;padding:16.5px;box-shadow:0 0 0 0.5px #f00', 16.5]
    ] as const) {
      const box = await importBox(style)
      expect({ style, takesSpace: strokeOf(box).takesSpace, padding: box.paddingLeft }).toEqual({
        style,
        takesSpace: false,
        padding
      })
    }
  })

  it('reads back every stroke the export writes', async () => {
    const stroke = (align: Stroke['align'], weight = 2): Stroke => ({
      type: 'SOLID',
      color: RED,
      opacity: 1,
      visible: true,
      weight,
      align
    })
    const sides = {
      independentStrokeWeights: true,
      borderTopWeight: 1,
      borderRightWeight: 0,
      borderBottomWeight: 3,
      borderLeftWeight: 0
    }
    const fractionalSides = { ...sides, borderBottomWeight: 0.5 }
    const included = { layoutMode: 'VERTICAL', strokesIncludedInLayout: true } as const
    const padded = { paddingTop: 12, paddingRight: 16, paddingBottom: 12, paddingLeft: 16 }
    const cases: Partial<SceneNode>[] = [
      { strokes: [stroke('INSIDE')] },
      { strokes: [stroke('CENTER')] },
      { strokes: [stroke('OUTSIDE')] },
      { strokes: [stroke('INSIDE', 3)], ...sides },
      { strokes: [stroke('CENTER', 3)], ...sides },
      { strokes: [stroke('OUTSIDE', 3)], ...sides },
      { strokes: [stroke('CENTER')], dashPattern: [6, 4] },
      { strokes: [stroke('INSIDE')], layoutMode: 'VERTICAL', strokesIncludedInLayout: true },
      { strokes: [stroke('INSIDE', 0.5)], ...included, ...padded },
      { strokes: [stroke('INSIDE', 0.5)], ...included, ...padded, dashPattern: [1, 1] },
      { strokes: [stroke('INSIDE', 1)], ...included, ...padded, ...fractionalSides },
      { strokes: [stroke('INSIDE', 0.5)], layoutMode: 'VERTICAL', ...padded }
    ]
    for (const fields of cases) {
      const graph = new SceneGraph()
      const design = graph.createNode('FRAME', graph.getPages()[0].id, {
        name: 'box',
        width: 100,
        height: 60,
        ...fields
      })
      const html = serializeHTML(
        sceneNodeToDesignDocument(graph, design.id, { includeSourceIds: false })
      ).replace('<div', '<div id="box"')
      const imported = await htmlToSceneGraph(html, { runtime: createHeadlessCSSRuntime() })
      const box = [...imported.getAllNodes()].find((node) => node.name === 'box')
      if (!box) throw new Error(`Nothing imported from ${html}`)
      expect({ html, ...strokeOf(box), padding: paddingOf(box) }).toEqual({
        html,
        ...strokeOf(design),
        padding: paddingOf(design)
      })
    }
  })
})
