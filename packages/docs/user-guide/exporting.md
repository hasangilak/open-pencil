---
title: Exporting
description: Export images, SVG, .fig subsets, and React apps, and open .fig or .pen documents in OpenPencil.
---

# Exporting

Export individual nodes as images or `.fig` subsets, and open full `.fig` or `.pen` documents.

## Image Export

Select a node and use the Export section in the properties panel.

### Export Settings

- **Scale** — 0.5×, 0.75×, 1×, 1.5×, 2×, 3×, or 4× (hidden for SVG — vectors are resolution-independent)
- **Format** — PNG (transparent background), JPG (white background), WEBP (transparent background), SVG (vector), `.fig` (native document subset)

You can add multiple export settings to export the same node at different scales or formats in one go. A live preview with a checkerboard background shows what will be exported.

### Export Methods

| Method | Mac | Windows / Linux |
|--------|-----|-----------------|
| Keyboard shortcut | <kbd>⇧</kbd><kbd>⌘</kbd><kbd>E</kbd> | <kbd>Shift</kbd> + <kbd>Ctrl</kbd> + <kbd>E</kbd> |
| Context menu | Right-click <kbd>→</kbd> Export… | Right-click <kbd>→</kbd> Export… |
| Properties panel | Click "Export" button | Click "Export" button |

The exported file is saved via a native dialog (desktop) or browser download.

## React App Export

Export a design as a React and Tailwind CSS app, the same project [`openpencil export -f react`](/programmable/cli/exporting#react-project-export) writes. Each top-level frame becomes a screen, each component a React component, and variables become Tailwind theme tokens. A frame of text alone with no fill, such as a section's heading, labels the canvas and is left out. The app is saved as a ZIP named after the document; unzip it and run `npm install && npm run dev`.

| What to export | How |
|----------------|-----|
| The page on screen | With nothing selected, click **React app (.zip)** under Export as code in the Export section |
| Any page | Right-click it in the Pages panel <kbd>→</kbd> Export as React app |
| Every page | File <kbd>→</kbd> Export as React App… |

**Check screens**, below that button, runs each screen's code as the app ships it, with its components and icons, lays it out in the browser, and compares it with its frame: positions, sizes, colors, and type, layers the code does not draw, and the colors again in each variable mode. It lists each screen as matching the design or with its number of differences.

## Copy/Paste as

In addition to file export, you can copy the selection to the clipboard in multiple formats via the context menu (right-click → Copy/Paste as):

| Action | Shortcut (Mac) | Shortcut (Win/Linux) |
|--------|----------------|----------------------|
| Copy as text | — | — |
| Copy as SVG | — | — |
| Copy as PNG | <kbd>⇧</kbd><kbd>⌘</kbd><kbd>C</kbd> | <kbd>Shift</kbd> + <kbd>Ctrl</kbd> + <kbd>C</kbd> |
| Copy as JSX | — | — |

- **Copy as text** — copies visible text content from the selection
- **Copy as SVG** — copies the selection as SVG markup (paste into code editors, Inkscape, etc.)
- **Copy as PNG** — renders at 2× and copies to the clipboard (ready to paste into Slack, Notion, etc.)
- **Copy as JSX** — copies the OpenPencil JSX representation (compatible with `renderJsx()`)

## .fig File Operations

OpenPencil uses the .fig format for full documents — the same binary format as Figma.

### Opening Files

| Action | Mac | Windows / Linux |
|--------|-----|-----------------|
| Open file | <kbd>⌘</kbd><kbd>O</kbd> | <kbd>Ctrl</kbd> + <kbd>O</kbd> |

A file picker dialog opens, filtered for `.fig` and `.pen` files. On the desktop app, this uses the native OS dialog.

You can also drag a `.fig`, `.pen`, or other supported document onto the window; it opens in a new tab. Images and SVG files dropped on the canvas are placed in the document instead, and any other file reports that it can't be opened.

### Saving Files

| Action | Mac | Windows / Linux |
|--------|-----|-----------------|
| Save | <kbd>⌘</kbd><kbd>S</kbd> | <kbd>Ctrl</kbd> + <kbd>S</kbd> |
| Save As | <kbd>⇧</kbd><kbd>⌘</kbd><kbd>S</kbd> | <kbd>Shift</kbd> + <kbd>Ctrl</kbd> + <kbd>S</kbd> |

- **Save** overwrites the currently open file without a dialog
- **Save As** opens a save dialog to choose a new location

Saved files are compressed and include a thumbnail image for preview in file browsers.

### Round-trip Compatibility

Files exported from OpenPencil can be opened in Figma, and vice versa. The .fig format preserves all node types, properties, fills, strokes, effects, vector data, and layout settings.

## Keyboard Shortcuts

| Action | Mac | Windows / Linux |
|--------|-----|-----------------|
| Export selection | <kbd>⇧</kbd><kbd>⌘</kbd><kbd>E</kbd> | <kbd>Shift</kbd> + <kbd>Ctrl</kbd> + <kbd>E</kbd> |
| Copy as PNG | <kbd>⇧</kbd><kbd>⌘</kbd><kbd>C</kbd> | <kbd>Shift</kbd> + <kbd>Ctrl</kbd> + <kbd>C</kbd> |
| Open file | <kbd>⌘</kbd><kbd>O</kbd> | <kbd>Ctrl</kbd> + <kbd>O</kbd> |
| Save | <kbd>⌘</kbd><kbd>S</kbd> | <kbd>Ctrl</kbd> + <kbd>S</kbd> |
| Save As | <kbd>⇧</kbd><kbd>⌘</kbd><kbd>S</kbd> | <kbd>Shift</kbd> + <kbd>Ctrl</kbd> + <kbd>S</kbd> |

## Tips

- Use 2× or 3× scale when exporting for high-DPI screens.
- JPG always uses a white background — use PNG or WEBP if you need transparency.
- Use SVG export when you need a vector format for further editing in Illustrator, Inkscape, or code.
- The thumbnail in exported .fig files enables preview in file browsers and Figma's file picker.
