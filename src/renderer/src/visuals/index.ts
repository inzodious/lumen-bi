/** Import every visual family once so they self-register. Import this module before rendering a report. */
import './charts'
import './tables'
import './cards'
import './slicers'
import './elements'
import './custom'
export { getVisual, allVisuals, registerVisual } from './registry'
