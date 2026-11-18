/**
 * Code visual: the starter templates (Insert ▸ Code visual picker, editor ▸ Templates). Each works with whatever fields
 * are bound (context.ts names: measure1, value1, category…), uses the theme's colours and text through CSS variables,
 * and adapts to its container with container queries and `cq*` units.
 */
import type { ParamDef } from './types'
import { FORMAT_OBJECT, writeCodeSource, writeParamDefs } from './model'
import { encodeLiteral } from '../report/literal'

export interface StarterTemplate {
  id: string
  name: string
  description: string
  /** what to put in the wells */
  wells: string
  html: string
  css: string
  jsx?: string
  params?: ParamDef[]
  /** row order when the visual has no sort of its own */
  defaultSort?: 'value' | 'category'
  size: { width: number; height: number }
}

/** empty = the theme's first data colour */
const ACCENT: ParamDef = { name: 'accent', label: 'Accent colour', type: 'color', default: '' }
const TITLE: ParamDef = { name: 'title', label: 'Title', type: 'text', default: '' }

/* shared tokens: every template reads the theme through these, with Power BI's defaults as fallbacks */
const TOKENS = `#lumen-root {
  --fg: var(--theme-foreground, #252423);
  --muted: var(--theme-foreground-secondary, #605E5C);
  --faint: var(--theme-foreground-tertiary, #B3B0AD);
  --accent: var(--param-accent, var(--theme-color-1, #118DFF));
  --good: var(--theme-good, #1AAB40);
  --bad: var(--theme-bad, #D64554);
  --warn: var(--theme-neutral, #E8A33D);
  --track: color-mix(in srgb, var(--fg) 9%, transparent);
}`

export const KPI_TILE: StarterTemplate = {
  id: 'kpi',
  name: 'KPI tile',
  description: 'A headline number with its change against a comparison measure and a sparkline of the rows.',
  wells: 'Values: the measure, then a comparison (target or prior period). Rows (optional): a date or period field for the sparkline.',
  defaultSort: 'category',
  size: { width: 320, height: 180 },
  params: [TITLE, ACCENT],
  html: `{{#if measureName1}}
<div class="kpi" data-trend="{{#if measureName2}}{{#if (gte measure1 measure2)}}up{{else}}down{{/if}}{{/if}}">
  <div class="kpi__label">{{default params.title measureName1}}</div>
  <div class="kpi__value">{{measure1}}</div>
  {{#if measureName2}}
  <div class="kpi__delta">
    <span class="kpi__chip">{{#if (gte measure1 measure2)}}▲{{else}}▼{{/if}} {{percent (abs (div (sub measure1 measure2) measure2)) 1}}</span>
    <span class="kpi__vs">vs {{measureName2}} <b>{{measure2}}</b></span>
  </div>
  {{/if}}
  {{#if (gt rowCount 1)}}
  <svg class="kpi__spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
    <polygon class="kpi__area" points="{{areaPoints 100 32}}"/>
    <polyline class="kpi__line" points="{{points 100 32}}"/>
  </svg>
  {{/if}}
</div>
{{else}}
<div class="hint">Add a measure to <b>Values</b></div>
{{/if}}`,
  css: `${TOKENS}
.kpi {
  height: 100%;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: clamp(2px, 2.5cqh, 8px);
  padding: clamp(8px, 7cqmin, 20px);
  color: var(--fg);
}
.kpi__label {
  font-size: clamp(11px, 7cqmin, 15px);
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.kpi__value {
  font-size: clamp(20px, 22cqmin, 58px);
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.kpi__delta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: clamp(10px, 5.5cqmin, 13px); min-width: 0; }
.kpi__chip {
  padding: 1px 8px; border-radius: 999px; font-weight: 600; white-space: nowrap;
  color: var(--trend, var(--muted));
  background: color-mix(in srgb, var(--trend, var(--muted)) 14%, transparent);
}
.kpi[data-trend="up"] { --trend: var(--good); }
.kpi[data-trend="down"] { --trend: var(--bad); }
.kpi__vs { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kpi__vs b { color: var(--fg); font-weight: 600; }
.kpi__spark { width: 100%; height: 100%; min-height: 0; align-self: end; overflow: visible; }
.kpi__line { fill: none; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
.kpi__area { fill: color-mix(in srgb, var(--accent) 15%, transparent); }
/* short: drop the sparkline, then the comparison */
@container (max-height: 120px) { .kpi__spark { display: none; } }
@container (max-height: 74px) { .kpi__delta { display: none; } .kpi { gap: 0; align-content: center; } }
/* wide and short: number on the left, sparkline on the right */
@container (min-width: 440px) and (max-height: 200px) {
  .kpi { grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); grid-template-rows: auto auto minmax(0, 1fr); column-gap: 24px; align-content: center; }
  .kpi__spark { display: block; grid-column: 2; grid-row: 1 / span 3; align-self: stretch; }
}
.hint { height: 100%; display: grid; place-items: center; color: var(--muted); font-size: 12px; text-align: center; padding: 8px; }`
}

