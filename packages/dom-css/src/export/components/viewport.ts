import type { StateElement } from '#dom-css/behaviours/states/types'

/**
 * A screen fills the viewport it is shown in. A top-level frame is the page at the width the
 * design draws it, so its width becomes the viewport's and its height the least the page
 * takes; content the frame holds below that grows the page rather than being cut off. At the
 * frame's own width the page lays out as the design does.
 */
export function fillViewport(root: StateElement): void {
  const style = { ...root.base }
  if (Object.hasOwn(style, 'width')) style.width = '100%'
  if (Object.hasOwn(style, 'height')) {
    style['min-height'] = style.height
    delete style.height
  }
  root.base = style
}
