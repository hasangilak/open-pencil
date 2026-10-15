import { defaultModeCondition, modeAttribute, tokenStylesheet } from '#dom-css/tokens/stylesheet'

import type {
  SceneGraph,
  SceneNode,
  VariableCollection,
  VariableCollectionMode
} from '@open-pencil/scene-graph'

import {
  designFontRequests,
  fontFaceStylesheet,
  type WebFontFaceRequest,
  type WebFontFaceResolver
} from '../bundle'
import { componentLibrary, type LibraryEntry } from '../components/library'
import { componentModel, type ComponentModel } from '../components/model'
import { reactComponent } from '../components/react'
import { fillViewport } from '../components/viewport'
import { sceneNodeToDesignDocument, type VectorElementRenderer } from '../projection'
import { collectGroups } from '../storybook/groups'
import { claimName, identifierName } from '../storybook/names'
import { imageAssets, type ImageAssets } from './assets'
import { ICONS_MODULE, iconsFile } from './icons'
import { projectDependencies } from './packages'
import { scaffoldFiles, screenPath } from './scaffold'
import {
  DESIGN_CODE_MANIFEST_FORMAT,
  type DesignCodeManifest,
  type ManifestCollection,
  type ManifestComponent,
  type ManifestMode,
  type ManifestScreen,
  type ProjectFile
} from './types'

export * from './types'
export { googleFontsURL, screenPath } from './scaffold'

export interface ExportReactProjectOptions {
  /** The project's name, which names its package and page title; `OpenPencil app` by default. */
  name?: string
  /** Pages whose screens and components the project holds; every page by default. */
  pageIds?: readonly string[]
  /** Frames to export as screens; every top-level frame on those pages by default. */
  screenIds?: readonly string[]
  /** Draws vector layers as inline SVG, from the engine's SVG export. */
  vectorElement?: VectorElementRenderer
  /** Ships the fonts text uses as files; without it the page loads them from Google Fonts. */
  fonts?: WebFontFaceResolver
}

/** The files of a React and Tailwind app, and the manifest that ties them to the design. */
export interface ReactProject {
  files: ProjectFile[]
  manifest: DesignCodeManifest
}

const shows = (paints: readonly { visible: boolean }[]) => paints.some((paint) => paint.visible)

/**
 * A frame that draws nothing itself and holds only text, such as a chapter's heading or a note
 * beside the screens, labels the canvas rather than being a screen of the app: a screen draws
 * its background, or holds more than words.
 */
function isLabel(graph: SceneGraph, frame: SceneNode): boolean {
  const children = graph.getChildren(frame.id).filter((child) => child.visible)
  return (
    children.length > 0 &&
    children.every((child) => child.type === 'TEXT') &&
    !shows(frame.fills) &&
    !shows(frame.strokes) &&
    !shows(frame.effects)
  )
}

/** Top-level frames on the pages, and the frames of their top-level sections, but labels. */
function screenLayers(graph: SceneGraph, pages: readonly SceneNode[]): SceneNode[] {
  const isScreen = (node: SceneNode) =>
    node.type === 'FRAME' && node.visible && !isLabel(graph, node)
  return pages.flatMap((page) =>
    graph.getChildren(page.id).flatMap((child) => {
      if (child.type === 'SECTION' && child.visible)
        return graph.getChildren(child.id).filter(isScreen)
      return isScreen(child) ? [child] : []
    })
  )
}

function propNames(model: ComponentModel): string[] {
  return [
    ...(model.model ? [model.model] : []),
    ...model.props.map((prop) => prop.name),
    ...model.texts.map((prop) => prop.name),
    ...model.booleans.map((prop) => prop.name),
    ...model.slots.map((prop) => prop.name),
    ...(model.disabled ? ['disabled'] : [])
  ]
}

const SIBLING_IMPORT = /from "\.\/([^"]+)"/g

const COMPONENT_FILE = /^src\/components\/([^/]+)\.tsx$/

/** The names components are imported by: their files' names in `src/components/`. */
function componentNames(sources: readonly ProjectFile[]): Set<string> {
  return new Set(sources.flatMap((file) => COMPONENT_FILE.exec(file.path)?.[1] ?? []))
}

/** A screen imports the components it uses from their own folder. */
function componentImports(source: string, components: ReadonlySet<string>): string {
  return source.replace(SIBLING_IMPORT, (statement, file: string) =>
    components.has(file) ? `from "../components/${file}"` : statement
  )
}

