import dedent from 'dedent'
import { uniq } from 'es-toolkit/array'

import { es, jsx, type SyntaxNode } from '@open-pencil/emit'

import type { WebFontFaceRequest } from '../bundle'
import { PROJECT_DEV_PACKAGES } from './packages'
import type { DesignCodeManifest, ProjectFile } from './types'

/** A mode attribute the page can be opened in, and the values it takes. */
export interface ModeSwitch {
  attribute: string
  values: string[]
}

export interface ScaffoldInput {
  manifest: DesignCodeManifest
  dependencies: Record<string, string>
  /** Fonts the page loads from Google Fonts, when the export ships no font files. */
  webFonts: readonly WebFontFaceRequest[]
  /** Stylesheets `src/index.css` imports after Tailwind, such as the tokens. */
  stylesheets: readonly string[]
  /** Modules `src/main.tsx` runs before the app draws, such as the icons it registers. */
  modules: readonly string[]
}

const VITE_CONFIG = es.parseModule(dedent`
  import tailwindcss from "@tailwindcss/vite";
  import react from "@vitejs/plugin-react";
  import { defineConfig } from "vite";

  export default defineConfig({
    plugins: [react(), tailwindcss()]
  });
`)

const MAIN_IMPORTS = es.parseModule(dedent`
  import { StrictMode } from "react";
  import { createRoot } from "react-dom/client";

  import { App } from "./App";
  import "./index.css";
`).body

/** Opens the page in the modes its link names, such as `?data-theme=dark`, before it draws. */
const OPEN_IN_MODES = es.parseModule(dedent`
  const MODES: { attribute: string; values: string[] }[] = $modes;
  const search = new URLSearchParams(location.search);
  for (const { attribute, values } of MODES) {
    const value = search.get(attribute);
    if (value && values.includes(value)) document.documentElement.setAttribute(attribute, value);
  }
`).body

const IMPORT_MODULE = es.parseModule('import "$path";')

const MAIN_RENDER = es.parseModule(dedent`
  const root = document.getElementById("root");
  if (root) createRoot(root).render($app);
`).body

const IMPORT_SCREEN = es.parseModule(`import { $Screen } from "$path";`)

const APP = es.parseModule(dedent`
  import { useEffect, useState } from "react";

  const SCREENS = $screens;

  type ScreenPath = keyof typeof SCREENS;

  function currentScreen(): ScreenPath {
    const path = location.hash.startsWith("#/") ? location.hash.slice(2) : "";
    return path in SCREENS ? (path as ScreenPath) : $first;
  }

  export function App() {
    const [screen, setScreen] = useState(currentScreen);
    useEffect(() => {
      const show = () => setScreen(currentScreen());
      addEventListener("hashchange", show);
      return () => removeEventListener("hashchange", show);
    }, []);
    const Screen = SCREENS[screen];
    return $screen;
  }
`)

const EMPTY_APP = es.parseModule(dedent`
  export function App() {
    return null;
  }
`)

/** The attributes that switch the page between the modes its tokens declare. */
export function modeSwitches(manifest: DesignCodeManifest): ModeSwitch[] {
  const values = new Map<string, string[]>()
  for (const collection of manifest.tokens.collections)
    for (const mode of collection.modes) {
      if (!mode.attribute) continue
      values.set(mode.attribute.name, [
        ...(values.get(mode.attribute.name) ?? []),
        mode.attribute.value
      ])
    }
  return [...values].map(([attribute, list]) => ({ attribute, values: uniq(list) }))
}

function mainModule(manifest: DesignCodeManifest, modules: readonly string[]): string {
  const switches = modeSwitches(manifest)
  const app = jsx.element('StrictMode', [], [jsx.element('App', [], [], 2)], 1)
  const body = [
    ...MAIN_IMPORTS,
    ...modules.flatMap((path) => es.fill(IMPORT_MODULE, { $path: es.string(path) }).body),
    ...(switches.length > 0
      ? OPEN_IN_MODES.map((node) => es.fill(node, { $modes: es.json(switches) }))
      : []),
    ...MAIN_RENDER.map((node) => es.fill(node, { $app: app }))
  ]
  return jsx.printModule({ type: 'Program', sourceType: 'module', body })
}

