/**
 * PBI "Options" dialog (File ▸ Options and settings ▸ Options): GLOBAL and CURRENT FILE sections.
 * Values live in useShell().options (persisted in localStorage). Edits are staged and saved on OK.
 */
import { useState } from 'react'
import { useShell, DEFAULT_OPTIONS, type UserOptions } from '../app/shellState'
import { BUILTIN_THEMES } from '../app/themes'
import { APP_NAME } from '../app/brand'
import { Button, Checkbox, Dropdown, Modal, NumberField, Radio, TextField } from '../app/ui'
import { cx } from '../app/ui/cx'

type Section = 'dataLoad' | 'regional' | 'report' | 'security' | 'diagnostics' | 'fileDataLoad' | 'fileReport'

const NAV: Array<{ header: string; items: Array<{ key: Section; label: string }> }> = [
  {
    header: 'Global',
    items: [
      { key: 'dataLoad', label: 'Data Load' },
      { key: 'regional', label: 'Regional Settings' },
      { key: 'report', label: 'Report settings' },
      { key: 'security', label: 'Security' },
      { key: 'diagnostics', label: 'Diagnostics' }
    ]
  },
  {
    header: 'Current file',
    items: [
      { key: 'fileDataLoad', label: 'Data Load' },
      { key: 'fileReport', label: 'Report settings' }
    ]
  }
]

export const LOCALES = [
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'de-DE', label: 'German (Germany)' },
  { value: 'fr-FR', label: 'French (France)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'it-IT', label: 'Italian (Italy)' },
  { value: 'nl-NL', label: 'Dutch (Netherlands)' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'ja-JP', label: 'Japanese (Japan)' },
  { value: 'zh-CN', label: 'Chinese (Simplified, PRC)' }
]

