/** Editor ▸ Data: exactly what the code receives — columns with their CSS / JS names, the rows, the root and row variables. */
import type { CodeVisualStatus } from '../CodeVisual'

export function DataPanel({ status }: { status: CodeVisualStatus | null }) {
  const d = status?.data
  if (!d) return <div className="wbi-cve__note">No data yet. Put fields in the wells; the preview's data appears here.</div>
  const rowVars = (status?.rowStyles?.[0] ?? '')
    .split(';')
    .filter(Boolean)
    .map((p) => [p.slice(0, p.indexOf(':')), p.slice(p.indexOf(':') + 1)])
  const shown = d.rows.slice(0, 100)
  return (
    <div className="wbi-cve__data">
      <h3>Fields</h3>
      <table className="wbi-cve__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Well</th>
            <th>Template / JSX</th>
            <th>CSS</th>
            <th>Type</th>
            <th>Format</th>
          </tr>
        </thead>
        <tbody>
          {d.columns.map((c) => (
            <tr key={c.name + c.role}>
              <td>{c.name}</td>
              <td>{c.role === 'rows' ? `Rows (level ${(c.level ?? 0) + 1})` : c.role === 'values' ? 'Values' : 'Tooltips'}</td>
              <td>
                <code>{`{{${/\s/.test(c.name) ? c.name : c.name}}}`}</code> · <code>row.{c.js}</code>
              </td>
              <td>
                <code>--{c.css}</code>
                {c.kind === 'value' ? (
                  <>
                    {' '}
                    <code>--{c.css}-text</code>
                  </>
                ) : null}
              </td>
              <td>{c.dataType}</td>
              <td>{c.formatString ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>
        Rows ({d.rows.length.toLocaleString('en-US')}
        {d.truncated ? `, cut at the row limit of ${d.rowLimit.toLocaleString('en-US')}` : ''})
      </h3>
      {d.rows.length ? (
        <div className="wbi-cve__scroll">
          <table className="wbi-cve__table">
            <thead>
              <tr>
                <th>#</th>
                {d.columns.map((c) => (
                  <th key={c.name + c.role}>{c.name}</th>
                ))}
                <th>selected</th>
                <th>highlighted</th>
                <th>depth</th>
                <th>canDrill</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key}>
                  <td>{r.index}</td>
                  {d.columns.map((c) => (
                    <td key={c.name + c.role} title={r.cells[c.name] ? JSON.stringify(r.cells[c.name].value) : ''}>
                      {r.cells[c.name]?.formatted ?? ''}
                      {r.cells[c.name]?.highlight !== undefined ? <span className="wbi-cve__hl"> ({r.cells[c.name]?.highlightFormatted || '–'})</span> : null}
                    </td>
                  ))}
                  <td>{String(r.selected)}</td>
                  <td>{String(r.highlighted)}</td>
                  <td>{r.depth}</td>
                  <td>{String(r.canDrill)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="wbi-cve__note">No rows.</div>
      )}
      <h3>Drill</h3>
      <div className="wbi-cve__note">
        Level {d.drill.level + 1} of {Math.max(1, d.drill.levels.length)} ({d.drill.levelName || 'none'}){d.drill.breadcrumb ? ` · ${d.drill.breadcrumb}` : ''} · can drill down: {String(d.drill.canDrillDown)} · can drill up: {String(d.drill.canDrillUp)}
      </div>
      <h3>CSS variables on the root</h3>
      <VarTable vars={Object.entries(status?.vars ?? {})} />
      <h3>CSS variables of the first row</h3>
      <VarTable vars={rowVars} />
    </div>
  )
}

function VarTable({ vars }: { vars: string[][] }) {
  if (!vars.length) return <div className="wbi-cve__note">None.</div>
  return (
    <table className="wbi-cve__table wbi-cve__vars">
      <tbody>
        {vars.map(([k, v]) => (
          <tr key={k}>
            <td>
              <code>{k}</code>
            </td>
            <td>
              <code>{v}</code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