export const PROGRESS_RING: StarterTemplate = {
  id: 'ring',
  name: 'Progress ring',
  description: 'Progress of a measure towards a target as a ring, with the percentage in the middle.',
  wells: 'Values: the measure, then its target (or set Target in the Format pane ▸ Parameters).',
  size: { width: 300, height: 200 },
  params: [{ name: 'target', label: 'Target (when no second measure)', type: 'number', default: 1 }, ACCENT],
  html: `{{#if measureName1}}
<div class="ring" style="--ratio: {{clamp (div measure1 (default measure2 params.target)) 0 1}}">
  <div class="ring__dial">
    <svg viewBox="0 0 120 120" role="img" aria-label="{{measureName1}}: {{percent (div measure1 (default measure2 params.target)) 0}} of target">
      <circle class="ring__track" cx="60" cy="60" r="50" pathLength="100"/>
      <circle class="ring__bar" cx="60" cy="60" r="50" pathLength="100"/>
    </svg>
    <div class="ring__center">
      <span class="ring__pct">{{percent (div measure1 (default measure2 params.target)) 0}}</span>
      <span class="ring__of">of {{#if measureName2}}{{measureName2}}{{else}}target{{/if}}</span>
    </div>
  </div>
  <div class="ring__text">
    <div class="ring__label">{{measureName1}}</div>
    <div class="ring__value">{{measure1}}</div>
    {{#if measureName2}}<div class="ring__target">Target <b>{{measure2}}</b></div>{{/if}}
  </div>
</div>
{{else}}
<div class="hint">Add a measure and its target to <b>Values</b></div>
{{/if}}`,
  css: `${TOKENS}
.ring {
  height: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: clamp(10px, 6cqw, 28px);
  padding: clamp(8px, 6cqmin, 18px);
  color: var(--fg);
}
.ring__dial { position: relative; height: min(100cqh - 2 * clamp(8px, 6cqmin, 18px), 60cqw); aspect-ratio: 1; }
.ring__dial svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.ring__track, .ring__bar { fill: none; stroke-width: 11; }
.ring__track { stroke: var(--track); }
.ring__bar {
  stroke: var(--accent);
  stroke-linecap: round;
  stroke-dasharray: calc(var(--ratio) * 100) 100;
  transition: stroke-dasharray .4s ease;
}
.ring__center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; line-height: 1.1; }
.ring__pct { font-size: clamp(14px, 13cqmin, 34px); font-weight: 600; font-variant-numeric: tabular-nums; }
.ring__of { font-size: clamp(9px, 4.2cqmin, 12px); color: var(--muted); max-width: 9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ring__label { font-size: clamp(11px, 5.5cqmin, 15px); font-weight: 600; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ring__value { font-size: clamp(18px, 12cqmin, 40px); font-weight: 600; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ring__target { font-size: clamp(10px, 4.5cqmin, 13px); color: var(--muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ring__target b { color: var(--fg); font-weight: 600; }
/* narrow or tall: the ring alone, centred, with the label underneath */
@container (max-width: 260px), (max-aspect-ratio: 5/4) {
  .ring { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; justify-items: center; text-align: center; gap: 6px; }
  .ring__dial { height: min(100cqh - 64px, 86cqw); }
  .ring__value, .ring__target { display: none; }
}
@container (max-height: 110px) { .ring__text { display: none; } .ring__dial { height: calc(100cqh - 12px); } .ring { grid-template-rows: 1fr; } }
.hint { height: 100%; display: grid; place-items: center; color: var(--muted); font-size: 12px; text-align: center; padding: 8px; }`
}

