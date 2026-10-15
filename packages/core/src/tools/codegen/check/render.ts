import { mapValues } from 'es-toolkit/object'
import { transform } from 'sucrase'
import * as v from 'valibot'

import type { ProjectFile, ReactProject } from '@open-pencil/dom-css/export'
import { findLayerByPath, layerPath, type SceneGraph } from '@open-pencil/scene-graph'

/** The attribute each element of a rendered screen carries, naming the layer it draws. */
export const LAYER_ATTRIBUTE = 'data-openpencil-layer'

/**
 * The packages exported code imports, by the names it imports them by (`react`, `radix-ui`,
 * `@iconify/react`, `shaders/react`), with `react-dom/server`, which renders a screen to markup,
 * and in a browser `react-dom/client` and `react-dom`, which mount it. A host that bundles them
 * lends them to the check, which runs the code the export writes with them.
 */
export type AppModules = Readonly<Record<string, unknown>>

const ReactModule = v.looseObject({ createElement: v.function(), Fragment: v.unknown() })
const ServerModule = v.looseObject({ renderToStaticMarkup: v.function() })
const IconifyModule = v.looseObject({ Icon: v.unknown(), addCollection: v.function() })
const ClientModule = v.looseObject({ createRoot: v.function() })
const DOMModule = v.looseObject({ flushSync: v.function() })
const Root = v.looseObject({ render: v.function(), unmount: v.function() })
const IconCollection = v.object({ prefix: v.string(), icons: v.record(v.string(), v.unknown()) })

/** Running a screen's code failed: it threw, or imports what the project or host lacks. */
export class ScreenCodeError extends Error {
  override name = 'ScreenCodeError'
}

/** Calls the generated code makes for its JSX, numbered in the order the elements open. */
const ELEMENT = '__openpencilElement'
const FRAGMENT = '__openpencilFragment'
/** The prop a component used in place of an instance receives that instance's layer by. */
const INSTANCE = '__openpencilInstance'
/** The screen's own layers, which elements its file creates draw as they are. */
const SCREEN = '__openpencilScreen'

const SCRIPT = /\.tsx?$/
const SIDE_EFFECT_IMPORT = /^import "(\.[^"]+)";$/gm

type Props = Record<string, unknown>
type Component = (props: Props) => unknown
type ModuleExports = Record<string, unknown>
type ModuleBody = (
  require: (specifier: string) => unknown,
  module: { exports: ModuleExports },
  exports: ModuleExports,
  element: (index: number, type: unknown, props: Props | null, ...children: unknown[]) => unknown,
  fragment: unknown
) => void
type FunctionConstructor = new (...args: string[]) => ModuleBody

/**
 * A file compiled to CommonJS that creates its elements through the check. Each JSX element
 * becomes one call, in the order it opens, which is the order `layerIds` lists them in, so the
 * calls are numbered; fragments draw no layer.
 */
function compile(file: ProjectFile & { content: string }): ModuleBody {
  const { code } = transform(file.content, {
    transforms: ['typescript', 'jsx', 'imports'],
    jsxPragma: ELEMENT,
    jsxFragmentPragma: FRAGMENT,
    production: true,
    filePath: file.path
  })
  let elements = 0
  const numbered = code.replaceAll(`${ELEMENT}(`, (call: string, offset: number) =>
    code.startsWith(FRAGMENT, offset + call.length) ? `${call}-1, ` : `${call}${elements++}, `
  )
  if (file.layerIds && file.layerIds.length !== elements)
    throw new ScreenCodeError(
      `${file.path} creates ${elements} elements but lists layers for ${file.layerIds.length}`
    )
  const Body = Object.getPrototypeOf(() => undefined).constructor as FunctionConstructor
  return new Body('require', 'module', 'exports', ELEMENT, FRAGMENT, numbered)
}

