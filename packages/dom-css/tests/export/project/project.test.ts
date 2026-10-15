import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { projectDesign, vectorElement } from '#dom-css-tests/export/project/fixtures'
import { exportReactProject, type ReactProject } from '#dom-css/export'
import ts from 'typescript'

/** What the generated app imports and builds with, linked so it resolves them as installed. */
const APP_PACKAGES = [
  'react',
  'react-dom',
  'radix-ui',
  '@iconify/react',
  '@types/react',
  '@types/react-dom',
  'typescript',
  'vite',
  '@vitejs/plugin-react',
  'tailwindcss',
  '@tailwindcss/vite'
]

const output = await mkdtemp(join(tmpdir(), 'open-pencil-project-'))
afterAll(() => rm(output, { recursive: true, force: true }))

/** Writes the project into a folder of its own with its packages linked in. */
async function writeProject(project: ReactProject, name: string): Promise<string> {
  const folder = join(output, name)
  for (const file of project.files) {
    await mkdir(dirname(join(folder, file.path)), { recursive: true })
    await writeFile(join(folder, file.path), file.content)
  }
  for (const pkg of APP_PACKAGES) {
    const target = join(folder, 'node_modules', pkg)
    await mkdir(dirname(target), { recursive: true })
    await symlink(dirname(Bun.resolveSync(`${pkg}/package.json`, import.meta.dir)), target)
  }
  return folder
}

function text(project: ReactProject, path: string): string {
  const file = project.files.find((candidate) => candidate.path === path)
  if (typeof file?.content !== 'string') throw new Error(`Expected ${path} in the project`)
  return file.content
}

const exported = exportReactProject(projectDesign().graph, { name: 'Acme Store', vectorElement })

