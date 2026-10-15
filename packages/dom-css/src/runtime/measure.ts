import type { MarkupMeasurement, MarkupMeasureRequest, MeasuredElement } from '../export/measure'
import type { CompileTailwindCSSOptions } from '../import/tailwind'

export interface MeasureMarkupOptions extends Pick<CompileTailwindCSSOptions, 'loadStylesheet'> {
  document?: Document
  /** How long to wait for fonts before measuring with whatever has loaded. */
  fontTimeoutMs?: number
}

const DEFAULT_FONT_TIMEOUT_MS = 4000
/** Tall enough that a page's layout never depends on the frame's height. */
const FRAME_HEIGHT = 2000

/** Every class the markup names, which Tailwind builds its utilities for. */
export function markupClassNames(html: string): string[] {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  return [...parsed.querySelectorAll('[class]')].flatMap((element) => [...element.classList])
}

async function stylesheet(
  request: MarkupMeasureRequest,
  options: MeasureMarkupOptions
): Promise<string> {
  if (!request.tailwind) return request.css
  const { compileTailwindCSS } = await import('../import/tailwind')
  return compileTailwindCSS(markupClassNames(request.html), {
    css: `@import "tailwindcss";\n${request.css}`,
    loadStylesheet: options.loadStylesheet
  })
}

const frame = (view: Window) =>
  new Promise<void>((resolve) => {
    view.requestAnimationFrame(() => resolve())
  })

/** Waits for the page's fonts, or the timeout, and says which came first. */
async function fontsReady(document: Document, timeoutMs: number): Promise<boolean> {
  const view = document.defaultView
  if (!view) return false
  let timer: number | undefined
  const timedOut = new Promise<false>((resolve) => {
    timer = view.setTimeout(() => resolve(false), timeoutMs)
  })
  const loaded = document.fonts.ready.then(() => document.fonts.status === 'loaded')
  try {
    return await Promise.race([loaded, timedOut])
  } finally {
    view.clearTimeout(timer)
  }
}

function measured(
  element: Element,
  origin: Pick<DOMRect, 'left' | 'top'>,
  view: Window,
  layerAttribute: string | undefined
): MeasuredElement {
  const box = element.getBoundingClientRect()
  const style = view.getComputedStyle(element)
  // An empty input or textarea draws its placeholder, in the placeholder's own styles.
  const text = element.matches(':placeholder-shown')
    ? view.getComputedStyle(element, '::placeholder')
    : style
  const holdsText = [...element.childNodes].some(
    (child) => child.nodeType === 3 && (child.textContent ?? '').trim().length > 0
  )
  return {
    tagName: element.tagName.toLowerCase(),
    x: box.left - origin.left,
    y: box.top - origin.top,
    width: box.width,
    height: box.height,
    // `display: none` on it or around it leaves it no box at all.
    displayed: element.getClientRects().length > 0,
    styles: {
      color: text.color,
      backgroundColor: style.backgroundColor,
      fontSize: text.fontSize,
      fontWeight: text.fontWeight,
      lineHeight: text.lineHeight,
      opacity: style.opacity
    },
    overflows: holdsText && element.scrollWidth > element.clientWidth + 1,
    ...(layerAttribute ? { layer: element.getAttribute(layerAttribute) } : {})
  }
}

/**
 * Lays markup out in an iframe as wide as the request's viewport, with its stylesheet and
 * fonts, and reports every element's box and computed styles in the order they open.
 */
export async function measureMarkupInBrowser(
  request: MarkupMeasureRequest,
  options: MeasureMarkupOptions = {}
): Promise<MarkupMeasurement> {
  const host = options.document ?? document
  const view = host.defaultView
  if (!view) throw new TypeError('Measuring markup requires a browser window')
  const css = await stylesheet(request, options)
  const iframe = host.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.style.cssText = [
    'position: fixed',
    'left: -100000px',
    'top: 0',
    `width: ${request.width}px`,
    `height: ${FRAME_HEIGHT}px`,
    'border: 0',
    'visibility: hidden',
    'pointer-events: none'
  ].join(';')
  host.body.append(iframe)
  let unmount: (() => void) | undefined
  try {
    const page = iframe.contentDocument
    const pageView = iframe.contentWindow
    if (!page || !pageView) throw new TypeError('Could not create a document to measure in')
    page.open()
    page.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
    page.close()
    for (const [name, value] of Object.entries(request.rootAttributes ?? {}))
      page.documentElement.setAttribute(name, value)
    for (const href of request.fontStylesheets ?? []) {
      const link = page.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      page.head.append(link)
    }
    const style = page.createElement('style')
    style.textContent = css
    page.head.append(style)
    if (request.mount) {
      // An app draws into its root, as `index.html` holds it.
      const root = page.createElement('div')
      root.id = 'root'
      page.body.append(root)
      unmount = await request.mount(root)
    } else {
      page.body.innerHTML = request.html
    }

    // A font stylesheet must load before the faces it declares start to.
    await Promise.all(
      [...page.querySelectorAll('link[rel="stylesheet"]')].map(
        (link) =>
          new Promise<void>((resolve) => {
            link.addEventListener('load', () => resolve(), { once: true })
            link.addEventListener('error', () => resolve(), { once: true })
          })
      )
    )
    const fontsLoaded = await fontsReady(page, options.fontTimeoutMs ?? DEFAULT_FONT_TIMEOUT_MS)
    await frame(pageView)
    await frame(pageView)

    const first = page.body.firstElementChild
    const origin = first?.getBoundingClientRect() ?? { left: 0, top: 0 }
    const elements = first
      ? [first, ...first.querySelectorAll('*')].map((element) =>
          measured(element, origin, pageView, request.layerAttribute)
        )
      : []
    return {
      width: request.width,
      scrollWidth: page.documentElement.scrollWidth,
      height: page.documentElement.scrollHeight,
      elements,
      fontsLoaded
    }
  } finally {
    unmount?.()
    iframe.remove()
  }
}