export const BAR_LIST: StarterTemplate = {
  id: 'barlist',
  name: 'Bar list (drill and select)',
  description: 'Ranked rows with inline bars in pure CSS. Click a row to cross-filter the page; drill into a hierarchy with the arrow, go back with the header.',
  wells: 'Rows: a field or a hierarchy (e.g. Category > Subcategory > Product). Values: a measure.',
  size: { width: 400, height: 300 },
  params: [TITLE, ACCENT],
  html: `<div class="bl">
  <header class="bl__head">
    {{#if drill.canDrillUp}}<button class="bl__icon" data-drill-up title="Drill up" aria-label="Drill up">‹</button>{{/if}}
    <div class="bl__titles">
      <span class="bl__title">{{default params.title measureName1}}</span>
      {{#if categoryName}}<span class="bl__by">by {{categoryName}}</span>{{/if}}
    </div>
    {{#if breadcrumb}}<span class="bl__path" title="{{breadcrumb}}">{{breadcrumb}}</span>{{/if}}
  </header>
  <ol class="bl__rows">
    {{#each rows}}
    <li class="bl__row" data-select>
      <span class="bl__label" title="{{category}}">{{category}}</span>
      <span class="bl__track"><span class="bl__fill"></span>{{#if @root.hasHighlight}}<span class="bl__hl"></span>{{/if}}</span>
      <span class="bl__value">{{value1}}</span>
      {{#if canDrill}}<button class="bl__icon" data-drill title="Drill down" aria-label="Drill down into {{category}}">›</button>{{/if}}
    </li>
    {{else}}
    <li class="hint">Add a field to <b>Rows</b> and a measure to <b>Values</b></li>
    {{/each}}
  </ol>
</div>`,
  css: `${TOKENS}
.bl { height: 100%; display: flex; flex-direction: column; gap: 8px; padding: clamp(6px, 3.5cqmin, 14px); color: var(--fg); }
.bl__head { display: flex; align-items: center; gap: 6px; min-height: 24px; min-width: 0; }
.bl__titles { display: flex; align-items: baseline; gap: 6px; min-width: 0; flex: 1; white-space: nowrap; overflow: hidden; }
.bl__title { font-size: clamp(12px, 4.5cqmin, 15px); font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
.bl__by { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
.bl__path {
  font-size: 11px; color: var(--muted); max-width: 45%;
  padding: 2px 8px; border-radius: 999px; background: var(--track);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bl__icon {
  all: unset; box-sizing: border-box; flex: 0 0 auto;
  display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px;
  font-size: 17px; line-height: 1; color: var(--muted); cursor: pointer;
}
.bl__icon:hover { background: var(--track); color: var(--fg); }
.bl__rows { list-style: none; margin: 0; padding: 0; flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
.bl__row {
  display: grid; grid-template-columns: minmax(64px, 34%) minmax(0, 1fr) auto 22px;
  align-items: center; gap: 10px; flex: 0 0 auto;
  min-height: 26px; padding: 2px 4px 2px 6px; border-radius: 6px;
  transition: opacity .15s, background .15s;
}
.bl__row:not([data-can-drill]) { grid-template-columns: minmax(64px, 34%) minmax(0, 1fr) auto; padding-right: 6px; }
.bl__row:hover { background: color-mix(in srgb, var(--fg) 5%, transparent); }
.bl__label { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bl__track { position: relative; height: 10px; border-radius: 5px; background: var(--track); overflow: hidden; }
.bl__fill, .bl__hl { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--accent); transition: width .3s ease; }
.bl__fill { width: calc(max(var(--pct-of-max), 0) * 100%); }
.bl__hl { width: calc(max(var(--highlight-pct-of-max, 0), 0) * 100%); }
/* cross-highlight from another visual: the whole bar faint, the highlighted part solid (like Power BI) */
#lumen-root[data-has-highlight="true"] .bl__fill { opacity: .3; }
.bl__value { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
/* this visual's own selection */
.bl__row[data-selected="false"] { opacity: .4; }
.bl__row[data-selected="true"] { background: color-mix(in srgb, var(--accent) 10%, transparent); }
/* narrow: the bar under the label */
@container (max-width: 280px) {
  .bl__row, .bl__row:not([data-can-drill]) { grid-template-columns: minmax(0, 1fr) auto auto; row-gap: 3px; }
  .bl__track { grid-column: 1 / -1; grid-row: 2; height: 6px; }
  .bl__by { display: none; }
}
@container (max-width: 160px) { .bl__value { display: none; } .bl__path { display: none; } }
.hint { padding: 16px 8px; color: var(--muted); font-size: 12px; text-align: center; }`
}

