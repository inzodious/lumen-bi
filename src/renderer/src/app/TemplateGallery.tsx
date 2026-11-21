/**
 * Report template gallery (Start screen ▸ Gallery and File ▸ New): one card per built-in template with its
 * preview, style and whether it is Power BI compatible or uses Lumen-only features. Clicking a card
 * creates a new, unsaved report from the template.
 */
import { useState } from 'react'
import { REPORT_TEMPLATES, newFromTemplate, type ReportTemplate } from './templates'
import { cx } from './ui/cx'

const previews = import.meta.glob<string>('../assets/templates/*.jpg', { eager: true, query: '?url', import: 'default' })

function previewOf(id: string): string | undefined {
  return previews[`../assets/templates/${id}.jpg`]
}

type Filter = 'all' | 'powerbi' | 'lumen'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'powerbi', label: 'Power BI compatible' },
  { id: 'lumen', label: 'Lumen only' }
]

export function CompatBadge({ template }: { template: ReportTemplate }) {
  if (!template.compatibility) return null
  const lumen = template.compatibility === 'lumen'
  const title = lumen
    ? `Uses Lumen-only features: ${(template.lumenFeatures ?? []).join('; ')}. Power BI Desktop opens it and draws those parts plainly.`
    : 'Uses only what Power BI Desktop renders the same way: save it as PBIP or .pbit and it opens there as is.'
  return (
    <span className={cx('wbi-gallery__badge', lumen ? 'is-lumen' : 'is-pbi')} title={title}>
      {lumen ? 'Lumen only' : 'Power BI compatible'}
    </span>
  )
}

function Card({ template, onOpen }: { template: ReportTemplate; onOpen(): void }) {
  const src = previewOf(template.id)
  return (
    <button type="button" className="wbi-gallery__card" onClick={onOpen} aria-label={`${template.name}: ${template.summary}`} title={template.description}>
      <span className="wbi-gallery__thumb">
        {src ? (
          <img src={src} alt="" draggable={false} />
        ) : (
          <span className="wbi-gallery__swatch">
            {(template.swatch ?? ['#e1dfdd', '#605e5c']).map((c) => (
              <span key={c} style={{ background: c }} />
            ))}
          </span>
        )}
      </span>
      <span className="wbi-gallery__meta">
        <span className="wbi-gallery__row">
          <span className="wbi-gallery__name">{template.name}</span>
          {template.style ? <span className="wbi-gallery__style">{template.style}</span> : null}
        </span>
        <span className="wbi-gallery__summary">{template.summary}</span>
        <CompatBadge template={template} />
      </span>
    </button>
  )
}

/** The template cards with an All / Power BI compatible / Lumen only filter. `onPicked` runs after a template opened. */
export function TemplateGallery({ onPicked, compact }: { onPicked?(): void; compact?: boolean }) {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = REPORT_TEMPLATES.filter((t) => filter === 'all' || t.compatibility === filter)
  return (
    <div className={cx('wbi-gallery', compact && 'is-compact')}>
      <div className="wbi-gallery__filters" role="radiogroup" aria-label="Show templates">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} className={cx('wbi-gallery__filter', filter === f.id && 'is-on')} onClick={() => setFilter(f.id)}>
            {f.label}
            <span className="wbi-gallery__count">{f.id === 'all' ? REPORT_TEMPLATES.length : REPORT_TEMPLATES.filter((t) => t.compatibility === f.id).length}</span>
          </button>
        ))}
      </div>
      <div className="wbi-gallery__grid" aria-label="Gallery">
        {shown.map((t) => (
          <Card
            key={t.id}
            template={t}
            onOpen={() =>
              void newFromTemplate(t.id).then((ok) => {
                if (ok) onPicked?.()
              })
            }
          />
        ))}
      </div>
    </div>
  )
}
