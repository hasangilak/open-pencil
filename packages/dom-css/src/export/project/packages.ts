/**
 * The packages an exported project runs with, at the ranges this repository builds and tests
 * generated code against: `packages/dom-css/package.json` for what components import and the
 * root `package.json` for the build (`packages/dom-css/tests/export/project/packages.test.ts`).
 */
export const PROJECT_PACKAGES: Readonly<Record<string, string>> = {
  react: '^19.3.0',
  'react-dom': '^19.3.0',
  'radix-ui': '^1.7.0',
  '@iconify/react': '^6.0.2',
  shaders: '4.0.4'
}

/** What builds, type-checks, and styles the project. */
export const PROJECT_DEV_PACKAGES: Readonly<Record<string, string>> = {
  '@tailwindcss/vite': '^4.3.3',
  '@types/react': '^19.3.0',
  '@types/react-dom': '^19.2.0',
  '@vitejs/plugin-react': '^6.1.2',
  tailwindcss: '^4.3.3',
  typescript: '~5.8.3',
  vite: '^8.1.4'
}

/** Packages every project depends on, whatever its components import. */
const ALWAYS = ['react', 'react-dom']

const IMPORT_SPECIFIER = /\b(?:from|import)\s+"([^"]+)"/g

/** The package an import names, `@scope/name` or its first segment, or null for a file. */
function packageName(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null
  const [first = '', second] = specifier.split('/')
  return first.startsWith('@') && second ? `${first}/${second}` : first
}

/**
 * The runtime packages generated sources import, with their ranges, and any import this
 * export has no range for, which the project then cannot install.
 */
export function projectDependencies(sources: readonly string[]): {
  dependencies: Record<string, string>
  unknown: string[]
} {
  const names = new Set(ALWAYS)
  for (const source of sources)
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const name = packageName(match[1] ?? '')
      if (name) names.add(name)
    }
  const dependencies: Record<string, string> = {}
  const unknown: string[] = []
  for (const name of [...names].sort()) {
    const range = PROJECT_PACKAGES[name]
    if (range) dependencies[name] = range
    else if (!PROJECT_DEV_PACKAGES[name]) unknown.push(name)
  }
  return { dependencies, unknown }
}
