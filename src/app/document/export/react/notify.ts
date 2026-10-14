import { notificationMessages } from '@/app/i18n/notifications'
import { toast } from '@/app/shell/ui'

import type { createReactAppExportActions, ReactAppScope } from './actions'

type ReactAppExporter = Pick<ReturnType<typeof createReactAppExportActions>, 'exportReactApp'>

/**
 * Exports a React app from a menu, which has no panel to say that no frame made a screen, so a
 * toast says it; a failure reaches the global error toast.
 */
export async function exportReactAppFromMenu(store: ReactAppExporter, scope: ReactAppScope) {
  const outcome = await store.exportReactApp(scope)
  if (outcome.status === 'empty') toast.warning(notificationMessages.get().noScreensToExport)
}
