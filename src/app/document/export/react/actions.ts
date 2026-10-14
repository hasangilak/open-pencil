import { zipSync, type Zippable } from 'fflate'

import type { Editor, EditorState } from '@open-pencil/core/editor'
import {
  checkScreenCode,
  exportReactProjectFiles,
  type CodeCheckReport
} from '@open-pencil/core/tools'

import { measureMarkup } from '@/app/code/measure'
import { getExportBytes, saveExportedFile } from '@/app/document/export/files'

type DownloadBlob = (data: Uint8Array, filename: string, mime: string) => void

/** What a React app holds: every page of the document, or one page. */
export type ReactAppScope = { scope: 'document' } | { scope: 'page'; pageId: string }

export type ReactAppExportOutcome =
  | { status: 'saved'; screens: number; components: number }
  /** The person cancelled the save, or the document closed first. */
  | { status: 'cancelled' }
  /** The pages hold no frame to make a screen of. */
  | { status: 'empty' }

export type ReactScreenCheckOutcome =
  | { status: 'checked'; reports: CodeCheckReport[] }
  | { status: 'cancelled' }
  | { status: 'empty' }

/**
 * Exports the design as a React and Tailwind app the person downloads as a ZIP, the same
 * project `openpencil export -f react` writes, and checks its screens against the design.
 */
export function createReactAppExportActions(
  editor: Editor,
  state: EditorState,
  downloadBlob: DownloadBlob
) {
  function scopePageIds(scope: ReactAppScope): string[] {
    if (scope.scope === 'page') return [scope.pageId]
    return editor.graph.getPages().map((page) => page.id)
  }

  /** Loads the layers of pages not opened yet, which a document opens lazily. */
  async function preparePages(scope: ReactAppScope): Promise<string[] | null> {
    const pageIds = scopePageIds(scope)
    for (const pageId of pageIds) if (!(await editor.preparePageNodes(pageId))) return null
    return pageIds
  }

  function zipName(scope: ReactAppScope): string {
    const name = state.documentName
    if (scope.scope === 'document') return `${name}.zip`
    const page = editor.graph.getNode(scope.pageId)?.name
    return page ? `${name} - ${page}.zip` : `${name}.zip`
  }

  async function exportReactApp(scope: ReactAppScope): Promise<ReactAppExportOutcome> {
    const pageIds = await preparePages(scope)
    if (!pageIds) return { status: 'cancelled' }
    const project = await exportReactProjectFiles(editor.graph, {
      name: state.documentName,
      pageIds
    })
    const { screens, components } = project.manifest
    if (screens.length === 0) return { status: 'empty' }

    const entries: Zippable = {}
    for (const file of project.files) entries[file.path] = getExportBytes(file.content)
    const saved = await saveExportedFile(
      zipSync(entries),
      zipName(scope),
      'ZIP',
      '.zip',
      'application/zip',
      downloadBlob
    )
    return saved
      ? { status: 'saved', screens: screens.length, components: components.length }
      : { status: 'cancelled' }
  }

  /** Lays each screen the export writes out in the browser and compares it with its frame. */
  async function checkReactAppScreens(scope: ReactAppScope): Promise<ReactScreenCheckOutcome> {
    const pageIds = await preparePages(scope)
    if (!pageIds) return { status: 'cancelled' }
    const { manifest } = await exportReactProjectFiles(editor.graph, { pageIds })
    const reports: CodeCheckReport[] = []
    for (const screen of manifest.screens) {
      const node = editor.graph.getNode(screen.layerId)
      if (node) reports.push(await checkScreenCode(editor.graph, node, measureMarkup))
    }
    return reports.length > 0 ? { status: 'checked', reports } : { status: 'empty' }
  }

  return { exportReactApp, checkReactAppScreens }
}
