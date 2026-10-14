import { describe, expect, mock, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'
import type { Fill, SceneNode } from '@open-pencil/scene-graph'

import { applyFill, applyGradientFill } from '#core/canvas/fills'
import type { SkiaRenderer } from '#core/canvas/renderer'

import { asRenderer } from './helpers'

const fill: Fill = {
  type: 'GRADIENT_LINEAR',
  gradientStops: [
    { position: 0, color: { r: 0, g: 0, b: 0, a: 0.7 } },
    { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } }
  ],
  gradientTransform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 },
  opacity: 1,
  visible: true
}

/** A renderer whose CanvasKit returns `shader` for every gradient, as a real one may return null. */
function createRenderer(shader: { delete: () => void } | null) {
  const renderer: SkiaRenderer = asRenderer({
    fillPaint: { setShader: mock(() => undefined), setColor: mock(() => undefined) },
    ck: {
      Color4f: mock((r, g, b, a) => [r, g, b, a]),
      Matrix: { multiply: mock(() => [1, 0, 0, 0, 1, 0, 0, 0, 1]), scaled: mock(() => []) },
      Shader: { MakeLinearGradient: mock(() => shader) },
      TileMode: { Clamp: 'clamp' }
    },
    resolveFillColorInfo: mock((solid: Fill) => ({ color: solid.color })),
    applyGradientFill(gradient: Fill, target: SceneNode, graph: SceneGraph) {
      return applyGradientFill(renderer, gradient, target, graph)
    }
  })
  return renderer
}

// While JSX streams, a preview lays out layers that may still be 0×0.
const node = { id: '1:2', source: { id: '' }, width: 0, height: 0 } as SceneNode

describe('gradient fills CanvasKit cannot build', () => {
  test('draw nothing instead of throwing on every frame', () => {
    const renderer = createRenderer(null)
    expect(() => applyFill(renderer, fill, node, new SceneGraph())).not.toThrow()
    expect(applyFill(renderer, fill, node, new SceneGraph())).toBe(false)
    expect(renderer.fillPaint.setShader).toHaveBeenLastCalledWith(null)
  })

  test('a built gradient is drawn and its handle released', () => {
    const shader = { delete: mock(() => undefined) }
    const renderer = createRenderer(shader)
    expect(applyFill(renderer, fill, { ...node, width: 100, height: 100 }, new SceneGraph())).toBe(
      true
    )
    expect(renderer.fillPaint.setShader).toHaveBeenLastCalledWith(shader)
    expect(shader.delete).toHaveBeenCalledTimes(1)
  })
})
