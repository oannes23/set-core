/* ui/dom — the one tiny DOM helper shared across the UI layer. `$` parses an HTML string into a
   single element (typed). Lives here so app.ts and router.ts both use the same builder. */

/** Parse an HTML string into its first element, typed. (No sanitization — callers pass trusted markup.) */
export const $ = <T extends HTMLElement>(html: string): T => {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstChild as T
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Escape a string for safe interpolation into `$`-built innerHTML — as text OR inside a double-quoted
    attribute. `$` does NO sanitization (FABLE §6 U3), so any SERVER- or USER-controlled string must pass
    through here: server-echoed Embassy handles, bests fields, daily-descriptor strings, and the user-set
    server URL. Escapes the five HTML-significant chars in one pass; null/undefined → "". */
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (ch) => ESC[ch]!)