/** The project file a relative import names, as a bundler resolves it. */
function resolvePath(from: string, specifier: string, paths: ReadonlySet<string>): string {
  const segments = from.split('/').slice(0, -1)
  for (const segment of specifier.split('/')) {
    if (segment === '..') segments.pop()
    else if (segment !== '.') segments.push(segment)
  }
  const base = segments.join('/')
  const found = ['', '.tsx', '.ts', '/index.tsx', '/index.ts']
    .map((extension) => base + extension)
    .find((path) => paths.has(path))
  if (!found) throw new ScreenCodeError(`${from} imports ${specifier}, which the project lacks`)
  return found
}

/**
 * Iconify's components draw an icon from the glyphs registered with it, else fetch the glyph
 * from Iconify's API, and draw nothing until mounted. The check draws each icon at once from the
 * glyphs this project registers, and an icon it does not register as Iconify's empty
 * placeholder, which is all an app offline shows, never from another project or the network.
 */
function iconifyForCheck(iconify: v.InferOutput<typeof IconifyModule>, create: CreateElement) {
  const registered = new Set<string>()
  return {
    ...iconify,
    addCollection: (data: unknown, ...rest: unknown[]) => {
      const collection = v.safeParse(IconCollection, data)
      if (collection.success)
        for (const name of Object.keys(collection.output.icons))
          registered.add(`${collection.output.prefix}:${name}`)
      return iconify.addCollection(data, ...rest)
    },
    Icon: (props: Props) =>
      typeof props.icon === 'string' && registered.has(props.icon)
        ? create(iconify.Icon, { ...props, ssr: true })
        : create('span', {})
  }
}

type CreateElement = (type: unknown, props: Props | null, ...children: unknown[]) => unknown

function hostModule<T extends v.GenericSchema>(modules: AppModules, name: string, schema: T) {
  const parsed = v.safeParse(schema, modules[name])
  if (!parsed.success) throw new ScreenCodeError(`The check has no ${name} to run the code with`)
  return parsed.output
}

const failure = (file: string, error: unknown) =>
  error instanceof ScreenCodeError
    ? error
    : new ScreenCodeError(
        `${file} failed to render: ${error instanceof Error ? error.message : String(error)}`
      )

/** A screen's code, run: what it renders, and how a page mounts it. */
export interface ScreenApp {
  /** React's markup of the screen, before it mounts. */
  html: string
  /**
   * Renders the screen into a container of a page as the app does, mounted, so what draws only
   * once mounted, such as a slider's thumb, draws; resolves to what unmounts it. Absent without
   * `react-dom/client` and `react-dom` among the modules.
   */
  mount?: (container: HTMLElement) => Promise<() => void>
}

/**
 * A screen of an exported project run with React: its file, the components it uses, and the
 * icons it registers, all from the project's own files, with every element that draws a layer
 * marked with `LAYER_ATTRIBUTE`. An element of a component draws the layer of the instance it is
 * used for, found by its path in the component; an element no layer drew, such as a part Radix
 * adds, is not marked.
 */
