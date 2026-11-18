/**
 * Custom title bar for the frameless window (PBI Desktop layout): app icon, quick access toolbar
 * (Save / Undo / Redo), document name + " - Lumen", centered search box (command search over ribbon
 * commands), window controls.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRedo20Regular, ArrowUndo20Regular, Dismiss20Regular, Save20Regular, Search16Regular, Subtract20Regular, Maximize20Regular, SquareMultiple20Regular } from '@fluentui/react-icons'
import { useApp } from '../state/store'
import { APP_NAME } from './brand'
import { LumenLogo } from './Logo'
import { Tip } from './ui/Tooltip'
import { Popover } from './ui/Popover'
import { cx } from './ui/cx'
import { redo, save, undo } from './commands'
import { searchCommands, type SearchableCommand } from './commandSearch'

export function TitleBar() {
  const project = useApp((s) => s.project)
  const canUndo = useApp((s) => s.undoStack.length > 0)
  const canRedo = useApp((s) => s.redoStack.length > 0)
  const undoLabel = useApp((s) => s.undoStack[s.undoStack.length - 1]?.label)
  const [maximized, setMaximized] = useState(false)
  const title = `${project ? project.name : 'Untitled'}${project?.dirty ? '*' : ''} - ${APP_NAME}`

  useEffect(() => {
    document.title = title
    window.wbi?.app.setTitle(title).catch(() => undefined)
  }, [title])
  useEffect(() => {
    if (!window.wbi) return
    window.wbi.window
      .isMaximized()
      .then(setMaximized)
      .catch(() => undefined)
    return window.wbi.window.onMaximizeChange(setMaximized)
  }, [])

  return (
    <header className="wbi-titlebar" onDoubleClick={(e) => e.target === e.currentTarget && window.wbi?.window.toggleMaximize()}>
      <div className="wbi-titlebar__left">
        <span className="wbi-titlebar__logo">
          <LumenLogo size={20} />
        </span>
        <Tip title="Save (Ctrl+S)">
          <button type="button" className="wbi-qat" aria-label="Save" disabled={!project} onClick={() => void save()}>
            <Save20Regular />
          </button>
        </Tip>
        <Tip title={`Undo${undoLabel ? ` ${undoLabel}` : ''} (Ctrl+Z)`}>
          <button type="button" className="wbi-qat" aria-label="Undo" disabled={!canUndo} onClick={undo}>
            <ArrowUndo20Regular />
          </button>
        </Tip>
        <Tip title="Redo (Ctrl+Y)">
          <button type="button" className="wbi-qat" aria-label="Redo" disabled={!canRedo} onClick={redo}>
            <ArrowRedo20Regular />
          </button>
        </Tip>
        <span className="wbi-titlebar__title" title={project?.source.path ?? title}>
          {title}
        </span>
      </div>
      <div className="wbi-titlebar__center">
        <CommandSearch />
      </div>
      <div className="wbi-titlebar__right">
        <button type="button" className="wbi-winbtn" aria-label="Minimize" onClick={() => window.wbi?.window.minimize()}>
          <Subtract20Regular />
        </button>
        <button type="button" className="wbi-winbtn" aria-label={maximized ? 'Restore' : 'Maximize'} onClick={() => window.wbi?.window.toggleMaximize()}>
          {maximized ? <SquareMultiple20Regular /> : <Maximize20Regular />}
        </button>
        <button type="button" className="wbi-winbtn wbi-winbtn--close" aria-label="Close" onClick={() => window.wbi?.window.close()}>
          <Dismiss20Regular />
        </button>
      </div>
    </header>
  )
}

function CommandSearch() {
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const results = useMemo<SearchableCommand[]>(() => (q.trim() ? searchCommands(q).slice(0, 10) : []), [q])
  const run = (c: SearchableCommand) => {
    setQ('')
    setFocused(false)
    ;(document.activeElement as HTMLElement | null)?.blur()
    c.run()
  }
  return (
    <div ref={ref} className={cx('wbi-tsearch', focused && 'is-focused')}>
      <Search16Regular />
      <input
        value={q}
        placeholder="Search"
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 150)}
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(results.length - 1, a + 1))
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1))
          else if (e.key === 'Enter' && results[active]) run(results[active])
          else if (e.key === 'Escape') {
            setQ('')
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      {focused && results.length > 0 && (
        <Popover anchor={ref.current} open matchWidth onClose={() => setFocused(false)} ignoreOutside={[ref.current]}>
          <div className="wbi-menu">
            <div className="wbi-menu__header">Actions</div>
            {results.map((c, i) => (
              <button key={c.id} type="button" className={cx('wbi-menu__item', i === active && 'is-active')} onMouseDown={(e) => e.preventDefault()} onClick={() => run(c)}>
                <span className="wbi-menu__icon">{c.icon}</span>
                <span className="wbi-menu__label">{c.label}</span>
                <span className="wbi-menu__shortcut">{c.group}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}
