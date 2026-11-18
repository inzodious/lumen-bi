/**
 * HTML / CSS sanitization for the HTML Content custom visual.
 *
 * The visual renders untrusted-ish HTML produced by measures. Like the original visual we allow
 * the full presentational surface — inline `style`, `<style>` blocks (incl. @keyframes),
 * SVG, tables, images (http/https/data URIs), links — but nothing executable: no scripts,
 * event-handler attributes, javascript: URLs, iframes/objects/embeds, forms or meta refreshes.
 *
 * `sanitizeHtml` uses DOMPurify when a DOM is available (renderer) and always runs the
 * string-level `preSanitize` first as defense in depth (and as the Node/test path).
 * The output is additionally rendered in a sandboxed iframe without `allow-scripts`.
 */
import DOMPurify from 'dompurify'

const DANGEROUS_BLOCKS = /<(script|iframe|object|embed|frame|frameset|applet|noscript|template)\b[\s\S]*?<\/\1\s*>/gi
const DANGEROUS_OPEN = /<\/?(script|iframe|object|embed|frame|frameset|applet|base|meta|link|form|noscript|template)\b[^>]*>/gi
const EVENT_ATTR = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
const JS_URL_ATTR = /\s+(href|src|xlink:href|action|formaction|data)\s*=\s*("\s*(?:javascript|vbscript):[^"]*"|'\s*(?:javascript|vbscript):[^']*'|(?:javascript|vbscript):[^\s>]+)/gi

/** String-level removal of executable content. Not a full sanitizer on its own. */
export function preSanitize(html: string): string {
  let out = String(html ?? '')
  let prev: string
  do {
    prev = out
    out = out.replace(DANGEROUS_BLOCKS, '').replace(DANGEROUS_OPEN, '')
  } while (out !== prev)
  out = out.replace(EVENT_ATTR, '').replace(JS_URL_ATTR, '')
  return sanitizeCssText(out, true)
}

/** Strip CSS constructs that can execute or exfiltrate (`expression()`, `javascript:` URLs, `-moz-binding`, `behavior`). */
export function sanitizeCssText(css: string, inHtml = false): string {
  let out = String(css ?? '')
    .replace(/expression\s*\(/gi, 'invalid(')
    .replace(/url\s*\(\s*(['"]?)\s*(?:javascript|vbscript):[^)]*\)/gi, 'none')
    .replace(/-moz-binding\s*:[^;"'}]*/gi, '')
    .replace(/behavior\s*:[^;"'}]*/gi, '')
  if (!inHtml) out = out.replace(/<\/?\s*style[^>]*>/gi, '').replace(/<\/?\s*script[^>]*>/gi, '')
  return out
}

let hooked = false

/** Full sanitization (renderer): DOMPurify with HTML + SVG profiles, styles and <style> kept. */
export function sanitizeHtml(html: string): string {
  const pre = preSanitize(html)
  const purify = DOMPurify as unknown as { isSupported?: boolean; sanitize?: (s: string, cfg: object) => string; addHook?: (n: string, fn: (node: Element) => void) => void }
  if (!purify?.isSupported || typeof purify.sanitize !== 'function') return pre
  if (!hooked && purify.addHook) {
    hooked = true
    // keep links in a new browsing context; the host intercepts clicks anyway
    purify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') node.setAttribute('rel', 'noopener noreferrer')
    })
  }
  return purify.sanitize(pre, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    ADD_ATTR: ['target', 'style', 'class', 'title'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'base', 'meta', 'link'],
    FORCE_BODY: true,
    ALLOW_DATA_ATTR: true
  })
}
