import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import {
  defaultModeCondition,
  modeAttribute,
  type MarkupMeasurer,
  type MarkupMeasureRequest,
  type MeasuredElement,
  type ReactProject
} from '@open-pencil/dom-css/export'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { colorToCSS } from '@open-pencil/scene-graph/color'

import { checkCode, checkScreenCode, type CodeCheckReport } from '#core/tools/codegen/check'
import { checkedModes, designLayer } from '#core/tools/codegen/check/design'
import { LAYER_ATTRIBUTE } from '#core/tools/codegen/check/render'
import { exportReactProjectFiles } from '#core/tools/codegen/project'
import {
  APP_MODULES,
  BLUE,
  layerNamed,
  screenDesign,
  SKY,
  withChangedFile
} from '#core-tests/tools/codegen/check/fixtures'

type Change = (element: MeasuredElement, layer: SceneNode, request: MarkupMeasureRequest) => void

/**
 * A browser that lays out each element of the code it is given where the design draws the
 * layer the element is marked with, colors resolved in the mode the page is switched to, with
 * `change` applied to what it reports. A layer the code draws no element for is not reported.
 */
function faithfulBrowser(
  graph: SceneGraph,
  screen: SceneNode,
  change?: Change,
  requests: MarkupMeasureRequest[] = []
): MarkupMeasurer {
  const switching = { modeAttribute, defaultModeCondition }
  return async (request) => {
    requests.push(request)
    const [attribute, value] = Object.entries(request.rootAttributes ?? {})[0] ?? []
    const mode =
      checkedModes(graph, switching).find(
        (candidate) =>
          candidate.attribute !== null &&
          candidate.attribute.name === attribute &&
          candidate.attribute.value === value
      ) ?? null
    const marks = request.html.matchAll(new RegExp(`${request.layerAttribute}="([^"]*)"`, 'g'))
    const elements = [...marks].map(([, id = '']): MeasuredElement => {
      const node = graph.getNode(id)
      if (!node) throw new Error(`The code marks an element with ${id}, which is no layer`)
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
        overflows: false,
        layer: id
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
  figma.loadAppModules = async () => APP_MODULES
  return (await checkCode.execute(figma, {
    id: design.screen.id,
    modes: true,
    tolerance: 2,
    ...args
  })) as CodeCheckReport
}

/** Checks the screen against a given export of the design, such as a broken one. */
async function checkExport(
  design: ReturnType<typeof screenDesign>,
  project: (exported: ReactProject) => ReactProject
): Promise<CodeCheckReport> {
  const exported = await exportReactProjectFiles(design.graph)
  const host = { measure: faithfulBrowser(design.graph, design.screen), modules: APP_MODULES }
  return checkScreenCode(design.graph, design.screen, host, { project: project(exported) })
}

describe('check_code', () => {
  test('passes when the browser lays the code out as the design draws it', async () => {
    const report = await check(screenDesign())
    expect(report.differences).toEqual([])
    expect(report.pass).toBe(true)
    expect(report.file).toBe('src/screens/Home.tsx')
    expect(report.checked).toEqual({ layers: 6, widths: [1440], modes: ['Theme / Dark'] })
    expect(report.summary).toContain('All 6 layers match the design at 1440px.')
  })

  test('lays out the code the export ships: the screen with the components it uses', async () => {
    const design = screenDesign()
    const requests: MarkupMeasureRequest[] = []
    const figma = new FigmaAPI(design.graph)
    figma.measureMarkup = faithfulBrowser(design.graph, design.screen, undefined, requests)
    figma.loadAppModules = async () => APP_MODULES

    await checkCode.execute(figma, { id: design.screen.id, modes: false, tolerance: 2 })

    const [request] = requests
    expect(request?.layerAttribute).toBe(LAYER_ATTRIBUTE)
    // Skip's own markup, its variant set from the screen's prop, and the icon from its glyph.
    expect(request?.html).toContain('class="group/skip ')
    expect(request?.html).toContain('data-direction="Forward"')
    expect(request?.html).toContain(
      `${LAYER_ATTRIBUTE}="${layerNamed(design.graph, design.next, 'skip-forward').id}"`
    )
    // The project's tokens style it.
    expect(request?.css).toContain('--color-primary')
  })

  test('fails a screen that uses a broken component, naming what it no longer draws', async () => {
    const design = screenDesign()
    const icon = layerNamed(design.graph, design.next, 'skip-forward')

    const wrongIcon = await checkExport(design, (project) =>
      withChangedFile(project, 'src/components/Skip.tsx', (source) =>
        source.replace('icon="lucide:skip-forward"', 'icon="lucide:skip-forwards"')
      )
    )
    const hiddenIcon = await checkExport(design, (project) =>
      withChangedFile(project, 'src/components/Skip.tsx', (source) =>
        source.replace(/(<IconifyIcon icon="lucide:skip-forward"[^>]*\/>)/, '{false && $1}')
      )
    )

    for (const report of [wrongIcon, hiddenIcon]) {
      expect(report.pass).toBe(false)
      expect(report.differences).toEqual([
        {
          layerId: icon.id,
          name: 'skip-forward',
          kind: 'missing',
          design: expect.stringContaining('22px × 22px'),
          code: 'not drawn',
          delta: 22
        }
      ])
      expect(report.summary).toContain('The code does not draw 1 of them.')
    }
  })

  test('fails a screen whose icons the project does not register', async () => {
    const design = screenDesign()

    const report = await checkExport(design, (project) =>
      withChangedFile(project, 'src/icons.ts', (source) =>
        source.replace("'skip-forward'", "'skip-ahead'")
      )
    )

    expect(report.pass).toBe(false)
    expect(report.differences).toMatchObject([{ name: 'skip-forward', kind: 'missing' }])
  })

  test('fails a screen whose code throws, saying where', async () => {
    const design = screenDesign()

    const report = await checkExport(design, (project) =>
      withChangedFile(project, 'src/components/Skip.tsx', (source) =>
        source.replace('return <div', 'throw new Error("no skipping"); return <div')
      )
    )

    expect(report).toMatchObject({
      pass: false,
      file: 'src/screens/Home.tsx',
      summary: 'src/screens/Home.tsx failed to render: no skipping.',
      checked: { layers: 0 }
    })
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

  test('fails a frame the export writes no screen for, such as a label', async () => {
    const design = screenDesign()
    const page = design.graph.getPages()[0]
    if (!page) throw new Error('Expected a page')
    const label = design.graph.createNode('FRAME', page.id, { name: 'Chapter', y: 1000 })
    design.graph.createNode('TEXT', label.id, { name: 'Heading', text: '01 Hello.' })
    const host = { measure: faithfulBrowser(design.graph, label), modules: APP_MODULES }

    const report = await checkScreenCode(design.graph, label, host)

    expect(report).toMatchObject({
      pass: false,
      file: null,
      summary: 'The export writes no screen for Chapter.'
    })
  })

  test('says it needs a browser and React where the host has neither', async () => {
    const { graph, screen } = screenDesign()
    const figma = new FigmaAPI(graph)
    figma.measureMarkup = faithfulBrowser(graph, screen)
    const result = await checkCode.execute(figma, { id: screen.id, modes: true, tolerance: 2 })
    expect(result).toMatchObject({ error: expect.stringContaining('React') })
  })
})