export const BADGE_GRID: StarterTemplate = {
  id: 'badges',
  name: 'Badge grid',
  description: 'One tile per row, tinted by its share of the largest value. Click tiles to cross-filter the page.',
  wells: 'Rows: a field. Values: a measure (a second measure shows under it).',
  size: { width: 420, height: 220 },
  params: [ACCENT],
  html: `<div class="bg">
  {{#each rows}}
  <button class="bg__tile" data-select>
    <span class="bg__name">{{category}}</span>
    <span class="bg__value">{{value1}}</span>
    {{#if value2}}<span class="bg__sub">{{@root.measureName2}} {{value2}}</span>{{/if}}
    <span class="bg__meter"><span></span></span>
  </button>
  {{else}}
  <div class="hint">Add a field to <b>Rows</b> and a measure to <b>Values</b></div>
  {{/each}}
</div>`,
  css: `${TOKENS}
.bg {
  height: 100%; overflow: auto;
  display: grid; gap: clamp(6px, 2cqmin, 10px); align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(clamp(92px, 28cqw, 150px), 1fr));
  padding: clamp(6px, 3cqmin, 12px);
  color: var(--fg);
}
.bg__tile {
  all: unset; box-sizing: border-box; cursor: pointer;
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
  padding: 10px 12px 12px; border-radius: 10px; position: relative; overflow: hidden;
  background: color-mix(in srgb, var(--accent) calc(6% + var(--pct-of-max) * 20%), transparent);
  border: 1px solid color-mix(in srgb, var(--accent) calc(14% + var(--pct-of-max) * 26%), transparent);
  transition: transform .12s, opacity .15s;
}
.bg__tile:hover { transform: translateY(-1px); }
.bg__name { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bg__value { font-size: clamp(14px, 6cqmin, 20px); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bg__sub { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bg__meter { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; }
.bg__meter span { display: block; height: 100%; width: calc(max(var(--pct-of-max), 0) * 100%); background: var(--accent); }
.bg__tile[data-selected="false"], .bg__tile[data-highlighted="false"] { opacity: .4; }
.bg__tile[data-selected="true"] { outline: 2px solid var(--accent); outline-offset: -2px; }
@container (max-height: 90px) { .bg__sub { display: none; } }
.hint { grid-column: 1 / -1; padding: 16px 8px; color: var(--muted); font-size: 12px; text-align: center; }`
}