/** A mode as the manifest describes it, and how the page switches to it. */
function manifestMode(
  collection: VariableCollection,
  mode: VariableCollectionMode,
  switchable: boolean
): ManifestMode {
  const entry: ManifestMode = { name: mode.name, default: mode.modeId === collection.defaultModeId }
  if (!entry.default) entry.condition = mode.condition ?? defaultModeCondition(collection, mode)
  if (switchable && !mode.condition) entry.attribute = modeAttribute(collection, mode)
  return entry
}

/** Every variable collection's modes, and how the page switches between them. */
function manifestCollections(graph: SceneGraph): ManifestCollection[] {
  return [...graph.variableCollections.values()].map((collection) => ({
    name: collection.name,
    modes: collection.modes.map((mode) =>
      manifestMode(collection, mode, collection.modes.length > 1)
    )
  }))
}

/** The faces text uses across the layers, each once. */
function fontRequests(graph: SceneGraph, layerIds: readonly string[]): WebFontFaceRequest[] {
  const requests = new Map<string, WebFontFaceRequest>()
  for (const id of layerIds)
    for (const request of designFontRequests(
      sceneNodeToDesignDocument(graph, id, { includeSourceIds: false })
    ))
      requests.set(`${request.family}|${request.weight}|${request.style ?? 'normal'}`, request)
  return [...requests.values()]
}

/** The project's component and screen names, claimed together so imports never collide. */
function claimEntries(
  graph: SceneGraph,
  pages: readonly SceneNode[],
  screenIds: readonly string[] | undefined
) {
  const taken = new Set<string>()
  const key = (name: string) => name.toLowerCase()
  const claim = (set: SceneNode, name: string): LibraryEntry => ({
    set,
    name: claimName(identifierName(name, 'Component'), taken, { key })
  })
  // Slash-named components without a set, such as `Button/Large`, are each a component.
  const components: LibraryEntry[] = pages.flatMap((page) =>
    collectGroups(graph, page, page.name).flatMap((group) =>
      group.set
        ? [claim(group.set, group.name)]
        : group.variants.map((variant) => claim(variant.node, variant.node.name))
    )
  )
  const layers = screenIds
    ? screenIds.flatMap((id) => graph.getNode(id) ?? [])
    : screenLayers(graph, pages)
  const screens = layers.map((layer) => ({
    layer,
    name: claimName(identifierName(layer.name, 'Screen'), taken, { key })
  }))
  return { components, screens }
}

/** What generating components and screens writes and what the manifest says of them. */
interface Generated<T> {
  sources: ProjectFile[]
  entries: T[]
  models: ComponentModel[]
}

/** Each component of the library as a file in `src/components/`. */
async function componentSources(
  entries: readonly LibraryEntry[],
  library: ReadonlyMap<string, ComponentModel>,
  images: ImageAssets
): Promise<Generated<ManifestComponent>> {
  const generated: Generated<ManifestComponent> = { sources: [], entries: [], models: [] }
  for (const entry of entries) {
    const model = library.get(entry.set.id)
    if (!model) continue
    generated.models.push(model)
    const { files } = await reactComponent(model, { styling: 'tailwind' })
    for (const file of files)
      generated.sources.push({
        path: `src/components/${file.path}`,
        content: images.extract(file.content),
        ...(file.layerIds ? { layerIds: file.layerIds } : {})
      })
    generated.entries.push({
      name: model.name,
      file: `src/components/${model.name}.tsx`,
      layerId: entry.set.id,
      kind: model.kind,
      props: propNames(model)
    })
  }
  return generated
}

/** Each screen as a file in `src/screens/` that fills the viewport and uses the components. */
async function screenSources(
  graph: SceneGraph,
  screens: readonly { layer: SceneNode; name: string }[],
  library: ReadonlyMap<string, ComponentModel>,
  context: {
    images: ImageAssets
    components: ReadonlySet<string>
    vectorElement?: VectorElementRenderer
  }
): Promise<Generated<ManifestScreen>> {
  const generated: Generated<ManifestScreen> = { sources: [], entries: [], models: [] }
  for (const { layer, name } of screens) {
    const model = componentModel(graph, layer, {
      name,
      references: library,
      vectorElement: context.vectorElement
    })
    if (!model) continue
    fillViewport(model.styles.root)
    generated.models.push(model)
    const { files } = await reactComponent(model, { styling: 'tailwind' })
    for (const file of files) {
      const content = context.images.extract(componentImports(file.content, context.components))
      generated.sources.push({
        path: `src/screens/${file.path}`,
        content,
        ...(file.layerIds ? { layerIds: file.layerIds } : {})
      })
    }
    generated.entries.push({
      name: model.name,
      file: `src/screens/${model.name}.tsx`,
      route: `#/${screenPath(model.name)}`,
      layerId: layer.id,
      width: layer.width,
      height: layer.height
    })
  }
  return generated
}

