/** Registers the charts visuals (registerVisual calls). */
import { registerCartesianCharts } from './cartesian/register'
import { registerOtherCharts } from './registerOthers'
import { registerPieCharts } from './pie/register'
import { registerMapVisuals } from './map/register'
import { registerMiscVisuals } from './misc/register'

registerCartesianCharts()
registerPieCharts()
registerOtherCharts()
registerMapVisuals()
registerMiscVisuals()
