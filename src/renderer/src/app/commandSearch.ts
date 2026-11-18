/**
 * Title-bar search ("Search" box in PBI Desktop): fuzzy-ish search over shell commands.
 */
import { createElement, type ReactElement } from 'react'
import type { FluentIcon } from '@fluentui/react-icons'
import {
  DocumentAddRegular, FolderOpenRegular, SaveRegular, SaveEditRegular, ArrowSyncRegular, DatabaseArrowRightRegular, TableAddRegular, TableEditRegular,
  DataBarVerticalAddRegular, TextFieldRegular, SlideAddRegular, ImageRegular, IconsRegular, CalculatorRegular, MathFormulaRegular, TableSimpleRegular, OrganizationRegular,
  DocumentPdfRegular, SlideTextRegular, ImageMultipleRegular, CodeRegular, PaintBrushRegular, FilterRegular, BookmarkRegular, LayerRegular, SettingsRegular,
  InfoRegular, BeakerRegular, ArrowUndoRegular, ArrowRedoRegular, ColorRegular, EyeRegular
} from '@fluentui/react-icons'
import { useApp } from '../state/store'
import { useShell } from './shellState'
import { openExportDialog } from '../export'
import { importThemeFile } from './themes'
import { insertIcon, insertImage, insertTextBox, insertVisual, newPage, newReport, openFileDialog, refreshAll, runModelingCommand, save, saveAs, useSampleData, regenerateSampleData, undo, redo, loadSampleProject } from './commands'

export interface SearchableCommand {
  id: string
  label: string
  group: string
  keywords?: string
  icon: ReactElement
  run(): void
}

const ic = (C: FluentIcon): ReactElement => createElement(C, { fontSize: 16 })

