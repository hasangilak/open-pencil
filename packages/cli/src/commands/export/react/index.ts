import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'

import { vectorElement } from '@open-pencil/core/io'
import { exportReactProject } from '@open-pencil/dom-css'

import { requireFile } from '#cli/app/client'
import { storyFonts } from '#cli/commands/export/storybook/fonts'
import { ok, printError, warn } from '#cli/format'
import { loadDocument, populateWholeDocument, requirePage } from '#cli/headless'

interface ReactProjectArgs {
  file?: string
  output?: string
  page?: string
  node?: string
  /** `none` ships no font files; the app then loads the fonts from Google Fonts. */
  fonts?: string
}

/**
 * Writes the document as a React and Tailwind app into a folder, `react-app` by default: the
 * project's files and `openpencil.json`, which maps each file to the layer it draws.
 */
export async function exportReactProjectFromFile(args: ReactProjectArgs): Promise<void> {
  const file = requireFile(args.file)
  const graph = await loadDocument(file)
  const pageIds = args.page ? [requirePage(graph, args.page).id] : undefined
  populateWholeDocument(graph)
  if (args.node && !graph.getNode(args.node)) {
    printError(`Node "${args.node}" not found.`)
    process.exit(1)
  }
  const project = await exportReactProject(graph, {
    name: basename(file, extname(file)),
    pageIds,
    screenIds: args.node ? [args.node] : undefined,
    vectorElement,
    fonts: args.fonts === 'none' ? undefined : storyFonts
  })
  const output = resolve(args.output ?? 'react-app')
  for (const entry of project.files) {
    const path = join(output, entry.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, entry.content)
  }
  const { screens, components, warnings } = project.manifest
  for (const message of warnings) console.error(warn(message))
  console.log(
    ok(`Exported ${screens.length} screens and ${components.length} components to ${output}`)
  )
}
