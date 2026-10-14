import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import {
  defaultModeCondition,
  layerMarkup,
  modeAttribute,
  type MarkupMeasurer,
  type MarkupMeasureRequest,
  type MeasuredElement
} from '@open-pencil/dom-css/export'
import { SceneGraph, type Color, type SceneNode } from '@open-pencil/scene-graph'
import { colorToCSS } from '@open-pencil/scene-graph/color'

import { vectorElement } from '#core/io/formats/html/vectors'
import { checkCode, type CodeCheckReport } from '#core/tools/codegen/check'
import { checkedModes, designLayer } from '#core/tools/codegen/check/design'

const BLUE = { r: 0.23, g: 0.51, b: 0.96, a: 1 }
const SKY = { r: 0.58, g: 0.77, b: 0.99, a: 1 }
const solid = (color: Color) => [{ type: 'SOLID' as const, color, opacity: 1, visible: true }]

/** A screen with a title, a card filled with Primary, which Dark changes, and a pinned badge. */
function screenDesign({ contrast = false } = {}) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (!page) throw new Error('Expected a page')
  const theme = graph.createCollection('Theme')
  graph.renameMode(theme.id, theme.defaultModeId, 'Light')
  graph.addMode(theme.id, 'dark', 'Dark')
  if (contrast) graph.addMode(theme.id, 'contrast', 'Contrast')
  const contrastMode = theme.modes.find((mode) => mode.modeId === 'contrast')
  if (contrastMode) contrastMode.condition = '@media (prefers-contrast: more)'
  const primary = graph.createVariable('Primary', 'COLOR', theme.id, BLUE)
  primary.valuesByMode.dark = SKY
  const screen = graph.createNode('FRAME', page.id, {
    name: 'Home',
    width: 1440,
    height: 900,
    layoutMode: 'VERTICAL',
    itemSpacing: 24,
    paddingTop: 64,
    paddingLeft: 64,
    fills: solid({ r: 1, g: 1, b: 1, a: 1 })
  })
  graph.createNode('TEXT', screen.id, {
    name: 'Title',
    text: 'Welcome',
    fontSize: 48,
    fontWeight: 700,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    width: 210,
    height: 58
  })
  graph.createNode('FRAME', screen.id, {
    name: 'Card',
    width: 320,
    height: 160,
    fills: solid(BLUE),
    boundVariables: { 'fills/0/color': primary.id }
  })
  graph.createNode('RECTANGLE', screen.id, {
    name: 'Badge',
    x: 1336,
    y: 40,
    width: 64,
    height: 24,
    layoutPositioning: 'ABSOLUTE',
    horizontalConstraint: 'MAX',
    fills: solid(BLUE)
  })
  return { graph, screen }
}

type Change = (element: MeasuredElement, layer: SceneNode, request: MarkupMeasureRequest) => void

/**
 * A browser that lays the markup out exactly as the design draws it, colors resolved in the mode
 * the page is switched to, with `change` applied to what it reports.
 */
function faithfulBrowser(graph: SceneGraph, screen: SceneNode, change?: Change): MarkupMeasurer {
  const switching = { modeAttribute, defaultModeCondition }
  return async (request) => {
    const markup = await layerMarkup(graph, [screen.id], {
      styling: 'tailwind',
      fillViewport: true,
      vectorElement
    })
    const [attribute, value] = Object.entries(request.rootAttributes ?? {})[0] ?? []
    const mode =
      checkedModes(graph, switching).find(
        (candidate) =>
          candidate.attribute !== null &&
          candidate.attribute.name === attribute &&
          candidate.attribute.value === value
      ) ?? null
    const elements = markup.layerIds.map((id): MeasuredElement => {
      const node = id ? graph.getNode(id) : undefined
      if (!node) throw new Error('Expected every element to draw a layer')
      const layer = designLayer(graph, screen, node, mode)
      const text = layer.type === 'TEXT'
      const element: MeasuredElement = {
        tagName: text ? 'span' : 'div',
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        styles: {
          color: text && layer.color ? colorToCSS(layer.color) : 'rgb(0, 0, 0)',
          backgroundColor: !text && layer.color ? colorToCSS(layer.color) : 'rgba(0, 0, 0, 0)',
          fontSize: `${layer.fontSize ?? 16}px`,
          fontWeight: String(layer.fontWeight ?? 400),
          lineHeight: 'normal',
          opacity: '1'
        },
        overflows: false
      }
      change?.(element, node, request)
      return element
    })
    const right = Math.max(...elements.map((element) => element.x + element.width))
    return {
      width: request.width,
      scrollWidth: Math.max(request.width, right),
      height: 900,
      elements,
      fontsLoaded: true
    }
  }
}

