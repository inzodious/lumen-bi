/**
 * File backstage (PBI Desktop "File" view): full-window overlay with a left command column
 * (Home, New, Open, Save, Save as, Export, Options and settings, About, Close) and content pages.
 */
import type { ReactElement, ReactNode } from 'react'
import {
  ArrowLeftRegular, HomeRegular, DocumentAddRegular, FolderOpenRegular, SaveRegular, SaveEditRegular, ArrowExportUpRegular, SettingsRegular, InfoRegular,
  DismissCircleRegular, DocumentPdfRegular, SlideTextRegular, ImageMultipleRegular, CodeRegular, FolderZipRegular, ArchiveRegular, DocumentArrowUpRegular,
  BeakerRegular, DatabaseArrowRightRegular, ShieldKeyholeRegular
} from '@fluentui/react-icons'
import { useApp } from '../../state/store'
import { useShell, type BackstagePage } from '../shellState'
import { APP_NAME } from '../brand'
import { LumenLogo } from '../Logo'
import { RecentList } from '../RecentList'
import { cx } from '../ui/cx'
import { closeProject, loadSampleProject, newReport, openFileDialog, openFolderDialog, save, saveAs } from '../commands'
import { openExportDialog } from '../../export'

interface NavItem {
  page?: BackstagePage
  label: string
  icon: ReactElement
  action?(): void
  needsProject?: boolean
}

export function Backstage() {
  const page = useShell((s) => s.backstage) ?? 'home'
  const open = useShell((s) => s.openBackstage)
  const hasProject = useApp((s) => !!s.project)
  const close = () => open(null)
  const run = (f: () => unknown) => () => {
    close()
    void f()
  }
  const nav: Array<NavItem | 'sep'> = [
    { page: 'home', label: 'Home', icon: <HomeRegular fontSize={20} /> },
    { page: 'new', label: 'New', icon: <DocumentAddRegular fontSize={20} /> },
    { page: 'open', label: 'Open', icon: <FolderOpenRegular fontSize={20} /> },
    { label: 'Save', icon: <SaveRegular fontSize={20} />, action: run(save), needsProject: true },
    { page: 'saveAs', label: 'Save as', icon: <SaveEditRegular fontSize={20} />, needsProject: true },
    'sep',
    { page: 'export', label: 'Export', icon: <ArrowExportUpRegular fontSize={20} />, needsProject: true },
    'sep',
    { page: 'options', label: 'Options and settings', icon: <SettingsRegular fontSize={20} /> },
    { page: 'about', label: 'About', icon: <InfoRegular fontSize={20} /> },
    { label: 'Close', icon: <DismissCircleRegular fontSize={20} />, action: run(closeProject), needsProject: true }
  ]
  return (
    <div className="wbi-backstage" role="dialog" aria-label="File">
      <nav className="wbi-backstage__nav">
        <button type="button" className="wbi-backstage__back" aria-label="Back" onClick={close}>
          <ArrowLeftRegular fontSize={20} />
        </button>
        {nav.map((n, i) =>
          n === 'sep' ? (
            <div key={`s${i}`} className="wbi-backstage__sep" />
          ) : (
            <button
              key={n.label}
              type="button"
              disabled={n.needsProject && !hasProject}
              className={cx('wbi-backstage__item', n.page === page && 'is-active')}
              onClick={() => (n.action ? n.action() : n.page && open(n.page))}
            >
              {n.icon}
              <span>{n.label}</span>
            </button>
          )
        )}
      </nav>
      <div className="wbi-backstage__content">
        {page === 'home' && <HomePage run={run} />}
        {page === 'new' && <NewPage run={run} />}
        {page === 'open' && <OpenPage run={run} />}
        {page === 'saveAs' && <SaveAsPage run={run} />}
        {page === 'export' && <ExportPage run={run} />}
        {page === 'options' && <OptionsPage />}
        {page === 'about' && <AboutPage />}
      </div>
    </div>
  )
}

type Run = (f: () => unknown) => () => void

function Tile({ icon, title, desc, onClick, disabled }: { icon: ReactElement; title: string; desc?: string; onClick(): void; disabled?: boolean }) {
  return (
    <button type="button" className="wbi-bs-tile" onClick={onClick} disabled={disabled}>
      <span className="wbi-bs-tile__icon">{icon}</span>
      <span className="wbi-bs-tile__text">
        <span className="wbi-bs-tile__title">{title}</span>
        {desc && <span className="wbi-bs-tile__desc">{desc}</span>}
      </span>
    </button>
  )
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wbi-bs-page">
      <h1 className="wbi-bs-page__title">{title}</h1>
      {children}
    </div>
  )
}

function HomePage({ run }: { run: Run }) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  return (
    <Page title={greeting}>
      <div className="wbi-bs-tiles">
        <Tile icon={<DocumentAddRegular fontSize={32} />} title="Blank report" desc="Start from scratch" onClick={run(newReport)} />
        <Tile icon={<BeakerRegular fontSize={32} />} title="Sample report" desc="Explore sample sales data" onClick={run(loadSampleProject)} />
        <Tile
          icon={<DatabaseArrowRightRegular fontSize={32} />}
          title="Get data"
          desc="Connect to files and databases"
          onClick={run(async () => {
            if (!useApp.getState().project) await newReport()
            useShell.getState().openDialog({ id: 'getData' })
          })}
        />
      </div>
      <h2 className="wbi-bs-page__subtitle">Recent</h2>
      <RecentList limit={15} />
    </Page>
  )
}

