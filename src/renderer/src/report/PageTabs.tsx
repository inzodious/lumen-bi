/**
 * Page tabs bar (bottom of the report canvas, PBI Desktop style): navigate, add (+), inline rename
 * (double-click), right-click menu (Duplicate / Rename / Delete / Hide), drag to reorder.
 * Hidden pages show an eye-off icon in edit mode and are not listed in reading view.
 */
import { useEffect, useRef, useState } from 'react'
import { AddRegular, ChevronLeftRegular, ChevronRightRegular, EyeOffRegular } from '@fluentui/react-icons'
import type { ReportDocument } from '@core/report/types'
import { useApp } from '../state/store'
import { addPage, deletePage, duplicatePage, movePage, renamePage, setPageHidden } from './editOps'
import { orderedPages, pageInfo } from './pbir'
import { navigatePage } from './runtime'
import { Menu, type MenuItem } from './Overlays'

export function PageTabs({ report, editing }: { report: ReportDocument; editing: boolean }) {
  const active = useApp((s) => s.activePage)
  const pages = orderedPages(report)
    .map(pageInfo)
    .filter((p) => editing || !p.hidden)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ page: string; x: number; y: number } | null>(null)
  const [dragOver, setDragOver] = useState<{ page: string; after: boolean } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const dragging = useRef<string | null>(null)

  useEffect(() => {
    const el = scroller.current?.querySelector('.wbi-tab.active') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const mutate = (label: string, fn: (r: ReportDocument) => void) => useApp.getState().mutateReport(label, fn)

  const onAdd = () => {
    let name: string | undefined
    mutate('New page', (r) => {
      name = addPage(r, { after: active ?? undefined })
    })
    if (name) navigatePage(name, { pushBack: false })
  }

  const menuItems = (pageName: string): MenuItem[] => {
    const info = pages.find((p) => p.name === pageName)
    return [
      {
        label: 'Duplicate page',
        onClick: () => {
          let n: string | undefined
          mutate('Duplicate page', (r) => {
            n = duplicatePage(r, pageName)
          })
          if (n) navigatePage(n, { pushBack: false })
        }
      },
      { label: 'Rename page', onClick: () => setRenaming(pageName) },
      {
        label: 'Delete page',
        disabled: report.pages.length <= 1,
        onClick: () => {
          let next: string | undefined
          mutate('Delete page', (r) => {
            next = deletePage(r, pageName)
          })
          if (next && useApp.getState().activePage === pageName) useApp.getState().setActivePage(next)
        }
      },
      { label: info?.hidden ? 'Show page' : 'Hide page', checked: info?.hidden, onClick: () => mutate(info?.hidden ? 'Show page' : 'Hide page', (r) => setPageHidden(r, pageName, !info?.hidden)) }
    ]
  }

  return (
    <div className="wbi-tabs">
      <button className="wbi-tabs-nav" title="Scroll left" onClick={() => scroller.current?.scrollBy({ left: -200, behavior: 'smooth' })}>
        <ChevronLeftRegular />
      </button>
      <button className="wbi-tabs-nav" title="Scroll right" onClick={() => scroller.current?.scrollBy({ left: 200, behavior: 'smooth' })}>
        <ChevronRightRegular />
      </button>
      <div className="wbi-tabs-scroll" ref={scroller} role="tablist" aria-label="Pages">
        {pages.map((p) => (
          <div
            key={p.name}
            className={
              'wbi-tab' +
              (p.name === active ? ' active' : '') +
              (p.hidden ? ' hidden' : '') +
              (dragOver?.page === p.name ? (dragOver.after ? ' drop-after' : ' drop-before') : '')
            }
            role="tab"
            aria-selected={p.name === active}
            data-page-name={p.name}
            title={p.displayName + (p.isTooltip ? ' (tooltip page)' : p.isDrillthrough ? ' (drillthrough page)' : '')}
            draggable={editing && renaming !== p.name}
            onDragStart={(e) => {
              dragging.current = p.name
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/x-wbi-page', p.name)
            }}
            onDragOver={(e) => {
              if (!dragging.current) return
              e.preventDefault()
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setDragOver({ page: p.name, after: e.clientX > r.left + r.width / 2 })
            }}
            onDragLeave={() => setDragOver((d) => (d?.page === p.name ? null : d))}
            onDrop={(e) => {
              e.preventDefault()
              const src = dragging.current
              dragging.current = null
              const over = dragOver
              setDragOver(null)
              if (!src || !over || src === p.name) return
              const order = orderedPages(report).map((x) => x.name).filter((n) => n !== src)
              const idx = order.indexOf(p.name) + (over.after ? 1 : 0)
              mutate('Move page', (r) => movePage(r, src, idx))
            }}
            onDragEnd={() => {
              dragging.current = null
              setDragOver(null)
            }}
            onClick={() => navigatePage(p.name, { pushBack: false })}
            onDoubleClick={() => editing && setRenaming(p.name)}
            onContextMenu={(e) => {
              e.preventDefault()
              if (editing) setMenu({ page: p.name, x: e.clientX, y: e.clientY })
            }}
          >
            {p.hidden && editing ? <EyeOffRegular className="wbi-tab-icon" aria-label="Hidden page" /> : null}
            {renaming === p.name ? (
              <input
                className="wbi-tab-input"
                autoFocus
                defaultValue={p.displayName}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => {
                  const v = e.currentTarget.value
                  setRenaming(null)
                  if (v.trim() && v !== p.displayName) mutate('Rename page', (r) => renamePage(r, p.name, v))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') {
                    e.currentTarget.value = p.displayName
                    e.currentTarget.blur()
                  }
                  e.stopPropagation()
                }}
              />
            ) : (
              <span className="wbi-tab-label">{p.displayName}</span>
            )}
          </div>
        ))}
        {editing && (
          <button className="wbi-tab-add" title="New page" onClick={onAdd}>
            <AddRegular />
          </button>
        )}
      </div>
      {menu && (
        <div className="wbi-menu-backdrop" onPointerDown={() => setMenu(null)} onContextMenu={(e) => (e.preventDefault(), setMenu(null))}>
          <Menu items={menuItems(menu.page)} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
        </div>
      )}
    </div>
  )
}
