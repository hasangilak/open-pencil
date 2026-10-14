import { fromUint8Array } from 'js-base64'
import * as v from 'valibot'

import type { ProjectFile, ReactProject } from '@open-pencil/dom-css/export'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { defineTool } from '#core/tools/schema'

export interface ReactProjectExportOptions {
  name?: string
  pageIds?: readonly string[]
  screenIds?: readonly string[]
}

/**
 * The document as a React and Tailwind app, with vector layers drawn as inline SVG, shared by
 * the tool, the CLI, and the app.
 */
export async function exportReactProjectFiles(
  graph: SceneGraph,
  options: ReactProjectExportOptions = {}
): Promise<ReactProject> {
  const [{ exportReactProject }, { vectorElement }] = await Promise.all([
    import('@open-pencil/dom-css/export'),
    import('#core/io/formats/html/vectors')
  ])
  return exportReactProject(graph, { ...options, vectorElement })
}

/** A project file as the tool returns it: text as is, an image as Base64 or by its size. */
function toolFile({ path, content }: ProjectFile, includeImages: boolean) {
  if (typeof content === 'string') return { path, encoding: 'utf8' as const, content }
  if (includeImages) return { path, encoding: 'base64' as const, content: fromUint8Array(content) }
  return { path, encoding: 'base64' as const, bytes: content.byteLength }
}

const idList = (description: string) =>
  v.optional(v.pipe(v.array(v.string()), v.minLength(1), v.description(description)))

export const exportReactProjectTool = defineTool({
  name: 'export_react_project',
  description:
    'Export the design as a React and Tailwind CSS app (Vite, TypeScript): each component set and component as a React component whose variants and properties are props, each top-level frame as a screen that fills the viewport and uses those components where the design places their instances, the variables as Tailwind theme tokens with every mode (light, dark, …) switchable, and openpencil.json, the manifest mapping each screen and component file to the layer it draws. Returns every file to write, text as UTF-8 and images as Base64. Check a screen against its design with check_code before handing the code over.',
  execution: { kind: 'async', mutation: 'none' },
  input: v.strictObject({
    name: v.optional(v.pipe(v.string(), v.description('Project name, for its package and title'))),
    page_ids: idList('Pages to export; every page by default'),
    screen_ids: idList('Frames to export as screens; every top-level frame by default'),
    include_images: v.optional(
      v.pipe(
        v.boolean(),
        v.description('Return image files as Base64 (default true); false lists them by size only')
      ),
      true
    )
  }),
  execute: async (figma, args) => {
    const project = await exportReactProjectFiles(figma.graph, {
      name: args.name,
      pageIds: args.page_ids,
      screenIds: args.screen_ids
    })
    const files = project.files.map((file) => toolFile(file, args.include_images))
    const { screens, components } = project.manifest
    return {
      summary: `${screens.length} screens and ${components.length} components in ${files.length} files`,
      manifest: project.manifest,
      files
    }
  }
})
