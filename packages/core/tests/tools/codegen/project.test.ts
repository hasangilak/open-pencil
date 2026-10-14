import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { SceneGraph } from '@open-pencil/scene-graph'

import { exportReactProjectTool } from '#core/tools/codegen/project'

/** `defineTool` erases a tool's result to `unknown`; this is what this one returns. */
interface ProjectToolResult {
  summary: string
  manifest: { name: string; screens: { name: string }[] }
  files: { path: string; encoding: 'utf8' | 'base64'; content?: string; bytes?: number }[]
}

const PIXEL = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])

function design() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected a page')
  graph.images.set('pixel', PIXEL)
  const screen = graph.createNode('FRAME', page.id, { name: 'Pricing', width: 1280, height: 720 })
  graph.createNode('RECTANGLE', screen.id, {
    name: 'Photo',
    width: 200,
    height: 100,
    fills: [
      {
        type: 'IMAGE',
        imageHash: 'pixel',
        imageScaleMode: 'FILL',
        color: { r: 1, g: 1, b: 1, a: 1 },
        opacity: 1,
        visible: true
      }
    ]
  })
  return new FigmaAPI(graph)
}

const run = async (args: Parameters<typeof exportReactProjectTool.execute>[1]) =>
  (await exportReactProjectTool.execute(design(), args)) as ProjectToolResult

describe('export_react_project', () => {
  test('returns the files of the app and its manifest', async () => {
    const result = await run({ name: 'Pricing site', include_images: true })
    expect(result.summary).toBe(`1 screens and 0 components in ${result.files.length} files`)
    expect(result.manifest).toMatchObject({ name: 'Pricing site', screens: [{ name: 'Pricing' }] })
    const paths = result.files.map((file) => file.path)
    expect(paths).toEqual(
      expect.arrayContaining(['package.json', 'openpencil.json', 'src/App.tsx', 'src/screens/Pricing.tsx'])
    )
    expect(result.files.find((file) => file.path.endsWith('.png'))).toMatchObject({
      encoding: 'base64',
      content: expect.any(String)
    })
  })

  test('lists images by size alone when asked not to include them', async () => {
    const result = await run({ include_images: false })
    expect(result.files.find((file) => file.path.endsWith('.png'))).toEqual({
      path: 'public/assets/images/image-1.png',
      encoding: 'base64',
      bytes: PIXEL.byteLength
    })
  })
})
