/**
 * Bookmarks pane: Add / View, list (groups expandable), click to apply, "…" menu per bookmark
 * (Update, Rename, Delete, Group, Ungroup, Move, Data / Display / Current page / All visuals vs
 * Selected visuals). Capture & apply are the canvas runtime's (report/runtime.ts).
 */
import { useMemo, useState } from 'react'
import { AddRegular, BookmarkRegular, ChevronDownRegular, ChevronLeftRegular, ChevronRightRegular, FolderRegular, MoreHorizontalRegular, PlayRegular, DismissRegular } from '@fluentui/react-icons'
import { useApp } from '../../state/store'
import { useInteraction } from '../../state/interaction'
import { addBookmarkFromState, applyBookmark, removeBookmark, updateBookmarkFromState } from '../../report/runtime'
import { PaneFrame } from '../PaneFrame'
import { Button, Tip, confirmDialog, cx, showContextMenu, type MenuItem } from '../../app/ui'
import { bookmarkOptions, bookmarkTree, groupBookmarks, moveBookmark, playOrder, renameBookmark, setBookmarkOption, ungroupBookmarks, type BookmarkOption } from './bookmarks'
import '../selection/selection.css'
import './bookmarks.css'

export function BookmarksPane() {
  const report = useApp((s) => s.project?.report)
  const selectedVisuals = useApp((s) => s.selectedVisuals)
  const mutate = useApp((s) => s.mutateReport)
  const applied = useInteraction((s) => s.appliedBookmark)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string[]>([])
  const [viewing, setViewing] = useState<number | null>(null)
  const tree = useMemo(() => bookmarkTree(report), [report])
  const order = useMemo(() => playOrder(report), [report])

  const add = () => {
    const names = new Set(report?.bookmarks.map((b) => b.json?.displayName))
    let i = (report?.bookmarks.length ?? 0) + 1
    while (names.has(`Bookmark ${i}`)) i++
    const name = addBookmarkFromState({ displayName: `Bookmark ${i}` })
    if (name) {
      setRenaming(name)
      setDraft(`Bookmark ${i}`)
    }
  }
  const commitRename = () => {
    if (renaming && draft.trim()) mutate('Rename bookmark', (r) => renameBookmark(r, renaming, draft.trim()))
    setRenaming(null)
  }
  const view = (idx: number) => {
    const n = order[idx]
    if (!n) return
    setViewing(idx)
    applyBookmark(n)
  }

  const menu = (name: string, groupName?: string): MenuItem[] => {
    if (!report) return []
    const o = bookmarkOptions(report, name)
    const opt = (key: BookmarkOption, label: string): MenuItem => ({
      label,
      checked: o[key],
      onClick: () => mutate('Bookmark options', (r) => setBookmarkOption(r, name, key, !o[key], selectedVisuals))
    })
    const sel = selected.includes(name) ? selected : [name]
    return [
      { label: 'Update', onClick: () => updateBookmarkFromState(name) },
      { label: 'Rename', onClick: () => (setRenaming(name), setDraft(report.bookmarks.find((b) => b.name === name)?.json?.displayName ?? name)) },
      {
        label: 'Delete',
        onClick: async () => {
          if ((await confirmDialog({ title: 'Delete bookmark', message: 'Delete this bookmark?', buttons: ['Delete', 'Cancel'] })) === 0) removeBookmark(name)
        }
      },
      { separator: true },
      groupName
        ? { label: 'Ungroup', onClick: () => mutate('Ungroup bookmarks', (r) => ungroupBookmarks(r, groupName)) }
        : { label: 'Group', onClick: () => mutate('Group bookmarks', (r) => groupBookmarks(r, sel, 'Group')) },
      { label: 'Move up', onClick: () => mutate('Move bookmark', (r) => moveBookmark(r, name, -1)) },
      { label: 'Move down', onClick: () => mutate('Move bookmark', (r) => moveBookmark(r, name, 1)) },
      { separator: true },
      opt('data', 'Data'),
      opt('display', 'Display'),
      opt('currentPage', 'Current page'),
      { separator: true },
      { label: 'All visuals', checked: o.allVisuals, onClick: () => mutate('Bookmark options', (r) => setBookmarkOption(r, name, 'allVisuals', true)) },
      { label: `Selected visuals${!o.allVisuals ? ` (${o.targetVisualNames.length})` : ''}`, checked: !o.allVisuals, disabled: o.allVisuals && !selectedVisuals.length, title: 'Select visuals on the canvas first', onClick: () => mutate('Bookmark options', (r) => setBookmarkOption(r, name, 'allVisuals', false, selectedVisuals)) }
    ]
  }

  const row = (name: string, displayName: string, depth: number, groupName?: string) => (
    <div
      key={name}
      className={cx('wbi-sel__row', 'wbi-bm__row', (applied === name || selected.includes(name)) && 'is-selected')}
      style={{ paddingLeft: 10 + depth * 16 }}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) return setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]))
        setSelected([name])
        applyBookmark(name)
      }}
      onDoubleClick={() => (setRenaming(name), setDraft(displayName))}
      onContextMenu={(e) => showContextMenu(e, menu(name, groupName))}
    >
      <BookmarkRegular fontSize={16} className="wbi-bm__icon" />
      {renaming === name ? (
        <input
          autoFocus
          className="wbi-sel__input"
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setRenaming(null)
          }}
        />
      ) : (
        <span className="wbi-sel__name">{displayName}</span>
      )}
      <button type="button" className="wbi-sel__eye wbi-bm__more" aria-label="More options" onClick={(e) => (e.stopPropagation(), showContextMenu(e.currentTarget.getBoundingClientRect(), menu(name, groupName)))}>
        <MoreHorizontalRegular fontSize={16} />
      </button>
    </div>
  )

  return (
    <PaneFrame id="bookmarks" title="Bookmarks">
      <div className="wbi-sel__toolbar">
        <Button size="small" icon={<AddRegular fontSize={14} />} disabled={!report} onClick={add}>
          Add
        </Button>
        <Button size="small" icon={<PlayRegular fontSize={14} />} disabled={!order.length} onClick={() => view(0)}>
          View
        </Button>
      </div>
      <div className="wbi-sel__list">
        {!tree.length && <div className="wbi-pane__empty">Bookmarks capture the current state of a report page. Select Add to capture the page as it is now.</div>}
        {tree.map((n) =>
          n.kind === 'bookmark' ? (
            row(n.name, n.displayName, 0)
          ) : (
            <div key={n.name}>
              <div
                className="wbi-sel__row"
                style={{ paddingLeft: 6 }}
                onClick={() =>
                  setCollapsed((s) => {
                    const next = new Set(s)
                    if (next.has(n.name)) next.delete(n.name)
                    else next.add(n.name)
                    return next
                  })
                }
                onDoubleClick={() => (setRenaming(n.name), setDraft(n.displayName))}
                onContextMenu={(e) =>
                  showContextMenu(e, [
                    { label: 'Rename', onClick: () => (setRenaming(n.name), setDraft(n.displayName)) },
                    { label: 'Ungroup', onClick: () => mutate('Ungroup bookmarks', (r) => ungroupBookmarks(r, n.name)) },
                    { label: 'Move up', onClick: () => mutate('Move bookmark', (r) => moveBookmark(r, n.name, -1)) },
                    { label: 'Move down', onClick: () => mutate('Move bookmark', (r) => moveBookmark(r, n.name, 1)) }
                  ])
                }
              >
                <span className="wbi-sel__chev">{collapsed.has(n.name) ? <ChevronRightRegular fontSize={12} /> : <ChevronDownRegular fontSize={12} />}</span>
                <FolderRegular fontSize={16} className="wbi-bm__icon" />
                {renaming === n.name ? (
                  <input
                    autoFocus
                    className="wbi-sel__input"
                    value={draft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <span className="wbi-sel__name wbi-bm__group">{n.displayName}</span>
                )}
              </div>
              {!collapsed.has(n.name) && n.children.map((c) => row(c.name, c.displayName, 1, n.name))}
            </div>
          )
        )}
      </div>
      {viewing !== null && order.length > 0 && (
        <div className="wbi-bm__viewbar" role="toolbar" aria-label="Bookmark view">
          <Tip title="Previous bookmark">
            <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Previous" disabled={viewing <= 0} onClick={() => view(viewing - 1)}>
              <ChevronLeftRegular fontSize={16} />
            </button>
          </Tip>
          <span className="wbi-bm__viewname">{report?.bookmarks.find((b) => b.name === order[viewing])?.json?.displayName ?? ''}</span>
          <span className="wbi-muted">
            {viewing + 1} / {order.length}
          </span>
          <Tip title="Next bookmark">
            <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Next" disabled={viewing >= order.length - 1} onClick={() => view(viewing + 1)}>
              <ChevronRightRegular fontSize={16} />
            </button>
          </Tip>
          <Tip title="Exit view">
            <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Exit" onClick={() => setViewing(null)}>
              <DismissRegular fontSize={14} />
            </button>
          </Tip>
        </div>
      )}
    </PaneFrame>
  )
}
