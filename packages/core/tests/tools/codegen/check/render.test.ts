import { describe, expect, test } from 'bun:test'

import {
  LAYER_ATTRIBUTE,
  screenApp,
  ScreenCodeError
} from '#core/tools/codegen/check/render'
import { exportReactProjectFiles } from '#core/tools/codegen/project'
import {
  APP_MODULES,
  BLUE,
  layerNamed,
  PIXEL_PNG,
  screenDesign,
  solid,
  withChangedFile
} from '#core-tests/tools/codegen/check/fixtures'

/** The layer each marked element draws, in the order the elements open. */
const marked = (html: string) =>
  [...html.matchAll(new RegExp(`<(\\w+)[^>]*${LAYER_ATTRIBUTE}="([^"]*)"`, 'g'))].map(
    ([, tag, layer]) => ({ tag, layer })
  )

async function exported() {
  const design = screenDesign()
  const project = await exportReactProjectFiles(design.graph)
  const entry = project.manifest.screens.find((screen) => screen.layerId === design.screen.id)
  if (!entry) throw new Error('Expected the screen in the export')
  return { ...design, project, entry }
}

describe("a screen's exported code, run", () => {
  test("marks each element with the screen's layer it draws, through the components it uses", async () => {
    const { graph, screen, next, project, entry } = await exported()
    const forward = layerNamed(graph, next, 'skip-forward')

    const { html } = screenApp(graph, project, entry, APP_MODULES)

    // Skip's elements draw the instance's layers: its root the instance, and the icon only
    // the Forward variant draws, found by its path below it.
    expect(marked(html)).toEqual([
      { tag: 'div', layer: screen.id },
      { tag: 'span', layer: layerNamed(graph, screen, 'Title').id },
      { tag: 'div', layer: layerNamed(graph, screen, 'Card').id },
      { tag: 'div', layer: next.id },
      { tag: 'svg', layer: forward.id },
      { tag: 'div', layer: layerNamed(graph, screen, 'Badge').id }
    ])
    // The component sets its variant from the prop the screen passes.
    expect(html).toContain('data-direction="Forward"')
  })

  test('draws icons from the glyphs the project registers in src/icons.ts', async () => {
    const { graph, next, project, entry } = await exported()
    const forward = layerNamed(graph, next, 'skip-forward')

    const { html } = screenApp(graph, project, entry, APP_MODULES)
    const unregistered = screenApp(
      graph,
      withChangedFile(project, 'src/icons.ts', (source) =>
        source.replace("'skip-forward'", "'skip-ahead'")
      ),
      entry,
      APP_MODULES
    ).html

    expect(html).toContain('<rect width="4" height="16"')
    expect(marked(html).map((element) => element.layer)).toContain(forward.id)
    // Iconify's placeholder until it would fetch the glyph from its API, which a check never
    // does, and never the glyph another project registered; it draws no layer.
    expect(unregistered).toContain('<span></span>')
    expect(marked(unregistered).map((element) => element.layer)).not.toContain(forward.id)
  })

  test('draws the images the project serves, which nothing serves to a check', async () => {
    const design = screenDesign()
    design.graph.images.set('pixel', PIXEL_PNG)
    design.graph.createNode('RECTANGLE', design.screen.id, {
      name: 'Photo',
      width: 320,
      height: 180,
      fills: [{ ...solid(BLUE)[0], type: 'IMAGE', imageHash: 'pixel', imageScaleMode: 'FILL' }]
    })
    const project = await exportReactProjectFiles(design.graph)
    const [entry] = project.manifest.screens
    if (!entry) throw new Error('Expected the screen in the export')
    const image = project.files.find((file) => file.path.startsWith('public/'))
    if (!image) throw new Error('Expected the image as a file')
    const address = `/${image.path.slice('public/'.length)}`

    const as = (served: Map<string, string>) =>
      screenApp(design.graph, project, entry, APP_MODULES, served).html

    expect(as(new Map())).toContain(address)
    const served = as(new Map([[address, 'data:image/png;base64,AAAA']]))
    expect(served).toContain('data:image/png;base64,AAAA')
    expect(served).not.toContain(address)
  })

  test('says what the code lacks to run', async () => {
    const { graph, project, entry } = await exported()
    const { '@iconify/react': _iconify, ...withoutIconify } = APP_MODULES

    expect(() => screenApp(graph, project, entry, withoutIconify)).toThrow(
      new ScreenCodeError(
        'src/components/Skip.tsx imports @iconify/react, which the check has no module for'
      )
    )
    expect(() =>
      screenApp(
        graph,
        withChangedFile(project, 'src/components/Skip.tsx', (source) =>
          source.replace('from "@iconify/react"', 'from "./Icon"')
        ),
        entry,
        APP_MODULES
      )
    ).toThrow('src/components/Skip.tsx imports ./Icon, which the project lacks')
  })

  test('fails on code that throws, or whose elements no longer match its layers', async () => {
    const { graph, project, entry } = await exported()
    const throwing = withChangedFile(project, 'src/components/Skip.tsx', (source) =>
      source.replace('return <div', 'throw new Error("no skipping"); return <div')
    )
    const reshaped = withChangedFile(project, 'src/components/Skip.tsx', (source) =>
      source.replace(/<IconifyIcon icon="lucide:skip-back"[^>]*\/>/, '')
    )

    expect(() => screenApp(graph, throwing, entry, APP_MODULES)).toThrow(
      'src/screens/Home.tsx failed to render: no skipping'
    )
    expect(() => screenApp(graph, reshaped, entry, APP_MODULES)).toThrow(
      'src/components/Skip.tsx creates 2 elements but lists layers for 3'
    )
  })

  test('mounts only where the host lends React DOM', async () => {
    const { graph, project, entry } = await exported()
    const mounting = { ...APP_MODULES, 'react-dom': {}, 'react-dom/client': {} }

    expect(screenApp(graph, project, entry, APP_MODULES).mount).toBeUndefined()
    // A module without what mounting needs is no React DOM.
    expect(screenApp(graph, project, entry, mounting).mount).toBeUndefined()
  })
})
