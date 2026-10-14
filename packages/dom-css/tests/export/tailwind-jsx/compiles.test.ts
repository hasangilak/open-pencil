import { describe, expect, test } from 'bun:test'

import { compileTailwindCSS } from '#dom-css/import/tailwind'
import { compact } from 'es-toolkit/array'

import type { ConstraintType } from '@open-pencil/scene-graph'

import { makeGraph, pageId, tw } from './helpers'

const WHITE = {
  type: 'SOLID' as const,
  color: { r: 1, g: 1, b: 1, a: 1 },
  opacity: 1,
  visible: true
}

/** A page of the sizes, radii, placements, and effects designs commonly use. */
function variedDesign() {
  const graph = makeGraph()
  const frame = graph.createNode('FRAME', pageId(graph), {
    name: 'Screen',
    width: 1440,
    height: 900,
    fills: [WHITE]
  })
  const column = graph.createNode('FRAME', frame.id, {
    name: 'Column',
    width: 600,
    height: 800,
    layoutMode: 'VERTICAL',
    itemSpacing: 12,
    paddingTop: 18,
    paddingLeft: 10,
    cornerRadius: 24,
    opacity: 0.85
  })
  for (const fontSize of [12, 14, 16, 20, 24, 28, 32, 40, 44, 48, 56, 64, 80, 100]) {
    graph.createNode('TEXT', column.id, {
      name: `Text ${fontSize}`,
      text: 'Aa',
      fontSize,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      width: fontSize,
      height: fontSize
    })
  }
  for (const letterSpacing of [-4, -1, 0.5, 2]) {
    graph.createNode('TEXT', column.id, {
      name: `Tracked ${letterSpacing}`,
      text: 'Aa',
      fontSize: 48,
      letterSpacing,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      width: 48,
      height: 58
    })
  }
  const constraints: ConstraintType[] = ['MIN', 'MAX', 'CENTER', 'STRETCH', 'SCALE']
  for (const [index, constraint] of constraints.entries()) {
    graph.createNode('RECTANGLE', frame.id, {
      name: `Placed ${constraint}`,
      x: 700 + index * 20,
      y: 40 + index * 30,
      width: 120,
      height: 48,
      cornerRadius: 12,
      horizontalConstraint: constraint,
      verticalConstraint: constraint,
      fills: [WHITE]
    })
  }
  return { graph, frame }
}

/** The utilities in every `className` of printed JSX. */
function utilities(code: string): string[] {
  return [...code.matchAll(/className="([^"]*)"/g)].flatMap((match) =>
    compact((match[1] ?? '').split(/\s+/))
  )
}

/** Whether compiled CSS has a rule for the utility, as Tailwind escapes its selector. */
function hasRule(css: string, utility: string): boolean {
  const selector = `.${utility.replace(/[^\w-]/g, (char) => `\\${char}`)}`
  return css.includes(`${selector} {`) || css.includes(`${selector}:`)
}

describe('Tailwind JSX utilities compile', () => {
  test('every utility the export writes is one Tailwind compiles', async () => {
    const { graph, frame } = variedDesign()
    const used = [...new Set(utilities(tw(graph, frame.id)))]
    const css = await compileTailwindCSS(used)
    expect(used.filter((utility) => !hasRule(css, utility))).toEqual([])
  })

  test('a font size on the spacing scale is written as its value', () => {
    const graph = makeGraph()
    const text = graph.createNode('TEXT', pageId(graph), {
      text: 'Welcome',
      fontSize: 32,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      width: 120,
      height: 40
    })
    const code = tw(graph, text.id)
    expect(code).toContain('text-[32px]')
    expect(code).not.toMatch(/\btext-8\b/)
  })

  test('letter spacing is written as its value, since Tailwind has no scale for it', async () => {
    const graph = makeGraph()
    const text = graph.createNode('TEXT', pageId(graph), {
      text: '01',
      fontSize: 88,
      letterSpacing: -4,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      width: 92,
      height: 106
    })
    const code = tw(graph, text.id)
    expect(code).toContain('tracking-[-4px]')
    expect(code).not.toMatch(/-tracking-1\b/)
    expect(await compileTailwindCSS(['tracking-[-4px]'])).toContain('letter-spacing: -4px')
  })

  test("a color in Tailwind v3's palette keeps its own value, which v4's shade is not", async () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Button',
      width: 120,
      height: 44,
      fills: [{ ...WHITE, color: { r: 124 / 255, g: 58 / 255, b: 237 / 255, a: 1 } }]
    })
    graph.createNode('TEXT', frame.id, { text: 'Continue', fills: [WHITE] })

    const used = [...new Set(utilities(tw(graph, frame.id)))]
    const css = await compileTailwindCSS(used)

    expect(used.filter((utility) => utility.includes('violet'))).toEqual([])
    expect(css.toLowerCase()).toContain('background-color: #7c3aed')
    // White is the same color in every Tailwind version, so it keeps its name.
    expect(used).toContain('text-white')
  })

  test("auto line height is the font's own, not Tailwind's paired or preflight one", async () => {
    const graph = makeGraph()
    const text = graph.createNode('TEXT', pageId(graph), {
      text: 'A headline long enough to wrap across the column',
      fontSize: 48,
      lineHeight: null,
      textAutoResize: 'HEIGHT',
      width: 400,
      height: 174
    })
    const code = tw(graph, text.id)
    expect(code).toContain('leading-[normal]')
    expect(code).not.toMatch(/\bleading-normal\b/)
    const css = await compileTailwindCSS(['leading-[normal]'])
    expect(css).toContain('line-height: normal')
  })

  test('a line of text with auto line height is as tall as the canvas lays it out', async () => {
    const graph = makeGraph()
    const text = graph.createNode('TEXT', pageId(graph), {
      text: 'Share it',
      fontSize: 17,
      lineHeight: null,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      width: 63,
      height: 21
    })
    // Chrome's `normal` for Inter at 17px is 20px, so each such line would sit a pixel higher.
    const code = tw(graph, text.id)
    expect(code).toContain('leading-[21px]')
    expect(await compileTailwindCSS(['leading-[21px]'])).toContain('line-height: 21px')
  })
})