describe('React project export', () => {
  test('the manifest maps screens and components to the layers they draw', async () => {
    const { graph, button, home } = projectDesign()
    const { manifest } = await exportReactProject(graph, { name: 'Acme Store' })
    expect(manifest.screens).toEqual([
      {
        name: 'Home',
        file: 'src/screens/Home.tsx',
        route: '#/home',
        layerId: home.id,
        width: 1440,
        height: 900
      }
    ])
    expect(manifest.components).toMatchObject([
      { name: 'Button', file: 'src/components/Button.tsx', layerId: button.id, kind: 'button' }
    ])
  })

  test('a frame of words that draws nothing itself labels the canvas and is no screen', async () => {
    const { graph, home } = projectDesign()
    const page = graph.getPages()[0].id
    const section = graph.createNode('SECTION', page, {
      name: 'Chapter',
      width: 2000,
      height: 1200
    })
    const heading = graph.createNode('FRAME', section.id, {
      name: 'Heading',
      width: 720,
      height: 120,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', heading.id, { name: 'Number', text: '01', fontSize: 88 })
    graph.createNode('TEXT', heading.id, { name: 'Title', text: 'Hello.', fontSize: 48 })
    const note = graph.createNode('FRAME', page, { name: 'Note', width: 320, height: 40 })
    graph.createNode('TEXT', note.id, { text: 'Flows start at Home' })
    // A frame of words with a background, such as a terms page, is a screen.
    const terms = graph.createNode('FRAME', section.id, {
      name: 'Terms',
      width: 390,
      height: 844,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    graph.createNode('TEXT', terms.id, { text: 'Terms of service' })

    const { manifest, files } = await exportReactProject(graph)

    expect(manifest.screens.map((screen) => screen.layerId)).toEqual([home.id, terms.id])
    expect(files.some((file) => file.path.includes('Heading'))).toBe(false)
    // Asked for by id, a label is exported like any frame.
    const asked = await exportReactProject(graph, { screenIds: [heading.id] })
    expect(asked.manifest.screens.map((screen) => screen.layerId)).toEqual([heading.id])
  })

  test('the manifest says how each design mode switches', async () => {
    const { manifest } = await exported
    const theme = manifest.tokens.collections.find((collection) => collection.name === 'Theme')
    expect(manifest.tokens.file).toBe('src/tokens.css')
    expect(theme?.modes).toEqual([
      { name: 'Light', default: true, attribute: { name: 'data-theme', value: 'light' } },
      {
        name: 'Dark',
        default: false,
        condition: '[data-theme="dark"]',
        attribute: { name: 'data-theme', value: 'dark' }
      },
      { name: 'Contrast', default: false, condition: '@media (prefers-contrast: more)' }
    ])
    expect(text(await exported, 'src/main.tsx')).toContain('"data-theme"')
  })

  test('a screen fills the viewport and uses the components its instances show', async () => {
    const home = text(await exported, 'src/screens/Home.tsx')
    expect(home).toContain('import { Button } from "../components/Button"')
    expect(home).toContain('<Button')
    expect(home).toMatch(/\bw-full\b/)
    expect(home).toMatch(/\bmin-h-225\b/)
    // The badge is pinned to the screen's right edge, so the screen is its containing block.
    expect(home).toMatch(/\brelative\b/)
    expect(home).toMatch(/\bright-10\b/)
  })

  test("screens' and components' files list the layer each of their elements draws", async () => {
    const { graph, button, home } = projectDesign()
    const { files } = await exportReactProject(graph, { vectorElement })
    const rest = graph.getChildren(button.id)[0]
    const elements = (path: string) => {
      const file = files.find((candidate) => candidate.path === path)
      if (typeof file?.content !== 'string') throw new Error(`Expected ${path} in the project`)
      const source = ts.createSourceFile(path, file.content, ts.ScriptTarget.Latest, true)
      let count = 0
      const visit = (node: ts.Node) => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) count++
        ts.forEachChild(node, visit)
      }
      visit(source)
      return { count, layerIds: file.layerIds ?? [] }
    }

    const screen = elements('src/screens/Home.tsx')
    const component = elements('src/components/Button.tsx')

    expect(screen.layerIds).toHaveLength(screen.count)
    expect(screen.layerIds[0]).toBe(home.id)
    expect(screen.layerIds).toContain(graph.getChildren(home.id)[2]?.id ?? '')
    expect(component.layerIds).toEqual([rest?.id, rest?.childIds[0]])
    expect(component.layerIds).toHaveLength(component.count)
    // What the files hold on disk is their code alone.
    expect(files.find((file) => file.path === 'openpencil.json')?.content).not.toContain('layerIds')
  })

  test('vector layers are inline SVG with the attribute names React takes', async () => {
    const home = text(await exported, 'src/screens/Home.tsx')
    expect(home).toContain('strokeWidth="1.5"')
    expect(home).toContain('fillRule="evenodd"')
    expect(home).not.toContain('stroke-width')
  })

  test("icons show the design's own glyphs, registered before the app draws", async () => {
    const project = await exported
    expect(text(project, 'src/screens/Home.tsx')).toContain('icon="lucide:heart"')
    const icons = text(project, 'src/icons.ts')
    expect(icons).toContain('import { addCollection } from "@iconify/react"')
    expect(icons).toContain("prefix: 'lucide'")
    expect(icons).toMatch(/heart: \{\s+body: '<path d="M0 6L12 6"/)
    expect(icons).toContain('width: 24')
    expect(text(project, 'src/main.tsx')).toContain('import "./icons"')

    // Without the engine's SVG there is no glyph, and Iconify fetches the icon by its name.
    const fetched = await exportReactProject(projectDesign().graph)
    expect(fetched.files.some((file) => file.path === 'src/icons.ts')).toBe(false)
    expect(text(fetched, 'src/main.tsx')).not.toContain('./icons')
  })

  test('images are files the page serves, not data inlined in components', async () => {
    const project = await exported
    expect(text(project, 'src/screens/Home.tsx')).toContain('src="/assets/images/image-1.png"')
    expect(project.files.some((file) => file.path === 'public/assets/images/image-1.png')).toBe(
      true
    )
    expect(
      project.files.some(
        (file) => typeof file.content === 'string' && file.content.includes('data:image')
      )
    ).toBe(false)
  })

  test('the app type-checks and builds', async () => {
    const folder = await writeProject(await exported, 'acme')
    const config = ts.getParsedCommandLineOfConfigFile(
      join(folder, 'tsconfig.json'),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => undefined
      }
    )
    if (!config) throw new Error('Expected the project tsconfig to parse')
    const program = ts.createProgram(config.fileNames, config.options)
    const errors = ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    expect(errors).toEqual([])

    const build = Bun.spawn(
      [process.execPath, join(folder, 'node_modules/vite/bin/vite.js'), 'build'],
      {
        cwd: folder,
        stdout: 'pipe',
        stderr: 'pipe'
      }
    )
    const [exitCode, stderr] = await Promise.all([build.exited, new Response(build.stderr).text()])
    expect(stderr).not.toContain('error')
    expect(exitCode).toBe(0)
  }, 60_000)
})
