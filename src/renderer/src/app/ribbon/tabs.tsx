/**
 * Standard Power BI Desktop ribbon tabs: Home, Insert, Modeling, View, Optimize, Help, plus the
 * contextual "Format" and "Data / drill" tabs shown while a visual is selected in report view.
 * (Table / Column / Measure tools are registered by the modeling workstream.)
 */
import type { ReactElement } from 'react'
import {
  ClipboardPasteRegular, CutRegular, CopyRegular, PaintBrushRegular, DatabaseArrowRightRegular, DocumentTableRegular, DatabaseRegular, TableAddRegular,
  ArrowSyncRegular, DataBarVerticalAddRegular, TextFieldRegular, CalculatorRegular, CalculatorArrowClockwiseRegular, ShareRegular, SlideAddRegular, ImageRegular, IconsRegular,
  ShapesRegular, ButtonRegular, OrganizationRegular, BranchRegular, OptionsRegular, PersonSquareRegular, ColorRegular, PageFitRegular, ArrowAutofitWidthRegular,
  RatioOneToOneRegular, FilterRegular, BookmarkRegular, LayerRegular, TimerRegular, QuestionCircleRegular, InfoRegular, LightbulbRegular, PeopleCommunityRegular,
  BookOpenRegular, ArrowUpRegular, ArrowDownRegular, AlignLeftRegular, GroupRegular, ArrowForwardRegular, PauseRegular, PlayRegular, DataTrendingRegular,
  SparkleRegular, MathFormulaRegular, TableSearchRegular, ArrowStepInRegular, ArrowStepOutRegular, ArrowStepInRightRegular, ChevronDoubleDownRegular,
  TableSimpleRegular, FullScreenMaximizeRegular, DocumentArrowRightRegular, GlobeRegular, FolderRegular, DocumentTextRegular, TableEditRegular, ShieldPersonRegular,
  ArrowRepeatAllRegular, BranchForkRegular, ArrowSyncCircleRegular, CheckboxCheckedRegular, CheckboxUncheckedRegular, EyeRegular, CloudArrowUpRegular, CodeRegular,
  AlignCenterHorizontalRegular, AlignRightRegular, AlignTopRegular, AlignCenterVerticalRegular, AlignBottomRegular, AlignSpaceEvenlyHorizontalRegular,
  AlignSpaceEvenlyVerticalRegular, KeyRegular, GridRegular, LayoutColumnTwoRegular, ArrowExportRegular,
  BeakerRegular
} from '@fluentui/react-icons'
import type { FluentIcon } from '@fluentui/react-icons'
import { useApp } from '../../state/store'
import { useInteraction } from '../../state/interaction'
import { exportVisualDataOf, canExportVisualData, useCanvasPrefs, SPACING_PRESETS, LAYOUT_PRESETS, distributeSelectionWithGap, tidyUpSelection, matchSizeSelection, alignSelection, distributeSelection, arrangeSelection, groupSelection, ungroupSelection, copySelection, cutSelection, pasteClipboard, hasClipboard } from '../../report'
import { currentLayoutGuides, setLayoutGuides, useLayoutGuides } from '../../report/layoutGuides'
import { findPage, findVisual, isGroup } from '../../report/pbir'
import { getVisual } from '../../visuals/registry'
import { useShell, type PaneId } from '../shellState'
import { registerRibbonTab } from './registry'
import { RibbonButton, RibbonGroup, RibbonStack, RibbonGallery } from './Ribbon'
import type { MenuItem } from '../ui/Menu'
import { promptDialog } from '../ui/Modal'
import { BUILTIN_THEMES, ThemeSwatch, applyTheme, currentThemeName, importThemeFile, saveCurrentTheme } from '../themes'
import { insertButton, insertIcon, insertImage, insertShape, insertTextBox, insertVisual, newPage, refreshAll, runModelingCommand, type ShapeKind, type ButtonKind } from '../commands'
import { duplicatePage } from '../../report/editOps'
import { MobileRibbonGroup } from '../../report/mobile'
import { toggleFormatPainter, useFormatPainter } from '../../report/formatPainter'
import { seedDrillState } from '../../report/host'
import { drillStateKey } from '../../state/interaction'
import { reportSampleDataOn } from '@core/sample/spec'
import { toggleSampleData } from '../../report/sampleActions'

const L = (I: FluentIcon, cls?: string) => <I fontSize={32} className={cls} />
const S = (I: FluentIcon, cls?: string) => <I fontSize={16} className={cls} />

const shell = () => useShell.getState()
const app = () => useApp.getState()

function useHasReport(): boolean {
  return useApp((s) => !!s.project?.report)
}
function useHasProject(): boolean {
  return useApp((s) => !!s.project)
}
function useHasSelection(): boolean {
  return useApp((s) => s.selectedVisuals.length > 0)
}