export const SCORECARD: StarterTemplate = {
  id: 'scorecard',
  name: 'Scorecard',
  description: 'A table of rows against a target, with progress bars and status chips. Click a row to cross-filter.',
  wells: 'Rows: a field. Values: the actual measure, then the target measure.',
  size: { width: 520, height: 260 },
  params: [
    { name: 'atRisk', label: 'At risk from (share of target)', type: 'number', default: 0.9 },
    ACCENT
  ],
  html: `<table class="sc">
  <thead>
    <tr>
      <th>{{categoryName}}</th>
      <th class="num">{{measureName1}}</th>
      <th class="num opt">{{default measureName2 "Target"}}</th>
      <th class="bar opt">Progress</th>
      <th class="st">Status</th>
    </tr>
  </thead>
  <tbody>
    {{#each rows}}
    <tr data-select style="--ratio: {{clamp (div value1 value2) 0 1.25}}">
      <td class="name">{{category}}</td>
      <td class="num">{{value1}}</td>
      <td class="num opt muted">{{value2}}</td>
      <td class="bar opt"><span class="sc__track"><span class="sc__fill"></span><span class="sc__goal"></span></span></td>
      <td class="st">
        {{#if (gte (div value1 value2) 1)}}<span class="chip good">On track</span>
        {{else if (gte (div value1 value2) @root.params.atRisk)}}<span class="chip warn">At risk</span>
        {{else}}<span class="chip bad">Behind</span>{{/if}}
      </td>
    </tr>
    {{else}}
    <tr><td class="hint" colspan="5">Add a field to <b>Rows</b>, then a measure and its target to <b>Values</b></td></tr>
    {{/each}}
  </tbody>
</table>`,
  css: `${TOKENS}
#lumen-root { overflow: auto; }
.sc { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; color: var(--fg); font-variant-numeric: tabular-nums; }
.sc th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; font-weight: 600; font-size: 11px; color: var(--muted);
  padding: 8px 10px; background: var(--theme-background, #fff);
  border-bottom: 1px solid color-mix(in srgb, var(--fg) 16%, transparent);
  white-space: nowrap;
}
.sc td { padding: 7px 10px; border-bottom: 1px solid color-mix(in srgb, var(--fg) 7%, transparent); white-space: nowrap; }
.sc .num { text-align: right; }
.sc .muted { color: var(--muted); }
.sc .name { max-width: 0; width: 34%; overflow: hidden; text-overflow: ellipsis; }
.sc .bar { width: 26%; min-width: 80px; }
.sc tbody tr { cursor: pointer; transition: opacity .15s, background .15s; }
.sc tbody tr:hover td { background: color-mix(in srgb, var(--fg) 4%, transparent); }
.sc tbody tr[data-selected="false"], .sc tbody tr[data-highlighted="false"] { opacity: .4; }
.sc tbody tr[data-selected="true"] td { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.sc__track { position: relative; display: block; height: 8px; border-radius: 4px; background: var(--track); }
.sc__fill { position: absolute; inset: 0 auto 0 0; width: calc(var(--ratio) / 1.25 * 100%); border-radius: inherit; background: var(--accent); }
.sc__goal { position: absolute; top: -3px; bottom: -3px; left: 80%; width: 2px; border-radius: 1px; background: var(--fg); opacity: .55; }
.chip { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.chip.good { color: var(--good); background: color-mix(in srgb, var(--good) 13%, transparent); }
.chip.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 15%, transparent); }
.chip.bad { color: var(--bad); background: color-mix(in srgb, var(--bad) 13%, transparent); }
.hint { text-align: center; color: var(--muted); padding: 18px 8px; white-space: normal; }
/* narrow: drop the target and progress columns; very narrow: status as a dot */
@container (max-width: 420px) { .sc .opt { display: none; } .sc .name { width: 50%; } }
@container (max-width: 260px) { .sc .st { width: 1%; } .chip { font-size: 0; padding: 4px; gap: 0; } .sc th.st { font-size: 0; } }`
}