export function screenApp(
  graph: SceneGraph,
  project: ReactProject,
  screen: { file: string; name: string },
  modules: AppModules,
  /** What the page serves at the addresses the code names, such as its images as data URLs. */
  served: ReadonlyMap<string, string> = new Map()
): ScreenApp {
  const react = hostModule(modules, 'react', ReactModule)
  const server = hostModule(modules, 'react-dom/server', ServerModule)
  const create: CreateElement = (type, props, ...children) =>
    react.createElement(type, props, ...children)
  const external: AppModules = {
    ...modules,
    ...(modules['@iconify/react'] === undefined
      ? {}
      : {
          '@iconify/react': iconifyForCheck(
            hostModule(modules, '@iconify/react', IconifyModule),
            create
          )
        })
  }
  const sources = new Map(
    project.files.flatMap((file) =>
      typeof file.content === 'string' && SCRIPT.test(file.path)
        ? [[file.path, { ...file, content: file.content }] as const]
        : []
    )
  )
  const paths = new Set(project.files.map((file) => file.path))
  const components = new Set<unknown>()
  const loaded = new Map<string, ModuleExports>()
  /** The instance the elements being created draw the layers of, or null when unknown. */
  let scope: string | null = SCREEN

  const screenLayer = (layerId: string): string | null => {
    if (scope === SCREEN) return layerId
    if (scope === null) return null
    const root = graph.closest(layerId, (node) => node.type === 'COMPONENT')
    if (!root) return null
    return findLayerByPath(graph, scope, layerPath(graph, root.id, layerId))?.id ?? null
  }

  /** A prop naming an address the page serves, such as an image's `src`, as served. */
  const serve = (value: unknown) => {
    if (typeof value !== 'string') return value
    let resolved = value
    for (const [address, content] of served) resolved = resolved.replaceAll(address, content)
    return resolved
  }

  const elementOf =
    (file: ProjectFile) =>
    (index: number, type: unknown, props: Props | null, ...children: unknown[]) => {
      const drawn = index >= 0 ? file.layerIds?.[index] : undefined
      const layer = drawn ? screenLayer(drawn) : null
      if (components.has(type)) return create(type, { ...props, [INSTANCE]: layer }, ...children)
      const own = mapValues(props ?? {}, serve)
      return create(type, layer ? { ...own, [LAYER_ATTRIBUTE]: layer } : own, ...children)
    }

  /** A component draws the layers of the instance it is used for while it renders. */
  const scoped = (component: Component): Component => {
    const Scoped = ({ [INSTANCE]: instance, ...props }: Props) => {
      const outer = scope
      scope = typeof instance === 'string' ? instance : null
      try {
        return component(props)
      } finally {
        scope = outer
      }
    }
    components.add(Scoped)
    return Scoped
  }

  const load = (path: string): ModuleExports => {
    const known = loaded.get(path)
    if (known) return known
    const file = sources.get(path)
    if (!file) throw new ScreenCodeError(`The project has no ${path} to run`)
    // The module object CommonJS code fills in, as `module.exports`.
    const run = { exports: {} }
    loaded.set(path, run.exports)
    const imported = (specifier: string) => {
      if (specifier.startsWith('.')) return load(resolvePath(path, specifier, paths))
      if (specifier in external) return external[specifier]
      throw new ScreenCodeError(`${path} imports ${specifier}, which the check has no module for`)
    }
    compile(file)(imported, run, run.exports, elementOf(file), react.Fragment)
    const scopedExports: ModuleExports = { __esModule: true }
    for (const [name, value] of Object.entries(run.exports))
      scopedExports[name] = typeof value === 'function' ? scoped(value as Component) : value
    loaded.set(path, scopedExports)
    return scopedExports
  }

  let element: unknown
  let html: unknown
  try {
    const Screen = load(screen.file)[screen.name]
    if (!components.has(Screen)) throw new ScreenCodeError(`${screen.file} has no ${screen.name}`)
    // What `src/main.tsx` runs before the app draws, such as the icons it registers.
    const main = sources.get('src/main.tsx')?.content ?? ''
    for (const [, specifier = ''] of main.matchAll(SIDE_EFFECT_IMPORT)) {
      const path = resolvePath('src/main.tsx', specifier, paths)
      if (SCRIPT.test(path)) load(path)
    }
    element = create(Screen, { [INSTANCE]: SCREEN })
    html = server.renderToStaticMarkup(element)
  } catch (error) {
    throw failure(screen.file, error)
  }
  if (typeof html !== 'string') throw new ScreenCodeError('React rendered no markup')
  const client = v.safeParse(ClientModule, modules['react-dom/client'])
  const dom = v.safeParse(DOMModule, modules['react-dom'])
  if (!client.success || !dom.success) return { html }
  return {
    html,
    mount: async (container) => {
      const errors: unknown[] = []
      const root = v.parse(
        Root,
        client.output.createRoot(container, {
          onUncaughtError: (error: unknown) => errors.push(error)
        })
      )
      dom.output.flushSync(() => root.render(element))
      if (errors.length > 0) {
        root.unmount()
        throw failure(screen.file, errors[0])
      }
      return () => root.unmount()
    }
  }
}