/** The path after `#/` that shows a screen. */
export function screenPath(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function appModule(manifest: DesignCodeManifest): string {
  const first = manifest.screens.at(0)
  if (!first) return jsx.printModule(EMPTY_APP)
  const [reactImport, ...rest] = es.fill(APP, {
    $screens: es.object(
      manifest.screens.map((screen) => [screenPath(screen.name), es.identifier(screen.name)])
    ),
    $first: es.string(screenPath(first.name)),
    $screen: jsx.element('Screen', [], [], 2)
  }).body
  const imports = manifest.screens.flatMap(
    (screen) =>
      es.fill(IMPORT_SCREEN, {
        $Screen: es.identifier(screen.name),
        $path: es.string(`./screens/${screen.name}`)
      }).body
  )
  const body: SyntaxNode[] = [reactImport, ...imports, ...rest]
  return jsx.printModule({ type: 'Program', sourceType: 'module', body })
}

const escapeHTML = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/**
 * Google Fonts' stylesheet for one family's weights and styles. Each family gets its own, so
 * a family Google Fonts does not serve fails alone rather than taking the others with it.
 */
export function googleFontsURL(family: string, requests: readonly WebFontFaceRequest[]): string {
  const upright = uniq(requests.filter((r) => r.style !== 'italic').map((r) => r.weight)).sort(
    (a, b) => a - b
  )
  const italic = uniq(requests.filter((r) => r.style === 'italic').map((r) => r.weight)).sort(
    (a, b) => a - b
  )
  const name = encodeURIComponent(family).replaceAll('%20', '+')
  const axes =
    italic.length === 0
      ? `wght@${upright.join(';')}`
      : `ital,wght@${[...upright.map((w) => `0,${w}`), ...italic.map((w) => `1,${w}`)].join(';')}`
  return `https://fonts.googleapis.com/css2?family=${name}:${axes}&display=swap`
}

function indexHTML(title: string, fonts: readonly WebFontFaceRequest[]): string {
  const families = new Map<string, WebFontFaceRequest[]>()
  for (const font of fonts) families.set(font.family, [...(families.get(font.family) ?? []), font])
  const links =
    families.size === 0
      ? []
      : [
          '<link rel="preconnect" href="https://fonts.googleapis.com" />',
          '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
          ...[...families].map(
            ([family, requests]) =>
              `<link rel="stylesheet" href="${escapeHTML(googleFontsURL(family, requests))}" />`
          )
        ]
  const head = [
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `<title>${escapeHTML(title)}</title>`,
    ...links
  ]
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    ...head.map((line) => `    ${line}`),
    '  </head>',
    '  <body>',
    '    <div id="root"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    '  </body>',
    '</html>',
    ''
  ].join('\n')
}

/** A package name npm accepts, from the project's name. */
export function packageSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'openpencil-app'
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

function readme({ manifest }: ScaffoldInput): string {
  const screens = manifest.screens.map((s) => `- \`${s.route}\` — ${s.name} (\`${s.file}\`)`)
  const components = manifest.components.map(
    (c) => `- ${c.name} (\`${c.file}\`)${c.props.length > 0 ? `: ${c.props.join(', ')}` : ''}`
  )
  const switches = modeSwitches(manifest).map(
    (mode) => `- \`?${mode.attribute}=${mode.values.join('|')}\``
  )
  return [
    `# ${manifest.name}`,
    '',
    'React and Tailwind CSS code exported from an OpenPencil design.',
    '',
    '```sh',
    'npm install',
    'npm run dev',
    '```',
    '',
    '`openpencil.json` maps every screen and component to the layer it draws, the props each component takes, and how the design modes switch, so design and code agents can check one against the other.',
    '',
    '## Screens',
    '',
    ...(screens.length > 0 ? screens : ['None.']),
    '',
    '## Components',
    '',
    ...(components.length > 0 ? components : ['None.']),
    '',
    ...(switches.length > 0
      ? ['## Modes', '', 'Open a screen in a design mode with its link:', '', ...switches, '']
      : []),
    '## Design tokens',
    '',
    manifest.tokens.file
      ? `\`${manifest.tokens.file}\` declares the design's variables as Tailwind theme values and CSS custom properties.`
      : 'The design has no variables.',
    ''
  ].join('\n')
}

/** The files around the generated components that make them a Vite, React, and Tailwind app. */
export function scaffoldFiles(input: ScaffoldInput): ProjectFile[] {
  const { manifest } = input
  const packageJSON = {
    name: packageSlug(manifest.name),
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: { dev: 'vite', build: 'tsc && vite build', preview: 'vite preview', typecheck: 'tsc' },
    dependencies: input.dependencies,
    devDependencies: PROJECT_DEV_PACKAGES
  }
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      isolatedModules: true,
      types: ['vite/client']
    },
    include: ['src']
  }
  const indexCSS = [
    '@import "tailwindcss";',
    ...input.stylesheets.map((path) => `@import "${path}";`)
  ]
  return [
    { path: 'package.json', content: json(packageJSON) },
    { path: 'tsconfig.json', content: json(tsconfig) },
    { path: 'vite.config.ts', content: `${es.printModule(VITE_CONFIG)}\n` },
    { path: 'index.html', content: indexHTML(manifest.name, input.webFonts) },
    { path: 'src/main.tsx', content: `${mainModule(manifest, input.modules)}\n` },
    { path: 'src/App.tsx', content: `${appModule(manifest)}\n` },
    { path: 'src/index.css', content: `${indexCSS.join('\n')}\n` },
    { path: '.gitignore', content: 'node_modules\ndist\n' },
    { path: 'README.md', content: readme(input) },
    { path: 'openpencil.json', content: json(manifest) }
  ]
}
