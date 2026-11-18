/**
 * Selection pane: Layer order (tree of visuals/groups, top of stack first, eye toggles, rename,
 * drag to re-stack, group/ungroup, bring forward/send backward, show/hide all) and Tab order.
 */
import { useMemo, useState } from 'react'
import { ArrowUpRegular, ArrowDownRegular, ChevronDownRegular, ChevronRightRegular, EyeRegular, EyeOffRegular, GroupRegular, GroupDismissRegular } from '@fluentui/react-icons'
import { useApp } from '../../state/store'
import { findPage, findVisual, isGroup, isHiddenVisual } from '../../report/pbir'
import { groupVisuals, reorderZ, setVisualsHidden, ungroupVisuals } from '../../report/editOps'
import { getVisual } from '../../visuals/registry'
import { PaneFrame } from '../PaneFrame'
import { Pivot, Tip, cx, showContextMenu } from '../../app/ui'
import { catalogEntry } from '../visualizations/catalog'
import { flattenTree, layerName, layerTree, moveLayerAbove, moveTabOrder, renameLayer, tabOrderList } from './layers'
import './selection.css'

const LAYER_MIME = 'application/x-lumen-layer'

export function typeDisplayName(type: string): string {
  return getVisual(type)?.displayName ?? catalogEntry(type)?.displayName ?? (type === 'textbox' ? 'Text box' : type === 'actionButton' ? 'Button' : type === 'shape' ? 'Shape' : type === 'image' ? 'Image' : type)
}

