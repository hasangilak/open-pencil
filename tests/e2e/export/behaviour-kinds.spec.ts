import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { behaviourKindsDriver } from '#tests/helpers/export/behaviour-kinds/driver'

const editor = useEditorSetupWithClear('/?test&no-rulers')
const kinds = behaviourKindsDriver(() => editor.page)

test('the React app draws a screen of every behaviour kind as its design', async () => {
  test.slow()
  const screens = await kinds.build()

  const checks = await kinds.checkScreens()

  expect(checks.map((check) => check.screen).sort()).toEqual([...screens].sort())
  expect(checks.filter((check) => !check.pass)).toEqual([])
  editor.canvas.assertNoErrors()
})
