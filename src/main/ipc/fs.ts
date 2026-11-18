import { ipcMain } from 'electron'
import { nodeFs } from '../../core/io/nodefs'

/** Filesystem IPC: mirrors the FileSystem interface (src/core/io/fs.ts). */
export function registerFsIpc(): void {
  ipcMain.handle('fs:readFile', (_e, p: string) => nodeFs.readFile(p))
  ipcMain.handle('fs:readText', (_e, p: string) => nodeFs.readText(p))
  ipcMain.handle('fs:writeFile', (_e, p: string, data: Uint8Array | string) => nodeFs.writeFile(p, data))
  ipcMain.handle('fs:list', (_e, p: string) => nodeFs.list(p))
  ipcMain.handle('fs:exists', (_e, p: string) => nodeFs.exists(p))
  ipcMain.handle('fs:stat', (_e, p: string) => nodeFs.stat(p))
  ipcMain.handle('fs:mkdirp', (_e, p: string) => nodeFs.mkdirp(p))
  ipcMain.handle('fs:remove', (_e, p: string) => nodeFs.remove(p))
}