async function check(
  design: ReturnType<typeof screenDesign>,
  change?: Change,
  args: Partial<Parameters<typeof checkCode.execute>[1]> = {}
): Promise<CodeCheckReport> {
  const figma = new FigmaAPI(design.graph)
  figma.measureMarkup = faithfulBrowser(design.graph, design.screen, change)
  return (await checkCode.execute(figma, {
    id: design.screen.id,
    modes: true,
    tolerance: 2,
    ...args
  })) as CodeCheckReport
}

describe('check_code', () => {
  test('passes when the browser lays the code out as the design draws it', async () => {
    const report = await check(screenDesign())
    expect(report.differences).toEqual([])
    expect(report.pass).toBe(true)
    expect(report.checked).toEqual({ layers: 4, widths: [1440], modes: ['Theme / Dark'] })
    expect(report.summary).toContain('All 4 layers match the design at 1440px.')
  })

  test('reports a layer the code draws at another size, with both sizes', async () => {
    const report = await check(screenDesign(), (element, layer) => {
      if (layer.name === 'Card') element.height = 172
    })
    expect(report.pass).toBe(false)
    expect(report.differences).toEqual([
      {
        layerId: expect.any(String),
        name: 'Card',
        kind: 'size',
        design: '320px × 160px',
        code: '320px × 172px',
        delta: 12
      }
    ])
  })

  test('reports a color that differs only in a mode, named after it', async () => {
    const report = await check(screenDesign(), (element, layer, request) => {
      if (layer.name === 'Card' && request.rootAttributes?.['data-theme'] === 'dark')
        element.styles.backgroundColor = colorToCSS(BLUE)
    })
    expect(report.differences).toMatchObject([
      { name: 'Card', kind: 'fill', mode: 'Theme / Dark', design: colorToCSS(SKY) }
    ])
    expect(report.summary).toContain('Theme / Dark: 1 colors differ.')
  })

  test('reports type the code sets other than the design', async () => {
    const report = await check(screenDesign(), (element, layer) => {
      if (layer.name === 'Title') element.styles.fontSize = '32px'
    })
    expect(report.differences).toMatchObject([
      { name: 'Title', kind: 'font-size', design: '48px', code: '32px' }
    ])
  })

  test('reports widths where the page scrolls sideways and what reaches past them', async () => {
    const report = await check(screenDesign(), undefined, { widths: [390] })
    const narrow = report.responsive.find((width) => width.width === 390)
    expect(narrow?.scrollsBy).toBe(1050)
    expect(narrow?.widest[0]).toMatchObject({ name: 'Home', right: 1440 })
    expect(report.pass).toBe(false)
    expect(report.summary).toContain('At 390px the page scrolls sideways by 1050px.')
  })

  test('notes a mode under a media condition, which it cannot switch to', async () => {
    const report = await check(screenDesign({ contrast: true }))
    expect(report.checked.modes).toEqual(['Theme / Dark'])
    expect(report.notes).toContain(
      'Theme / Contrast applies under @media (prefers-contrast: more), which a check cannot switch to, so it was not checked.'
    )
  })

  test('says it needs a browser where the host has none', async () => {
    const { graph, screen } = screenDesign()
    const result = await checkCode.execute(new FigmaAPI(graph), {
      id: screen.id,
      modes: true,
      tolerance: 2
    })
    expect(result).toMatchObject({ error: expect.stringContaining('browser') })
  })
})
