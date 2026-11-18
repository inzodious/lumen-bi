/**
 * Segoe UI advance widths (printable ASCII), used to predict where Power BI breaks lines when the
 * machine renders a wider fallback font (Linux has no Segoe UI; Open Sans is 5–13% wider).
 *
 * Values are em/1000 taken from Microsoft's Selawik 1.01 (SIL Open Font License 1.1), which is
 * metric-compatible with Segoe UI: Light (300), Semilight (350), Regular (400), Semibold (600), Bold (700).
 * Kerning is ignored (it changes widths by well under 1% for UI text).
 */

const WIDTHS: Record<number, number[]> = {
  300: [274,284,335,604,515,784,697,214,282,282,406,650,222,398,222,366,515,356,515,515,531,515,515,499,515,515,222,222,650,650,650,430,944,629,544,621,674,500,465,668,677,228,324,527,458,833,709,761,544,754,555,497,511,648,604,895,563,540,570,282,366,282,650,415,248,494,560,444,560,505,276,560,535,205,205,444,205,822,535,561,560,560,330,388,297,535,453,677,421,453,464,282,226,282,650],
  350: [274,284,364,598,527,801,749,222,292,292,412,667,220,399,220,378,527,448,527,527,535,527,527,519,527,527,220,220,667,667,667,439,950,637,559,620,688,503,477,677,693,247,341,554,464,866,729,758,552,754,577,514,518,667,613,915,577,546,570,292,373,292,667,415,258,501,574,453,575,514,294,575,551,224,224,471,224,842,551,574,574,575,339,406,318,551,466,700,440,469,458,292,233,292,667],
  400: [274,284,392,591,539,818,800,230,302,302,417,684,217,400,217,390,539,539,539,539,539,539,539,539,539,539,217,217,684,684,684,448,955,645,573,619,701,506,488,686,710,266,357,580,471,898,748,754,560,754,598,531,524,687,621,934,590,553,570,302,379,302,684,415,268,509,588,462,589,523,313,589,566,242,242,497,242,861,566,586,588,589,348,424,339,566,479,723,459,484,452,302,239,302,684],
  600: [275,313,459,592,563,851,833,272,347,347,442,699,253,403,253,425,563,563,563,563,563,563,563,563,563,563,253,253,699,699,699,441,955,684,619,623,725,523,509,703,748,300,416,626,498,938,776,757,596,757,635,551,565,711,652,981,633,589,595,347,417,347,699,415,299,528,609,474,609,535,360,609,590,270,270,539,270,898,592,603,609,609,381,435,373,592,521,772,521,520,470,347,297,347,699],
  700: [276,327,493,592,575,867,850,293,369,369,455,707,271,404,271,443,575,575,575,575,575,575,575,575,575,575,271,271,707,707,707,438,954,703,641,624,737,532,520,711,766,317,445,649,511,957,790,758,614,758,653,561,586,723,667,1005,655,607,607,369,436,369,707,415,314,538,620,480,619,541,383,619,602,284,284,559,284,916,605,611,620,619,398,440,389,605,542,797,552,538,479,369,326,369,707]
}

/** average letter width per weight (non-ASCII fallback) */
const AVG: Record<number, number> = { 300: 526, 350: 540, 400: 553, 600: 582, 700: 597 }

function nearestWeight(w: number): number {
  const ws = [300, 350, 400, 600, 700]
  let best = 400
  for (const x of ws) if (Math.abs(x - w) < Math.abs(best - w)) best = x
  return w >= 800 ? 700 : best
}

/** Width in px of `text` set in Segoe UI at `px` CSS pixels and CSS `weight`. */
export function segoeTextWidth(text: string, px: number, weight = 400): number {
  const w = nearestWeight(weight)
  const table = WIDTHS[w]
  let units = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 32
    units += c >= 32 && c <= 126 ? table[c - 32] : c === 0xa0 ? table[0] : AVG[w]
  }
  return (units / 1000) * px
}

/** Does a CSS font-family stack ask for Segoe UI (or a PBI theme font token that resolves to it)? */
export function isSegoeFamily(fontFamily: string): boolean {
  const first = fontFamily.split(',')[0].replace(/['"]/g, '').trim().toLowerCase()
  return first.startsWith('segoe') || first.startsWith('wf_segoe') || first === 'selawik' || first === 'heading' || first === 'body' || first === 'title'
}
