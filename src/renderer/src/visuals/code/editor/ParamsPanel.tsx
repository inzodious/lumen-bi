/** Editor ▸ Parameters: values the Format pane can change without editing code (CSS `--param-<name>`, `params.<name>`). */
import { cssName } from '@core/codevisual/naming'
import { normaliseParam } from '@core/codevisual/model'
import type { ParamDef } from '@core/codevisual/types'
import { Button } from '../../../app/ui/primitives'

const TYPES: Array<{ value: ParamDef['type']; label: string }> = [
  { value: 'color', label: 'Colour' },
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Text' },
  { value: 'toggle', label: 'Toggle' }
]

export function ParamsPanel({ params, onChange }: { params: ParamDef[]; onChange(p: ParamDef[]): void }) {
  const set = (i: number, patch: Partial<ParamDef>) => onChange(params.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const add = () => {
    let n = params.length + 1
    while (params.some((p) => p.name === `param${n}`)) n++
    onChange([...params, { name: `param${n}`, label: `Parameter ${n}`, type: 'number', default: 0 }])
  }
  return (
    <div className="wbi-cve__params">
      <p className="wbi-cve__note">
        Parameters appear in the Format pane under <b>Parameters</b>, so the visual can be restyled without editing code; themes can set them too. Read them as{' '}
        <code>{'{{params.name}}'}</code> in the template, <code>var(--param-name)</code> in CSS and <code>params.name</code> in JSX. A colour left empty means
        &ldquo;automatic&rdquo;.
      </p>
      {params.length > 0 && (
        <table className="wbi-cve__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Label</th>
              <th>Type</th>
              <th>Default</th>
              <th>CSS variable</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {params.map((p, i) => (
              <tr key={i}>
                <td>
                  <input aria-label="Parameter name" value={p.name} onChange={(e) => set(i, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) })} />
                </td>
                <td>
                  <input aria-label="Parameter label" value={p.label} onChange={(e) => set(i, { label: e.target.value.slice(0, 60) })} />
                </td>
                <td>
                  <select aria-label="Parameter type" value={p.type} onChange={(e) => set(i, { type: e.target.value as ParamDef['type'], default: normaliseParam(e.target.value as ParamDef['type'], p.default) })}>
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {p.type === 'toggle' ? (
                    <input aria-label="Default" type="checkbox" checked={p.default === true} onChange={(e) => set(i, { default: e.target.checked })} />
                  ) : p.type === 'color' ? (
                    <span className="wbi-cve__colorcell">
                      <input aria-label="Default colour" type="color" value={String(p.default) || '#118DFF'} onChange={(e) => set(i, { default: e.target.value.toUpperCase() })} />
                      <input aria-label="Default colour hex" value={String(p.default)} placeholder="automatic" onChange={(e) => set(i, { default: e.target.value.trim() })} />
                    </span>
                  ) : (
                    <input aria-label="Default" type={p.type === 'number' ? 'number' : 'text'} value={String(p.default)} onChange={(e) => set(i, { default: p.type === 'number' ? Number(e.target.value) : e.target.value })} />
                  )}
                </td>
                <td>
                  <code>--param-{cssName(p.name)}</code>
                </td>
                <td>
                  <Button size="small" onClick={() => onChange(params.filter((_, j) => j !== i))} aria-label={`Remove ${p.name}`}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Button onClick={add}>Add parameter</Button>
    </div>
  )
}