export const STEPS: StarterTemplate = {
  id: 'steps',
  name: 'Timeline steps',
  description: 'Rows as numbered steps along a line, the last one emphasised. Horizontal when wide, vertical when narrow.',
  wells: 'Rows: an ordered field (stages, months). Values: a measure.',
  defaultSort: 'category',
  size: { width: 560, height: 150 },
  params: [ACCENT],
  html: `<ol class="st">
  {{#each rows}}
  <li class="st__step{{#if @last}} is-current{{/if}}" data-select>
    <span class="st__dot">{{@number}}</span>
    <span class="st__text">
      <span class="st__name">{{category}}</span>
      <span class="st__value">{{value1}}</span>
    </span>
  </li>
  {{else}}
  <li class="hint">Add an ordered field to <b>Rows</b> and a measure to <b>Values</b></li>
  {{/each}}
</ol>`,
  css: `${TOKENS}
.st {
  list-style: none; margin: 0; height: 100%;
  padding: clamp(8px, 5cqmin, 18px) clamp(8px, 3cqw, 20px);
  display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr);
  align-items: start; color: var(--fg); overflow: auto;
}
.st__step { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 0 4px; cursor: pointer; transition: opacity .15s; min-width: 0; }
/* the connector to the previous step */
.st__step + .st__step::before {
  content: ""; position: absolute; top: 13px; right: calc(50% + 17px); width: calc(100% - 34px); height: 2px;
  background: color-mix(in srgb, var(--accent) 45%, transparent); border-radius: 1px;
}
.st__dot {
  flex: 0 0 auto; width: 28px; height: 28px; border-radius: 50%;
  display: grid; place-items: center; font-size: 12px; font-weight: 600;
  color: var(--accent); background: var(--theme-background, #fff);
  border: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
}
.is-current .st__dot { color: #fff; background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent); }
.st__text { display: flex; flex-direction: column; gap: 1px; min-width: 0; max-width: 100%; }
.st__name { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st__value { font-size: clamp(12px, 8cqh, 17px); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st__step[data-selected="false"], .st__step[data-highlighted="false"] { opacity: .4; }
/* narrow: vertical */
@container (max-width: 360px) {
  .st { grid-auto-flow: row; grid-auto-columns: auto; grid-auto-rows: auto; gap: 14px; }
  .st__step { flex-direction: row; text-align: left; gap: 12px; }
  .st__step + .st__step::before { top: auto; bottom: calc(100% - 2px); left: 17px; right: auto; width: 2px; height: 14px; }
  .st__text { flex-direction: row; justify-content: space-between; align-items: baseline; gap: 8px; flex: 1; }
}
@container (max-height: 96px) and (min-width: 361px) { .st__name { display: none; } }
.hint { grid-column: 1 / -1; color: var(--muted); font-size: 12px; text-align: center; padding: 12px; }`
}