export function OptionsDialog({ section: initial, onClose }: { section?: string; onClose(): void }) {
  const saved = useShell((s) => s.options)
  const setOptions = useShell((s) => s.setOptions)
  const [opts, setOpts] = useState<UserOptions>(saved)
  const [section, setSection] = useState<Section>((initial as Section) ?? 'dataLoad')
  const set = (patch: Partial<UserOptions>) => setOpts((o) => ({ ...o, ...patch }))
  const ok = () => {
    setOptions(opts)
    onClose()
  }
  return (
    <Modal
      title="Options"
      onClose={onClose}
      width="min(820px, calc(100vw - 64px))"
      height="min(600px, calc(100vh - 64px))"
      footerLeft={
        <Button variant="subtle" onClick={() => setOpts(DEFAULT_OPTIONS)}>
          Restore defaults
        </Button>
      }
      footer={
        <>
          <Button variant="primary" onClick={ok}>
            OK
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-dlg-split">
        <div className="wbi-dlg-nav">
          {NAV.map((g) => (
            <div key={g.header} style={{ display: 'contents' }}>
              <div className="wbi-dlg-nav__header">{g.header}</div>
              {g.items.map((i) => (
                <button key={i.key} type="button" className={cx('wbi-dlg-nav__item', section === i.key && 'is-active')} onClick={() => setSection(i.key)}>
                  {i.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="wbi-dlg-main">
          {section === 'dataLoad' && (
            <>
              <div className="wbi-dlg-section-title">When tables have no data</div>
              <div className="wbi-dlg-help">Reports opened from PBIP projects or templates often contain no cached data. Choose what {APP_NAME} does when it opens such a file.</div>
              <Radio checked={opts.onMissingData === 'ask'} onChange={() => set({ onMissingData: 'ask' })} label="Ask me (show a notification)" />
              <Radio checked={opts.onMissingData === 'refresh'} onChange={() => set({ onMissingData: 'refresh' })} label="Refresh from the data sources" />
              <Radio checked={opts.onMissingData === 'synthetic'} onChange={() => set({ onMissingData: 'synthetic' })} label="Generate sample data automatically" />
              <div className="wbi-dlg-section-title">Sample data</div>
              <div className="wbi-dlg-help">Sample data is generated from the model schema. Keys stay consistent across relationships; the same seed always produces the same rows.</div>
              <div className="wbi-dlg-grid2">
                <NumberField label="Random seed" value={opts.syntheticSeed} min={0} max={2 ** 31 - 1} onChange={(v) => set({ syntheticSeed: v ?? 42 })} />
                <NumberField label="Approximate fact table rows" value={opts.syntheticFactRows} min={10} max={1_000_000} onChange={(v) => set({ syntheticFactRows: v ?? 5000 })} />
              </div>
              <div className="wbi-dlg-help">
                Every value is invented. Category values, flags, thresholds and dates that your formulas and report filters compare columns to are reused so that filtered measures return data; names, ids, e-mail addresses and free text never are, unless you allow
                it below.
              </div>
              <Checkbox
                checked={opts.syntheticReuseIdentifying}
                onChange={(v) => set({ syntheticReuseIdentifying: v })}
                label="Also reuse names and ids mentioned in formulas and report filters (visuals filtered to a specific customer or person then show data, under the real name)"
              />
            </>
          )}
          {section === 'regional' && (
            <>
              <div className="wbi-dlg-section-title">Locale for import</div>
              <div className="wbi-dlg-help">Used to format numbers and dates in visuals and to interpret text when loading data.</div>
              <div style={{ maxWidth: 320 }}>
                <Dropdown value={opts.locale} options={LOCALES} onChange={(v) => set({ locale: v })} />
              </div>
            </>
          )}
          {section === 'report' && (
            <>
              <div className="wbi-dlg-section-title">Default report theme</div>
              <div style={{ maxWidth: 320 }}>
                <Dropdown value={opts.defaultTheme} options={BUILTIN_THEMES.map((t) => ({ value: t.name, label: t.name }))} onChange={(v) => set({ defaultTheme: v })} />
              </div>
              <div className="wbi-dlg-help">Applied to new reports.</div>
              <div className="wbi-dlg-section-title">Start-up</div>
              <Checkbox checked={opts.showStartScreen} onChange={(v) => set({ showStartScreen: v })} label="Show the welcome screen on startup" />
              <Checkbox checked={opts.autoRecovery} onChange={(v) => set({ autoRecovery: v })} label="Store auto-recovery information" />
            </>
          )}
          {section === 'security' && (
            <>
              <div className="wbi-dlg-section-title">SQL Server / Microsoft Fabric sign-in</div>
              <div className="wbi-dlg-help">How {APP_NAME} authenticates to SQL Server, Azure SQL and Fabric SQL analytics endpoints during refresh. Windows authentication is not available on Linux.</div>
              <div style={{ maxWidth: 420 }}>
                <Dropdown
                  label="Authentication method"
                  value={opts.sqlAuth}
                  onChange={(v) => set({ sqlAuth: v })}
                  options={[
                    { value: 'azure-default', label: 'Microsoft Entra ID — default credential chain' },
                    { value: 'azure-cli', label: 'Microsoft Entra ID — Azure CLI (az login)' },
                    { value: 'device-code', label: 'Microsoft Entra ID — device code' },
                    { value: 'interactive', label: 'Microsoft Entra ID — browser sign-in' },
                    { value: 'sql', label: 'SQL Server authentication (asked per source)' }
                  ]}
                />
              </div>
              <div style={{ maxWidth: 420 }}>
                <TextField label="Tenant ID (optional)" value={opts.sqlTenantId} onChange={(v) => set({ sqlTenantId: v.trim() })} placeholder="00000000-0000-0000-0000-000000000000" />
              </div>
              <div className="wbi-dlg-section-title">Data source settings</div>
              <div className="wbi-dlg-help">Saved credentials (kept encrypted by the operating system's key store) and privacy levels, per data source.</div>
              <div>
                <Button onClick={() => useShell.getState().openDialog({ id: 'dataSources' })}>Data source settings…</Button>
              </div>
            </>
          )}
          {section === 'diagnostics' && (
            <>
              <div className="wbi-dlg-section-title">Diagnostics</div>
              <div className="wbi-dlg-help">
                Version {window.wbi?.app.version ?? '—'} on {window.wbi?.app.platform ?? navigator.platform}. Open the developer tools with Ctrl+Shift+I to inspect renderer logs.
              </div>
            </>
          )}
          {section === 'fileDataLoad' && (
            <>
              <div className="wbi-dlg-section-title">Relationships</div>
              <Checkbox checked={opts.autoDetectRelationships} onChange={(v) => set({ autoDetectRelationships: v })} label="Autodetect new relationships after data is loaded" />
              <div className="wbi-dlg-section-title">Time intelligence</div>
              <Checkbox checked={opts.autoDateTime} onChange={(v) => set({ autoDateTime: v })} label="Auto date/time" />
              <div className="wbi-dlg-help">Auto date/time creates hidden date tables for date columns. Existing variations in opened models are always kept.</div>
            </>
          )}
          {section === 'fileReport' && (
            <>
              <div className="wbi-dlg-section-title">Report settings</div>
              <div className="wbi-dlg-help">Visual interaction defaults and filter pane options are stored in the report and edited from the View and Format ribbons.</div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
