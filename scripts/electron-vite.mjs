#!/usr/bin/env node
// Cross-platform `env -u ELECTRON_RUN_AS_NODE electron-vite <args>`: VS Code terminals set ELECTRON_RUN_AS_NODE=1,
// which makes Electron start as plain Node. `env -u` doesn't exist in Windows shells, so unset it here instead.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const cli = join(dirname(require.resolve('electron-vite/package.json')), 'bin', 'electron-vite.js')
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
