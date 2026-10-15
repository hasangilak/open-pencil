import { renderJSX } from '@open-pencil/core/design-jsx'
import type { SceneGraph } from '@open-pencil/scene-graph'

const INK = '#111827'
const MUTED = '#6B7280'
const LINE = '#D1D5DB'
const ACCENT = '#4F46E5'
const WHITE = '#FFFFFF'
const SURFACE = '#F3F4F6'

/** Where the screens start, below the components they place. */
const SCREEN_Y = 1200
const COLUMN_WIDTH = 600
const COMPONENT_HEIGHT = 300

const label = (id: string, value: string) =>
  `properties={[{ id: '${id}', name: 'Label', type: 'TEXT', defaultValue: '${value}' }]}`
const labelRef = (id: string) => `propertyRefs={[{ propertyId: '${id}', field: 'TEXT' }]}`

/**
 * A document of every behaviour kind a screen can use: one component per kind, and a screen per
 * kind placing instances of it, a column each. Switches and checkboxes are drawn off and on, a
 * collapsible closed and open, an accordion with its first item open, a number field at its own
 * value and another, and a text field empty, empty with other words, and filled.
 */
export async function createBehaviourKindsDocument(
  graph: SceneGraph,
  pageId: string
): Promise<{ screens: string[] }> {
  const screens: string[] = []
  let column = 0
  let row = 0
  const render = async (jsx: string, y = row++ * COMPONENT_HEIGHT) => {
    const [result] = await renderJSX(graph, jsx, { parentId: pageId, x: column * COLUMN_WIDTH, y })
    if (!result) throw new Error('The JSX rendered nothing')
    if (result.warnings?.length) throw new Error(result.warnings.join('\n'))
    return result.id
  }
  const screen = async (name: string, children: string) => {
    await render(
      `<Frame name="${name}" flex="col" w={480} h="hug" p={32} gap={16} bg="${SURFACE}">
        <Text name="Heading" font="Inter" size={20} weight={700} color="${INK}">${name}</Text>
        ${children}
      </Frame>`,
      SCREEN_Y
    )
    screens.push(name)
    column++
    row = 0
  }

  const switchId = await render(`
    <Switch.Root name="Switch" flex="row" gap={16} p={16} modelValue="State">
      <Component name="State=Off" w={44} h={24} rounded={12} bg="${LINE}">
        <Switch.Thumb x={2} y={2} w={20} h={20} rounded={10} bg="${WHITE}" />
      </Component>
      <Component name="State=On" w={44} h={24} rounded={12} bg="${ACCENT}">
        <Switch.Thumb x={22} y={2} w={20} h={20} rounded={10} bg="${WHITE}" />
      </Component>
    </Switch.Root>`)
  await screen(
    'Switches',
    `<Instance of="${switchId}" State="Off" /><Instance of="${switchId}" State="On" />`
  )

  const checkboxId = await render(`
    <Checkbox.Root name="Checkbox" flex="row" gap={16} p={16} modelValue="Checked">
      <Component name="Checked=Off" w={20} h={20} rounded={4} bg="${WHITE}" stroke="${LINE}" />
      <Component name="Checked=On" flex="row" justify="center" items="center" w={20} h={20} rounded={4} bg="${ACCENT}">
        <Checkbox.Indicator w={10} h={10} rounded={2} bg="${WHITE}" />
      </Component>
    </Checkbox.Root>`)
  await screen(
    'Checkboxes',
    `<Instance of="${checkboxId}" Checked="Off" /><Instance of="${checkboxId}" Checked="On" />`
  )

  const radioId = await render(`
    <RadioGroup.Item name="Radio" flex="row" gap={16} p={16} modelValue="Checked" ${label('radio-label', 'Option')}>
      <Component name="Checked=Off" flex="row" gap={8} items="center">
        <Frame name="Circle" w={16} h={16} rounded={8} bg="${WHITE}" stroke="${LINE}" />
        <Text name="Label" font="Inter" size={14} color="${INK}" ${labelRef('radio-label')}>Option</Text>
      </Component>
      <Component name="Checked=On" flex="row" gap={8} items="center">
        <Frame name="Circle" flex="row" justify="center" items="center" w={16} h={16} rounded={8} bg="${ACCENT}">
          <RadioGroup.Indicator w={6} h={6} rounded={3} bg="${WHITE}" />
        </Frame>
        <Text name="Label" font="Inter" size={14} color="${INK}" ${labelRef('radio-label')}>Option</Text>
      </Component>
    </RadioGroup.Item>`)
  const planId = await render(`
    <RadioGroup.Root name="Plan" flex="col" gap={8}>
      <RadioGroup.Item of="${radioId}" Label="Basic" />
      <RadioGroup.Item of="${radioId}" Checked="On" Label="Pro" />
      <RadioGroup.Item of="${radioId}" Label="Team" />
    </RadioGroup.Root>`)
  await screen('Plans', `<Instance of="${planId}" />`)

  const segmentId = await render(`
    <ToggleGroup.Item name="Segment" flex="row" gap={16} p={16} modelValue="Pressed" ${label('segment-label', 'Option')}>
      <Component name="Pressed=Off" flex="row" px={12} py={6} rounded={6}>
        <Text name="Label" font="Inter" size={14} color="${MUTED}" ${labelRef('segment-label')}>Option</Text>
      </Component>
      <Component name="Pressed=On" flex="row" px={12} py={6} rounded={6} bg="${WHITE}">
        <Text name="Label" font="Inter" size={14} weight={600} color="${INK}" ${labelRef('segment-label')}>Option</Text>
      </Component>
    </ToggleGroup.Item>`)
  const alignId = await render(`
    <ToggleGroup.Root name="Align" flex="row" p={4} rounded={8} bg="${LINE}">
      <ToggleGroup.Item of="${segmentId}" Pressed="On" Label="Left" />
      <ToggleGroup.Item of="${segmentId}" Label="Center" />
      <ToggleGroup.Item of="${segmentId}" Label="Right" />
    </ToggleGroup.Root>`)
  await screen('Alignment', `<Instance of="${alignId}" />`)

  const disclosureId = await render(`
    <Collapsible.Root name="Disclosure" flex="row" gap={16} p={16} open="Open">
      <Component name="Open=No" flex="col" w={320} gap={8} p={12} rounded={8} bg="${WHITE}" stroke="${LINE}">
        <Collapsible.Trigger flex="row" w="fill" justify="between">
          <Text name="Title" font="Inter" size={14} weight={600} color="${INK}">Shipping</Text>
          <Text name="Action" font="Inter" size={14} color="${MUTED}">Show</Text>
        </Collapsible.Trigger>
      </Component>
      <Component name="Open=Yes" flex="col" w={320} gap={8} p={12} rounded={8} bg="${WHITE}" stroke="${LINE}">
        <Collapsible.Trigger flex="row" w="fill" justify="between">
          <Text name="Title" font="Inter" size={14} weight={600} color="${INK}">Shipping</Text>
          <Text name="Action" font="Inter" size={14} color="${MUTED}">Hide</Text>
        </Collapsible.Trigger>
        <Collapsible.Content flex="col" w="fill">
          <Text name="Body" font="Inter" size={14} w="fill" color="${MUTED}">Orders ship within two days.</Text>
        </Collapsible.Content>
      </Component>
    </Collapsible.Root>`)
  await screen(
    'Shipping',
    `<Instance of="${disclosureId}" Open="No" /><Instance of="${disclosureId}" Open="Yes" />`
  )

  const questionId = await render(`
    <Accordion.Item name="Question" flex="row" gap={16} p={16} open="Open" ${label('question-label', 'Question')}>
      <Component name="Open=No" flex="col" w={360} gap={8} py={12}>
        <Accordion.Trigger flex="row" w="fill">
          <Text name="Label" font="Inter" size={14} weight={600} color="${INK}" ${labelRef('question-label')}>Question</Text>
        </Accordion.Trigger>
      </Component>
      <Component name="Open=Yes" flex="col" w={360} gap={8} py={12}>
        <Accordion.Trigger flex="row" w="fill">
          <Text name="Label" font="Inter" size={14} weight={600} color="${INK}" ${labelRef('question-label')}>Question</Text>
        </Accordion.Trigger>
        <Accordion.Content flex="col" w="fill">
          <Text name="Answer" font="Inter" size={14} w="fill" color="${MUTED}">Yes, any time from your account.</Text>
        </Accordion.Content>
      </Component>
    </Accordion.Item>`)
  const faqId = await render(`
    <Accordion.Root name="FAQ" flex="col" w={360}>
      <Accordion.Item of="${questionId}" Open="Yes" Label="Can I cancel?" />
      <Accordion.Item of="${questionId}" Label="Do you offer refunds?" />
    </Accordion.Root>`)
  await screen('Questions', `<Instance of="${faqId}" />`)

  const accountId = await render(`
    <Tabs.Root name="Account" flex="col" w={360} gap={12} p={16} rounded={12} bg="${WHITE}" stroke="${LINE}">
      <Tabs.List flex="row" gap={4} p={4} rounded={8} bg="${SURFACE}">
        <Tabs.Trigger flex="row" px={12} py={6} rounded={6} bg="${WHITE}">
          <Text name="Label" font="Inter" size={14} weight={600} color="${INK}">Profile</Text>
        </Tabs.Trigger>
        <Tabs.Trigger flex="row" px={12} py={6} rounded={6}>
          <Text name="Label" font="Inter" size={14} color="${MUTED}">Password</Text>
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content flex="col" gap={8} w="fill">
        <Text name="Body" font="Inter" size={14} color="${INK}">Your name</Text>
        <Frame name="Box" w="fill" h={36} rounded={6} bg="${WHITE}" stroke="${LINE}" />
      </Tabs.Content>
      <Tabs.Content flex="col" gap={8} w="fill">
        <Text name="Body" font="Inter" size={14} color="${INK}">Your password</Text>
      </Tabs.Content>
    </Tabs.Root>`)
  await screen('Settings', `<Instance of="${accountId}" />`)

  const uploadId = await render(`
    <Progress.Root name="Upload" w={240} h={8} min={0} max={100} defaultValue={40}>
      <Progress.Track x={0} y={0} w={240} h={8} rounded={4} bg="${LINE}">
        <Progress.Indicator x={0} y={0} w={96} h={8} rounded={4} bg="${ACCENT}" />
      </Progress.Track>
    </Progress.Root>`)
  await screen('Uploads', `<Instance of="${uploadId}" />`)

  const quantityId = await render(`
    <NumberField.Root name="Quantity" flex="row" items="center" gap={8} p={4} rounded={8} bg="${WHITE}" stroke="${LINE}" min={1} max={10} step={1} defaultValue={2}>
      <NumberField.Decrement flex="row" w={28} h={28} rounded={6} bg="${SURFACE}" justify="center" items="center">
        <Text name="Minus" font="Inter" size={16} color="${INK}">-</Text>
      </NumberField.Decrement>
      <NumberField.Input name="Count" font="Inter" size={14} color="${INK}">2</NumberField.Input>
      <NumberField.Increment flex="row" w={28} h={28} rounded={6} bg="${SURFACE}" justify="center" items="center">
        <Text name="Plus" font="Inter" size={16} color="${INK}">+</Text>
      </NumberField.Increment>
    </NumberField.Root>`)
  await screen('Cart', `<Instance of="${quantityId}" /><Instance of="${quantityId}" Count="10" />`)

  const emailId = await render(`
    <TextField.Root name="Email" flex="row" gap={16} p={16} filled={{ property: 'Filled', on: 'Yes', off: 'No' }}>
      <Component name="Filled=No" flex="row" items="center" w={280} h={40} px={12} rounded={8} bg="${WHITE}" stroke="${LINE}">
        <TextField.Input name="Email" font="Inter" size={14} color="${MUTED}">you@example.com</TextField.Input>
      </Component>
      <Component name="Filled=Yes" flex="row" items="center" w={280} h={40} px={12} rounded={8} bg="${WHITE}" stroke="${LINE}">
        <TextField.Input name="Email" font="Inter" size={14} color="${INK}">ada@example.com</TextField.Input>
      </Component>
    </TextField.Root>`)
  await screen(
    'Signup',
    `<Instance of="${emailId}" Filled="No" />
     <Instance of="${emailId}" Filled="No" Email="Work email" />
     <Instance of="${emailId}" Filled="Yes" />`
  )

  const messageId = await render(`
    <Textarea.Root name="Message" flex="col" w={280} h={96} p={12} rounded={8} bg="${WHITE}" stroke="${LINE}">
      <Textarea.Input font="Inter" size={14} w="fill" color="${INK}">Tell us more about your project</Textarea.Input>
    </Textarea.Root>`)
  await screen('Contact', `<Instance of="${messageId}" />`)

  return { screens }
}
