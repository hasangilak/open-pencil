/**
 * Laying exported markup out in a real browser, as a check of code against its design does:
 * what a host is asked to render and what it reports back. Hosts with a DOM implement it with
 * `measureMarkupInBrowser` from `@open-pencil/dom-css/browser`.
 */

/** Markup to lay out, the stylesheet beside it, and the viewport it is laid out in. */
export interface MarkupMeasureRequest {
  html: string
  /** CSS after Tailwind's, such as the design tokens a project's `tokens.css` holds. */
  css: string
  /** Compile the Tailwind utilities the markup names, with `css` in the same build. */
  tailwind: boolean
  /** The viewport's width in CSS pixels. */
  width: number
  /** Attributes on `<html>`, such as `data-theme="dark"` to show a design mode. */
  rootAttributes?: Record<string, string>
  /** Stylesheets that load the fonts the markup's text uses, such as Google Fonts'. */
  fontStylesheets?: readonly string[]
  /** The attribute naming the layer an element draws, which each element reports as `layer`. */
  layerAttribute?: string
  /**
   * Renders the page's app into its root in place of `html`, as an app that draws itself once
   * mounted does; `html` still names the classes Tailwind builds. Resolves to what unmounts it.
   */
  mount?: (root: HTMLElement) => Promise<() => void>
}

/**
 * The computed styles a check compares, as the browser reports them. An input or textarea
 * showing its placeholder reports its placeholder's text styles, which are what it draws.
 */
export interface MeasuredStyles {
  color: string
  backgroundColor: string
  fontSize: string
  fontWeight: string
  lineHeight: string
  opacity: string
}

/** An element's box in CSS pixels from the markup's first element, and its styles. */
export interface MeasuredElement {
  tagName: string
  x: number
  y: number
  width: number
  height: number
  /**
   * The browser lays out a box for it; false for one `display: none` hides, itself or an
   * element around it, such as a closed panel, which draws nothing.
   */
  displayed: boolean
  styles: MeasuredStyles
  /** Its content is wider than its box, as overflowing or clipped text is. */
  overflows: boolean
  /** The value of the request's `layerAttribute` on it, null without one. */
  layer?: string | null
}

export interface MarkupMeasurement {
  width: number
  /** The page's scroll width; more than `width` means the page scrolls sideways. */
  scrollWidth: number
  /** The page's height. */
  height: number
  /** Every element of the markup, in the order they open. */
  elements: MeasuredElement[]
  /** The fonts the page asked for finished loading before it was measured. */
  fontsLoaded: boolean
}

export type MarkupMeasurer = (request: MarkupMeasureRequest) => Promise<MarkupMeasurement>
