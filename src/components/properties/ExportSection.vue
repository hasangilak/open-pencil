<script setup lang="ts">
import { tryOnScopeDispose, useObjectUrl } from '@vueuse/core'
import { computed, onActivated, onDeactivated, ref, shallowRef, watch } from 'vue'

import type { CodeCheckReport } from '@open-pencil/core/tools'
import { useCodeMessages, useExport, useI18n, useRetainedActivity } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { useNotificationMessages } from '@/app/i18n/notifications'
import ExportScaleInput from '@/components/properties/ExportScaleInput.vue'
import AppButton from '@/components/ui/button/AppButton.vue'
import IconButton from '@/components/ui/button/IconButton.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import Tip from '@/components/ui/overlay/Tip.vue'
import PanelItemRow from '@/components/ui/panel/PanelItemRow.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'
import AppSelect from '@/components/ui/select/AppSelect.vue'
import { CHECKERBOARD_BACKGROUND } from '@/theme/paint/checkerboard'

const editorStore = useEditorStore()
const { panels } = useI18n()
const code = useCodeMessages()
const notifications = useNotificationMessages()
const {
  activeTarget,
  activeName,
  activeSettings,
  targetIds,
  mixed,
  addSetting,
  removeSetting,
  updateScale,
  updateFormat,
  formatSupportsScale,
  formatOptions,
  scales,
  clampExportScale
} = useExport()

const previewBlob = shallowRef<Blob | null>(null)
const previewURL = useObjectUrl(previewBlob)
const showPreview = ref(false)
const exporting = ref(false)
const retainedActivity = useRetainedActivity()
let previewVersion = 0

function clearPreview() {
  previewVersion++
  previewBlob.value = null
}

onDeactivated(clearPreview)
tryOnScopeDispose(clearPreview)
onActivated(() => {
  void updatePreview()
})

const PREVIEW_WIDTH = 480

async function doExport() {
  exporting.value = true
  try {
    const requests = []
    // Export exactly the rows shown in the panel (activeSettings) for every target,
    // so a multi-selection exports what the user sees rather than each node's own
    // (possibly hidden / divergent) settings.
    for (const id of targetIds.value) {
      const node = editorStore.graph.getNode(id)
      if (!node) continue
      const target =
        activeTarget.value === 'page'
          ? ({ scope: 'page', pageId: id } as const)
          : ({ scope: 'node', nodeId: id } as const)
      for (const setting of activeSettings.value) {
        requests.push({ target, formatId: setting.format, options: { scale: setting.scale } })
      }
    }
    // A single file downloads directly; multiple files bundle into one zip.
    await editorStore.exportTargets(requests)
  } finally {
    exporting.value = false
  }
}

async function updatePreview() {
  const version = ++previewVersion
  if (retainedActivity?.value === false || !showPreview.value) {
    previewBlob.value = null
    return
  }

  const ids =
    activeTarget.value === 'selection'
      ? [...editorStore.state.selectedIds]
      : editorStore.graph.getChildren(editorStore.state.currentPageId).map((n) => n.id)

  if (ids.length === 0) {
    previewBlob.value = null
    return
  }

  let maxW = 0
  for (const id of ids) {
    const node = editorStore.getNode(id)
    if (node) maxW = Math.max(maxW, node.width)
  }
  const scale = maxW > 0 ? Math.min(PREVIEW_WIDTH / maxW, 2) : 1
  const data = await editorStore.renderExportImage(ids, scale, 'PNG')
  if (version !== previewVersion) return
  previewBlob.value = data ? new Blob([data], { type: 'image/png' }) : null
}

const previewKey = computed(
  () =>
    `${activeTarget.value}:${editorStore.state.sceneVersion}:${editorStore.state.currentPageId}:${[
      ...editorStore.state.selectedIds
    ]
      .sort()
      .join(',')}`
)

watch(() => showPreview.value, updatePreview, { flush: 'post' })
watch(previewKey, updatePreview, { flush: 'post' })

// The page as a React app: exported, or its screens checked against their frames first.
const exportingApp = ref(false)
const checkingScreens = ref(false)
const noScreens = ref(false)
const screenReports = shallowRef<CodeCheckReport[] | null>(null)

function pageScope() {
  return { scope: 'page', pageId: editorStore.state.currentPageId } as const
}

async function exportApp() {
  exportingApp.value = true
  try {
    noScreens.value = (await editorStore.exportReactApp(pageScope())).status === 'empty'
  } finally {
    exportingApp.value = false
  }
}

async function checkScreens() {
  checkingScreens.value = true
  screenReports.value = null
  try {
    const outcome = await editorStore.checkReactAppScreens(pageScope())
    noScreens.value = outcome.status === 'empty'
    if (outcome.status === 'checked') screenReports.value = outcome.reports
  } finally {
    checkingScreens.value = false
  }
}

const matchingScreens = computed(
  () => screenReports.value?.filter((report) => report.pass).length ?? 0
)
const checkHeading = computed(() => {
  const total = screenReports.value?.length ?? 0
  return matchingScreens.value === total
    ? code.value.screensMatch(total)
    : code.value.screensDiffer({ matching: matchingScreens.value, total })
})

