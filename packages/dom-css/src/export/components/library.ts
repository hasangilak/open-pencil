import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { VectorElementRenderer } from '../projection'
import { claimName } from '../storybook/names'
import { componentModel, type ComponentModel } from './model'
import type { ComponentReferences } from './references'

/** A component set or standalone component to generate, and the name its file takes. */
export interface LibraryEntry {
  set: SceneNode
  name: string
}

export interface ComponentLibraryOptions {
  vectorElement?: VectorElementRenderer
  /** File names already used beside the components, which a group's item component avoids. */
  reserved?: readonly string[]
}

/**
 * The component each entry's set generates, by set id, built twice: first alone, so each
 * knows its props, then knowing all the others, so an instance of one uses it rather than
 * drawing its layers. Components are imported by their files' names, so a group's item
 * component gets a file of its own, named apart from every other file.
 */
export function componentLibrary(
  graph: SceneGraph,
  entries: readonly LibraryEntry[],
  { vectorElement, reserved = [] }: ComponentLibraryOptions = {}
): Map<string, ComponentModel> {
  const key = (name: string) => name.toLowerCase()
  const taken = new Set([...reserved, ...entries.map((entry) => entry.name)].map(key))
  const itemNames = new Map(
    entries.map((entry) => [entry.name, claimName(`${entry.name}Item`, taken, { key })])
  )
  const model = (entry: LibraryEntry, references?: ComponentReferences) =>
    componentModel(graph, entry.set, {
      vectorElement,
      references,
      name: entry.name,
      itemName: itemNames.get(entry.name)
    })
  const alone = new Map<string, ComponentModel>()
  for (const entry of entries) {
    const component = model(entry)
    if (component) alone.set(entry.set.id, component)
  }
  const models = new Map<string, ComponentModel>()
  for (const entry of entries) {
    const component = alone.has(entry.set.id) && model(entry, alone)
    if (component) models.set(entry.set.id, component)
  }
  return models
}
