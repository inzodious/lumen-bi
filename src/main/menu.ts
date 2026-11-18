import { BrowserWindow, Menu } from 'electron'

/**
 * The window is frameless (Power BI Desktop style custom title bar + ribbon in the renderer), so the
 * application menu is never shown. Keyboard shortcuts (Ctrl+S/O/N/Z/Y, canvas Ctrl+C/V/X…) are handled
 * in the renderer; the menu only keeps text-editing roles (so Ctrl+C/V work in inputs on every
 * platform) and forwards a few commands as 'menu:command' events (see MenuCommand in src/shared/host.ts).
 * Developer shortcuts (F12 / Ctrl+Shift+I devtools, Ctrl+R reload in dev) are wired in index.ts.
 */
export function buildMenu(win: BrowserWindow): void {
  const send = (cmd: string) => () => win.webContents.send('menu:command', cmd)
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'New', click: send('file.new') },
        { label: 'Open…', click: send('file.open') },
        { label: 'Save', click: send('file.save') },
        { label: 'Save As…', click: send('file.saveAs') },
        { label: 'Export PDF…', click: send('file.export.pdf') },
        { type: 'separator' },
        { label: 'About Lumen', click: send('help.about') },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    }
  ])
  Menu.setApplicationMenu(menu)
}
