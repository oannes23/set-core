/* ui/dom — the one tiny DOM helper shared across the UI layer. `$` parses an HTML string into a
   single element (typed). Lives here so app.ts and router.ts both use the same builder. */

/** Parse an HTML string into its first element, typed. (No sanitization — callers pass trusted markup.) */
export const $ = <T extends HTMLElement>(html: string): T => {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstChild as T
}
