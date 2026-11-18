/**
 * Code visual: sanitising the template's HTML output before it goes to the frame. The frame's CSP already blocks
 * scripts, inline handlers and every network request; this second layer removes what could still navigate or embed
 * (meta refresh, base, iframes, objects, forms, links leaving the visual) so a template cannot break its own frame, and
 * keeps the markup authors need: HTML and SVG, <style>, inline styles, classes, data-* and ARIA attributes, data: images.
 */
import DOMPurify from 'dompurify'
import { preSanitize } from '../custom/htmlSanitize'

/**
 * Attribute values DOMPurify accepts (it tests every non-URI-safe attribute value against this): values without a
 * scheme (numbers, SVG coordinates, relative references, which resolve to the frame's own scheme and never reach the
 * network) and the data: / blob: schemes. Any other scheme (http:, https:, javascript:, file:, …) is removed.
 */
const ALLOWED_URI = /^(?:(?:data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i

const FORBID_TAGS = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'base', 'meta', 'link', 'portal', 'noscript', 'template']

let hooked = false

export function sanitizeTemplateHtml(html: string): string {
  const purify = DOMPurify as unknown as { isSupported?: boolean; sanitize?: (s: string, cfg: object) => string; addHook?: (n: string, fn: (node: Element) => void) => void }
  if (!purify?.isSupported || typeof purify.sanitize !== 'function') {
    // no DOM (unit tests, server rendering): the string-level pass, plus meta / base and remote URLs
    return preSanitize(html)
      .replace(/<\/?(meta|base|link|form)\b[^>]*>/gi, '')
      .replace(/\s(href|src|xlink:href|action|data|poster|srcset)\s*=\s*("(?!data:|blob:|#)[^"]*"|'(?!data:|blob:|#)[^']*')/gi, '')
  }
  if (!hooked && purify.addHook) {
    hooked = true
    purify.addHook('afterSanitizeAttributes', (node) => {
      // links never navigate the frame (or the app): keep them as text with their title
      if (node.tagName === 'A') {
        node.removeAttribute('target')
        if (node.getAttribute('href') && !node.getAttribute('href')!.startsWith('#')) node.removeAttribute('href')
      }
    })
  }
  return purify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    ADD_ATTR: ['style', 'class', 'title', 'role', 'tabindex'],
    FORBID_TAGS,
    ALLOW_DATA_ATTR: true,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    FORCE_BODY: true
  })
}