export function SelectionPane() {
  const project = useApp((s) => s.project)
  const activePage = useApp((s) => s.activePage)
  const selected = useApp((s) => s.selectedVisuals)
  const selectVisuals = useApp((s) => s.selectVisuals)
  const mutate = useApp((s) => s.mutateReport)
  const [tab, setTab] = useState<'layer' | 'tab'>('layer')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const page = findPage(project?.report, activePage)
  const rows = useMemo(() => (page ? flattenTree(layerTree(page), collapsed) : []), [page, collapsed])
  const tabRows = useMemo(() => (page ? tabOrderList(page).filter((v) => !isGroup(v)) : []), [page])

  const edit = (label: string, fn: (p: NonNullable<typeof page>) => void) =>
    mutate(label, (r) => {
      const p = findPage(r, activePage)
      if (p) fn(p)
    })

  const click = (name: string, e: React.MouseEvent, list: string[]) => {
    if (e.ctrlKey || e.metaKey) selectVisuals(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name])
    else if (e.shiftKey && anchor && list.includes(anchor)) {
      const [a, b] = [list.indexOf(anchor), list.indexOf(name)].sort((x, y) => x - y)
      selectVisuals(list.slice(a, b + 1))
    } else {
      selectVisuals([name])
      setAnchor(name)
    }
  }
  const commitRename = () => {
    if (renaming && draft.trim())
      edit('Rename', (p) => {
        const v = findVisual(p, renaming)
        if (v) renameLayer(v, draft.trim())
      })
    setRenaming(null)
  }

  const selGroups = selected.filter((n) => isGroup(findVisual(page, n)))
  const toolbar = page && (
    <div className="wbi-sel__toolbar">
      <button type="button" className="wbi-link" onClick={() => edit('Show all', (p) => setVisualsHidden(p, p.visuals.map((v) => v.name), false))}>
        Show all
      </button>
      <button type="button" className="wbi-link" onClick={() => edit('Hide all', (p) => setVisualsHidden(p, p.visuals.filter((v) => !v.json?.parentGroupName).map((v) => v.name), true))}>
        Hide all
      </button>
      <span className="wbi-sel__spacer" />
      {tab === 'layer' ? (
        <>
          <Tip title="Group">
            <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Group" disabled={selected.length < 1} onClick={() => {
              let g: string | undefined
              edit('Group', (p) => (g = groupVisuals(p, selected)))
              if (g) selectVisuals([g])
            }}>
              <GroupRegular fontSize={16} />
            </button>
          </Tip>
          <Tip title="Ungroup">
            <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Ungroup" disabled={!selGroups.length} onClick={() => {
              let freed: string[] = []
              edit('Ungroup', (p) => (freed = ungroupVisuals(p, selGroups)))
              selectVisuals(freed)
            }}>
              <GroupDismissRegular fontSize={16} />
            </button>
          </Tip>
          <Tip title="Bring forward">
            <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Bring forward" disabled={!selected.length} onClick={() => edit('Bring forward', (p) => reorderZ(p, selected, 'forward'))}>
              <ArrowUpRegular fontSize={16} />
            </button>
          </Tip>
          <Tip title="Send backward">
            <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Send backward" disabled={!selected.length} onClick={() => edit('Send backward', (p) => reorderZ(p, selected, 'backward'))}>
              <ArrowDownRegular fontSize={16} />
            </button>
          </Tip>
        </>
      ) : (
        <>
          <Tip title="Move up">
            <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Move up" disabled={selected.length !== 1} onClick={() => edit('Tab order', (p) => moveTabOrder(p, selected[0], -1))}>
              <ArrowUpRegular fontSize={16} />
            </button>
          </Tip>
          <Tip title="Move down">
            <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Move down" disabled={selected.length !== 1} onClick={() => edit('Tab order', (p) => moveTabOrder(p, selected[0], 1))}>
              <ArrowDownRegular fontSize={16} />
            </button>
          </Tip>
        </>
      )}
    </div>
  )

  return (
    <PaneFrame id="selection" title="Selection">
      <Pivot className="wbi-sel__pivot" tabs={[{ key: 'layer', label: 'Layer order' }, { key: 'tab', label: 'Tab order' }]} value={tab} onChange={(v) => setTab(v as 'layer' | 'tab')} />
      {!page ? (
        <div className="wbi-pane__empty">Open a report page to see its visuals.</div>
      ) : (
        <>
          {toolbar}
          {tab === 'layer' ? (
            <div className="wbi-sel__list" role="tree">
              {!rows.length && <div className="wbi-pane__empty">There are no visuals on this page.</div>}
              {rows.map((n) => {
                const v = n.visual
                const hidden = isHiddenVisual(v)
                const group = isGroup(v)
                const name = layerName(v, typeDisplayName)
                return (
                  <div
                    key={v.name}
                    role="treeitem"
                    aria-selected={selected.includes(v.name)}
                    aria-expanded={group ? !collapsed.has(v.name) : undefined}
                    className={cx('wbi-sel__row', selected.includes(v.name) && 'is-selected', hidden && 'is-hidden', dropTarget === v.name && 'is-drop')}
                    style={{ paddingLeft: 8 + n.depth * 16 }}
                    draggable={renaming !== v.name}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(LAYER_MIME, v.name)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(LAYER_MIME)) {
                        e.preventDefault()
                        setDropTarget(v.name)
                      }
                    }}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDropTarget(null)
                      const src = e.dataTransfer.getData(LAYER_MIME)
                      if (src && src !== v.name) edit('Reorder layers', (p) => moveLayerAbove(p, src, v.name))
                    }}
                    onClick={(e) => click(v.name, e, rows.map((r) => r.visual.name))}
                    onDoubleClick={() => {
                      setRenaming(v.name)
                      setDraft(name)
                    }}
                    onContextMenu={(e) =>
                      showContextMenu(e, [
                        { label: 'Rename', onClick: () => (setRenaming(v.name), setDraft(name)) },
                        { label: hidden ? 'Show' : 'Hide', onClick: () => edit(hidden ? 'Show visual' : 'Hide visual', (p) => setVisualsHidden(p, [v.name], !hidden)) },
                        { separator: true },
                        { label: 'Bring to front', onClick: () => edit('Bring to front', (p) => reorderZ(p, [v.name], 'front')) },
                        { label: 'Send to back', onClick: () => edit('Send to back', (p) => reorderZ(p, [v.name], 'back')) }
                      ])
                    }
                  >
                    <span className="wbi-sel__chev" onClick={(e) => {
                      if (!group) return
                      e.stopPropagation()
                      const next = new Set(collapsed)
                      if (next.has(v.name)) next.delete(v.name)
                      else next.add(v.name)
                      setCollapsed(next)
                    }}>
                      {group ? collapsed.has(v.name) ? <ChevronRightRegular fontSize={12} /> : <ChevronDownRegular fontSize={12} /> : null}
                    </span>
                    {renaming === v.name ? (
                      <input
                        autoFocus
                        className="wbi-sel__input"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitRename}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter') commitRename()
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                      />
                    ) : (
                      <span className="wbi-sel__name" title={name}>
                        {name}
                      </span>
                    )}
                    <Tip title={hidden ? 'Show this visual' : 'Hide this visual'}>
                      <button
                        type="button"
                        className="wbi-sel__eye"
                        aria-label={hidden ? 'Show' : 'Hide'}
                        onClick={(e) => {
                          e.stopPropagation()
                          edit(hidden ? 'Show visual' : 'Hide visual', (p) => setVisualsHidden(p, [v.name], !hidden))
                        }}
                      >
                        {hidden ? <EyeOffRegular fontSize={16} /> : <EyeRegular fontSize={16} />}
                      </button>
                    </Tip>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="wbi-sel__list" role="list">
              {tabRows.map((v, i) => (
                <div key={v.name} role="listitem" className={cx('wbi-sel__row', selected.includes(v.name) && 'is-selected')} onClick={(e) => click(v.name, e, tabRows.map((x) => x.name))}>
                  <span className="wbi-sel__num">{i + 1}</span>
                  <span className="wbi-sel__name">{layerName(v, typeDisplayName)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </PaneFrame>
  )
}
