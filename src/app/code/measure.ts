import type { MarkupMeasurer } from '@open-pencil/dom-css/export'

import { loadTailwindStylesheet } from './tailwind'

/**
 * Lays exported markup out in an iframe of this window, which checking code against the design
 * needs; the measuring code loads with the first check.
 */
export const measureMarkup: MarkupMeasurer = async (request) => {
  const { measureMarkupInBrowser } = await import('@open-pencil/dom-css/browser')
  return measureMarkupInBrowser(request, { loadStylesheet: loadTailwindStylesheet })
}