const getDataMenu = (): MenuItem[] => [
  { header: 'Common data sources' },
  { label: 'Excel workbook', icon: S(DocumentTableRegular), onClick: () => shell().openDialog({ id: 'getData', source: 'excel' }) },
  { label: 'Text/CSV', icon: S(DocumentTextRegular), onClick: () => shell().openDialog({ id: 'getData', source: 'csv' }) },
  { label: 'Parquet', icon: S(DocumentTextRegular), onClick: () => shell().openDialog({ id: 'getData', source: 'parquet' }) },
  { label: 'JSON', icon: S(CodeRegular), onClick: () => shell().openDialog({ id: 'getData', source: 'json' }) },
  { label: 'Folder', icon: S(FolderRegular), onClick: () => shell().openDialog({ id: 'getData', source: 'folder' }) },
  { label: 'SQL Server', icon: S(DatabaseRegular), onClick: () => shell().openDialog({ id: 'getData', source: 'sql' }) },
  { label: 'Fabric SQL analytics endpoint', icon: S(DatabaseArrowRightRegular), onClick: () => shell().openDialog({ id: 'getData', source: 'fabric' }) },
  { label: 'Web', icon: S(GlobeRegular), onClick: () => shell().openDialog({ id: 'getData', source: 'web' }) },
  { label: 'Blank query', icon: S(DocumentTextRegular), onClick: () => shell().openDialog({ id: 'getData', source: 'blank' }) },
  { label: 'Enter data', icon: S(TableAddRegular), onClick: () => shell().openDialog({ id: 'enterData' }) },
  { separator: true },
  { label: 'More…', onClick: () => shell().openDialog({ id: 'getData' }) }
]

const SHAPES: Array<{ kind: ShapeKind; label: string }> = [
  { kind: 'rectangle', label: 'Rectangle' },
  { kind: 'rectangleRounded', label: 'Rounded rectangle' },
  { kind: 'oval', label: 'Oval' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'line', label: 'Line' },
  { kind: 'arrow', label: 'Arrow' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'octagon', label: 'Octagon' },
  { kind: 'chevron', label: 'Chevron' },
  { kind: 'pentagonArrow', label: 'Pentagon arrow' },
  { kind: 'heart', label: 'Heart' },
  { kind: 'speechBubble', label: 'Speech bubble' },
  { kind: 'tab', label: 'Tab' }
]

const BUTTONS: Array<{ kind: ButtonKind; label: string }> = [
  { kind: 'Back', label: 'Left arrow' },
  { kind: 'PageNavigation', label: 'Right arrow' },
  { kind: 'Information', label: 'Information' },
  { kind: 'Help', label: 'Help' },
  { kind: 'Q&A', label: 'Q&A' },
  { kind: 'Bookmark', label: 'Bookmark' },
  { kind: 'Blank', label: 'Blank' },
  { kind: 'Navigator', label: 'Page navigator' }
]

function FormatPainterButton() {
  const armed = useFormatPainter((s) => !!s.format)
  const single = useApp((s) => s.selectedVisuals.length === 1 && s.editMode)
  return (
    <RibbonButton
      size="small"
      label="Format painter"
      icon={S(PaintBrushRegular)}
      checked={armed}
      disabled={!armed && !single}
      onClick={toggleFormatPainter}
      tooltip="Copy the formatting of the selected visual, then click another visual to apply it. Esc cancels."
    />
  )
}

function ClipboardGroup() {
  const hasSel = useHasSelection()
  return (
    <RibbonGroup label="Clipboard">
      <RibbonButton label="Paste" icon={L(ClipboardPasteRegular)} shortcut="Ctrl+V" disabled={!hasClipboard()} onClick={() => pasteClipboard()} />
      <RibbonStack>
        <RibbonButton size="small" label="Cut" icon={S(CutRegular)} shortcut="Ctrl+X" disabled={!hasSel} onClick={() => cutSelection()} />
        <RibbonButton size="small" label="Copy" icon={S(CopyRegular)} shortcut="Ctrl+C" disabled={!hasSel} onClick={() => copySelection()} />
        <FormatPainterButton />
      </RibbonStack>
    </RibbonGroup>
  )
}

function DataGroup() {
  return (
    <RibbonGroup label="Data">
      <RibbonButton label="Get data" icon={L(DatabaseArrowRightRegular, 'wbi-ico-accent')} onClick={() => shell().openDialog({ id: 'getData' })} menu={getDataMenu} tooltip="Get data from a wide range of data sources." />
      <RibbonButton label="Excel workbook" icon={L(DocumentTableRegular, 'wbi-ico-excel')} onClick={() => shell().openDialog({ id: 'getData', source: 'excel' })} />
      <RibbonButton label="SQL Server" icon={L(DatabaseRegular)} onClick={() => shell().openDialog({ id: 'getData', source: 'sql' })} />
      <RibbonButton label="Enter data" icon={L(TableAddRegular)} onClick={() => shell().openDialog({ id: 'enterData' })} tooltip="Create a new table by typing or pasting data." />
    </RibbonGroup>
  )
}

