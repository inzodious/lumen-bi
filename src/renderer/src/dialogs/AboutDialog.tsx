/** About dialog: logo, product name, versions, credits. */
import { Button, Modal } from '../app/ui'
import { APP_NAME, APP_TAGLINE } from '../app/brand'
import { LumenLogo } from '../app/Logo'

function versionOf(re: RegExp): string | undefined {
  return re.exec(navigator.userAgent)?.[1]
}

const CREDITS = ['Fluent UI System Icons', 'Open Sans', 'React', 'zustand', 'immer', 'd3', 'Vega / Vega-Lite', 'ExcelJS', 'PptxGenJS', 'fflate', 'hyparquet', 'sql.js', 'tedious', 'CodeMirror', 'React Flow']

export function AboutDialog({ onClose }: { onClose(): void }) {
  const electron = versionOf(/Electron\/([\d.]+)/)
  const chrome = versionOf(/Chrome\/([\d.]+)/)
  return (
    <Modal
      title={`About ${APP_NAME}`}
      onClose={onClose}
      width={520}
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="wbi-about">
        <LumenLogo size={72} />
        <div style={{ minWidth: 0 }}>
          <h3 className="wbi-about__name">{APP_NAME}</h3>
          <div className="wbi-muted" style={{ marginBottom: 6 }}>
            {APP_TAGLINE}
          </div>
          <div className="wbi-about__ver">
            Version {window.wbi?.app.version ?? '0.1.0'}
            {electron ? ` · Electron ${electron}` : ''}
            {chrome ? ` · Chromium ${chrome}` : ''} · {window.wbi?.app.platform ?? 'linux'}
          </div>
          <div className="wbi-about__credits">
            Opens Power BI files (.pbix, .pbit, PBIP) — not affiliated with or endorsed by Microsoft. Power BI is a trademark of Microsoft Corporation.
            <br />
            <br />
            Built with {CREDITS.join(', ')}.
          </div>
        </div>
      </div>
    </Modal>
  )
}
