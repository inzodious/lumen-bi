/**
 * Conditional formatting (fx) dialogs — Power BI Desktop's "Background color - <series>" dialog family:
 *  - color properties: Format style Gradient / Rules / Field value
 *  - text / web URL properties: Field value
 *  - icons: Rules / Field value + icon layout, alignment and style sets
 *  - data bars: min/max, bar colors, axis, direction, show bar only
 * Edits a local draft; OK writes the PBIR expressions (cf/rules.ts) through one undoable mutateReport.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AddRegular, ArrowDownRegular, ArrowSortRegular, ArrowUpRegular, DeleteRegular } from '@fluentui/react-icons'
import type { SemanticModel } from '@core/model/types'
import type { ResolvedTheme } from '@core/report/theme'
import { themeDataColor } from '@core/report/theme'
import type { VisualDocument } from '@core/report/types'
import { useApp } from '../../../state/store'
import { findPage, findVisual, visualTypeOf } from '../../../report/pbir'
import { parseHash } from '../../../app/Router'
import { Button, Checkbox, ColorPicker, Dropdown, Modal, NumberField, TextField, cx } from '../../../app/ui'
import { colorToken } from '../../../visuals/common/conditionalFormatting'
import { CFIcon } from '../../../visuals/tables/cfIcons'
import { visualBag } from '../objects'
import { roleProjections, isValueProjection } from '../wells'
import { defaultAggregation, defaultInputFor, inputForField, inputIsNumeric, isColumnField, modelFields } from './fields'
import {
  APPLY_TO,
  ICON_SETS,
  RULE_OPS,
  SECOND_OPS,
  SUMMARIZATIONS,
  TEXT_SUMMARIZATIONS,
  defaultDataBars,
  defaultGradient,
  defaultIconRules,
  iconChoices,
  inputLabel,
  matchingOptionOf,
  parseCF,
  parseDataBars,
  parseIcons,
  reverseRuleValues,
  serializeCF,
  serializeDataBars,
  serializeIcons,
  stableKey,
  type ApplyTo,
  type CFColor,
  type CFInput,
  type CFModel,
  type CFStyle,
  type DataBarsModel,
  type GradientModel,
  type GradientStop,
  type IconsModel,
  type NullStrategy,
  type RuleBound,
  type RuleOp,
  type RuleRow,
  type RulesModel
} from './rules'
import { cellTarget, cfRendered, findCF, type CFTarget } from './target'
import { useCfDialog } from './store'
import { commitCF } from './actions'
import './cf.css'

// ---------------------------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------------------------

const commit = commitCF

const CONTAINER_OBJECTS = new Set(['title', 'subTitle', 'background', 'border', 'dropShadow', 'visualHeader', 'visualTooltip', 'divider', 'lockAspect'])
let hashHandled = false

/** `#/?…&cf=<object>.<prop>[@<queryRef>]&cfStyle=gradient|rules|fieldValue` opens the dialog for the selected visual (headless captures). */
function targetFromHash(): { target: CFTarget; style?: CFStyle } | undefined {
  const params = parseHash(window.location.hash).params
  const spec = params.get('cf')
  if (!spec) return undefined
  const app = useApp.getState()
  const page = findPage(app.project?.report, app.activePage)
  const visual = findVisual(page, app.selectedVisuals[0])
  if (!page || !visual) return undefined
  const m = /^([A-Za-z]+)\.([A-Za-z]+)(?:@(.+))?$/.exec(spec)
  if (!m) return undefined
  const [, object, prop, ref] = m
  const style = (params.get('cfStyle') ?? undefined) as CFStyle | undefined
  if (object === 'values' || object === 'columnFormatting') {
    const projections = Object.keys(visual.json?.visual?.query?.queryState ?? {}).flatMap((r) => roleProjections(visual.json, r))
    const p = projections.find((x) => x.queryRef === ref) ?? projections.find((x) => isValueProjection(x.field)) ?? projections[0]
    if (!p) return undefined
    const kind = object === 'columnFormatting' ? 'dataBars' : (prop as 'backColor' | 'fontColor' | 'icon' | 'webURL')
    return { target: cellTarget(page.name, visual.name, p.queryRef, p.displayName ?? p.nativeQueryRef ?? p.queryRef, kind), style }
  }
  const container = CONTAINER_OBJECTS.has(object)
  const kind = prop === 'text' || prop === 'altText' ? 'text' : 'color'
  return {
    target: { pageName: page.name, visualName: visual.name, container, object, prop, scoped: !container && object === 'dataPoint', kind, title: prop === 'text' ? 'Title text' : prop.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) },
    style
  }
}