function QueriesGroup() {
  const hasProject = useHasProject()
  return (
    <RibbonGroup label="Queries">
      <RibbonButton
        label="Transform data"
        icon={L(TableEditRegular)}
        disabled={!hasProject}
        onClick={() => app().setView('powerquery')}
        menu={[
          { label: 'Transform data', onClick: () => app().setView('powerquery') },
          { label: 'Data source settings', onClick: () => shell().openDialog({ id: 'dataSources' }) },
          { label: 'Edit parameters', onClick: () => app().setView('powerquery') }
        ]}
        tooltip="Open the Power Query editor to transform data."
      />
      <RibbonButton label="Refresh" icon={L(ArrowSyncRegular)} disabled={!hasProject} onClick={() => refreshAll()} tooltip="Refresh all data from the sources." />
    </RibbonGroup>
  )
}

function InsertGroupHome() {
  return (
    <RibbonGroup label="Insert">
      <RibbonButton label="New visual" icon={L(DataBarVerticalAddRegular)} onClick={() => insertVisual('clusteredColumnChart')} />
      <RibbonButton label="Text box" icon={L(TextFieldRegular)} onClick={insertTextBox} />
      <RibbonButton label="More visuals" icon={L(DataTrendingRegular)} menu={() => visualMenu()} />
    </RibbonGroup>
  )
}

function visualMenu(): MenuItem[] {
  const types: Array<[string, string]> = [
    ['clusteredBarChart', 'Clustered bar chart'],
    ['clusteredColumnChart', 'Clustered column chart'],
    ['lineChart', 'Line chart'],
    ['areaChart', 'Area chart'],
    ['pieChart', 'Pie chart'],
    ['donutChart', 'Donut chart'],
    ['scatterChart', 'Scatter chart'],
    ['tableEx', 'Table'],
    ['pivotTable', 'Matrix'],
    ['cardVisual', 'Card'],
    ['slicer', 'Slicer'],
    ['map', 'Map']
  ]
  return types.map(([t, label]) => ({ label: getVisual(t)?.displayName ?? label, onClick: () => insertVisual(t) }))
}

function CalculationsGroup({ withColumnTable }: { withColumnTable?: boolean }) {
  const hasProject = useHasProject()
  return (
    <RibbonGroup label="Calculations">
      <RibbonButton label="New measure" icon={L(CalculatorRegular)} disabled={!hasProject} onClick={() => void runModelingCommand('newMeasure')} />
      <RibbonButton label="Quick measure" icon={L(CalculatorArrowClockwiseRegular)} disabled={!hasProject} onClick={() => void runModelingCommand('quickMeasure')} />
      {withColumnTable && (
        <>
          <RibbonButton label="New column" icon={L(MathFormulaRegular)} disabled={!hasProject} onClick={() => void runModelingCommand('newColumn')} />
          <RibbonButton label="New table" icon={L(TableSimpleRegular)} disabled={!hasProject} onClick={() => void runModelingCommand('newTable')} />
        </>
      )}
    </RibbonGroup>
  )
}

function ShareGroup() {
  return (
    <RibbonGroup label="Share">
      <RibbonButton label="Publish" icon={L(CloudArrowUpRegular)} disabled tooltip="Publishing to the Power BI service isn't available in Lumen. Save as PBIP and use Fabric Git integration instead." />
    </RibbonGroup>
  )
}

function HomeTab() {
  const view = useApp((s) => s.view)
  return (
    <>
      <ClipboardGroup />
      <DataGroup />
      <QueriesGroup />
      {view === 'report' && <InsertGroupHome />}
      <CalculationsGroup withColumnTable={view !== 'report'} />
      {view === 'model' && <RelationshipsGroup />}
      <ShareGroup />
    </>
  )
}

