/** The starter-template picker of the code visual (Insert ▸ Code visual, the editor's Templates button). */
import { useState } from 'react'
import { STARTER_TEMPLATES, type StarterTemplate } from '@core/codevisual/templates'
import { Modal } from '../../../app/ui/Modal'
import { Button } from '../../../app/ui/primitives'
import './codeEditor.css'

/** Schematic thumbnails (drawn with currentColor and the accent) */
const THUMBS: Record<string, string> = {
  kpi: '<rect x="10" y="12" width="34" height="5" rx="2.5" opacity=".45"/><rect x="10" y="22" width="56" height="13" rx="3"/><rect x="10" y="40" width="22" height="7" rx="3.5" class="a" opacity=".5"/><path class="s" d="M10 66 L24 58 L36 62 L50 50 L64 54 L78 42 L90 46"/>',
  ring: '<circle cx="30" cy="40" r="18" fill="none" stroke-width="7" opacity=".18" stroke="currentColor"/><path class="s" stroke-width="7" d="M30 22 A18 18 0 1 1 13.5 47.2"/><rect x="56" y="30" width="30" height="5" rx="2.5" opacity=".45"/><rect x="56" y="40" width="26" height="10" rx="3"/>',
  barlist: '<path class="s" stroke-width="2" d="M11 13 l-3 3 l3 3" opacity=".6"/><rect x="16" y="12" width="30" height="6" rx="3" opacity=".7"/><rect x="10" y="26" width="18" height="5" rx="2.5" opacity=".45"/><rect x="32" y="26" width="52" height="6" rx="3" class="a"/><rect x="10" y="38" width="18" height="5" rx="2.5" opacity=".45"/><rect x="32" y="38" width="38" height="6" rx="3" class="a"/><rect x="10" y="50" width="18" height="5" rx="2.5" opacity=".45"/><rect x="32" y="50" width="26" height="6" rx="3" class="a"/><rect x="10" y="62" width="18" height="5" rx="2.5" opacity=".45"/><rect x="32" y="62" width="16" height="6" rx="3" class="a"/>',
  badges: '<rect x="8" y="12" width="26" height="24" rx="5" class="a" opacity=".55"/><rect x="38" y="12" width="26" height="24" rx="5" class="a" opacity=".35"/><rect x="68" y="12" width="26" height="24" rx="5" class="a" opacity=".2"/><rect x="8" y="42" width="26" height="24" rx="5" class="a" opacity=".3"/><rect x="38" y="42" width="26" height="24" rx="5" class="a" opacity=".15"/><rect x="68" y="42" width="26" height="24" rx="5" class="a" opacity=".1"/>',
  scorecard: '<rect x="8" y="12" width="86" height="4" rx="2" opacity=".35"/><g><rect x="8" y="26" width="20" height="5" rx="2.5" opacity=".6"/><rect x="34" y="26" width="30" height="5" rx="2.5" class="a"/><rect x="72" y="25" width="20" height="7" rx="3.5" fill="#1AAB40" opacity=".7"/></g><g><rect x="8" y="40" width="20" height="5" rx="2.5" opacity=".6"/><rect x="34" y="40" width="22" height="5" rx="2.5" class="a"/><rect x="72" y="39" width="20" height="7" rx="3.5" fill="#E8A33D" opacity=".8"/></g><g><rect x="8" y="54" width="20" height="5" rx="2.5" opacity=".6"/><rect x="34" y="54" width="12" height="5" rx="2.5" class="a"/><rect x="72" y="53" width="20" height="7" rx="3.5" fill="#D64554" opacity=".7"/></g>',
  steps: '<path d="M18 36 H84" stroke="currentColor" stroke-width="2" opacity=".25"/><circle cx="18" cy="36" r="7" fill="#fff" stroke="currentColor" stroke-width="2" opacity=".5"/><circle cx="40" cy="36" r="7" fill="#fff" stroke="currentColor" stroke-width="2" opacity=".5"/><circle cx="62" cy="36" r="7" fill="#fff" stroke="currentColor" stroke-width="2" opacity=".5"/><circle cx="84" cy="36" r="8" class="a"/><rect x="10" y="50" width="16" height="4" rx="2" opacity=".4"/><rect x="32" y="50" width="16" height="4" rx="2" opacity=".4"/><rect x="54" y="50" width="16" height="4" rx="2" opacity=".4"/><rect x="76" y="50" width="16" height="4" rx="2" opacity=".6"/>',
  'topn-jsx': '<rect x="56" y="10" width="36" height="9" rx="4.5" opacity=".18"/><rect x="58" y="12" width="12" height="5" rx="2.5" opacity=".6"/><rect x="10" y="28" width="16" height="5" rx="2.5" opacity=".45"/><rect x="30" y="28" width="54" height="6" rx="3" class="a"/><rect x="10" y="42" width="16" height="5" rx="2.5" opacity=".45"/><rect x="30" y="42" width="40" height="6" rx="3" class="a"/><rect x="10" y="56" width="16" height="5" rx="2.5" opacity=".45"/><rect x="30" y="56" width="28" height="6" rx="3" class="a"/>'
}

export function TemplateThumb({ id }: { id: string }) {
  return (
    <svg className="wbi-cvt__thumb" viewBox="0 0 102 78" aria-hidden="true" dangerouslySetInnerHTML={{ __html: THUMBS[id] ?? '' }} />
  )
}

export function TemplatePicker({ title, okText, onPick, onClose }: { title?: string; okText?: string; onPick(t: StarterTemplate): void; onClose(): void }) {
  const [sel, setSel] = useState(STARTER_TEMPLATES[0].id)
  const chosen = STARTER_TEMPLATES.find((t) => t.id === sel) ?? STARTER_TEMPLATES[0]
  return (
    <Modal
      title={title ?? 'Choose a template'}
      subtitle="Every template reads the fields you put in the wells and follows the report theme. You can change everything in the code editor afterwards."
      onClose={onClose}
      width={720}
      onSubmit={() => onPick(chosen)}
      footer={
        <>
          <Button variant="primary" onClick={() => onPick(chosen)}>
            {okText ?? 'OK'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <div className="wbi-cvt" role="listbox" aria-label="Code visual templates">
        {STARTER_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="option"
            aria-selected={t.id === sel}
            className={`wbi-cvt__card${t.id === sel ? ' is-selected' : ''}`}
            onClick={() => setSel(t.id)}
            onDoubleClick={() => onPick(t)}
          >
            <TemplateThumb id={t.id} />
            <span className="wbi-cvt__name">{t.name}</span>
          </button>
        ))}
      </div>
      <div className="wbi-cvt__about">
        <div className="wbi-cvt__desc">{chosen.description}</div>
        <div className="wbi-cvt__wells">{chosen.wells}</div>
      </div>
    </Modal>
  )
}
