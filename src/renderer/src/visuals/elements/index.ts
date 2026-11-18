/** Registers the elements visuals: textbox, shapes, image, buttons, navigators, Q&A. */
import { registerVisual } from '../registry'
import type { FormatCardDef, FormatPropDef } from '../contract'
import { TextboxVisual } from './Textbox'
import { ShapeVisual } from './Shape'
import { ImageVisual } from './Image'
import { ActionButtonVisual } from './ActionButton'
import { BookmarkNavigatorVisual, PageNavigatorVisual } from './Navigator'
import { QnaVisual } from './QnaVisual'
import { buildParagraphs, paragraphsText } from './textboxModel'
import { SHAPE_KINDS } from './shapes'
import { buildPageItems } from './navigatorModel'
import { svgIcon } from './util'

const ICONS = {
  textbox: svgIcon('<rect x="2.5" y="3.5" width="15" height="13" rx="1"/><path d="M6 7h8M10 7v7"/>'),
  shape: svgIcon('<rect x="2.5" y="5.5" width="9" height="9"/><circle cx="13.5" cy="8.5" r="4"/>'),
  image: svgIcon('<rect x="2.5" y="3.5" width="15" height="13" rx="1"/><circle cx="7" cy="8" r="1.5"/><path d="M3 15l4.5-4.5 3 3 2.5-2.5 4 4"/>'),
  button: svgIcon('<rect x="2.5" y="5.5" width="15" height="9" rx="2"/><path d="M8 10h4M10.5 8l2 2-2 2"/>'),
  pageNav: svgIcon('<rect x="2.5" y="5.5" width="4.5" height="9" rx="1"/><rect x="7.75" y="5.5" width="4.5" height="9" rx="1"/><rect x="13" y="5.5" width="4.5" height="9" rx="1"/>'),
  bookmarkNav: svgIcon('<path d="M5.5 3.5h9v13l-4.5-3.4-4.5 3.4z"/>'),
  qna: svgIcon('<path d="M3 4h14v9H9.5L6 16.5V13H3z"/>')
}

const p = (name: string, displayName: string, type: FormatPropDef['type'], extra: Partial<FormatPropDef> = {}): FormatPropDef => ({ name, displayName, type, ...extra })

const ALIGN_OPTS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' }
]
const VALIGN_OPTS = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' }
]

const textCard = (displayName = 'Text'): FormatCardDef => ({
  object: 'text',
  displayName,
  toggle: 'show',
  properties: [
    p('show', 'Show', 'bool'),
    p('text', 'Text', 'text'),
    p('fontFamily', 'Font', 'fontFamily'),
    p('fontSize', 'Font size', 'fontSize'),
    p('bold', 'Bold', 'bool'),
    p('italic', 'Italic', 'bool'),
    p('underline', 'Underline', 'bool'),
    p('fontColor', 'Font color', 'color'),
    p('transparency', 'Transparency', 'percent'),
    p('horizontalAlignment', 'Horizontal alignment', 'enum', { options: ALIGN_OPTS }),
    p('verticalAlignment', 'Vertical alignment', 'enum', { options: VALIGN_OPTS }),
    p('leftMargin', 'Left padding', 'integer'),
    p('rightMargin', 'Right padding', 'integer'),
    p('topMargin', 'Top padding', 'integer'),
    p('bottomMargin', 'Bottom padding', 'integer')
  ]
})

const fillCard: FormatCardDef = {
  object: 'fill',
  displayName: 'Fill',
  toggle: 'show',
  properties: [p('show', 'Show', 'bool'), p('fillColor', 'Color', 'color'), p('transparency', 'Transparency', 'percent')]
}

const outlineCard = (displayName = 'Border'): FormatCardDef => ({
  object: 'outline',
  displayName,
  toggle: 'show',
  properties: [p('show', 'Show', 'bool'), p('lineColor', 'Color', 'color'), p('weight', 'Width', 'integer', { min: 0, max: 20 }), p('transparency', 'Transparency', 'percent'), p('roundEdge', 'Rounded corners', 'integer', { min: 0 })]
})