function InsertTab() {
  const hasReport = useHasReport()
  return (
    <>
      <RibbonGroup label="Pages">
        <RibbonButton
          label="New page"
          icon={L(SlideAddRegular)}
          onClick={newPage}
          menu={[
            { label: 'Blank page', onClick: newPage },
            {
              label: 'Duplicate page',
              disabled: !hasReport,
              onClick: () => {
                const cur = app().activePage
                if (!cur) return
                let dup: string | undefined
                app().mutateReport('Duplicate page', (r) => {
                  dup = duplicatePage(r, cur)
                })
                if (dup) app().setActivePage(dup)
              }
            }
          ]}
        />
      </RibbonGroup>
      <RibbonGroup label="Visuals">
        <RibbonButton label="New visual" icon={L(DataBarVerticalAddRegular)} onClick={() => insertVisual('clusteredColumnChart')} />
        <RibbonButton label="More visuals" icon={L(DataTrendingRegular)} menu={() => visualMenu()} />
      </RibbonGroup>
      <RibbonGroup label="AI visuals">
        <RibbonButton label="Key influencers" icon={L(LightbulbRegular)} onClick={() => insertVisual('keyDriversVisual')} />
        <RibbonButton label="Decomposition tree" icon={L(BranchForkRegular)} onClick={() => insertVisual('decompositionTreeVisual')} />
        <RibbonButton label="Q&A" icon={L(QuestionCircleRegular)} onClick={() => insertVisual('qnaVisual')} />
        <RibbonButton label="Narrative" icon={L(SparkleRegular)} onClick={() => insertVisual('scriptVisual')} disabled tooltip="Smart narrative isn't available in Lumen." />
      </RibbonGroup>
      <RibbonGroup label="Elements">
        <RibbonButton label="Text box" icon={L(TextFieldRegular)} onClick={insertTextBox} />
        <RibbonButton label="Buttons" icon={L(ButtonRegular)} menu={BUTTONS.map((b) => ({ label: b.label, onClick: () => insertButton(b.kind) }))} />
        <RibbonButton label="Shapes" icon={L(ShapesRegular)} menu={SHAPES.map((s) => ({ label: s.label, onClick: () => insertShape(s.kind) }))} />
        <RibbonButton
          label="Image"
          icon={L(ImageRegular)}
          onClick={() => void insertImage()}
          menu={[
            { label: 'Image from file…', onClick: () => void insertImage() },
            { label: 'Icon…', onClick: () => void insertIcon() }
          ]}
        />
        <RibbonButton label="Icon" icon={L(IconsRegular)} onClick={() => void insertIcon()} tooltip="Insert an icon (Lucide or Fluent Color) as an image." />
      </RibbonGroup>
    </>
  )
}

function RelationshipsGroup() {
  const hasProject = useHasProject()
  return (
    <RibbonGroup label="Relationships">
      <RibbonButton label="Manage relationships" icon={L(OrganizationRegular)} disabled={!hasProject} onClick={() => void runModelingCommand('manageRelationships')} />
    </RibbonGroup>
  )
}

function ModelingTab() {
  const hasProject = useHasProject()
  return (
    <>
      <RelationshipsGroup />
      <CalculationsGroup withColumnTable />
      <RibbonGroup label="Parameters">
        <RibbonButton
          label="New parameter"
          icon={L(OptionsRegular)}
          disabled={!hasProject}
          menu={[
            { label: 'Numeric range', onClick: () => void runModelingCommand('newParameter') },
            { label: 'Fields', onClick: () => void runModelingCommand('newFieldParameter') }
          ]}
        />
      </RibbonGroup>
      <RibbonGroup label="Calculation groups">
        <RibbonButton label="Calculation group" icon={L(BranchRegular)} disabled={!hasProject} onClick={() => void runModelingCommand('newCalculationGroup')} />
      </RibbonGroup>
      <RibbonGroup label="Security">
        <RibbonButton label="Manage roles" icon={L(ShieldPersonRegular)} disabled={!hasProject} onClick={() => void runModelingCommand('manageRoles')} />
        <RibbonButton label="View as" icon={L(PersonSquareRegular)} disabled={!hasProject} onClick={() => void runModelingCommand('viewAsRoles')} />
      </RibbonGroup>
      <RibbonGroup label="Date table">
        <RibbonButton label="Mark as date table" icon={L(KeyRegular)} disabled={!hasProject} onClick={() => void runModelingCommand('markAsDateTable', app().selectedField?.table)} />
      </RibbonGroup>
    </>
  )
}

function ThemesGroup() {
  const themeName = useApp((s) => s.theme.name)
  const hasReport = useHasReport()
  const current = hasReport ? currentThemeName() : 'Default'
  return (
    <RibbonGroup label="Themes" className="wbi-rgroup--themes">
      <RibbonGallery
        items={BUILTIN_THEMES}
        visibleCount={4}
        columns={4}
        isSelected={(t) => t.name === current || (!t.json && current === 'Default') || t.name === themeName}
        renderItem={(t) => <ThemeSwatch theme={t} title={t.name} />}
        onPick={(t) => applyTheme(t.json ? t : null)}
        footer={[
          { label: 'Browse for themes', onClick: () => void importThemeFile() },
          { label: 'Customize current theme', disabled: !hasReport, onClick: () => shell().openDialog({ id: 'customizeTheme' }) },
          { label: 'Save current theme', disabled: !hasReport, onClick: () => void saveCurrentTheme() }
        ]}
      />
    </RibbonGroup>
  )
}

function PaneToggle({ id, label, icon }: { id: PaneId; label: string; icon: ReactElement }) {
  const open = useShell((s) => s.panes[id].open)
  return <RibbonButton label={label} icon={icon} checked={open} onClick={() => shell().togglePane(id)} />
}

