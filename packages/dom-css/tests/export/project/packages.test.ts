import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { PROJECT_DEV_PACKAGES, PROJECT_PACKAGES } from '#dom-css/export/project/packages'
import * as v from 'valibot'

const Manifest = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({
    dependencies: v.optional(v.record(v.string(), v.string()), {}),
    devDependencies: v.optional(v.record(v.string(), v.string()), {})
  })
)

/** A range's lowest version; a project may take a caret range where the repository pins one. */
const lowest = (range: string) => range.replace(/^[\^~]/, '')

/** The workspace root, found by its lockfile rather than by counting directories. */
function workspaceRoot(): string {
  for (let dir = import.meta.dir; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'bun.lock'))) return dir
    if (dirname(dir) === dir) throw new Error('No workspace root above the test')
  }
}

async function ranges(...path: string[]): Promise<Record<string, string>> {
  const manifest = v.parse(Manifest, await Bun.file(join(workspaceRoot(), ...path)).text())
  return { ...manifest.dependencies, ...manifest.devDependencies }
}

describe('Exported project packages', () => {
  test('use the ranges this repository builds and tests generated code with', async () => {
    const repository = {
      ...(await ranges('package.json')),
      ...(await ranges('packages', 'dom-css', 'package.json'))
    }
    for (const [name, range] of Object.entries({ ...PROJECT_PACKAGES, ...PROJECT_DEV_PACKAGES })) {
      expect({ name, version: lowest(range) }).toEqual({
        name,
        version: lowest(repository[name] ?? range)
      })
    }
  })
})
