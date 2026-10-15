import { twirl, type ConvertedDeclaration } from 'twirlwind'

import type {
  DesignDocument,
  DesignElement,
  DesignNode,
  DesignStyleDeclaration,
  DesignText
} from '../types'

export interface SerializeHTMLOptions {
  style?: 'inline' | 'tailwind'
  /** Custom properties declared in `@theme`; a `var()` naming one becomes its utility. */
  themeVariables?: readonly string[]
  /**
   * Put each child of an element that holds only elements on its own indented line, for code
   * people read. Text keeps its whitespace; whitespace between elements in a projected layer
   * changes nothing, since its children are placed by flex, grid, or absolute position.
   */
  indent?: boolean
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
])

export function splitWhitespace(value: string): string[] {
  const parts: string[] = []
  let current = ''
  for (const char of value) {
    if (char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f') {
      if (current.length > 0) parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current.length > 0) parts.push(current)
  return parts
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttr(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;')
}

function serializeText(node: DesignText): string {
  return escapeText(node.text)
}

function serializeStyle(node: DesignElement): string | undefined {
  if (!node.inlineStyle || Object.keys(node.inlineStyle).length === 0) return undefined
  return Object.entries(node.inlineStyle)
    .filter(([, value]) => value !== '')
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ')
}

/**
 * A font size on Tailwind's spacing scale, such as `text-8` for 32px, which twirlwind writes
 * but Tailwind v4 compiles to nothing: its font sizes are the `--text-*` theme scale alone.
 */
const SPACING_FONT_SIZE = /^text-\d+(\.\d+)?$/

/**
 * Letter spacing on the spacing scale, such as `-tracking-1` for -4px, which twirlwind writes
 * but Tailwind v4 compiles to nothing: its letter spacings are the `--tracking-*` names alone.
 */
const SPACING_TRACKING = /^-?tracking-(\d+(\.\d+)?|px)$/

/**
 * A one-pixel outline offset, such as `-outline-offset-px` for -1px, which twirlwind writes but
 * Tailwind v4 compiles to nothing: its offsets are numbers of pixels, without `px`.
 */
const PIXEL_OUTLINE_OFFSET = /^-?outline-offset-px$/

/** A utility naming a palette shade, such as `bg-violet-600`: its prefix and the shade. */
const PALETTE_SHADE = /^(.+)-([a-z]+-\d{2,3})$/

const COLOR_PROPERTY = /(^|-)color$|^fill$|^stroke$/

/** A CSS value as a Tailwind arbitrary value, with its spaces as underscores. */
const arbitrary = (value: string) => `[${value.trim().replaceAll(' ', '_')}]`

/**
 * A palette shade twirlwind matched from Tailwind v3's hex value, such as `bg-violet-600` for
 * `#7c3aed`, as the exact color: Tailwind v4 draws its shades in other, `oklch()` colors. Only an
 * `oklch()` value, or a variable, can be the v4 shade itself.
 */
function exactColor(utility: string, converted: readonly ConvertedDeclaration[]): string {
  const shade = PALETTE_SHADE.exec(utility)
  const declaration = converted.find((item) => item.className === utility)
  if (!shade || !declaration || !COLOR_PROPERTY.test(declaration.property)) return utility
  if (/^(oklch|var)\(/i.test(declaration.value.trim())) return utility
  return `${shade[1]}-${arbitrary(declaration.value)}`
}

/**
 * Declarations as Tailwind utilities, as twirlwind writes them, with any font size, letter
 * spacing, or pixel outline offset off the theme's scale written as an arbitrary value, so every
 * utility compiles, a
 * `normal` line height kept as CSS means it, and colors as exact as the design's
 * (`packages/dom-css/tests/export/tailwind-jsx/compiles.test.ts`).
 */
export function tailwindUtilities(
  style: DesignStyleDeclaration,
  themeVariables: readonly string[] = []
): string[] {
  const css = Object.entries(style)
    .filter(([, value]) => value !== '')
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ')
  if (!css) return []
  const fontSize = style['font-size']?.trim()
  const letterSpacing = style['letter-spacing']?.trim()
  const outlineOffset = style['outline-offset']?.trim()
  const normalLineHeight = style['line-height']?.trim() === 'normal'
  const converted = twirl.convert(css, { theme: { variables: themeVariables } })
  return splitWhitespace(converted.className).map((utility) => {
    if (fontSize && SPACING_FONT_SIZE.test(utility)) return `text-${arbitrary(fontSize)}`
    if (letterSpacing && SPACING_TRACKING.test(utility))
      return `tracking-${arbitrary(letterSpacing)}`
    if (outlineOffset && PIXEL_OUTLINE_OFFSET.test(utility))
      return `outline-offset-${arbitrary(outlineOffset)}`
    // Tailwind's `leading-normal` is 1.5, not the font's own line height CSS calls `normal`.
    if (normalLineHeight && utility === 'leading-normal') return 'leading-[normal]'
    return exactColor(utility, converted.exact)
  })
}

export function serializeTailwindClasses(
  node: DesignElement,
  themeVariables: readonly string[] = []
): string | undefined {
  const className = tailwindUtilities(node.inlineStyle ?? {}, themeVariables).join(' ')
  return className.length > 0 ? className : undefined
}

export function mergeClassNames(...values: Array<string | undefined>): string | undefined {
  const className = values
    .flatMap((value) => (value ? splitWhitespace(value) : []))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(' ')
  return className.length > 0 ? className : undefined
}

function serializeAttrs(node: DesignElement, options: SerializeHTMLOptions): string {
  const style = serializeStyle(node)
  const tailwindClass =
    options.style === 'tailwind'
      ? serializeTailwindClasses(node, options.themeVariables)
      : undefined
  const attrsWithoutStyle = { ...node.attrs }
  delete attrsWithoutStyle.style
  const sourceAttrs = options.style === 'tailwind' && tailwindClass ? attrsWithoutStyle : node.attrs
  const attrs: Record<string, string | undefined> = { ...sourceAttrs }
  if (tailwindClass) attrs.class = mergeClassNames(node.attrs.class, tailwindClass)
  if (style && options.style !== 'tailwind') attrs.style = style
  const serialized = Object.entries(attrs)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .map(([name, value]) => `${name}="${escapeAttr(value)}"`)

  if (serialized.length === 0) return ''
  return ` ${serialized.join(' ')}`
}

/** Static HTML cannot play a shader, so its layer shows the still frame behind its content. */
const SHADER_FRAME_STYLE =
  'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;border-radius:inherit;pointer-events:none'

function shaderFrame(node: DesignElement): string {
  const frame = node.shader?.frame
  return frame ? `<img src="${escapeAttr(frame)}" alt="" style="${SHADER_FRAME_STYLE}">` : ''
}

function serializeElement(
  node: DesignElement,
  options: SerializeHTMLOptions,
  depth: number
): string {
  // SVG names such as `linearGradient` keep their case, as an SVG parser needs them.
  const tagName = node.tagName
  const attrs = serializeAttrs(node, options)
  if (VOID_ELEMENTS.has(tagName.toLowerCase())) return `<${tagName}${attrs}>`
  const children = [
    shaderFrame(node),
    ...node.children.map((child) => serializeNode(child, options, depth + 1))
  ].filter((child) => child !== '')
  const block =
    options.indent && children.length > 0 && node.children.every((child) => child.type !== 'text')
  if (!block) return `<${tagName}${attrs}>${children.join('')}</${tagName}>`
  const inner = '  '.repeat(depth + 1)
  const outer = '  '.repeat(depth)
  return `<${tagName}${attrs}>\n${children.map((child) => inner + child).join('\n')}\n${outer}</${tagName}>`
}

export function serializeNode(
  node: DesignNode,
  options: SerializeHTMLOptions = {},
  depth = 0
): string {
  return node.type === 'text' ? serializeText(node) : serializeElement(node, options, depth)
}

/**
 * The elements `serializeHTML` writes, in the order they open: the document's own, and `null`
 * for a shader's still frame, which it adds in front of its layer's content.
 */
export function serializedElements(document: DesignDocument): (DesignElement | null)[] {
  const visit = (node: DesignNode): (DesignElement | null)[] => {
    if (node.type === 'text') return []
    if (VOID_ELEMENTS.has(node.tagName.toLowerCase())) return [node]
    return [node, ...(node.shader?.frame ? [null] : []), ...node.children.flatMap(visit)]
  }
  return document.children.flatMap(visit)
}

export function serializeHTML(
  document: DesignDocument,
  options: SerializeHTMLOptions = {}
): string {
  const resolved: SerializeHTMLOptions = {
    ...options,
    themeVariables: options.themeVariables ?? document.tokens?.themeVariables()
  }
  return document.children
    .map((node) => serializeNode(node, resolved))
    .join(options.indent ? '\n' : '')
}