/** The variables as `src/tokens.css`, and what CSS could not express of them. */
async function tokenFiles(graph: SceneGraph): Promise<{ files: ProjectFile[]; issues: string[] }> {
  if (graph.variables.size === 0) return { files: [], issues: [] }
  const { css, issues } = await tokenStylesheet(graph, { format: 'tailwind' })
  return {
    files: css ? [{ path: 'src/tokens.css', content: css }] : [],
    issues: issues.map((issue) => issue.message)
  }
}

/**
 * The fonts the drawn layers' text uses: files in `src/fonts/` and the stylesheet that loads
 * them when a resolver finds them, otherwise the faces for the page to load from Google Fonts.
 */
async function fontFiles(
  graph: SceneGraph,
  layerIds: readonly string[],
  resolver: WebFontFaceResolver | undefined
): Promise<{ files: ProjectFile[]; webFonts: WebFontFaceRequest[] }> {
  const requests = fontRequests(graph, layerIds)
  const assets = resolver && requests.length > 0 ? await resolver(requests, 'src/fonts') : []
  if (assets.length === 0) return { files: [], webFonts: requests }
  const css = await fontFaceStylesheet(assets, { from: 'src', display: 'swap' })
  return { files: [...assets, { path: 'src/fonts.css', content: css }], webFonts: [] }
}

/**
 * The design as a Vite app of React components styled with Tailwind CSS: each component set
 * or component as a component with its variants and properties as props, each top-level frame
 * as a screen filling the viewport that uses those components where the design places their
 * instances, the variables as a stylesheet of tokens with their modes, and `openpencil.json`,
 * the manifest that maps every file to the layer it draws.
 */
export async function exportReactProject(
  graph: SceneGraph,
  options: ExportReactProjectOptions = {}
): Promise<ReactProject> {
  const pages = graph
    .getPages()
    .filter((page) => !options.pageIds || options.pageIds.includes(page.id))
  const entries = claimEntries(graph, pages, options.screenIds)
  const library = componentLibrary(graph, entries.components, {
    vectorElement: options.vectorElement,
    reserved: entries.screens.map((screen) => screen.name)
  })
  const images = imageAssets()
  const components = await componentSources(entries.components, library, images)
  const screens = await screenSources(graph, entries.screens, library, {
    images,
    vectorElement: options.vectorElement,
    components: componentNames(components.sources)
  })
  const icons = iconsFile(graph, [...components.models, ...screens.models], options.vectorElement)
  const sources = [...components.sources, ...screens.sources, ...(icons ? [icons] : [])]
  const tokens = await tokenFiles(graph)
  const fonts = await fontFiles(
    graph,
    [...components.entries, ...screens.entries].map((entry) => entry.layerId),
    options.fonts
  )
  const { dependencies, unknown } = projectDependencies(
    sources.flatMap((file) => (typeof file.content === 'string' ? [file.content] : []))
  )
  const manifest: DesignCodeManifest = {
    format: DESIGN_CODE_MANIFEST_FORMAT,
    name: options.name?.trim() || 'OpenPencil app',
    framework: 'react',
    styling: 'tailwind',
    screens: screens.entries,
    components: components.entries,
    tokens: {
      file: tokens.files.length > 0 ? 'src/tokens.css' : null,
      collections: manifestCollections(graph),
      issues: tokens.issues
    },
    warnings: unknown.map(
      (pkg) => `Generated code imports ${pkg}, which the export has no version for`
    )
  }
  const scaffold = scaffoldFiles({
    manifest,
    dependencies,
    webFonts: fonts.webFonts,
    modules: icons ? [ICONS_MODULE] : [],
    stylesheets: [
      ...(tokens.files.length > 0 ? ['./tokens.css'] : []),
      ...(fonts.files.length > 0 ? ['./fonts.css'] : [])
    ]
  })
  return {
    files: [...scaffold, ...tokens.files, ...fonts.files, ...sources, ...images.files],
    manifest
  }
}
