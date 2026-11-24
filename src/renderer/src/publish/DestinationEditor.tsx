/** Add or edit a hosted publish destination: its kind, name, settings and secrets (secrets are never shown again). */
import { useState } from 'react'
import type { PublishDestination, PublishDestinationKind } from '@shared/host'
import { Button, Dropdown, Modal, TextField } from '../app/ui'
import { DESTINATION_KINDS, kindInfo, useDestinations } from './destinations'

export function DestinationEditor({ existing, onClose }: { existing?: PublishDestination; onClose(saved?: PublishDestination): void }) {
  const [kind, setKind] = useState<PublishDestinationKind>(existing?.kind ?? 'github-pages')
  const [name, setName] = useState(existing?.name ?? '')
  const [values, setValues] = useState<Record<string, string>>(existing?.settings ?? {})
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [signedIn, setSignedIn] = useState<string | null>(null)
  const info = kindInfo(kind)!
  const missing = info.fields.filter((f) => f.required && !(f.secret ? secrets[f.key] || existing?.secrets.includes(f.key) : values[f.key]?.trim())).map((f) => f.label)
  const canSave = !busy && !!name.trim() && !missing.length

  const signInWithGoogle = async () => {
    const url = values.url?.trim()
    if (!url) return setError('Enter the server address first.')
    setBusy(true)
    setError(null)
    const r = await window.wbi.publish!.connectLumenServer!(url)
    setBusy(false)
    if (!r.ok || !r.key) return setError(r.message ?? 'The sign-in did not finish.')
    setSecrets((s) => ({ ...s, token: r.key! }))
    setSignedIn(r.email ?? '')
    if (!name.trim()) setName('My dashboards')
  }

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const settings: Record<string, string> = {}
      for (const f of info.fields) if (!f.secret && values[f.key]?.trim()) settings[f.key] = values[f.key].trim()
      const sec: Record<string, string | undefined> = {}
      for (const f of info.fields) if (f.secret) sec[f.key] = secrets[f.key] ? secrets[f.key] : undefined
      const saved = await window.wbi.publish!.destinations.set({ id: existing?.id, kind, name: name.trim(), settings, secrets: sec })
      await useDestinations.getState().refresh()
      onClose(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={existing ? 'Edit destination' : 'Add destination'}
      onClose={() => onClose()}
      width={520}
      onSubmit={save}
      footerLeft={error ? <span className="wbi-pub__reason">{error}</span> : !canSave && missing.length ? <span className="wbi-pub__hint">Required: {missing.join(', ')}</span> : undefined}
      footer={
        <>
          <Button variant="primary" disabled={!canSave} onClick={save}>
            Save
          </Button>
          <Button onClick={() => onClose()}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-col wbi-pub__body">
        <Dropdown label="Type" value={kind} disabled={!!existing} options={DESTINATION_KINDS.map((k) => ({ value: k.kind, label: k.label }))} onChange={(k) => setKind(k)} />
        <div className="wbi-dlg-help">{info.help}</div>
        <TextField label="Name" value={name} placeholder={`My ${info.label}`} onChange={setName} />
        {info.fields.map((f) =>
          f.secret && kind === 'lumen-server' && signedIn !== null ? (
            <div key={`${kind}:${f.key}`} className="wbi-pub__ok">
              Signed in with Google as {signedIn}. Save to keep this computer connected.
            </div>
          ) : f.secret ? (
            <TextField
              key={`${kind}:${f.key}`}
              label={f.label}
              type="password"
              value={secrets[f.key] ?? ''}
              placeholder={existing?.secrets.includes(f.key) ? 'Saved. Type to replace it.' : f.placeholder}
              hint={f.hint}
              onChange={(v) => setSecrets((s) => ({ ...s, [f.key]: v }))}
            />
          ) : (
            <TextField key={`${kind}:${f.key}`} label={f.label} value={values[f.key] ?? ''} placeholder={f.placeholder} hint={f.hint} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
          )
        )}
        {kind === 'lumen-server' && window.wbi.publish?.connectLumenServer && signedIn === null ? (
          <div>
            <Button onClick={() => void signInWithGoogle()} disabled={busy || !values.url?.trim()}>
              {busy ? 'Waiting for the browser…' : 'Sign in with Google'}
            </Button>
            <span className="wbi-pub__hint"> Opens the server's sign-in page in your browser.</span>
          </div>
        ) : null}
        <div className="wbi-pub__summary">Tokens and keys are stored encrypted with your system keyring and are only sent to the service they belong to.</div>
      </div>
    </Modal>
  )
}
