import { count, params } from '@nanostores/i18n'

import { i18n } from '#vue/i18n/create'

export const codeMessageDefaults = {
  source: 'Code source',
  sourceDesignJSX: 'Design JSX',
  sourceHTML: 'HTML',
  sourceVue: 'Vue',
  sourceReact: 'React',
  styling: 'Styling',
  stylingCSS: 'CSS',
  stylingTailwind: 'Tailwind',
  editorDesignLabel: 'Design JSX',
  editorHTMLCSSLabel: 'HTML and CSS',
  updating: 'Updating…',
  updatedLive: 'Updated live',
  previewFailed: 'Preview failed',
  generatedReadOnly: 'Generated, read only',
  reset: 'Reset',
  copyJSXReference: 'Copy JSX prop reference to clipboard',
  jsxUpToDate: 'Up to date',
  canvasChangedExpression: params('The canvas now has {value}; the expression stays as written.'),
  canvasChangedOrder: 'The canvas now orders these layers differently; the code stays as written.',
  noSelection: 'Select a layer to see its code',
  noSelectionDesignJSX: 'Or write Design JSX to add new layers to the page.',
  noSelectionComponents: params('{framework} components are generated for the selected layers.'),
  writeJSX: 'Write JSX',
  exportAsCode: 'Export as code',
  exportReactApp: 'React app (.zip)',
  checkScreens: 'Check screens',
  checkingScreens: 'Checking screens…',
  screensMatch: count({
    one: 'The screen matches the design',
    many: 'All {count} screens match the design'
  }),
  screensDiffer: params('{matching} of {total} screens match the design'),
  screenMatches: 'Matches the design',
  screenDifferences: count({ one: '{count} difference', many: '{count} differences' }),
  screenNotCompared: 'Could not be compared'
} as const

export const codeMessages = i18n('code', codeMessageDefaults)