function ViewTab() {
  const pageView = useApp((s) => s.pageView)
  const sampleOn = useApp((s) => reportSampleDataOn(s.project?.report?.report))
  const hasReport = useApp((s) => !!s.project?.report)
  const prefs = useCanvasPrefs()
  const editMode = useApp((s) => s.editMode)
  const pv = pageView ?? 'fitToPage'
  return (
    <>
      <ThemesGroup />
      <RibbonGroup label="Scale to fit">
        <RibbonButton
          label="Page view"
          icon={L(PageFitRegular)}
          menu={[
            { label: 'Fit to page', icon: S(PageFitRegular), checked: pv === 'fitToPage', onClick: () => app().setPageView('fitToPage') },
            { label: 'Fit to width', icon: S(ArrowAutofitWidthRegular), checked: pv === 'fitToWidth', onClick: () => app().setPageView('fitToWidth') },
            { label: 'Actual size', icon: S(RatioOneToOneRegular), checked: pv === 'actualSize', onClick: () => app().setPageView('actualSize') }
          ]}
        />
      </RibbonGroup>
      <MobileRibbonGroup />
      <RibbonGroup label="Page options">
        <RibbonStack>
          <RibbonButton size="small" label="Gridlines" icon={S(prefs.showGridlines ? CheckboxCheckedRegular : CheckboxUncheckedRegular)} onClick={() => prefs.set({ showGridlines: !prefs.showGridlines })} />
          <RibbonButton size="small" label="Snap to grid" icon={S(prefs.snapToGrid ? CheckboxCheckedRegular : CheckboxUncheckedRegular)} onClick={() => prefs.set({ snapToGrid: !prefs.snapToGrid })} />
          <RibbonButton size="small" label="Lock objects" icon={S(prefs.lockObjects ? CheckboxCheckedRegular : CheckboxUncheckedRegular)} onClick={() => prefs.set({ lockObjects: !prefs.lockObjects })} />
        </RibbonStack>
      </RibbonGroup>
      <LayoutGuidesGroup />
      <RibbonGroup label="Sample data">
        <RibbonButton
          label="Sample data"
          icon={L(BeakerRegular)}
          checked={sampleOn}
          disabled={!hasReport}
          onClick={toggleSampleData}
          tooltip="Draw realistic sample data on visuals that have no fields yet, for quick mockups. Drop fields into a visual to replace its sample. Sample data is never part of the model or of what Power BI opens."
        />
      </RibbonGroup>
      <RibbonGroup label="Show panes">
        <PaneToggle id="filters" label="Filters" icon={L(FilterRegular)} />
        <PaneToggle id="bookmarks" label="Bookmarks" icon={L(BookmarkRegular)} />
        <PaneToggle id="selection" label="Selection" icon={L(LayerRegular)} />
        <PaneToggle id="performance" label="Performance analyzer" icon={L(TimerRegular)} />
        <PaneToggle id="syncSlicers" label="Sync slicers" icon={L(ArrowSyncCircleRegular)} />
      </RibbonGroup>
      <RibbonGroup label="Reading view">
        <RibbonButton label={editMode ? 'Reading view' : 'Edit report'} icon={L(editMode ? EyeRegular : TableEditRegular)} checked={!editMode} onClick={() => app().setEditMode(!editMode)} tooltip="Switch between editing and reading the report (hidden pages, locked filters and view-mode behavior)." />
      </RibbonGroup>
    </>
  )
}

function OptimizeTab() {
  const recording = useShell((s) => s.perfRecording)
  return (
    <>
      <RibbonGroup label="Visuals">
        <RibbonButton label="Refresh visuals" icon={L(ArrowRepeatAllRegular)} onClick={() => app().dataChanged()} tooltip="Re-run every visual's query." />
        <RibbonButton label={recording ? 'Stop recording' : 'Start recording'} icon={L(recording ? PauseRegular : PlayRegular)} onClick={() => shell().setPerfRecording(!recording)} />
      </RibbonGroup>
      <RibbonGroup label="Show panes">
        <PaneToggle id="performance" label="Performance analyzer" icon={L(TimerRegular)} />
      </RibbonGroup>
    </>
  )
}

const external = (url: string) => () => void window.wbi?.app.openExternal(url)