function screenStatus(report: CodeCheckReport) {
  if (report.pass) return code.value.screenMatches
  const issues =
    report.differences.length + report.responsive.filter((width) => width.scrollsBy > 0).length
  return issues > 0 ? code.value.screenDifferences(issues) : code.value.screenNotCompared
}

// A result describes the page as it was checked, so an edit or another page clears it.
watch(
  () => [editorStore.state.currentPageId, editorStore.state.sceneVersion],
  () => {
    if (checkingScreens.value) return
    screenReports.value = null
    noScreens.value = false
  }
)
</script>

<template>
  <PanelSection
    :label="panels.export"
    :empty="activeSettings.length === 0 && activeTarget !== 'page'"
  >
    <template #actions>
      <IconButton :label="panels.addExport" @click="addSetting">
        <icon-lucide-plus class="size-3.5" />
      </IconButton>
    </template>
    <p v-if="mixed" class="text-[11px] text-muted">
      {{ panels.mixed }}
    </p>

    <PanelItemRow
      v-for="(setting, index) in activeSettings"
      :key="`${targetIds.join(',')}:${index}`"
      data-property="exportSettings"
      :data-index="index"
    >
      <div v-if="formatSupportsScale(setting.format)" class="w-24 shrink-0">
        <ExportScaleInput
          :model-value="setting.scale"
          :presets="scales"
          :clamp="clampExportScale"
          :label="panels.exportScale"
          data-property="export-scale"
          @update:model-value="updateScale(index, $event)"
        />
      </div>
      <AppSelect
        :model-value="setting.format"
        :options="formatOptions"
        :label="panels.exportFormat"
        :ui="{ trigger: 'w-auto flex-1' }"
        data-property="export-format"
        @update:model-value="updateFormat(index, $event)"
      />
      <template #rail="{ removeClass }">
        <IconButton
          :label="panels.removeExport"
          :class="[removeClass, 'shrink-0']"
          @click="removeSetting(index)"
        >
          <icon-lucide-minus class="size-3.5" />
        </IconButton>
      </template>
    </PanelItemRow>

    <AppButton
      v-if="activeSettings.length > 0"
      color="primary"
      variant="solid"
      data-test-id="export-button"
      class="mt-1.5 w-full"
      :disabled="exporting"
      @click="doExport"
    >
      <span class="truncate">{{ panels.export }} {{ activeName }}</span>
    </AppButton>

    <Tip v-if="activeSettings.length > 0" :label="panels.toggleExportPreview">
      <button
        data-test-id="export-preview-toggle"
        class="mt-1 flex w-full cursor-pointer items-center gap-1 rounded border-none bg-transparent px-0 py-1 text-[11px] text-muted hover:text-surface"
        @click="showPreview = !showPreview"
      >
        <icon-lucide-chevron-down v-if="showPreview" class="size-3" />
        <icon-lucide-chevron-right v-else class="size-3" />
        {{ panels.exportPreview }}
      </button>
    </Tip>

    <div v-if="showPreview && previewURL" class="mt-1 overflow-hidden rounded border border-border">
      <img :src="previewURL" :class="['block w-full', CHECKERBOARD_BACKGROUND]" />
    </div>
    <div
      v-else-if="showPreview"
      class="mt-1 rounded border border-border px-3 py-2 text-[11px] text-muted"
    >
      {{ panels.exportRenderingPreview }}
    </div>

    <div v-if="activeTarget === 'page'" data-test-id="react-app-export" class="mt-1.5">
      <p class="mb-1 text-[11px] text-muted">{{ code.exportAsCode }}</p>
      <div class="flex flex-col gap-1">
        <AppButton variant="outline" class="w-full" :loading="exportingApp" @click="exportApp">
          <template #leading><icon-lucide-download /></template>
          <span class="truncate">{{ code.exportReactApp }}</span>
        </AppButton>
        <AppButton variant="ghost" class="w-full" :loading="checkingScreens" @click="checkScreens">
          <template #leading><icon-lucide-scan-eye /></template>
          <span class="truncate">
            {{ checkingScreens ? code.checkingScreens : code.checkScreens }}
          </span>
        </AppButton>
      </div>
      <AppAlert
        v-if="noScreens"
        class="mt-1.5"
        tone="warning"
        :heading="notifications.noScreensToExport"
      />
      <AppAlert
        v-else-if="screenReports"
        class="mt-1.5"
        :tone="matchingScreens === screenReports.length ? 'success' : 'warning'"
        :heading="checkHeading"
      >
        <ul class="flex flex-col gap-0.5">
          <li
            v-for="report in screenReports"
            :key="report.screen.id"
            class="flex min-w-0 items-baseline justify-between gap-2"
          >
            <span class="truncate">{{ report.screen.name }}</span>
            <span class="shrink-0 text-muted">{{ screenStatus(report) }}</span>
          </li>
        </ul>
      </AppAlert>
    </div>
  </PanelSection>
</template>
