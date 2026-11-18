/**
 * Floating toolbar of the model diagram (Lumen additions to Power BI's Model view): pointer mode (pan / select
 * with a marquee), the layout's relationship line style, group / ungroup, snapping and "export as image".
 */
import type { ReactElement, ReactNode } from 'react'
import { GridDotsRegular, GroupDismissRegular, GroupRegular, HandRightRegular, ImageRegular, SelectObjectRegular } from '@fluentui/react-icons'
import type { LineStyle } from '@core/io/diagramSidecar'
import { Tip, cx } from '../../app/ui'

/** Line-style glyphs (Fluent has none that show the three routings side by side); drawn in the same 20px/1.5 stroke weight. */
export function LineStyleIcon({ style, size = 20 }: { style: LineStyle; size?: number }): ReactElement {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      {style === 'curved' && <path d="M3,15 C10,15 10,5 17,5" {...common} />}
      {style === 'orthogonal' && <path d="M3,15 H8.5 Q10,15 10,13.5 V6.5 Q10,5 11.5,5 H17" {...common} />}
      {style === 'straight' && <path d="M3,15 L17,5" {...common} />}
      <circle cx="3" cy="15" r="1.6" fill="currentColor" />
      <circle cx="17" cy="5" r="1.6" fill="currentColor" />
    </svg>
  )
}

export const LINE_STYLE_LABELS: Record<LineStyle, string> = { curved: 'Curved', orthogonal: 'Orthogonal', straight: 'Straight' }
const LINE_STYLE_HELP: Record<LineStyle, string> = {
  curved: 'Smooth curved relationship lines',
  orthogonal: 'Right-angled relationship lines (Power BI style)',
  straight: 'Straight relationship lines'
}

function ToolButton({ label, description, pressed, disabled, onClick, children, name }: { label: string; description?: string; pressed?: boolean; disabled?: boolean; onClick(): void; children: ReactNode; name: string }) {
  return (
    <Tip title={label} description={description}>
      <button type="button" className={cx('wbi-mv__tool', pressed && 'is-on')} aria-label={label} aria-pressed={pressed} disabled={disabled} data-tool={name} onMouseDown={(e) => {
        // keep keyboard focus out of the toolbar (Space pans, Delete acts on the diagram selection)
        e.preventDefault()
        e.stopPropagation()
      }} onClick={onClick}>
        {children}
      </button>
    </Tip>
  )
}

export interface DiagramToolbarProps {
  mode: 'pan' | 'select'
  onMode(mode: 'pan' | 'select'): void
  lineStyle: LineStyle
  onLineStyle(style: LineStyle): void
  canGroup: boolean
  canUngroup: boolean
  onGroup(): void
  onUngroup(): void
  snap: boolean
  onSnap(on: boolean): void
  onExport(): void
}

export function DiagramToolbar(p: DiagramToolbarProps) {
  return (
    <div className="wbi-mv__toolbar" role="toolbar" aria-label="Diagram tools" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <ToolButton name="pan" label="Pan" description="Drag the canvas to move around. Shift+drag selects tables with a box." pressed={p.mode === 'pan'} onClick={() => p.onMode('pan')}>
        <HandRightRegular />
      </ToolButton>
      <ToolButton name="select" label="Select" description="Drag a box around tables to select them. Hold Space (or use the middle button) to pan." pressed={p.mode === 'select'} onClick={() => p.onMode('select')}>
        <SelectObjectRegular />
      </ToolButton>
      <span className="wbi-mv__toolsep" />
      {(['curved', 'orthogonal', 'straight'] as const).map((s) => (
        <ToolButton key={s} name={`style-${s}`} label={`${LINE_STYLE_LABELS[s]} lines`} description={`${LINE_STYLE_HELP[s]} for this layout. Right-click a line to style it on its own.`} pressed={p.lineStyle === s} onClick={() => p.onLineStyle(s)}>
          <LineStyleIcon style={s} />
        </ToolButton>
      ))}
      <span className="wbi-mv__toolsep" />
      <ToolButton name="group" label="Group (Ctrl+G)" description="Put the selected tables in a labelled container." disabled={!p.canGroup} onClick={p.onGroup}>
        <GroupRegular />
      </ToolButton>
      <ToolButton name="ungroup" label="Ungroup (Ctrl+Shift+G)" description="Remove the container; its tables stay where they are." disabled={!p.canUngroup} onClick={p.onUngroup}>
        <GroupDismissRegular />
      </ToolButton>
      <span className="wbi-mv__toolsep" />
      <ToolButton name="snap" label="Snap pinch points" description="Snap pinch points to the grid and to alignment with other points and table centres. Hold Alt while dragging to turn snapping off." pressed={p.snap} onClick={() => p.onSnap(!p.snap)}>
        <GridDotsRegular />
      </ToolButton>
      <ToolButton name="export" label="Export diagram as image" description="Save this layout — tables, relationship lines and groups — as a PNG or SVG file." onClick={p.onExport}>
        <ImageRegular />
      </ToolButton>
    </div>
  )
}
