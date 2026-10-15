import type { Page } from '@playwright/test'

import type * as KindsScene from '#tests/helpers/export/behaviour-kinds/scene'

/** How a screen's code compared with its design in Check screens. */
export interface ScreenCheck {
  screen: string
  pass: boolean
  /** Each layer the code draws other than the design, and how. */
  differences: string[]
}

/** Builds a screen of every behaviour kind and checks the React app's screens against them. */
export function behaviourKindsDriver(page: () => Page) {
  return {
    /** Setup: the components and their screens, laid out in the app's fonts; the screens' names. */
    build() {
      return page().evaluate(async () => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const fixtureURL = '/tests/helpers/export/behaviour-kinds/scene.ts'
        const scene: typeof KindsScene = await import(fixtureURL)
        const pageId = store.state.currentPageId
        const { screens } = await scene.createBehaviourKindsDocument(store.graph, pageId)
        await store.loadFontsForNodes(store.graph.getChildren(pageId).map((node) => node.id))
        store.clearSelection()
        store.zoomToFit()
        store.requestRender()
        return screens
      })
    },

    /** Probe: Check screens over the whole document, as the export runs it. */
    checkScreens(): Promise<ScreenCheck[]> {
      return page().evaluate(async () => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const outcome = await store.checkReactAppScreens({ scope: 'document' })
        if (outcome.status !== 'checked') throw new Error(`Check screens: ${outcome.status}`)
        return outcome.reports.map((report) => ({
          screen: report.screen.name,
          pass: report.pass,
          differences: report.differences.map(
            (difference) =>
              `${difference.name} ${difference.kind}: design ${difference.design}, code ${difference.code}`
          )
        }))
      })
    }
  }
}
