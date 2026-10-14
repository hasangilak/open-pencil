import { describe, expect, test } from 'bun:test'

import {
  sceneNodeToDesignDocument,
  type DesignElement,
  type DesignNode
} from '@open-pencil/dom-css/export'
import { SceneGraph, type ConstraintType } from '@open-pencil/scene-graph'

function element(node: DesignNode | undefined): DesignElement {
  if (node?.type !== 'element') throw new Error('Expected an element')
  return node
}

describe('DOM projection', () => {
  test('a frame without auto layout places its layers at their coordinates', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const toggle = graph.createNode('FRAME', page.id, { name: 'Switch', width: 44, height: 24 })
    graph.createNode('ELLIPSE', toggle.id, { name: 'Knob', x: 22, y: 2, width: 20, height: 20 })

    const root = element(sceneNodeToDesignDocument(graph, toggle.id).children[0])
    expect(root.inlineStyle).toMatchObject({ position: 'relative', width: '44px' })
    expect(element(root.children[0]).inlineStyle).toMatchObject({
      position: 'absolute',
      left: '22px',
      top: '2px'
    })
  })

  test('an auto layout frame leaves its layers to flexbox', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const row = graph.createNode('FRAME', page.id, { name: 'Row', layoutMode: 'HORIZONTAL' })
    graph.createNode('FRAME', row.id, { name: 'Item', x: 30, width: 10, height: 10 })

    const root = element(sceneNodeToDesignDocument(graph, row.id).children[0])
    expect(root.inlineStyle?.position).toBeUndefined()
    expect(element(root.children[0]).inlineStyle?.position).toBeUndefined()
  })

  test('an auto layout frame is the containing block of the layers it places absolutely', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const row = graph.createNode('FRAME', page.id, { name: 'Row', layoutMode: 'HORIZONTAL' })
    graph.createNode('FRAME', row.id, { name: 'Item', width: 10, height: 10 })
    graph.createNode('FRAME', row.id, {
      name: 'Badge',
      x: 4,
      y: 2,
      width: 8,
      height: 8,
      layoutPositioning: 'ABSOLUTE'
    })

    const root = element(sceneNodeToDesignDocument(graph, row.id).children[0])
    expect(root.inlineStyle?.position).toBe('relative')
    expect(element(root.children[1]).inlineStyle).toMatchObject({
      position: 'absolute',
      left: '4px',
      top: '2px'
    })
  })

  test('text that fills across its auto layout parent stretches as a frame does', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const column = graph.createNode('FRAME', page.id, {
      name: 'Column',
      width: 400,
      layoutMode: 'VERTICAL'
    })
    graph.createNode('TEXT', column.id, {
      name: 'Lead',
      text: 'Fills the column',
      width: 400,
      height: 20,
      textAutoResize: 'HEIGHT',
      layoutAlignSelf: 'STRETCH'
    })

    const root = element(sceneNodeToDesignDocument(graph, column.id).children[0])
    const lead = element(root.children[0]).inlineStyle
    expect(lead?.['align-self']).toBe('stretch')
    expect(lead?.width).toBeUndefined()
  })

  test('children start at the cross-axis start, as auto layout places them, not stretched', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const column = graph.createNode('FRAME', page.id, { name: 'Column', layoutMode: 'VERTICAL' })

    const root = element(sceneNodeToDesignDocument(graph, column.id).children[0])
    expect(root.inlineStyle?.['align-items']).toBe('flex-start')
  })
})

describe('DOM projection constraints', () => {
  function placed(horizontal: ConstraintType, vertical: ConstraintType, x = 20, y = 30) {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const card = graph.createNode('FRAME', page.id, { name: 'Card', width: 400, height: 300 })
    graph.createNode('RECTANGLE', card.id, {
      name: 'Badge',
      x,
      y,
      width: 100,
      height: 40,
      horizontalConstraint: horizontal,
      verticalConstraint: vertical
    })
    const root = element(sceneNodeToDesignDocument(graph, card.id).children[0])
    return element(root.children[0]).inlineStyle ?? {}
  }

  test('Left and Top keep a placed layer at its coordinates', () => {
    expect(placed('MIN', 'MIN')).toMatchObject({ left: '20px', top: '30px', width: '100px' })
  })

  test('Right and Bottom pin a placed layer to the far edges', () => {
    const style = placed('MAX', 'MAX')
    expect(style).toMatchObject({ right: '280px', bottom: '230px', width: '100px' })
    expect(style.left).toBeUndefined()
    expect(style.top).toBeUndefined()
  })

  test('Center keeps the same distance from the parent centre', () => {
    expect(placed('CENTER', 'CENTER', 130, 100)).toMatchObject({
      left: 'calc(50% - 70px)',
      top: 'calc(50% - 50px)'
    })
    expect(placed('CENTER', 'CENTER', 260, 150)).toMatchObject({
      left: 'calc(50% + 60px)',
      top: '50%'
    })
  })

  test('Left and right stretches between both edges without a fixed size', () => {
    const style = placed('STRETCH', 'STRETCH')
    expect(style).toMatchObject({ left: '20px', right: '280px', top: '30px', bottom: '230px' })
    expect(style.width).toBeUndefined()
    expect(style.height).toBeUndefined()
  })

  test('Scale places and sizes the layer in proportion to its parent', () => {
    expect(placed('SCALE', 'SCALE')).toMatchObject({
      left: '5%',
      top: '10%',
      width: '25%',
      height: '13.33%'
    })
  })
})

describe('DOM projection sizes', () => {
  test('a hugging auto layout frame and auto-sizing text leave their size to the content', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const card = graph.createNode('FRAME', page.id, {
      name: 'Card',
      width: 240,
      height: 72,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FIXED'
    })
    graph.createNode('TEXT', card.id, {
      name: 'Title',
      text: 'Details',
      width: 60,
      height: 16,
      textAutoResize: 'WIDTH_AND_HEIGHT'
    })
    graph.createNode('ELLIPSE', card.id, { name: 'Knob', width: 20, height: 20 })

    const root = element(sceneNodeToDesignDocument(graph, card.id).children[0])
    expect(root.inlineStyle).toMatchObject({ width: '240px' })
    expect(root.inlineStyle?.height).toBeUndefined()
    const [title, dot] = root.children.map(element)
    expect(title.inlineStyle?.width).toBeUndefined()
    expect(title.inlineStyle?.height).toBeUndefined()
    expect(dot.inlineStyle).toMatchObject({ width: '20px', 'border-radius': '50%' })
  })
})
