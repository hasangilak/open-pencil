import { beforeAll, describe, expect, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'
import { createSVGNodes } from '@open-pencil/core/io'
import { populateFigPage } from '@open-pencil/core/io/formats/fig'

async function roundTrip(graph: SceneGraph): Promise<SceneGraph> {
  const reImported = await parseFigFile((await exportFigFile(graph)).buffer as ArrayBuffer)
  populateFigPage(reImported, reImported.getPages()[0].id)
  return reImported
}

describe('roundtrip: masks', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('a mask keeps its type', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    for (const maskType of ['ALPHA', 'VECTOR', 'LUMINANCE'] as const)
      graph.createNode('RECTANGLE', page.id, { name: maskType, isMask: true, maskType })

    const reImported = await roundTrip(graph)

    expect(
      reImported
        .getChildren(reImported.getPages()[0].id)
        .map(({ name, isMask, maskType }) => ({ name, isMask, maskType }))
    ).toEqual([
      { name: 'ALPHA', isMask: true, maskType: 'ALPHA' },
      { name: 'VECTOR', isMask: true, maskType: 'VECTOR' },
      { name: 'LUMINANCE', isMask: true, maskType: 'LUMINANCE' }
    ])
  })

  test('an SVG clip path keeps its mask group', async () => {
    const graph = new SceneGraph()
    createSVGNodes(
      graph,
      graph.getPages()[0].id,
      '<svg viewBox="0 0 100 100"><defs><clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath></defs><rect width="100" height="100" fill="red" clip-path="url(#c)"/></svg>'
    )

    const reImported = await roundTrip(graph)
    const mask = [...reImported.getAllNodes()].find((node) => node.isMask)

    expect(mask?.name).toBe('c')
    expect(mask?.maskType).toBe('VECTOR')
    expect(reImported.getChildren(mask?.id ?? '').map((shape) => shape.type)).toEqual(['VECTOR'])
  })
})
