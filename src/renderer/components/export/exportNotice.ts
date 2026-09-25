import { notify } from '@renderer/lib/notify'
import { revealInFolder } from '@renderer/lib/api/system'

// Completion of a written export, as the mock's toast: the path is the
// subtitle and Show in folder the one action. That action is the only route
// back to the file from here, so a failed reveal raises its own error rather
// than failing silently.
export function notifyExportWritten(title: string, description: string, filePath: string): void {
  notify.success(title, {
    description,
    action: {
      label: 'Show in folder',
      onClick: () => {
        revealInFolder(filePath).catch((err: unknown) => {
          notify.error("Couldn't show the file in its folder.", { cause: err })
        })
      }
    }
  })
}
