/**
 * Power BI button icons (`icon.shapeType`) as stroke-based SVG path data in a 24×24 box.
 * Drawn after PBI's built-in glyphs (thin outline style, round caps).
 */

export type ButtonIconKind =
  | 'blank'
  | 'back'
  | 'information'
  | 'help'
  | 'qna'
  | 'bookmark'
  | 'navigator'
  | 'reset'
  | 'filter'
  | 'clearAllSlicers'
  | 'applyAllSlicers'
  | 'leftArrow'
  | 'rightArrow'
  | 'upArrow'
  | 'downArrow'
  | 'plus'
  | 'close'
  | 'drillthrough'

const ALIASES: Record<string, ButtonIconKind> = {
  blank: 'blank',
  none: 'blank',
  back: 'back',
  backarrow: 'back',
  information: 'information',
  info: 'information',
  help: 'help',
  qna: 'qna',
  'q&a': 'qna',
  bookmark: 'bookmark',
  bookmarknavigator: 'bookmark',
  navigator: 'navigator',
  pagenavigator: 'navigator',
  pagenavigation: 'navigator',
  reset: 'reset',
  filter: 'filter',
  clearallslicers: 'clearAllSlicers',
  clearfilters: 'clearAllSlicers',
  applyallslicers: 'applyAllSlicers',
  leftarrow: 'leftArrow',
  arrowleft: 'leftArrow',
  rightarrow: 'rightArrow',
  arrowright: 'rightArrow',
  uparrow: 'upArrow',
  downarrow: 'downArrow',
  plus: 'plus',
  close: 'close',
  x: 'close',
  drillthrough: 'drillthrough'
}

export function normalizeIconKind(v: unknown): ButtonIconKind {
  return ALIASES[String(v ?? 'blank').replace(/[\s_-]/g, '').toLowerCase()] ?? 'blank'
}

/** Path elements (d strings) for an icon; filled paths are prefixed with 'F:'. */
export function iconPaths(kind: ButtonIconKind): string[] {
  switch (kind) {
    case 'blank':
      return []
    case 'back':
      return ['M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 1 1 0-19', 'M16.5 12H7.5', 'M11 8.2L7.3 12L11 15.8']
    case 'information':
      return ['M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 1 1 0-19', 'M12 10.5v6.5', 'F:M12 6.4a1 1 0 1 1 0 2a1 1 0 1 1 0-2']
    case 'help':
      return [
        'M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 1 1 0-19',
        'M9.3 9.4a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.9v.6',
        'F:M12 16.4a1 1 0 1 1 0 2a1 1 0 1 1 0-2'
      ]
    case 'qna':
      return ['M4 4.5h16v11H11l-4.5 4v-4H4z', 'M8 8.5h8', 'M8 11.5h5']
    case 'bookmark':
      return ['M6.5 3.5h11v17l-5.5-4.2-5.5 4.2z']
    case 'navigator':
      return ['M12 2.5a9.5 9.5 0 1 1 0 19a9.5 9.5 0 1 1 0-19', 'M7.5 12h9', 'M13 8.2l3.7 3.8L13 15.8']
    case 'reset':
      return ['M5.2 9.5A7.5 7.5 0 1 1 4.5 13', 'M4.6 4.8v4.9h4.9']
    case 'filter':
      return ['M3.5 4.5h17l-6.5 7.8v6.4l-4 2v-8.4z']
    case 'clearAllSlicers':
      return ['M3.5 4.5h17l-6.5 7.8v2.2', 'M10 12.3v8.4l2-1', 'M3.5 4.5l6.5 7.8', 'M15.3 16.3l4.4 4.4', 'M19.7 16.3l-4.4 4.4']
    case 'applyAllSlicers':
      return ['M3.5 4.5h17l-6.5 7.8v2.2', 'M10 12.3v8.4l2-1', 'M3.5 4.5l6.5 7.8', 'M14.8 18.3l2 2 3.7-4']
    case 'leftArrow':
      return ['M20 12H4', 'M10 6l-6 6 6 6']
    case 'rightArrow':
      return ['M4 12h16', 'M14 6l6 6-6 6']
    case 'upArrow':
      return ['M12 20V4', 'M6 10l6-6 6 6']
    case 'downArrow':
      return ['M12 4v16', 'M6 14l6 6 6-6']
    case 'plus':
      return ['M12 4v16', 'M4 12h16']
    case 'close':
      return ['M5 5l14 14', 'M19 5L5 19']
    case 'drillthrough':
      return ['M4 6h10', 'M4 11h7', 'M4 16h5', 'M13 13l7 0', 'M17 10l3 3-3 3']
  }
}
