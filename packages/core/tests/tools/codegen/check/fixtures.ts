import * as iconify from '@iconify/react'
import * as radix from 'radix-ui'
import * as react from 'react'
import * as server from 'react-dom/server'

import type { ProjectFile, ReactProject } from '@open-pencil/dom-css/export'
import { SceneGraph, withIcon, type Color, type SceneNode } from '@open-pencil/scene-graph'

import type { AppModules } from '#core/tools/codegen/check/render'

/** The packages exported code imports, as an app installs them; no DOM, so nothing mounts. */
export const APP_MODULES: AppModules = {
  react,
  'react-dom/server': server,
  'radix-ui': radix,
  '@iconify/react': iconify
}

/** A 1×1 transparent PNG, as an image fill stores it. */
export const PIXEL_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 248, 15, 4, 0, 9, 251, 3, 253,
  227, 85, 242, 156, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
])

export const BLUE = { r: 0.23, g: 0.51, b: 0.96, a: 1 }
export const SKY = { r: 0.58, g: 0.77, b: 0.99, a: 1 }
const GREY = { r: 0.6, g: 0.6, b: 0.67, a: 1 }
export const solid = (color: Color) => [{ type: 'SOLID' as const, color, opacity: 1, visible: true }]

/** A Lucide icon layer with a glyph to draw. */
function icon(graph: SceneGraph, parentId: string, name: string) {
  const frame = graph.createNode('FRAME', parentId, { name, width: 22, height: 22 })
  graph.updateNode(frame.id, { pluginData: withIcon(frame, { name: `lucide:${name}` }) })
  graph.createNode('RECTANGLE', frame.id, {
    name: 'Bar',
    x: 9,
    y: 3,
    width: 4,
    height: 16,
    fills: solid(GREY)
  })
  return frame
}

/**
 * A Skip button set whose Back and Forward variants each draw their own Lucide icon, so the
 * Forward icon is a layer only one variant draws.
 */
function skipSet(graph: SceneGraph, pageId: string) {
  const set = graph.createNode('COMPONENT_SET', pageId, {
    name: 'Skip',
    x: 1600,
    componentPropertyDefinitions: [
      {
        id: 'direction',
        name: 'Direction',
        type: 'VARIANT',
        defaultValue: 'Back',
        variantOptions: ['Back', 'Forward']
      }
    ]
  })
  const variants = (['Back', 'Forward'] as const).map((direction) => {
    const variant = graph.createNode('COMPONENT', set.id, {
      name: `Direction=${direction}`,
      componentPropertyValues: { Direction: direction },
      width: 44,
      height: 44,
      layoutMode: 'HORIZONTAL',
      primaryAxisAlign: 'CENTER',
      counterAxisAlign: 'CENTER'
    })
    icon(graph, variant.id, direction === 'Back' ? 'skip-back' : 'skip-forward')
    return variant
  })
  return { set, variants }
}

/**
 * A screen with a title, a card filled with Primary, which Dark changes, a pinned badge, and a
 * Forward Skip button, an instance of a component the export writes as its own file.
 */
export function screenDesign({ contrast = false } = {}) {
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
  const skip = skipSet(graph, page.id)
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
  const forward = skip.variants[1]
  if (!forward) throw new Error('Expected a Forward variant')
  const next = graph.createInstance(forward.id, screen.id, { name: 'Next' })
  if (!next) throw new Error('Expected an instance')
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
  return { graph, screen, skip, next }
}

/** The layer below `parent` named `name`. */
export function layerNamed(graph: SceneGraph, parent: SceneNode, name: string): SceneNode {
  const found = graph.getChildren(parent.id).find((child) => child.name === name)
  if (!found) throw new Error(`Expected ${name} below ${parent.name}`)
  return found
}

/** The project with one text file changed, as a deliberately broken export. */
export function withChangedFile(
  project: ReactProject,
  path: string,
  change: (content: string) => string
): ReactProject {
  const edit = (file: ProjectFile): ProjectFile => {
    if (file.path !== path || typeof file.content !== 'string') return file
    const content = change(file.content)
    if (content === file.content) throw new Error(`The change left ${path} as it was`)
    return { ...file, content }
  }
  return { ...project, files: project.files.map(edit) }
}
