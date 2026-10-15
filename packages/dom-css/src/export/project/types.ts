/** A file of an exported project, at its path from the project's root. */
export interface ProjectFile {
  path: string
  content: string | Uint8Array
  /**
   * For a screen's or component's file, the layer each of its JSX elements draws, in the order
   * they open, `null` for an element no layer drew; a check that runs the code links its
   * elements back to the design by it. Not written to disk.
   */
  layerIds?: (string | null)[]
}

/** The manifest format: what `openpencil.json` holds, versioned for the agents that read it. */
export const DESIGN_CODE_MANIFEST_FORMAT = 'openpencil.design-code/1'

/** A top-level frame exported as a page the app shows. */
export interface ManifestScreen {
  name: string
  file: string
  /** The address that shows it, such as `#/home`. */
  route: string
  /** The frame it draws, which checks and agents link back to. */
  layerId: string
  /** The size the design draws it at, the viewport the screen matches the design in. */
  width: number
  height: number
}

/** A component set or component exported as a React component. */
export interface ManifestComponent {
  name: string
  file: string
  layerId: string
  /** Its behaviour, such as `button` or `tabs`, or `plain` for a component without one. */
  kind: string
  /** Its props: variants, text, booleans, and slots. */
  props: string[]
}

/** A mode of a variable collection, and how the page switches to it. */
export interface ManifestMode {
  name: string
  default: boolean
  /**
   * The selector or at-rule its values apply under; the default mode's apply everywhere. A
   * media condition, such as `prefers-color-scheme`, follows the reader's system.
   */
  condition?: string
  /** The attribute that switches the page to it, set on `<html>`, for a selector mode. */
  attribute?: { name: string; value: string }
}

export interface ManifestCollection {
  name: string
  modes: ManifestMode[]
}

/**
 * The contract between a design and the code exported from it, written as `openpencil.json`:
 * which file draws which layer, which props each component takes, and how design modes such
 * as light and dark switch. Agents on either side read it to stay on the same page.
 */
export interface DesignCodeManifest {
  format: typeof DESIGN_CODE_MANIFEST_FORMAT
  name: string
  framework: 'react'
  styling: 'tailwind'
  screens: ManifestScreen[]
  components: ManifestComponent[]
  tokens: {
    /** The stylesheet of design tokens, or null when the document has no variables. */
    file: string | null
    collections: ManifestCollection[]
    /** Variables CSS could not express, which the stylesheet leaves out. */
    issues: string[]
  }
  /** What the export could not carry over, such as an import it has no package range for. */
  warnings: string[]
}
