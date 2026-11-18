/**
 * The code of docs/create-reports/tutorial-build-a-kpi-tile-with-html-and-css.md, step by step. The tutorial shows
 * exactly these texts; e2e/codevisual-docs.e2e.ts types them into the editor and checks the result.
 */
export const TUTORIAL_KPI = {
  html1: `<div class="tile">
  <div class="label">{{measureName1}}</div>
  <div class="value">{{measure1}}</div>
  <div class="delta">{{percent (div (sub measure1 measure2) measure2) 1}} vs {{measureName2}}</div>
</div>`,
  css1: `.tile {
  height: 100%;
  padding: 16px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  color: var(--theme-foreground);
}
.label { font-size: 14px; color: var(--theme-foreground-secondary); }
.value { font-size: 40px; font-weight: 600; }
.delta { font-size: 13px; color: var(--theme-good); }`,
  css2: `.tile {
  height: 100%;
  padding: clamp(8px, 6cqmin, 20px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  color: var(--theme-foreground);
}
.label { font-size: clamp(11px, 7cqmin, 15px); color: var(--theme-foreground-secondary); }
.value { font-size: clamp(20px, 22cqmin, 56px); font-weight: 600; }
.delta { font-size: 13px; color: var(--theme-good); }
@container (max-height: 130px) {
  .delta { display: none; }
}`,
  html2: `<div class="tile">
  <div class="label">{{measureName1}}</div>
  <div class="value">{{measure1}}</div>
  <div class="delta">{{percent (div (sub measure1 measure2) measure2) 1}} vs {{measureName2}}</div>
  <div class="bar"><span></span></div>
</div>`,
  css3: `.tile {
  height: 100%;
  padding: clamp(8px, 6cqmin, 20px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  color: var(--theme-foreground);
}
.label { font-size: clamp(11px, 7cqmin, 15px); color: var(--theme-foreground-secondary); }
.value { font-size: clamp(20px, 22cqmin, 56px); font-weight: 600; }
.delta { font-size: 13px; color: var(--theme-good); }
.bar { height: 6px; margin-top: 6px; border-radius: 3px; background: var(--theme-background-neutral); }
.bar span {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--theme-color-1);
  /* Sales LY as a share of Total Sales, straight from the data */
  width: calc(min(var(--sales-ly) / var(--total-sales), 1) * 100%);
}
@container (max-height: 130px) {
  .delta { display: none; }
}`
}
