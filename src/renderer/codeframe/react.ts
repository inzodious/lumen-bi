/**
 * React runtime for code visuals with JSX, loaded into the sandboxed frame on demand (frame.ts `loadReact`). React 19
 * ships no UMD build, so this entry is bundled as a classic script (IIFE, production mode) by the `codeframe` plugin in
 * electron.vite.config.ts and exposes the modules on `window.__lumenReact`.
 */
import * as React from 'react'
import * as ReactDOMClient from 'react-dom/client'
import * as JSXRuntime from 'react/jsx-runtime'
;(window as unknown as { __lumenReact: unknown }).__lumenReact = { React, ReactDOMClient, JSXRuntime }
