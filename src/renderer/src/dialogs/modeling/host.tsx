/**
 * Modeling dialog host. Dialogs are opened imperatively (`showModelingDialog(<X/>)`) and rendered by
 * <ModelingDialogHost/>. The shell may mount the host; if it doesn't, the first call mounts one
 * automatically into its own root, so commands work from anywhere.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { create } from 'zustand'

interface DialogEntry {
  id: number
  render: (close: () => void) => ReactNode
}

interface ModelingDialogsState {
  stack: DialogEntry[]
  /** mounted host ids; only the first one renders (avoids duplicates when the shell also mounts a host) */
  hosts: number[]
}

export const useModelingDialogs = create<ModelingDialogsState>(() => ({ stack: [], hosts: [] }))
let nextHost = 1

let nextId = 1
let autoRoot = false

/** Show a dialog. `render` receives a `close` callback. Returns a function that closes it. */
export function showModelingDialog(render: (close: () => void) => ReactNode): () => void {
  ensureHost()
  const id = nextId++
  const close = () => useModelingDialogs.setState((s) => ({ stack: s.stack.filter((d) => d.id !== id) }))
  useModelingDialogs.setState((s) => ({ stack: [...s.stack, { id, render }] }))
  return close
}

function ensureHost(): void {
  if (useModelingDialogs.getState().hosts.length > 0 || autoRoot || typeof document === 'undefined') return
  autoRoot = true
  const el = document.createElement('div')
  el.id = 'wbi-modeling-dialogs'
  document.body.appendChild(el)
  createRoot(el).render(<ModelingDialogHost />)
}

export function ModelingDialogHost() {
  const stack = useModelingDialogs((s) => s.stack)
  const [hostId] = useState(() => nextHost++)
  const primary = useModelingDialogs((s) => s.hosts[0] === hostId)
  useEffect(() => {
    useModelingDialogs.setState((s) => ({ hosts: [...s.hosts, hostId] }))
    return () => useModelingDialogs.setState((s) => ({ hosts: s.hosts.filter((h) => h !== hostId) }))
  }, [hostId])
  if (!primary) return null
  return (
    <>
      {stack.map((d) => (
        <DialogSlot key={d.id} entry={d} />
      ))}
    </>
  )
}

function DialogSlot({ entry }: { entry: DialogEntry }) {
  const close = () => useModelingDialogs.setState((s) => ({ stack: s.stack.filter((d) => d.id !== entry.id) }))
  return <>{entry.render(close)}</>
}
