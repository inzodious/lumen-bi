/** Standalone entry for the canvas dev harness (renders CanvasTest without the app shell). */
import { createRoot } from 'react-dom/client'
import '../../styles/global.css'
import { CanvasTest } from './CanvasTest'

createRoot(document.getElementById('root')!).render(<CanvasTest />)
