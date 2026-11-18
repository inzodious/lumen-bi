/**
 * Notification bars under the ribbon (PBI's yellow message bar): missing cached data with
 * "Refresh from source / Use sample data / Dismiss", refresh errors, engine errors, and the
 * modeling workstream's "Now viewing as" banner.
 */
import { useApp } from '../state/store'
import { ViewAsBanner } from '../dialogs/modeling'
import { useShell } from './shellState'
import { NotificationBar } from './ui/Notify'
import { refreshAll, useSampleData } from './commands'

export function NoticeArea() {
  const notice = useShell((s) => s.dataNotice)
  const setNotice = useShell((s) => s.setDataNotice)
  const engineError = useApp((s) => s.engineError)
  const hasProject = useApp((s) => !!s.project)
  return (
    <div className="wbi-notices">
      <ViewAsBanner />
      {notice?.kind === 'noData' && (
        <NotificationBar
          kind="warning"
          onDismiss={() => setNotice(null)}
          actions={[
            { label: 'Refresh from source', primary: true, onClick: () => refreshAll(notice.tables) },
            { label: 'Use sample data', onClick: () => void useSampleData() },
            { label: 'Dismiss', onClick: () => setNotice(null) }
          ]}
        >
          <b>No data loaded.</b> This report has no cached data for {notice.tables.length} table{notice.tables.length === 1 ? '' : 's'}
          {notice.tables.length <= 4 ? ` (${notice.tables.join(', ')})` : ''}. Refresh from the source, or fill the tables with generated sample data to explore the report.
        </NotificationBar>
      )}
      {notice?.kind === 'refreshErrors' && (
        <NotificationBar kind="error" onDismiss={() => setNotice(null)} actions={[{ label: 'Use sample data', onClick: () => void useSampleData() }]}>
          <b>Refresh failed</b> for {notice.tables.join(', ')}. {notice.message}
        </NotificationBar>
      )}
      {hasProject && engineError && !engineError.includes('not implemented') && (
        <NotificationBar kind="error">
          <b>The query engine couldn't load this model.</b> {engineError}
        </NotificationBar>
      )}
    </div>
  )
}
