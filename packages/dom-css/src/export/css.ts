import type { Effect, Fill, Stroke } from '@open-pencil/scene-graph'
import { colorToCSS, colorToHex } from '@open-pencil/scene-graph/color'
import type { Color } from '@open-pencil/scene-graph/primitives'

import type { DesignStyleDeclaration } from '../types'

/** Opaque colors as hex, which Tailwind matches to its palette; translucent ones as `rgba()`. */
export function cssColor(color: Color): string {
  return color.a >= 1 ? colorToHex(color) : colorToCSS(color)
}

export function fillToCSS(fill: Fill | undefined): string | undefined {
  if (fill?.type !== 'SOLID' || !fill.visible) return undefined
  return cssColor({ ...fill.color, a: fill.opacity })
}

export function strokeColorToCSS(stroke: Stroke | undefined): string | undefined {
  if (!stroke?.visible) return undefined
  return cssColor({ ...stroke.color, a: stroke.opacity })
}

function shadowToCSS(effect: Effect): string {
  const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : ''
  return `${inset}${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.spread}px ${cssColor(effect.color)}`
}

export function dropShadowToCSS(effect: Effect | undefined): string | undefined {
  if (effect?.type !== 'DROP_SHADOW' || !effect.visible) return undefined
  return shadowToCSS(effect)
}

/**
 * Every visible shadow plus layer and background blur. A stroke drawn as shadows (`strokes`)
 * sits beneath the inner shadows and above the drop shadows, as the canvas paints them; CSS
 * paints the first shadow on top, and inset and outer shadows never overlap.
 */
export function effectsToCSS(effects: Effect[], strokes: string[] = []): DesignStyleDeclaration {
  const style: DesignStyleDeclaration = {}
  const visible = effects.filter((effect) => effect.visible)
  const shadows = [
    ...visible.filter((effect) => effect.type === 'INNER_SHADOW').map(shadowToCSS),
    ...strokes,
    ...visible.filter((effect) => effect.type === 'DROP_SHADOW').map(shadowToCSS)
  ]
  if (shadows.length > 0) style['box-shadow'] = shadows.join(', ')
  for (const effect of visible) {
    if (effect.type === 'LAYER_BLUR' || effect.type === 'FOREGROUND_BLUR')
      style.filter = `blur(${effect.radius}px)`
    if (effect.type === 'BACKGROUND_BLUR') style['backdrop-filter'] = `blur(${effect.radius}px)`
  }
  return style
}