const shadowCard: FormatCardDef = {
  object: 'shadow',
  displayName: 'Shadow',
  toggle: 'show',
  properties: [p('show', 'Show', 'bool'), p('color', 'Color', 'color'), p('transparency', 'Transparency', 'percent'), p('angle', 'Angle', 'integer'), p('shadowDistance', 'Distance', 'integer'), p('shadowBlur', 'Blur', 'integer')]
}

const glowCard: FormatCardDef = {
  object: 'glow',
  displayName: 'Glow',
  toggle: 'show',
  properties: [p('show', 'Show', 'bool'), p('color', 'Color', 'color'), p('transparency', 'Transparency', 'percent'), p('glowBlur', 'Blur', 'integer')]
}

const actionCard: FormatCardDef = {
  object: 'visualLink',
  displayName: 'Action',
  container: true,
  toggle: 'show',
  tab: 'general',
  properties: [
    p('show', 'Show', 'bool'),
    p('type', 'Type', 'enum', {
      options: ['Back', 'Bookmark', 'Drillthrough', 'PageNavigation', 'QnA', 'WebUrl', 'ClearAllSlicers', 'ApplyAllSlicers'].map((v) => ({ value: v, label: v.replace(/([a-z])([A-Z])/g, '$1 $2') }))
    }),
    p('navigationSection', 'Destination page', 'text'),
    p('bookmark', 'Bookmark', 'text'),
    p('drillthroughSection', 'Drill through destination', 'text'),
    p('webUrl', 'Web URL', 'text'),
    p('tooltip', 'Tooltip', 'text')
  ]
}

const SHAPE_OPTIONS = SHAPE_KINDS.map((k) => ({ value: k, label: k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()) }))

registerVisual({
  type: 'textbox',
  displayName: 'Text box',
  category: 'element',
  icon: ICONS.textbox,
  roles: [],
  formatCards: [],
  component: TextboxVisual,
  inGallery: false,
  defaultSize: { width: 280, height: 80 },
  getData(visual) {
    const text = paragraphsText(buildParagraphs(visual.json?.visual?.objects?.general?.[0]?.properties?.paragraphs))
    return { columns: ['Text'], rows: text ? [[text]] : [] }
  }
})

registerVisual({
  type: 'shape',
  aliases: ['basicShape'],
  displayName: 'Shape',
  category: 'element',
  icon: ICONS.shape,
  roles: [],
  formatCards: [
    { object: 'shape', displayName: 'Shape', properties: [p('tileShape', 'Shape', 'enum', { options: SHAPE_OPTIONS }), p('rectangleRoundedCurve', 'Rounded corners', 'integer', { min: 0 })] },
    { object: 'rotation', displayName: 'Rotation', properties: [p('shapeAngle', 'Shape', 'integer', { min: 0, max: 360 }), p('textAngle', 'Text', 'integer', { min: 0, max: 360 })] },
    fillCard,
    outlineCard(),
    textCard(),
    shadowCard,
    glowCard,
    actionCard
  ],
  component: ShapeVisual,
  inGallery: false,
  defaultSize: { width: 200, height: 120 }
})

registerVisual({
  type: 'image',
  displayName: 'Image',
  category: 'element',
  icon: ICONS.image,
  roles: [],
  formatCards: [
    {
      object: 'imageScaling',
      displayName: 'Image',
      properties: [
        p('imageScalingType', 'Image fit', 'enum', {
          options: [
            { value: 'Normal', label: 'Normal' },
            { value: 'Fit', label: 'Fit' },
            { value: 'Fill', label: 'Fill' }
          ]
        })
      ]
    },
    actionCard
  ],
  component: ImageVisual,
  inGallery: false,
  defaultSize: { width: 200, height: 150 }
})