function commands(): SearchableCommand[] {
  const shell = useShell.getState()
  const app = useApp.getState()
  return [
    { id: 'new', label: 'New report', group: 'File', icon: ic(DocumentAddRegular), run: () => void newReport() },
    { id: 'open', label: 'Open report', group: 'File', keywords: 'pbix pbip pbit wbi', icon: ic(FolderOpenRegular), run: () => void openFileDialog() },
    { id: 'save', label: 'Save', group: 'File', icon: ic(SaveRegular), run: () => void save() },
    { id: 'saveas', label: 'Save as', group: 'File', keywords: 'pbip wbi', icon: ic(SaveEditRegular), run: () => void saveAs() },
    { id: 'pdf', label: 'Export to PDF', group: 'Export', keywords: 'pages print', icon: ic(DocumentPdfRegular), run: () => openExportDialog('pdf') },
    { id: 'pptx', label: 'Export to PowerPoint', group: 'Export', keywords: 'pptx slides pages', icon: ic(SlideTextRegular), run: () => openExportDialog('pptx') },
    { id: 'png', label: 'Export pages as images', group: 'Export', keywords: 'png pages', icon: ic(ImageMultipleRegular), run: () => openExportDialog('png') },
    { id: 'html', label: 'Export to HTML', group: 'Export', keywords: 'web static pages', icon: ic(CodeRegular), run: () => openExportDialog('html') },
    { id: 'getdata', label: 'Get data', group: 'Home', keywords: 'import source csv excel sql', icon: ic(DatabaseArrowRightRegular), run: () => shell.openDialog({ id: 'getData' }) },
    { id: 'enterdata', label: 'Enter data', group: 'Home', icon: ic(TableAddRegular), run: () => shell.openDialog({ id: 'enterData' }) },
    { id: 'transform', label: 'Transform data', group: 'Home', keywords: 'power query m editor', icon: ic(TableEditRegular), run: () => app.setView('powerquery') },
    { id: 'refresh', label: 'Refresh', group: 'Home', icon: ic(ArrowSyncRegular), run: () => refreshAll() },
    { id: 'sample', label: 'Use sample data for empty tables', group: 'Data', keywords: 'synthetic fake mock', icon: ic(BeakerRegular), run: () => void useSampleData() },
    { id: 'resample', label: 'Regenerate sample data (new random values)', group: 'Data', keywords: 'synthetic fake mock seed shuffle randomize', icon: ic(BeakerRegular), run: () => void regenerateSampleData() },
    { id: 'demo', label: 'Open sample report', group: 'File', keywords: 'demo example', icon: ic(BeakerRegular), run: () => void loadSampleProject() },
    { id: 'visual', label: 'New visual', group: 'Insert', keywords: 'chart', icon: ic(DataBarVerticalAddRegular), run: () => void insertVisual('clusteredColumnChart') },
    { id: 'text', label: 'Text box', group: 'Insert', icon: ic(TextFieldRegular), run: insertTextBox },
    { id: 'image', label: 'Image', group: 'Insert', icon: ic(ImageRegular), run: () => void insertImage() },
    { id: 'icon', label: 'Icon', group: 'Insert', icon: ic(IconsRegular), run: () => void insertIcon() },
    { id: 'page', label: 'New page', group: 'Insert', icon: ic(SlideAddRegular), run: newPage },
    { id: 'measure', label: 'New measure', group: 'Modeling', keywords: 'dax', icon: ic(CalculatorRegular), run: () => void runModelingCommand('newMeasure') },
    { id: 'column', label: 'New column', group: 'Modeling', keywords: 'calculated dax', icon: ic(MathFormulaRegular), run: () => void runModelingCommand('newColumn') },
    { id: 'table', label: 'New table', group: 'Modeling', keywords: 'calculated dax', icon: ic(TableSimpleRegular), run: () => void runModelingCommand('newTable') },
    { id: 'rel', label: 'Manage relationships', group: 'Modeling', icon: ic(OrganizationRegular), run: () => void runModelingCommand('manageRelationships') },
    { id: 'theme', label: 'Browse for themes', group: 'View', keywords: 'json colors', icon: ic(PaintBrushRegular), run: () => void importThemeFile() },
    { id: 'customize', label: 'Customize current theme', group: 'View', icon: ic(ColorRegular), run: () => shell.openDialog({ id: 'customizeTheme' }) },
    { id: 'filters', label: 'Filters pane', group: 'View', icon: ic(FilterRegular), run: () => shell.togglePane('filters') },
    { id: 'bookmarks', label: 'Bookmarks pane', group: 'View', icon: ic(BookmarkRegular), run: () => shell.togglePane('bookmarks') },
    { id: 'selection', label: 'Selection pane', group: 'View', keywords: 'layers', icon: ic(LayerRegular), run: () => shell.togglePane('selection') },
    { id: 'reading', label: 'Reading view', group: 'View', keywords: 'edit mode', icon: ic(EyeRegular), run: () => app.setEditMode(!app.editMode) },
    { id: 'options', label: 'Options and settings', group: 'File', keywords: 'preferences', icon: ic(SettingsRegular), run: () => shell.openDialog({ id: 'options' }) },
    { id: 'about', label: 'About', group: 'Help', icon: ic(InfoRegular), run: () => shell.openDialog({ id: 'about' }) },
    { id: 'undo', label: 'Undo', group: 'Edit', icon: ic(ArrowUndoRegular), run: undo },
    { id: 'redo', label: 'Redo', group: 'Edit', icon: ic(ArrowRedoRegular), run: redo }
  ]
}

/** Rank commands by label prefix > word prefix > substring (label or keywords). */
export function searchCommands(query: string): SearchableCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: Array<[number, SearchableCommand]> = []
  for (const c of commands()) {
    const label = c.label.toLowerCase()
    const hay = `${label} ${c.keywords ?? ''} ${c.group.toLowerCase()}`
    let score = -1
    if (label.startsWith(q)) score = 3
    else if (label.split(/\s+/).some((w) => w.startsWith(q))) score = 2
    else if (hay.includes(q)) score = 1
    if (score >= 0) scored.push([score, c])
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label)).map((x) => x[1])
}