export function CfDialogHost() {
  const target = useCfDialog((s) => s.target)
  const close = useCfDialog((s) => s.close)
  const project = useApp((s) => s.project)
  const theme = useApp((s) => s.theme)
  const [hashStyle, setHashStyle] = useState<CFStyle | undefined>()

  useEffect(() => {
    if (hashHandled) return
    hashHandled = true
    const t = targetFromHash()
    if (t) {
      setHashStyle(t.style)
      useCfDialog.getState().open(t.target)
    }
  }, [])

  if (!target) return null
  const visual = findVisual(findPage(project?.report, target.pageName), target.visualName)
  if (!visual) return null
  const props: DialogProps = { target, visual, model: project?.model, theme, onClose: close, initialStyle: hashStyle }
  const key = `${target.pageName}/${target.visualName}/${target.object}.${target.prop}/${stableKey(target.baseSelector)}`
  if (target.kind === 'dataBars') return <DataBarsDialog key={key} {...props} />
  if (target.kind === 'icon') return <IconsDialog key={key} {...props} />
  return <ValueDialog key={key} {...props} />
}

interface DialogProps {
  target: CFTarget
  visual: VisualDocument
  model: SemanticModel | undefined
  theme: ResolvedTheme
  onClose(): void
  initialStyle?: CFStyle
}

// ---------------------------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------------------------

function titleOf(t: CFTarget): string {
  return t.series ? `${t.title} - ${t.series}` : t.title
}

function displayColor(c: CFColor | undefined, theme: ResolvedTheme): string | undefined {
  if (c === undefined) return undefined
  if (typeof c === 'string') return colorToken(c, theme)
  return themeDataColor(theme, c.theme.ColorId, c.theme.Percent ?? 0)
}

function Swatch({ value, theme, onChange, label }: { value: CFColor | undefined; theme: ResolvedTheme; onChange(c: CFColor): void; label?: string }) {
  return <ColorPicker value={displayColor(value, theme)} themeColors={theme} onChange={(hex) => onChange(hex.toUpperCase())} label={label} />
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('wbi-cf__field', className)}>
      <span className="wbi-cf__label">{label}</span>
      {children}
    </div>
  )
}

function FieldPicker({ model, input, onChange }: { model: SemanticModel | undefined; input: CFInput | undefined; onChange(i: CFInput): void }) {
  const fields = useMemo(() => modelFields(model), [model])
  const current = input ? stableKey(input.field) : undefined
  const options = fields.map((f) => ({ value: f.key, label: f.label, group: f.table }))
  if (input && current && !fields.some((f) => f.key === current)) options.unshift({ value: current, label: inputLabel({ field: input.field }) || 'Current field', group: 'Current' })
  return (
    <Dropdown
      size="small"
      searchable
      value={current}
      placeholder="Search or select a field"
      options={options}
      onChange={(k) => {
        const f = fields.find((x) => x.key === k)
        if (f) onChange(inputForField(model, f.expr))
      }}
    />
  )
}

function SummarizationPicker({ model, input, onChange }: { model: SemanticModel | undefined; input: CFInput; onChange(i: CFInput): void }) {
  if (!isColumnField(input.field)) return null
  const numeric = inputIsNumeric(model, { field: input.field })
  const opts = numeric ? SUMMARIZATIONS.map((s) => ({ value: s.fn, label: s.label })) : TEXT_SUMMARIZATIONS.map((s) => ({ value: s.fn, label: s.label }))
  return (
    <Field label="Summarization">
      <Dropdown size="small" value={input.aggregation ?? defaultAggregation(model, input.field)} options={opts} onChange={(fn) => onChange({ ...input, aggregation: fn })} />
    </Field>
  )
}

function InputRow({ model, input, setInput, extra }: { model: SemanticModel | undefined; input: CFInput | undefined; setInput(i: CFInput): void; extra?: ReactNode }) {
  return (
    <div className="wbi-cf__grid">
      <Field label="What field should we base this on?">
        <FieldPicker model={model} input={input} onChange={setInput} />
      </Field>
      {input ? <SummarizationPicker model={model} input={input} onChange={setInput} /> : <span />}
      {extra ?? <span />}
    </div>
  )
}

function Footer({ onOk, onClose, okDisabled }: { onOk(): void; onClose(): void; okDisabled?: boolean }) {
  return (
    <>
      <Button variant="primary" onClick={onOk} disabled={okDisabled}>
        OK
      </Button>
      <Button onClick={onClose}>Cancel</Button>
    </>
  )
}

