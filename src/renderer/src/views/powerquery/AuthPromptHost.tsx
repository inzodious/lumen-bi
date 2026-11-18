/**
 * Microsoft Entra ID sign-in prompt (device code / browser), shown while a connector authenticates.
 * Listens to `window.wbi.connectors.onAuthPrompt`; closes when the main process reports the sign-in
 * as done or failed. Mount once for the whole app (refresh can run outside the Power Query Editor);
 * the editor mounts it too; one listener is shared and the oldest mounted host renders the prompt.
 */
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { CopyRegular, OpenRegular } from '@fluentui/react-icons'
import type { AuthPrompt } from '@shared/host'
import { Button, Modal, Spinner, toast } from '../../app/ui'
import './dialogs/dialogs.css'

/**
 * One subscription for the whole app (started by the first mounted host, kept while any host is
 * mounted); the prompt lives in a tiny store and only the oldest mounted host renders it, so the
 * shell's host takes over when the editor's host unmounts.
 */
const usePrompt = create<{ prompt: AuthPrompt | null; hosts: number[] }>(() => ({ prompt: null, hosts: [] }))
let off: (() => void) | undefined
let nextHost = 1

function subscribe(): void {
  if (off) return
  off = window.wbi?.connectors?.onAuthPrompt?.((p) => {
    if (p.state === 'done') return usePrompt.setState({ prompt: null })
    if (p.state === 'failed') {
      usePrompt.setState({ prompt: null })
      toast({ kind: 'error', title: 'Sign-in failed', message: p.message })
      return
    }
    usePrompt.setState({ prompt: p })
  })
}

function remaining(expiresOn: number | undefined, now: number): string | null {
  if (!expiresOn) return null
  const s = Math.max(0, Math.round((expiresOn - now) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function AuthPromptHost() {
  const [id] = useState(() => nextHost++)
  const prompt = usePrompt((s) => s.prompt)
  const active = usePrompt((s) => s.hosts[0] === id)
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    subscribe()
    usePrompt.setState((s) => ({ hosts: [...s.hosts, id] }))
    return () => {
      const hosts = usePrompt.getState().hosts.filter((h) => h !== id)
      usePrompt.setState({ hosts })
      if (!hosts.length) {
        off?.()
        off = undefined
      }
    }
  }, [id])

  useEffect(() => setCopied(false), [prompt])

  useEffect(() => {
    if (!prompt?.expiresOn) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [prompt])

  if (!active || !prompt) return null
  const close = () => usePrompt.setState({ prompt: null })
  const left = remaining(prompt.expiresOn, now)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.userCode ?? '')
      setCopied(true)
    } catch {
      toast({ kind: 'warning', message: 'Could not copy the code. Select it and copy it manually.' })
    }
  }
  const open = () => {
    if (prompt.verificationUri) void window.wbi?.app.openExternal(prompt.verificationUri).catch(() => undefined)
  }
  return (
    <Modal title="Sign in" subtitle="Microsoft account" onClose={close} width={520} footer={<Button onClick={close}>Cancel</Button>}>
      <div className="wbi-col" style={{ gap: 14 }}>
        {prompt.kind === 'device-code' ? (
          <>
            <div>To sign in, open the sign-in page in your browser and enter this code:</div>
            {prompt.userCode && (
              <div className="wbi-row" style={{ gap: 8 }}>
                <span className="wbi-pq-dlg__code wbi-selectable">{prompt.userCode}</span>
                <Button icon={<CopyRegular fontSize={16} />} onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            )}
            {prompt.verificationUri && (
              <div>
                <Button variant="primary" icon={<OpenRegular fontSize={16} />} onClick={open}>
                  Open sign-in page
                </Button>
                <div className="wbi-pq-dlg__hint wbi-selectable" style={{ marginTop: 6 }}>
                  {prompt.verificationUri}
                </div>
              </div>
            )}
            <div className="wbi-pq-dlg__hint wbi-selectable">{prompt.message}</div>
            <div className="wbi-row" style={{ gap: 8 }}>
              <Spinner label={`Waiting for you to sign in…${left ? ` (code expires in ${left})` : ''}`} />
            </div>
          </>
        ) : prompt.kind === 'browser' ? (
          <>
            <div className="wbi-selectable">{prompt.message}</div>
            <Spinner label="Waiting for you to sign in…" />
          </>
        ) : (
          <div className="wbi-selectable">{prompt.message}</div>
        )}
      </div>
    </Modal>
  )
}