function HelpTab() {
  return (
    <>
      <RibbonGroup label="Help">
        <RibbonButton label="Guided learning" icon={L(BookOpenRegular)} onClick={external('https://learn.microsoft.com/power-bi/fundamentals/desktop-getting-started')} />
        <RibbonButton label="Documentation" icon={L(DocumentTextRegular)} onClick={external('https://learn.microsoft.com/power-bi/')} />
        <RibbonButton label="DAX reference" icon={L(MathFormulaRegular)} onClick={external('https://learn.microsoft.com/dax/dax-function-reference')} />
        <RibbonButton label="About" icon={L(InfoRegular)} onClick={() => shell().openDialog({ id: 'about' })} />
      </RibbonGroup>
      <RibbonGroup label="Community">
        <RibbonButton label="Power BI blog" icon={L(DocumentArrowRightRegular)} onClick={external('https://powerbi.microsoft.com/blog/')} />
        <RibbonButton label="Community" icon={L(PeopleCommunityRegular)} onClick={external('https://community.fabric.microsoft.com/t5/Power-BI-forums/ct-p/powerbi')} />
      </RibbonGroup>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Contextual: Format / Data-drill (a visual is selected)
// ---------------------------------------------------------------------------------------------

function selectedVisualDocs() {
  const { project, activePage, selectedVisuals } = app()
  const page = findPage(project?.report, activePage)
  return { page, visuals: selectedVisuals.map((n) => findVisual(page, n)).filter((v): v is NonNullable<typeof v> => !!v) }
}

async function askGap(title: string): Promise<number | null> {
  const v = await promptDialog({
    title,
    label: 'Gap (px)',
    value: String(currentLayoutGuides().gutter || 16),
    validate: (t) => (/^\d+(\.\d+)?$/.test(t.trim()) && Number(t) <= 2000 ? undefined : 'Enter a number of pixels (0–2000).')
  })
  return v === null ? null : Number(v)
}

function alignMenu(count: number): MenuItem[] {
  const to = useCanvasPrefs.getState().alignTo
  const setTo = (alignTo: typeof to) => useCanvasPrefs.getState().set({ alignTo })
  return [
    { label: 'Align left', icon: S(AlignLeftRegular), onClick: () => alignSelection('left') },
    { label: 'Align center', icon: S(AlignCenterHorizontalRegular), onClick: () => alignSelection('center') },
    { label: 'Align right', icon: S(AlignRightRegular), onClick: () => alignSelection('right') },
    { label: 'Align top', icon: S(AlignTopRegular), onClick: () => alignSelection('top') },
    { label: 'Align middle', icon: S(AlignCenterVerticalRegular), onClick: () => alignSelection('middle') },
    { label: 'Align bottom', icon: S(AlignBottomRegular), onClick: () => alignSelection('bottom') },
    { separator: true },
    { label: 'Distribute horizontally', icon: S(AlignSpaceEvenlyHorizontalRegular), disabled: count < 3, onClick: () => distributeSelection('horizontal') },
    { label: 'Distribute vertically', icon: S(AlignSpaceEvenlyVerticalRegular), disabled: count < 3, onClick: () => distributeSelection('vertical') },
    { separator: true },
    { header: 'Align multiple visuals to' },
    { label: 'Selection', checked: to === 'selection', onClick: () => setTo('selection'), title: 'Align to the bounds of the selection (Power BI)' },
    { label: 'Key object (first selected)', checked: to === 'keyObject', onClick: () => setTo('keyObject'), title: 'The first selected visual stays put; the others align to it' },
    { label: 'Page', checked: to === 'page', onClick: () => setTo('page') }
  ]
}

function spacingMenu(count: number): MenuItem[] {
  const gapItems = (axis: 'horizontal' | 'vertical'): MenuItem[] => [
    ...SPACING_PRESETS.map((g) => ({ label: `${g} px`, onClick: () => distributeSelectionWithGap(axis, g) })),
    { separator: true as const },
    {
      label: 'Custom…',
      onClick: () =>
        void askGap(`Distribute ${axis}ly with a fixed gap`).then((g) => {
          if (g !== null) distributeSelectionWithGap(axis, g)
        })
    }
  ]
  return [
    { label: 'Tidy up', icon: S(GridRegular), disabled: count < 2, shortcut: 'Ctrl+Alt+T', onClick: () => tidyUpSelection(), title: 'Arrange into an even row or grid using the current median spacing' },
    { label: 'Tidy up with gap', disabled: count < 2, submenu: [...SPACING_PRESETS.map((g) => ({ label: `${g} px`, onClick: () => tidyUpSelection(g) }))] },
    { separator: true },
    { label: 'Distribute horizontally with gap', icon: S(AlignSpaceEvenlyHorizontalRegular), disabled: count < 2, submenu: gapItems('horizontal') },
    { label: 'Distribute vertically with gap', icon: S(AlignSpaceEvenlyVerticalRegular), disabled: count < 2, submenu: gapItems('vertical') },
    { separator: true },
    { header: 'Match the first selected visual' },
    { label: 'Make same width', disabled: count < 2, onClick: () => matchSizeSelection('width') },
    { label: 'Make same height', disabled: count < 2, onClick: () => matchSizeSelection('height') },
    { label: 'Make same size', disabled: count < 2, onClick: () => matchSizeSelection('both') }
  ]
}

function LayoutGuidesGroup() {
  const prefs = useCanvasPrefs()
  const layout = useLayoutGuides()
  const hasReport = useApp((s) => !!s.project?.report)
  const current = LAYOUT_PRESETS.find((p) => p.layout.margin === layout.margin && p.layout.gutter === layout.gutter)
  const custom = async () => {
    const m = await promptDialog({ title: 'Layout guides', label: 'Page margin (px)', value: String(layout.margin), validate: (t) => (/^\d+$/.test(t.trim()) ? undefined : 'Enter whole pixels.') })
    if (m === null) return
    const g = await promptDialog({ title: 'Layout guides', label: 'Gutter between visuals (px)', value: String(layout.gutter), validate: (t) => (/^\d+$/.test(t.trim()) ? undefined : 'Enter whole pixels.') })
    if (g === null) return
    setLayoutGuides({ margin: Number(m), gutter: Number(g) })
  }
  return (
    <RibbonGroup label="Layout">
      <RibbonButton
        label="Layout guides"
        icon={L(LayoutColumnTwoRegular)}
        disabled={!hasReport}
        tooltip="Page margin and gutter: visuals snap to them while moving and resizing (Lumen; saved with the report, ignored by Power BI Desktop)."
        menu={() => [
          ...LAYOUT_PRESETS.map((p) => ({ label: p.label, checked: current?.id === p.id, onClick: () => setLayoutGuides(p.layout) })),
          { label: current ? 'Custom…' : `Custom (${layout.margin} px, ${layout.gutter} px)…`, checked: !current, onClick: () => void custom() },
          { separator: true },
          { label: 'Show margin guides', checked: prefs.showLayoutGuides, onClick: () => useCanvasPrefs.getState().set({ showLayoutGuides: !prefs.showLayoutGuides }) }
        ]}
      />
      <RibbonStack>
        <RibbonButton size="small" label="Equal spacing" icon={S(prefs.equalSpacing ? CheckboxCheckedRegular : CheckboxUncheckedRegular)} onClick={() => prefs.set({ equalSpacing: !prefs.equalSpacing })} tooltip="Snap to the same gaps as neighboring visuals and show distance guides (hold Alt to move freely)." />
        <RibbonButton size="small" label="Match size" icon={S(prefs.matchSize ? CheckboxCheckedRegular : CheckboxUncheckedRegular)} onClick={() => prefs.set({ matchSize: !prefs.matchSize })} tooltip="While resizing, snap to the width or height of other visuals." />
      </RibbonStack>
    </RibbonGroup>
  )
}

function FormatTab() {
  const sel = useApp((s) => s.selectedVisuals)
  const multi = sel.length > 1
  const groupSelected = useApp((s) => {
    const page = findPage(s.project?.report, s.activePage)
    return s.selectedVisuals.some((n) => isGroup(findVisual(page, n)))
  })
  return (
    <>
      <RibbonGroup label="Arrange">
        <RibbonButton
          label="Bring forward"
          icon={L(ArrowUpRegular)}
          onClick={() => arrangeSelection('forward')}
          menu={[
            { label: 'Bring forward', onClick: () => arrangeSelection('forward') },
            { label: 'Bring to front', onClick: () => arrangeSelection('front') }
          ]}
        />
        <RibbonButton
          label="Send backward"
          icon={L(ArrowDownRegular)}
          onClick={() => arrangeSelection('backward')}
          menu={[
            { label: 'Send backward', onClick: () => arrangeSelection('backward') },
            { label: 'Send to back', onClick: () => arrangeSelection('back') }
          ]}
        />
        <RibbonButton label="Align" icon={L(AlignLeftRegular)} menu={() => alignMenu(sel.length)} />
        <RibbonButton label="Size & spacing" icon={L(AlignSpaceEvenlyHorizontalRegular)} disabled={sel.length < 2} menu={() => spacingMenu(sel.length)} tooltip="Distribute with a fixed gap, tidy up into an even row or grid, make visuals the same size." />
        <RibbonButton
          label="Group"
          icon={L(GroupRegular)}
          menu={[
            { label: 'Group', disabled: !multi, onClick: groupSelection },
            { label: 'Ungroup', disabled: !groupSelected, onClick: ungroupSelection }
          ]}
        />
        <PaneToggle id="selection" label="Selection" icon={L(LayerRegular)} />
      </RibbonGroup>
      <RibbonGroup label="Interactions">
        <RibbonButton
          label="Apply drill down filters to"
          icon={L(ArrowForwardRegular)}
          menu={() => {
            const { visuals } = selectedVisualDocs()
            const v = visuals[0]
            const on = v?.json?.visual?.drillFilterOtherVisuals !== false
            const set = (val: boolean) =>
              app().mutateReport('Drill filters', (r) => {
                const page = findPage(r, app().activePage)
                for (const n of app().selectedVisuals) {
                  const vis = findVisual(page, n)
                  if (vis?.json?.visual) vis.json.visual.drillFilterOtherVisuals = val
                }
              })
            return [
              { label: 'Entire page', checked: on, onClick: () => set(true) },
              { label: 'Selected visual', checked: !on, onClick: () => set(false) }
            ]
          }}
        />
      </RibbonGroup>
    </>
  )
}

function DrillTab() {
  const activePage = useApp((s) => s.activePage)
  const selected = useApp((s) => (s.selectedVisuals.length === 1 ? s.selectedVisuals[0] : null))
  const stored = useInteraction((s) => (activePage && selected ? s.drill[drillStateKey(activePage, selected)] : undefined))
  const visualJson = useApp((s) => (selected ? findVisual(findPage(s.project?.report, s.activePage), selected)?.json : undefined))
  // same seeding as the canvas (PBIR `active` projections) until the user drills
  const drill = activePage && selected ? (stored ?? seedDrillState(visualJson)) : null
  const def = useApp((s) => {
    const v = findVisual(findPage(s.project?.report, s.activePage), selected ?? '')
    return v ? getVisual(v.json?.visual?.visualType ?? '') : undefined
  })
  const set = (patch: Partial<NonNullable<typeof drill>>) => {
    if (!activePage || !selected || !drill) return
    useInteraction.getState().setDrill(activePage, selected, { ...drill, ...patch })
  }
  const canDrill = !!def?.supportsDrill && !!drill
  return (
    <>
      <RibbonGroup label="Data">
        <RibbonButton label="Show as a table" icon={L(TableSearchRegular)} disabled={!selected} onClick={() => activePage && selected && useInteraction.getState().setFocus({ page: activePage, visual: selected, mode: 'table' })} />
        <RibbonButton label="Focus mode" icon={L(FullScreenMaximizeRegular)} disabled={!selected} onClick={() => activePage && selected && useInteraction.getState().setFocus({ page: activePage, visual: selected, mode: 'focus' })} />
        <RibbonButton
          label="Export data"
          icon={L(ArrowExportRegular)}
          disabled={!canExportVisualData(activePage, selected)}
          onClick={() => activePage && selected && exportVisualDataOf(activePage, selected)}
          tooltip="Export the data used to make this visual (.xlsx or .csv)."
        />
      </RibbonGroup>
      <RibbonGroup label="Drill actions">
        <RibbonButton label="Drill mode" icon={L(ArrowStepInRegular)} disabled={!canDrill} checked={!!drill?.drillMode} onClick={() => set({ drillMode: !drill?.drillMode })} tooltip="Click a data point to drill down instead of cross-filtering." />
        <RibbonStack>
          <RibbonButton size="small" label="Drill up" icon={S(ArrowStepOutRegular)} disabled={!canDrill || (!drill?.level && !drill?.path.length)} onClick={() => set({ level: Math.max(0, (drill?.level ?? 0) - 1), path: (drill?.path ?? []).slice(0, -1) })} />
          <RibbonButton size="small" label="Go to next level" icon={S(ChevronDoubleDownRegular)} disabled={!canDrill} onClick={() => set({ level: (drill?.level ?? 0) + 1 })} />
          <RibbonButton size="small" label="Expand next level" icon={S(ArrowStepInRightRegular)} disabled={!canDrill} onClick={() => set({ expandedLevel: (drill?.expandedLevel ?? drill?.level ?? 0) + 1 })} />
        </RibbonStack>
      </RibbonGroup>
    </>
  )
}

let registered = false

/** Register the standard tabs (idempotent). */
export function registerStandardTabs(): void {
  if (registered) return
  registered = true
  registerRibbonTab({ id: 'home', label: 'Home', order: 10, views: ['report', 'data', 'model', 'dax'], render: () => <HomeTab /> })
  registerRibbonTab({ id: 'insert', label: 'Insert', order: 20, render: () => <InsertTab /> })
  registerRibbonTab({ id: 'modeling', label: 'Modeling', order: 30, views: ['report'], render: () => <ModelingTab /> })
  registerRibbonTab({ id: 'view', label: 'View', order: 40, render: () => <ViewTab /> })
  registerRibbonTab({ id: 'optimize', label: 'Optimize', order: 50, render: () => <OptimizeTab /> })
  registerRibbonTab({ id: 'help', label: 'Help', order: 60, views: ['report', 'data', 'model', 'dax'], render: () => <HelpTab /> })
  registerRibbonTab({ id: 'format', label: 'Format', contextual: true, order: 100, visible: (s) => s.selectedVisuals.length > 0 && s.editMode, render: () => <FormatTab /> })
  registerRibbonTab({ id: 'dataDrill', label: 'Data / Drill', contextual: true, order: 110, visible: (s) => s.selectedVisuals.length === 1, render: () => <DrillTab /> })
}

export { getDataMenu, visualMenu }
