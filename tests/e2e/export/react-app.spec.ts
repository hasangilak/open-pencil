import { readFile } from 'node:fs/promises'

import { test, expect, type Download, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import * as v from 'valibot'

import { CanvasHelper } from '#tests/helpers/canvas'
import { openAppMenu } from '#tests/helpers/menu'
import { addPages } from '#tests/helpers/pages'
import { propertySection } from '#tests/helpers/properties'

let page: Page
let canvas: CanvasHelper
const screenIds: string[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto('/')
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  // The app prefers the File System Access save dialog, which never resolves in a headless
  // browser; without it the export falls back to a download Playwright captures.
  await page.evaluate(() => {
    window.showSaveFilePicker = undefined
  })
})

test.afterAll(async () => {
  await page.close()
})

const Manifest = v.object({
  screens: v.array(v.object({ file: v.string(), layerId: v.string() }))
})

/** Setup: a frame with a rectangle in it on a page, the layer a screen is exported from. */
function addScreen(pageName?: string): Promise<string> {
  return page.evaluate((name) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const parentId = name
      ? store.graph.getPages().find((candidate) => candidate.name === name)?.id
      : store.state.currentPageId
    if (!parentId) throw new Error(`Page "${name}" not found`)
    const frameId = store.createShape('FRAME', 0, 0, 390, 844, parentId, 'Home')
    store.createShape('RECTANGLE', 24, 24, 160, 48, frameId)
    store.clearSelection()
    store.requestRender()
    return frameId
  }, pageName)
}

/** Probe: the downloaded project's files and its manifest. */
async function projectFiles(download: Download) {
  const files = unzipSync(new Uint8Array(await readFile(await download.path())))
  const manifest = v.parse(
    v.pipe(v.string(), v.parseJson(), Manifest),
    strFromU8(files['openpencil.json'])
  )
  return { paths: Object.keys(files), manifest }
}

function reactAppExport() {
  return propertySection(page, 'Export').getByTestId('react-app-export')
}

test('the page downloads as a React app ZIP named after the document', async () => {
  const frameId = await addScreen()
  screenIds.push(frameId)
  await canvas.waitForRender()
  const documentName = await page.evaluate(
    () => window.openPencil?.getStore?.()?.state.documentName ?? ''
  )

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    reactAppExport().getByRole('button', { name: 'React app (.zip)' }).click()
  ])

  expect(download.suggestedFilename().startsWith(documentName)).toBe(true)
  expect(download.suggestedFilename().endsWith('.zip')).toBe(true)
  const { paths, manifest } = await projectFiles(download)
  expect(paths).toContain('package.json')
  expect(paths).toContain('openpencil.json')
  expect(paths.filter((path) => /^src\/screens\/[^/]+\.tsx$/.test(path))).not.toHaveLength(0)
  expect(manifest.screens.map((screen) => screen.layerId)).toEqual([frameId])
  expect(paths).toContain(manifest.screens[0].file)
  canvas.assertNoErrors()
})

test('checking screens lists each screen against its frame', async () => {
  test.slow()
  await reactAppExport().getByRole('button', { name: 'Check screens' }).click()

  await expect(reactAppExport().locator('[data-slot="alert"]')).toContainText('Home', {
    timeout: 30_000
  })
  canvas.assertNoErrors()
})

test('the Pages context menu exports that page alone', async () => {
  await addPages(page, ['Checkout'])
  const frameId = await addScreen('Checkout')
  screenIds.push(frameId)
  await canvas.waitForRender()

  await page
    .getByTestId('pages-row')
    .filter({ has: page.getByText('Checkout', { exact: true }) })
    .click({ button: 'right' })
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Export as React app' }).click()
  ])

  const { paths, manifest } = await projectFiles(download)
  expect(paths).toContain('package.json')
  expect(manifest.screens.map((screen) => screen.layerId)).toEqual([frameId])
  canvas.assertNoErrors()
})

test('the File menu exports every page of the document', async () => {
  const menu = await openAppMenu(page, 'File')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    menu.getByRole('menuitem', { name: 'Export as React app…' }).click()
  ])

  const { manifest } = await projectFiles(download)
  expect(manifest.screens.map((screen) => screen.layerId).sort()).toEqual([...screenIds].sort())
  canvas.assertNoErrors()
})

test('a page without frames says there is nothing to export', async () => {
  await canvas.clearCanvas()
  let downloads = 0
  page.on('download', () => downloads++)

  await reactAppExport().getByRole('button', { name: 'React app (.zip)' }).click()

  await expect(reactAppExport().getByRole('alert')).toBeVisible()
  expect(downloads).toBe(0)
  canvas.assertNoErrors()
})
