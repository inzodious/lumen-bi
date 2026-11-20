/**
 * Start screen ("Welcome to Lumen") shown at launch without a file: new blank report, open a file
 * or PBIP folder, try the sample, the template gallery (Gallery button), recent files, and the
 * "Show this screen on startup" option.
 */
import { DocumentAddRegular, FolderOpenRegular, DocumentArrowUpRegular, BeakerRegular, DismissRegular, DatabaseArrowRightRegular, GridRegular, ArrowLeftRegular } from '@fluentui/react-icons'
import { useState, type ReactElement } from 'react'
import { useShell } from './shellState'
import { useApp } from '../state/store'
import { APP_NAME, APP_TAGLINE } from './brand'
import { LumenLogo } from './Logo'
import { RecentList } from './RecentList'
import { Checkbox } from './ui/primitives'
import { cx } from './ui/cx'
import { blankProject, loadSampleProject, openFileDialog, openFolderDialog } from './commands'
import { TemplateGallery } from './TemplateGallery'

function Action({ icon, title, desc, onClick }: { icon: ReactElement; title: string; desc: string; onClick(): void }) {
  return (
    <button type="button" className="wbi-start__action" onClick={onClick}>
      <span className="wbi-start__action-icon">{icon}</span>
      <span className="wbi-start__action-text">
        <span className="wbi-start__action-title">{title}</span>
        <span className="wbi-start__action-desc">{desc}</span>
      </span>
    </button>
  )
}

export function StartScreen() {
  const close = () => useShell.getState().setStartScreen(false)
  const showOnStartup = useShell((s) => s.options.showStartScreen)
  const setOptions = useShell((s) => s.setOptions)
  const [gallery, setGallery] = useState(false)
  const blank = () => {
    useApp.getState().setProject(blankProject())
    close()
  }
  return (
    <div className="wbi-modal-backdrop is-dark wbi-start-backdrop">
      <div className={cx('wbi-start', gallery && 'wbi-start--gallery')} role="dialog" aria-label={`Welcome to ${APP_NAME}`}>
        {gallery ? null : (
          <aside className="wbi-start__brand">
            <LumenLogo size={72} />
            <div className="wbi-start__brand-name">{APP_NAME}</div>
            <div className="wbi-start__brand-tag">{APP_TAGLINE}</div>
            <div className="wbi-start__brand-foot">Opens .pbix · .pbit · .pbip (PBIR + TMDL) · .wbi</div>
          </aside>
        )}
        <section className="wbi-start__main">
          <button type="button" className="wbi-btn wbi-btn--icon wbi-start__close" aria-label="Close" onClick={close}>
            <DismissRegular fontSize={18} />
          </button>
          {gallery ? (
            <>
              <h1 className="wbi-start__title">
                <button type="button" className="wbi-btn wbi-btn--icon wbi-start__back" aria-label="Back" onClick={() => setGallery(false)}>
                  <ArrowLeftRegular fontSize={20} />
                </button>
                Gallery
                <span className="wbi-start__title-note">Start from a designed report with sample data, then swap in your own</span>
              </h1>
              <div className="wbi-start__gallery">
                <TemplateGallery />
              </div>
            </>
          ) : (
            <>
              <h1 className="wbi-start__title">Welcome to {APP_NAME}</h1>
              <div className="wbi-start__actions">
                <Action icon={<DocumentAddRegular fontSize={28} />} title="Blank report" desc="Start a new report from scratch" onClick={blank} />
                <Action icon={<FolderOpenRegular fontSize={28} />} title="Open a file" desc=".pbix, .pbit, .pbip or .wbi" onClick={() => void openFileDialog()} />
                <Action icon={<DocumentArrowUpRegular fontSize={28} />} title="Open a folder" desc="A PBIP project, .Report or .SemanticModel" onClick={() => void openFolderDialog()} />
                <Action
                  icon={<DatabaseArrowRightRegular fontSize={28} />}
                  title="Get data"
                  desc="Excel, CSV, Parquet, SQL, Web…"
                  onClick={() => {
                    blank()
                    useShell.getState().openDialog({ id: 'getData' })
                  }}
                />
                <Action icon={<BeakerRegular fontSize={28} />} title="Try a sample" desc="Explore a ready-made sales report" onClick={() => void loadSampleProject()} />
                <Action icon={<GridRegular fontSize={28} />} title="Gallery" desc="Start from a designed report template" onClick={() => setGallery(true)} />
              </div>
              <h2 className="wbi-start__subtitle">Recent</h2>
              <div className="wbi-start__recent">
                <RecentList limit={8} />
              </div>
            </>
          )}
          <div className="wbi-start__foot">
            <Checkbox checked={showOnStartup} onChange={(v) => setOptions({ showStartScreen: v })} label="Show this screen on startup" />
          </div>
        </section>
      </div>
    </div>
  )
}