function NewPage({ run }: { run: Run }) {
  return (
    <Page title="New">
      <div className="wbi-bs-tiles">
        <Tile icon={<DocumentAddRegular fontSize={32} />} title="Blank report" onClick={run(newReport)} />
        <Tile icon={<BeakerRegular fontSize={32} />} title="Sample report" desc="Sales overview with sample data" onClick={run(loadSampleProject)} />
      </div>
    </Page>
  )
}

function OpenPage({ run }: { run: Run }) {
  return (
    <Page title="Open">
      <div className="wbi-bs-tiles">
        <Tile icon={<FolderOpenRegular fontSize={32} />} title="Browse this device" desc=".pbix · .pbit · .pbip · .wbi" onClick={run(openFileDialog)} />
        <Tile icon={<DocumentArrowUpRegular fontSize={32} />} title="Open a folder" desc="PBIP project, .Report or .SemanticModel folder" onClick={run(openFolderDialog)} />
      </div>
      <h2 className="wbi-bs-page__subtitle">Recent</h2>
      <RecentList limit={20} />
    </Page>
  )
}

function SaveAsPage({ run }: { run: Run }) {
  const project = useApp((s) => s.project)
  const fromPbix = project?.source.kind === 'pbix' || project?.source.kind === 'pbit'
  return (
    <Page title="Save as">
      {fromPbix && <p className="wbi-bs-note">Saving a .pbix keeps the file's data model when Lumen can (experimental: not yet verified in Power BI Desktop). A Power BI project (PBIP) or a {APP_NAME} bundle always works.</p>}
      <div className="wbi-bs-list">
        <Tile icon={<FolderZipRegular fontSize={32} />} title="Power BI project (.pbip)" desc="Report (PBIR) + semantic model (TMDL) folders — opens in Power BI Desktop, works with Git" onClick={run(() => saveAs('pbip'))} />
        <Tile icon={<ArchiveRegular fontSize={32} />} title={`${APP_NAME} bundle (.wbi)`} desc="Single file: the PBIP project plus the cached data, so it opens without a refresh" onClick={run(() => saveAs('wbi'))} />
        <Tile icon={<ArchiveRegular fontSize={32} />} title="Power BI file (.pbix)" desc="Experimental: the report with its data model and the data loaded now; not yet verified in Power BI Desktop" onClick={run(() => saveAs('pbix'))} />
        <Tile icon={<DocumentAddRegular fontSize={32} />} title="Power BI template (.pbit)" desc="Experimental: model and report without data; Power BI loads the data from your sources when it opens the file" onClick={run(() => saveAs('pbit'))} />
      </div>
    </Page>
  )
}

function ExportPage({ run }: { run: Run }) {
  // each page-based export opens the page selection dialog (dialogs/ExportPagesDialog.tsx)
  return (
    <Page title="Export">
      <div className="wbi-bs-list">
        <Tile icon={<DocumentPdfRegular fontSize={32} />} title="Export to PDF" desc="Choose the pages, hidden pages included; one PDF page per report page, at the report page size" onClick={run(() => openExportDialog('pdf'))} />
        <Tile icon={<SlideTextRegular fontSize={32} />} title="Export to PowerPoint" desc="Choose the pages; one slide per page with the page image, filters listed in the notes" onClick={run(() => openExportDialog('pptx'))} />
        <Tile icon={<ImageMultipleRegular fontSize={32} />} title="Export pages as images" desc="Choose the pages and the resolution; one PNG per page into a folder" onClick={run(() => openExportDialog('png'))} />
        <Tile icon={<CodeRegular fontSize={32} />} title="Export to HTML" desc="Choose the pages; a single self-contained web page with page navigation" onClick={run(() => openExportDialog('html'))} />
        <Tile icon={<FolderZipRegular fontSize={32} />} title="Power BI project (.pbip)" desc="Save a copy as PBIR + TMDL folders" onClick={run(() => saveAs('pbip'))} />
      </div>
    </Page>
  )
}

function OptionsPage() {
  const openDialog = useShell((s) => s.openDialog)
  return (
    <Page title="Options and settings">
      <div className="wbi-bs-list">
        <Tile icon={<SettingsRegular fontSize={32} />} title="Options" desc="Data load, regional settings, report settings, sample data" onClick={() => openDialog({ id: 'options' })} />
        <Tile icon={<ShieldKeyholeRegular fontSize={32} />} title="Data source settings" desc="Authentication for SQL / Fabric endpoints" onClick={() => openDialog({ id: 'dataSources' })} />
      </div>
    </Page>
  )
}

function AboutPage() {
  const openDialog = useShell((s) => s.openDialog)
  const version = window.wbi?.app.version ?? '0.1.0'
  return (
    <Page title="About">
      <div className="wbi-bs-about">
        <LumenLogo size={64} />
        <div>
          <div className="wbi-bs-about__name">{APP_NAME}</div>
          <div className="wbi-muted">Version {version}</div>
          <p style={{ maxWidth: 520, lineHeight: '20px' }}>
            A Linux-native workbench for Power BI reports and semantic models: PBIX / PBIP files, DAX and Power Query engines, modeling, and rich export. Not affiliated with Microsoft.
          </p>
          <button type="button" className="wbi-link" onClick={() => openDialog({ id: 'about' })}>
            Credits and versions
          </button>
        </div>
      </div>
    </Page>
  )
}
