/**
 * Renders the shell dialog selected in useShell().dialog, plus the visual "Export data" dialog.
 * Mounted once by the App shell.
 */
import './dialogs.css'
import { useShell } from '../app/shellState'
import { GetDataDialog } from './getdata/GetDataDialog'
import { EnterDataDialog } from './getdata/EnterDataDialog'
import { RefreshDialog } from './RefreshDialog'
import { CustomizeThemeDialog } from './CustomizeThemeDialog'
import { OptionsDialog } from './OptionsDialog'
import { AboutDialog } from './AboutDialog'
import { PageSettingsDialog } from './PageSettingsDialog'
import { ExportDataDialog } from './ExportDataDialog'
import { DataSourceSettings } from '../views/powerquery/dialogs/SourceDialogs'

export function DialogsHost() {
  const dialog = useShell((s) => s.dialog)
  const openDialog = useShell((s) => s.openDialog)
  const close = () => openDialog(null)
  let body: React.ReactNode = null
  switch (dialog?.id) {
    case 'getData':
      body = <GetDataDialog key={dialog.source ?? 'all'} source={dialog.source} onClose={close} />
      break
    case 'enterData':
      body = <EnterDataDialog onClose={close} />
      break
    case 'refresh':
      body = <RefreshDialog key={(dialog.tables ?? []).join('|')} tables={dialog.tables} onClose={close} />
      break
    case 'customizeTheme':
      body = <CustomizeThemeDialog onClose={close} />
      break
    case 'options':
      body = <OptionsDialog section={dialog.section} onClose={close} />
      break
    case 'about':
      body = <AboutDialog onClose={close} />
      break
    case 'pageSettings':
      body = <PageSettingsDialog onClose={close} />
      break
    case 'dataSources':
      body = <DataSourceSettings onClose={close} />
      break
    default:
      // 'unsaved' is handled by commands.confirmDiscard via confirmDialog
      body = null
  }
  return (
    <>
      {body}
      <ExportDataDialog />
    </>
  )
}