function FooterLeft({ target, visual, existing, onRemove }: { target: CFTarget; visual: VisualDocument; existing: boolean; onRemove(): void }) {
  const rendered = cfRendered(visualTypeOf(visual), target)
  return (
    <div className="wbi-cf__footleft">
      {existing && (
        <Button size="small" variant="subtle" icon={<DeleteRegular />} onClick={onRemove}>
          Remove
        </Button>
      )}
      {!rendered && <span className="wbi-cf__note">Saved in Power BI format. Lumen doesn't preview conditional formatting on this property yet.</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Gradient editor
// ---------------------------------------------------------------------------------------------

type GradientDraft = Omit<GradientModel, 'input'>

const STOP_KIND_LABEL: Record<string, string> = { lowest: 'Lowest value', highest: 'Highest value', middle: 'Middle value', number: 'Number', custom: 'Custom (kept as is)' }

function StopEditor({ label, stop, auto, theme, onChange }: { label: string; stop: GradientStop; auto: 'lowest' | 'highest' | 'middle'; theme: ResolvedTheme; onChange(s: GradientStop): void }) {
  const kinds = [auto, 'number', ...(stop.kind === 'custom' ? ['custom'] : [])]
  const options = [
    ...kinds.map((k) => ({ value: k, label: STOP_KIND_LABEL[k] })),
    // Percent / Percentile need visual-level aggregates Lumen's evaluators don't compute (see rules.ts)
    { value: 'percent', label: 'Percent (not supported yet)', disabled: true },
    { value: 'percentile', label: 'Percentile (not supported yet)', disabled: true }
  ]
  return (
    <div className="wbi-cf__stop">
      <span className="wbi-cf__label">{label}</span>
      <Dropdown size="small" value={stop.kind} options={options} onChange={(k) => onChange({ ...stop, kind: k as GradientStop['kind'], ...(k === 'number' && stop.value === undefined ? { value: 0 } : {}) })} />
      {stop.kind === 'number' ? (
        <NumberField size="small" value={stop.value} placeholder="Enter a value" onChange={(v) => onChange({ ...stop, value: v })} />
      ) : (
        <div className="wbi-cf__auto">{stop.kind === 'custom' ? 'Custom value' : STOP_KIND_LABEL[auto]}</div>
      )}
      <Swatch value={stop.color} theme={theme} onChange={(c) => onChange({ ...stop, color: c })} />
    </div>
  )
}

function GradientEditor({ g, theme, onChange }: { g: GradientDraft; theme: ResolvedTheme; onChange(g: GradientDraft): void }) {
  return (
    <div className="wbi-cf__section">
      <Checkbox
        checked={!!g.mid}
        label="Add a middle color"
        onChange={(on) => {
          if (on) onChange({ ...g, mid: { kind: 'middle', color: 'midColor' } })
          else {
            const { mid: _m, ...rest } = g
            onChange(rest)
          }
        }}
      />
      <div className={cx('wbi-cf__stops', g.mid && 'is-three')}>
        <StopEditor label="Minimum" stop={g.min} auto="lowest" theme={theme} onChange={(s) => onChange({ ...g, min: s })} />
        {g.mid && <StopEditor label="Center" stop={g.mid} auto="middle" theme={theme} onChange={(s) => onChange({ ...g, mid: s })} />}
        <StopEditor label="Maximum" stop={g.max} auto="highest" theme={theme} onChange={(s) => onChange({ ...g, max: s })} />
      </div>
      <div className="wbi-cf__preview" style={{ background: `linear-gradient(to right, ${[g.min, g.mid, g.max].filter((s): s is GradientStop => !!s).map((s) => displayColor(s.color, theme)).join(', ')})` }} />
    </div>
  )
}

function stopValid(s: GradientStop | undefined): boolean {
  return !s || s.kind !== 'number' || (s.value !== undefined && Number.isFinite(s.value))
}

// ---------------------------------------------------------------------------------------------
// Rules editor (colors or icons)
// ---------------------------------------------------------------------------------------------

function BoundValue({ b, numeric, onChange }: { b: RuleBound; numeric: boolean; onChange(b: RuleBound): void }) {
  if (RULE_OPS.find((o) => o.op === b.op)?.noValue) return <span className="wbi-cf__auto" />
  return numeric ? (
    <NumberField size="small" value={typeof b.value === 'number' ? b.value : undefined} placeholder="Value" onChange={(v) => onChange({ op: b.op, value: v })} />
  ) : (
    <TextField size="small" value={b.value === null || b.value === undefined ? '' : String(b.value)} placeholder="Value" onChange={(v) => onChange({ op: b.op, value: v })} />
  )
}

const UNIT_OPTIONS = [
  { value: 'number', label: 'Number' },
  { value: 'percent', label: 'Percent (not supported yet)', disabled: true }
]

function RuleEditorRow(props: {
  rule: RuleRow
  index: number
  count: number
  numeric: boolean
  theme: ResolvedTheme
  icons?: string[]
  onChange(r: RuleRow): void
  onMove(delta: number): void
  onDelete(): void
}) {
  const { rule, numeric, theme } = props
  const ops = RULE_OPS.filter((o) => (numeric ? o.numeric : o.text)).map((o) => ({ value: o.op, label: o.label }))
  if (!ops.some((o) => o.value === rule.first.op)) ops.push({ value: rule.first.op, label: RULE_OPS.find((o) => o.op === rule.first.op)?.label ?? rule.first.op })
  const hasSecond = numeric && (rule.first.op === 'gt' || rule.first.op === 'ge')
  const noValue = !!RULE_OPS.find((o) => o.op === rule.first.op)?.noValue
  const set = (patch: Partial<RuleRow>) => props.onChange({ ...rule, ...patch })
  return (
    <div className="wbi-cf__rule" data-rule={props.index}>
      <span className="wbi-cf__word">If value</span>
      <Dropdown size="small" className="wbi-cf__op" value={rule.first.op} options={ops} onChange={(op) => set({ first: { ...rule.first, op: op as RuleOp }, ...(op === 'gt' || op === 'ge' ? {} : { second: undefined }) })} />
      <BoundValue b={rule.first} numeric={numeric} onChange={(b) => set({ first: b })} />
      {numeric && !noValue ? <Dropdown size="small" className="wbi-cf__unit" value="number" options={UNIT_OPTIONS} onChange={() => undefined} /> : <span />}
      {hasSecond ? (
        <>
          <span className="wbi-cf__word">and</span>
          <Dropdown size="small" className="wbi-cf__op" value={rule.second?.op ?? 'lt'} options={SECOND_OPS.map((op) => ({ value: op, label: RULE_OPS.find((o) => o.op === op)!.label }))} onChange={(op) => set({ second: { op: op as RuleOp, value: rule.second?.value } })} />
          <NumberField size="small" value={typeof rule.second?.value === 'number' ? rule.second.value : undefined} placeholder="(none)" onChange={(v) => set({ second: v === undefined ? undefined : { op: rule.second?.op ?? 'lt', value: v } })} />
          <Dropdown size="small" className="wbi-cf__unit" value="number" options={UNIT_OPTIONS} onChange={() => undefined} />
        </>
      ) : (
        <>
          <span />
          <span />
          <span />
          <span />
        </>
      )}
      <span className="wbi-cf__word">then</span>
      {props.icons ? (
        <Dropdown
          size="small"
          className="wbi-cf__icon"
          value={typeof rule.value === 'string' ? rule.value : ''}
          options={iconChoices([typeof rule.value === 'string' ? rule.value : '', ...props.icons].filter(Boolean)).map((n) => ({ value: n, label: n.replace(/([a-z])([A-Z0-9])/g, '$1 $2'), icon: <CFIcon name={n} size={14} /> }))}
          renderValue={() => null}
          onChange={(n) => set({ value: n })}
        />
      ) : (
        <Swatch value={rule.value} theme={theme} onChange={(c) => set({ value: c })} />
      )}
      <div className="wbi-cf__rowbtns">
        <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Move up" disabled={props.index === 0} onClick={() => props.onMove(-1)}>
          <ArrowUpRegular fontSize={14} />
        </button>
        <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Move down" disabled={props.index === props.count - 1} onClick={() => props.onMove(1)}>
          <ArrowDownRegular fontSize={14} />
        </button>
        <button type="button" className="wbi-btn wbi-btn--icon" aria-label="Delete rule" onClick={props.onDelete}>
          <DeleteRegular fontSize={14} />
        </button>
      </div>
    </div>
  )
}

function RulesEditor({ rules, numeric, theme, icons, onChange, newValue }: { rules: RuleRow[]; numeric: boolean; theme: ResolvedTheme; icons?: string[]; onChange(r: RuleRow[]): void; newValue(): CFColor }) {
  const move = (i: number, d: number) => {
    const next = rules.slice()
    const [r] = next.splice(i, 1)
    next.splice(i + d, 0, r)
    onChange(next)
  }
  return (
    <div className="wbi-cf__section">
      <div className="wbi-cf__ruleshead">
        <span className="wbi-cf__label">Rules</span>
        <div className="wbi-row">
          <Button size="small" variant="subtle" icon={<ArrowSortRegular />} disabled={rules.length < 2} onClick={() => onChange(reverseRuleValues(rules))}>
            Reverse order
          </Button>
          <Button
            size="small"
            variant="subtle"
            icon={<AddRegular />}
            onClick={() => onChange([...rules, numeric ? { first: { op: 'ge', value: 0 }, second: { op: 'le', value: 100 }, value: newValue() } : { first: { op: 'eq', value: '' }, value: newValue() }])}
          >
            New rule
          </Button>
        </div>
      </div>
      <div className="wbi-cf__rules">
        {rules.map((r, i) => (
          <RuleEditorRow
            key={i}
            rule={r}
            index={i}
            count={rules.length}
            numeric={numeric}
            theme={theme}
            icons={icons}
            onChange={(nr) => onChange(rules.map((x, j) => (j === i ? nr : x)))}
            onMove={(d) => move(i, d)}
            onDelete={() => onChange(rules.filter((_, j) => j !== i))}
          />
        ))}
        {!rules.length && <div className="wbi-cf__empty">No rules. Use "New rule" to add one.</div>}
      </div>
    </div>
  )
}

function rulesValid(rules: RuleRow[], numeric: boolean): boolean {
  return rules.every((r) => {
    const noValue = RULE_OPS.find((o) => o.op === r.first.op)?.noValue
    if (noValue) return true
    if (numeric) return typeof r.first.value === 'number' && Number.isFinite(r.first.value) && (!r.second || (typeof r.second.value === 'number' && Number.isFinite(r.second.value)))
    return r.first.value !== undefined
  })
}

// ---------------------------------------------------------------------------------------------
// Value dialog (colors / text / web URL)
// ---------------------------------------------------------------------------------------------

const STYLE_LABEL: Record<CFStyle, string> = { gradient: 'Gradient', rules: 'Rules', fieldValue: 'Field value' }

function ValueDialog({ target, visual, model, theme, onClose, initialStyle }: DialogProps) {
  const bag = visualBag(visual.json, target.container)
  const found = findCF(bag, target)
  const parsed = found ? parseCF(found.raw) : undefined
  const pm = parsed?.model
  const styles: CFStyle[] = target.kind === 'color' ? ['gradient', 'rules', 'fieldValue'] : ['fieldValue']
  const fallbackInput = useMemo(() => (target.kind === 'color' ? defaultInputFor(model, visual.json, target.baseSelector?.metadata) : undefined), [model, visual.json, target])
  const [style, setStyle] = useState<CFStyle>(() => (pm && pm.style !== 'raw' && styles.includes(pm.style) ? pm.style : initialStyle && styles.includes(initialStyle) ? initialStyle : styles[0]))
  const [input, setInput] = useState<CFInput | undefined>(() => (pm && pm.style !== 'raw' ? pm.input : fallbackInput))
  const [applyTo, setApplyTo] = useState<ApplyTo>(found?.applyTo ?? 'values')
  const [grad, setGrad] = useState<GradientDraft>(() => {
    const g = pm?.style === 'gradient' ? pm : defaultGradient(input ?? { field: null })
    const { input: _i, ...rest } = g
    return rest
  })
  const [rules, setRules] = useState<RuleRow[]>(() => (pm?.style === 'rules' ? pm.rules : [{ first: { op: 'ge', value: 0 }, second: { op: 'le', value: 100 }, value: theme.dataColors[0]?.toUpperCase() ?? '#118DFF' }]))
  const defaultValue = pm?.style === 'rules' ? pm.defaultValue : undefined
  const raw = pm?.style === 'raw'
  const [replaceRaw, setReplaceRaw] = useState(false)
  const numeric = inputIsNumeric(model, input)
  const wrap = parsed?.wrap ?? (target.kind === 'color' ? 'solid' : 'expr')

  const build = (): CFModel | undefined => {
    if (!input) return undefined
    if (style === 'gradient') return { ...grad, style: 'gradient', input }
    if (style === 'rules') return { style: 'rules', input, rules, ...(defaultValue !== undefined ? { defaultValue } : {}) }
    return { style: 'fieldValue', input }
  }
  const valid = !!input && (style !== 'gradient' || (stopValid(grad.min) && stopValid(grad.mid) && stopValid(grad.max))) && (style !== 'rules' || (rules.length > 0 && rulesValid(rules, numeric)))
  const ok = () => {
    const m = build()
    if (!m) return
    commit(target, serializeCF({ wrap, model: m }), applyTo)
    onClose()
  }

  const emptyValues =
    style === 'gradient' ? (
      <Field label="How should we format empty values?">
        <div className="wbi-row">
          <Dropdown
            size="small"
            value={grad.nullStrategy}
            options={[
              { value: 'asZero', label: 'As zero' },
              { value: 'specificColor', label: 'As specific color' },
              { value: 'noColor', label: "Don't format" }
            ]}
            onChange={(v) => setGrad({ ...grad, nullStrategy: v as NullStrategy, nullOmitted: false, ...(v === 'specificColor' && grad.nullColor === undefined ? { nullColor: '#FFFFFF' } : {}) })}
          />
          {grad.nullStrategy === 'specificColor' && <Swatch value={grad.nullColor} theme={theme} onChange={(c) => setGrad({ ...grad, nullColor: c })} />}
        </div>
      </Field>
    ) : undefined

  return (
    <Modal
      title={titleOf(target)}
      onClose={onClose}
      width={style === 'rules' ? 960 : 680}
      className="wbi-cf-modal"
      footerLeft={<FooterLeft target={target} visual={visual} existing={!!found} onRemove={() => (commit(target, undefined, applyTo), onClose())} />}
      footer={<Footer onOk={ok} onClose={onClose} okDisabled={!valid || (raw && !replaceRaw)} />}
    >
      <div className="wbi-cf">
        {raw && !replaceRaw ? (
          <div className="wbi-cf__rawnote">
            <p>This property uses a conditional formatting expression that this dialog can't edit. It's kept as is when you save.</p>
            <Button size="small" onClick={() => setReplaceRaw(true)}>
              Replace it
            </Button>
          </div>
        ) : (
          <>
            <div className="wbi-cf__grid">
              <Field label="Format style">
                <Dropdown size="small" value={style} options={styles.map((s) => ({ value: s, label: STYLE_LABEL[s] }))} onChange={(s) => setStyle(s)} />
              </Field>
              {target.applyTo ? (
                <Field label="Apply to">
                  <Dropdown size="small" value={applyTo} options={APPLY_TO.map((a) => ({ value: a.value, label: a.label }))} onChange={setApplyTo} />
                </Field>
              ) : (
                <span />
              )}
              <span />
            </div>
            <InputRow model={model} input={input} setInput={setInput} extra={emptyValues} />
            {style === 'gradient' && <GradientEditor g={grad} theme={theme} onChange={setGrad} />}
            {style === 'rules' && <RulesEditor rules={rules} numeric={numeric} theme={theme} onChange={setRules} newValue={() => theme.dataColors[rules.length % theme.dataColors.length]?.toUpperCase() ?? '#118DFF'} />}
            {style === 'fieldValue' && (
              <div className="wbi-cf__hint">
                {target.kind === 'color'
                  ? 'The field should return a color: a hex code such as #118DFF or a color name.'
                  : target.kind === 'webURL'
                    ? 'The field should return a web address (http:// or https://).'
                    : 'The text is the value of the field, evaluated with the filters that apply to this visual.'}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------------------------

const LAYOUTS = [
  { value: 'Before', label: 'Left of data' },
  { value: 'After', label: 'Right of data' },
  { value: 'IconOnly', label: 'Icon only' }
]
const ALIGNS = [
  { value: 'Top', label: 'Top' },
  { value: 'Middle', label: 'Middle' },
  { value: 'Bottom', label: 'Bottom' }
]

function IconsDialog({ target, visual, model, theme, onClose, initialStyle }: DialogProps) {
  const bag = visualBag(visual.json, target.container)
  const found = findCF(bag, target)
  const parsed = found ? parseIcons(found.raw) : undefined
  const fallbackInput = useMemo(() => defaultInputFor(model, visual.json, target.baseSelector?.metadata), [model, visual.json, target])
  const [style, setStyle] = useState<'rules' | 'fieldValue'>(parsed?.rule.style ?? (initialStyle === 'fieldValue' ? 'fieldValue' : 'rules'))
  const [input, setInput] = useState<CFInput | undefined>(parsed?.rule.input ?? fallbackInput)
  const [applyTo, setApplyTo] = useState<ApplyTo>(found?.applyTo ?? 'values')
  const [layout, setLayout] = useState(parsed?.layout ?? 'Before')
  const [align, setAlign] = useState(parsed?.verticalAlignment ?? 'Top')
  const [setId, setSetId] = useState(() => {
    const names = parsed?.rule.style === 'rules' ? parsed.rule.rules.map((r) => r.value) : []
    return ICON_SETS.find((s) => names.length && names.every((n) => typeof n === 'string' && s.icons.includes(n)))?.id ?? (parsed ? '' : 'lights')
  })
  const [rules, setRules] = useState<RuleRow[]>(() => (parsed?.rule.style === 'rules' ? parsed.rule.rules : defaultIconRules(input ?? { field: null }, ICON_SETS.find((s) => s.id === 'lights')!.icons).rules))
  const defaultValue = parsed?.rule.style === 'rules' ? parsed.rule.defaultValue : undefined
  const numeric = inputIsNumeric(model, input)
  const corrupt = !!found && !parsed
  const valid = !!input && !corrupt && (style === 'fieldValue' || (rules.length > 0 && rulesValid(rules, numeric)))

  const ok = () => {
    if (!input) return
    const rule: RulesModel | { style: 'fieldValue'; input: CFInput } = style === 'rules' ? { style: 'rules', input, rules, ...(defaultValue !== undefined ? { defaultValue } : {}) } : { style: 'fieldValue', input }
    const m: IconsModel = { ...(parsed ?? { kind: 'Icon' }), layout, verticalAlignment: align, layoutOmitted: false, alignOmitted: false, rule }
    commit(target, serializeIcons(m), applyTo)
    onClose()
  }
  const iconSet = ICON_SETS.find((s) => s.id === setId)

  return (
    <Modal
      title={titleOf(target)}
      onClose={onClose}
      width={960}
      className="wbi-cf-modal"
      footerLeft={<FooterLeft target={target} visual={visual} existing={!!found} onRemove={() => (commit(target, undefined, applyTo), onClose())} />}
      footer={<Footer onOk={ok} onClose={onClose} okDisabled={!valid} />}
    >
      <div className="wbi-cf">
        {corrupt && <div className="wbi-cf__rawnote">This icon formatting uses an expression this dialog can't edit; it's kept unless you remove it.</div>}
        <div className="wbi-cf__grid">
          <Field label="Format style">
            <Dropdown
              size="small"
              value={style}
              options={[
                { value: 'rules', label: 'Rules' },
                { value: 'fieldValue', label: 'Field value' }
              ]}
              onChange={(s) => setStyle(s as 'rules' | 'fieldValue')}
            />
          </Field>
          {target.applyTo ? (
            <Field label="Apply to">
              <Dropdown size="small" value={applyTo} options={APPLY_TO.map((a) => ({ value: a.value, label: a.label }))} onChange={setApplyTo} />
            </Field>
          ) : (
            <span />
          )}
          <span />
        </div>
        <InputRow model={model} input={input} setInput={setInput} />
        <div className="wbi-cf__grid">
          <Field label="Icon layout">
            <Dropdown size="small" value={layout} options={LAYOUTS} onChange={setLayout} />
          </Field>
          <Field label="Icon alignment">
            <Dropdown size="small" value={align} options={ALIGNS} onChange={setAlign} />
          </Field>
          {style === 'rules' ? (
            <Field label="Style">
              <Dropdown
                size="small"
                value={setId}
                placeholder="Custom"
                options={ICON_SETS.map((s) => ({ value: s.id, label: s.label }))}
                renderValue={(o) =>
                  o ? (
                    <span className="wbi-cf__iconset">
                      {ICON_SETS.find((s) => s.id === o.value)!.icons.map((n) => (
                        <CFIcon key={n} name={n} size={14} />
                      ))}
                    </span>
                  ) : (
                    'Custom'
                  )
                }
                onChange={(id) => {
                  const s = ICON_SETS.find((x) => x.id === id)
                  if (!s) return
                  setSetId(id)
                  setRules(defaultIconRules(input ?? { field: null }, s.icons).rules)
                }}
              />
            </Field>
          ) : (
            <span />
          )}
        </div>
        {style === 'rules' ? (
          <RulesEditor rules={rules} numeric={numeric} theme={theme} icons={iconSet?.icons ?? []} onChange={(r) => (setRules(r), setSetId((cur) => (ICON_SETS.find((s) => s.id === cur && r.every((x) => typeof x.value === 'string' && s.icons.includes(x.value))) ? cur : '')))} newValue={() => iconSet?.icons[rules.length % iconSet.icons.length] ?? 'CircleGreen'} />
        ) : (
          <div className="wbi-cf__hint">The field should return an icon name (for example CircleGreen, ArrowUpGreen) or an image URL.</div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Data bars
// ---------------------------------------------------------------------------------------------

function DataBarsDialog({ target, visual, theme, onClose }: DialogProps) {
  const bag = visualBag(visual.json, target.container)
  const found = findCF(bag, target)
  const parsed = found ? parseDataBars(found.raw) : undefined
  const [m, setM] = useState<DataBarsModel>(() => parsed ?? defaultDataBars(theme.dataColors[0]?.toUpperCase() ?? '#118DFF'))
  const applyTo: ApplyTo = m.totalMatchingOption === 0 ? 'valuesAndTotals' : m.totalMatchingOption === 2 ? 'totals' : 'values'
  const valid = (!m.min || Number.isFinite(m.min.value)) && (!m.max || Number.isFinite(m.max.value)) && !(found && !parsed)
  const ok = () => {
    commit(target, serializeDataBars(m), 'values')
    onClose()
  }
  const bound = (key: 'min' | 'max', auto: string) => {
    const v = m[key]
    return (
      <div className="wbi-cf__stop">
        <span className="wbi-cf__label">{key === 'min' ? 'Minimum' : 'Maximum'}</span>
        <Dropdown
          size="small"
          value={v ? 'number' : 'auto'}
          options={[
            { value: 'auto', label: auto },
            { value: 'number', label: 'Number' },
            { value: 'percent', label: 'Percent (not supported yet)', disabled: true }
          ]}
          onChange={(k) => setM({ ...m, [key]: k === 'number' ? { value: v?.value ?? (key === 'min' ? 0 : 100) } : undefined })}
        />
        {v ? <NumberField size="small" value={v.value} onChange={(n) => setM({ ...m, [key]: { value: n ?? NaN, literal: v.literal } })} /> : <div className="wbi-cf__auto">{auto}</div>}
      </div>
    )
  }
  const color = (key: 'positiveColor' | 'negativeColor' | 'axisColor', label: string) => (
    <Field label={label}>
      <Swatch value={m[key]} theme={theme} onChange={(c) => setM({ ...m, [key]: c, omitted: m.omitted?.filter((k) => k !== key) })} />
    </Field>
  )
  const pos = displayColor(m.positiveColor, theme)
  const neg = displayColor(m.negativeColor, theme)
  const axis = displayColor(m.axisColor, theme)
  return (
    <Modal
      title={titleOf(target)}
      onClose={onClose}
      width={620}
      className="wbi-cf-modal"
      footerLeft={<FooterLeft target={target} visual={visual} existing={!!found} onRemove={() => (commit(target, undefined, 'values'), onClose())} />}
      footer={<Footer onOk={ok} onClose={onClose} okDisabled={!valid} />}
    >
      <div className="wbi-cf">
        <div className="wbi-cf__grid">
          <Checkbox checked={!!m.hideText} label="Show bar only" onChange={(on) => setM({ ...m, hideText: on })} />
          <Field label="Apply to">
            <Dropdown size="small" value={applyTo} options={APPLY_TO.map((a) => ({ value: a.value, label: a.label }))} onChange={(a) => setM({ ...m, totalMatchingOption: matchingOptionOf(a), totalLiteral: undefined })} />
          </Field>
          <span />
        </div>
        <div className="wbi-cf__stops">
          {bound('min', 'Lowest value')}
          {bound('max', 'Highest value')}
        </div>
        <div className="wbi-cf__grid">
          {color('positiveColor', 'Positive bar')}
          {color('negativeColor', 'Negative bar')}
          {color('axisColor', 'Axis')}
        </div>
        <Field label="Bar direction">
          <Dropdown
            size="small"
            value={m.reverse ? 'rtl' : 'ltr'}
            options={[
              { value: 'ltr', label: 'Left to right' },
              { value: 'rtl', label: 'Right to left' }
            ]}
            onChange={(d) => setM({ ...m, reverse: d === 'rtl' })}
          />
        </Field>
        <div className="wbi-cf__bars" style={{ flexDirection: m.reverse ? 'row-reverse' : 'row' }} aria-label="Preview">
          <div className="wbi-cf__barneg" style={{ background: neg }} />
          <div className="wbi-cf__baraxis" style={{ background: axis }} />
          <div className="wbi-cf__barpos" style={{ background: pos }} />
        </div>
      </div>
    </Modal>
  )
}