registerVisual({
  type: 'actionButton',
  displayName: 'Button',
  category: 'element',
  icon: ICONS.button,
  roles: [],
  formatCards: [
    { object: 'shape', displayName: 'Shape', properties: [p('tileShape', 'Shape', 'enum', { options: SHAPE_OPTIONS }), p('rectangleRoundedCurve', 'Rounded corners', 'integer', { min: 0 })] },
    textCard(),
    {
      object: 'icon',
      displayName: 'Icon',
      toggle: 'show',
      properties: [
        p('show', 'Show', 'bool'),
        p('shapeType', 'Icon type', 'enum', {
          options: ['blank', 'back', 'information', 'help', 'qna', 'bookmark', 'navigator', 'reset', 'filter', 'clearAllSlicers', 'applyAllSlicers', 'leftArrow', 'rightArrow', 'plus', 'close'].map((v) => ({ value: v, label: v }))
        }),
        p('placement', 'Placement', 'enum', {
          options: [
            { value: 'left', label: 'Left of text' },
            { value: 'right', label: 'Right of text' },
            { value: 'top', label: 'Above text' },
            { value: 'bottom', label: 'Below text' }
          ]
        }),
        p('lineColor', 'Line color', 'color'),
        p('lineWeight', 'Line weight', 'integer', { min: 1, max: 10 }),
        p('transparency', 'Transparency', 'percent'),
        p('iconSize', 'Size', 'integer'),
        p('horizontalAlignment', 'Horizontal alignment', 'enum', { options: ALIGN_OPTS }),
        p('verticalAlignment', 'Vertical alignment', 'enum', { options: VALIGN_OPTS })
      ]
    },
    fillCard,
    outlineCard(),
    shadowCard,
    glowCard,
    actionCard
  ],
  component: ActionButtonVisual,
  inGallery: false,
  defaultSize: { width: 120, height: 40 }
})

const navigatorCards = (itemsCard: FormatCardDef): FormatCardDef[] => [
  {
    object: 'layout',
    displayName: 'Grid layout',
    properties: [
      p('orientation', 'Orientation', 'enum', {
        options: [
          { value: 0, label: 'Horizontal' },
          { value: 1, label: 'Vertical' },
          { value: 2, label: 'Grid' }
        ]
      }),
      p('rowCount', 'Rows', 'integer', { min: 1 }),
      p('columnCount', 'Columns', 'integer', { min: 1 }),
      p('cellPadding', 'Padding', 'integer', { min: 0 })
    ]
  },
  itemsCard,
  { object: 'shape', displayName: 'Shape', properties: [p('tileShape', 'Shape', 'enum', { options: SHAPE_OPTIONS }), p('roundEdge', 'Rounded corners', 'integer', { min: 0 })] },
  textCard(),
  fillCard,
  outlineCard(),
  shadowCard,
  glowCard
]

registerVisual({
  type: 'pageNavigator',
  displayName: 'Page navigator',
  category: 'element',
  icon: ICONS.pageNav,
  roles: [],
  formatCards: navigatorCards({
    object: 'pages',
    displayName: 'Pages',
    properties: [p('showHiddenPages', 'Show hidden pages', 'bool'), p('showTooltipPages', 'Show tooltip pages', 'bool')]
  }),
  component: PageNavigatorVisual,
  inGallery: false,
  defaultSize: { width: 480, height: 40 },
  getData(visual, ctx) {
    return { columns: ['Page'], rows: buildPageItems(visual.json, ctx.report).map((i) => [i.label]) }
  }
})

registerVisual({
  type: 'bookmarkNavigator',
  displayName: 'Bookmark navigator',
  category: 'element',
  icon: ICONS.bookmarkNav,
  roles: [],
  formatCards: navigatorCards({
    object: 'bookmarks',
    displayName: 'Bookmarks',
    properties: [p('bookmarkGroup', 'Bookmark group', 'text'), p('allowDeselection', 'Allow deselection', 'bool')]
  }),
  component: BookmarkNavigatorVisual,
  inGallery: false,
  defaultSize: { width: 480, height: 40 }
})

registerVisual({
  type: 'qnaVisual',
  displayName: 'Q&A',
  category: 'element',
  icon: ICONS.qna,
  roles: [],
  formatCards: [],
  component: QnaVisual,
  defaultSize: { width: 400, height: 240 }
})