export const JSX_TOP_N: StarterTemplate = {
  id: 'topn-jsx',
  name: 'Top N bars (JSX)',
  description: 'A React component with state: switch between Top 5, Top 10 and All; rows select and drill like the bar list.',
  wells: 'Rows: a field or a hierarchy. Values: a measure.',
  size: { width: 420, height: 300 },
  params: [TITLE, ACCENT],
  html: '',
  jsx: `import { useState } from 'react'

export default function Visual({ rows, columns, size, params, drillInfo, breadcrumb, drillUp, rowProps, hasHighlight }) {
  const [limit, setLimit] = useState(5)
  const measure = columns.find((c) => c.role === 'values')
  if (!measure || !rows.length) return <p className="hint">Add a field to <b>Rows</b> and a measure to <b>Values</b>.</p>

  const shown = limit ? rows.slice(0, limit) : rows
  const max = Math.max(1e-9, ...shown.map((r) => Math.abs(r.cells[measure.name]?.value ?? 0)))
  const compact = size.width < 300

  return (
    <div className="top">
      <header>
        {drillInfo.canDrillUp && <button className="icon" data-drill-up aria-label="Drill up">‹</button>}
        <strong>{params.title || measure.name}</strong>
        {breadcrumb && !compact && <span className="crumb">{breadcrumb}</span>}
        <div className="seg" role="group" aria-label="Rows shown">
          {[5, 10, 0].map((n) => (
            <button key={n} aria-pressed={limit === n} onClick={() => setLimit(n)}>{n ? (compact ? n : 'Top ' + n) : 'All'}</button>
          ))}
        </div>
      </header>
      <ul>
        {shown.map((r) => {
          const cell = r.cells[measure.name]
          const pct = Math.max(0, (cell?.value ?? 0) / max)
          const hl = hasHighlight ? Math.max(0, (cell?.highlight ?? 0) / max) : null
          return (
            <li key={r.key} {...rowProps(r)} data-select>
              <span className="name">{r.label}</span>
              <span className="bar">
                <i style={{ width: pct * 100 + '%', opacity: hl === null ? 1 : 0.3 }} />
                {hl !== null && <i style={{ width: hl * 100 + '%' }} />}
              </span>
              <span className="val">{cell?.formatted}</span>
              {r.canDrill && <button className="icon" data-drill aria-label={'Drill down into ' + r.label}>›</button>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
`,
  css: `${TOKENS}
.top { height: 100%; display: flex; flex-direction: column; gap: 8px; padding: clamp(6px, 3.5cqmin, 14px); color: var(--fg); }
header { display: flex; align-items: center; gap: 8px; min-width: 0; }
header strong { font-size: clamp(12px, 4.5cqmin, 15px); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.crumb { font-size: 11px; color: var(--muted); padding: 2px 8px; border-radius: 999px; background: var(--track); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.seg { margin-left: auto; display: inline-flex; padding: 2px; border-radius: 8px; background: var(--track); flex: 0 0 auto; }
.seg button { all: unset; cursor: pointer; font-size: 11px; padding: 3px 9px; border-radius: 6px; color: var(--muted); }
.seg button[aria-pressed="true"] { background: var(--theme-background, #fff); color: var(--fg); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, .12); }
.icon { all: unset; cursor: pointer; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; font-size: 17px; color: var(--muted); flex: 0 0 auto; }
.icon:hover { background: var(--track); color: var(--fg); }
ul { list-style: none; margin: 0; padding: 0; flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
li { display: grid; grid-template-columns: minmax(60px, 32%) minmax(0, 1fr) auto auto; align-items: center; gap: 10px; min-height: 26px; padding: 2px 4px 2px 6px; border-radius: 6px; flex: 0 0 auto; transition: opacity .15s; }
li:hover { background: color-mix(in srgb, var(--fg) 5%, transparent); }
li[data-selected="false"], li[data-highlighted="false"] { opacity: .4; }
.name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar { position: relative; height: 10px; border-radius: 5px; background: var(--track); overflow: hidden; }
.bar i { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--accent); transition: width .3s ease; }
.val { font-size: 12px; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
@container (max-width: 240px) { .val { display: none; } }
.hint { height: 100%; display: grid; place-items: center; margin: 0; color: var(--muted); font-size: 12px; text-align: center; }`
}

export const STARTER_TEMPLATES: StarterTemplate[] = [KPI_TILE, PROGRESS_RING, BAR_LIST, BADGE_GRID, SCORECARD, STEPS, JSX_TOP_N]

export function starterTemplate(id: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.id === id)
}

/** Put a template's code, parameters and default row order into a visual (works on an immer draft). */
export function applyTemplate(visualJson: any, t: StarterTemplate): void {
  writeCodeSource(visualJson, { html: t.html, css: t.css, jsx: t.jsx ?? '' })
  writeParamDefs(visualJson, t.params ?? [])
  const objects = (visualJson.visual.objects ??= {})
  const fmt = (objects[FORMAT_OBJECT] ??= [{ properties: {} }])
  const props = (fmt[0].properties ??= {})
  if (t.defaultSort === 'category') props.defaultSort = { expr: { Literal: { Value: encodeLiteral('category') } } }
  else delete props.defaultSort
  if (!Object.keys(props).length) delete objects[FORMAT_OBJECT]
}
