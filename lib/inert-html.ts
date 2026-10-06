// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST HTML IS NOT TRUSTED JUST BECAUSE IT IS OURS.
//
// Three screens put a post's HTML straight into the MVP page: the article
// preview (dangerouslySetInnerHTML), and the two in-app editors that seed a
// contenteditable with innerHTML. That HTML is not only MVP's own writing. The
// article writer runs web_search, so a page it read can steer what it emits;
// blog_posts.content is backfilled from WordPress, where other people on the
// creator's site can write; and a VA can save content the owner later opens.
// One `<img src=x onerror=...>` in any of them ran with the creator's session
// on the MVP origin (2026-10-06 security audit).
//
// inertHtml keeps the post as it is for reading and editing and removes only
// what executes once inserted: inline on* handlers, srcdoc, plugins,
// <base>/<meta>/<link>, and javascript:/vbscript:/data:text/html URLs.
// <script> is LEFT IN: a script inserted through innerHTML never runs, and the
// editors save what they show, so removing one would delete an embed or a
// JSON-LD block from the post on the next save. An iframe embed (a YouTube
// video) stays too: it is another origin and cannot reach this page.
//
// Runs in the browser, where DOMParser builds an inert document (nothing in it
// loads or runs). Without DOMParser it escapes everything, which is safe and
// only ever reached during a server render that has no post HTML anyway.

// noscript is dropped because DOMParser parses it with scripting OFF and the page
// with scripting ON: markup hidden in an attribute inside it comes back to life
// on the second parse (the classic mutation XSS).
const DROP_TAGS = ['object', 'embed', 'applet', 'base', 'meta', 'link', 'frame', 'frameset', 'noscript']

/** A URL that runs code when followed or loaded. Control characters and
 *  whitespace are removed first, since browsers ignore them inside a scheme. */
export function isScriptUrl(raw: string): boolean {
  // eslint-disable-next-line no-control-regex
  const v = String(raw || '').replace(/[\x00-\x20\x7f-\x9f]/g, '').toLowerCase()
  return /^(javascript|vbscript|livescript):/.test(v) || /^data:(text\/html|application\/xhtml|text\/xml|application\/xml)/.test(v)
}

const escapeAll = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function inertHtml(html: string | null | undefined): string {
  const src = String(html ?? '')
  if (!src) return ''
  if (typeof DOMParser === 'undefined') return escapeAll(src)
  // UNTIL IT STOPS CHANGING. Markup that parses differently the second time is
  // how a sanitizer is bypassed; a pass that changes nothing is the proof that
  // what reaches the page is what was checked. Anything that never settles is
  // shown as text.
  let cur = src
  for (let i = 0; i < 4; i++) {
    const next = inertPass(cur)
    if (next === cur) return next
    cur = next
  }
  return escapeAll(src)
}

function inertPass(src: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${src}</body></html>`, 'text/html')
  for (const el of Array.from(doc.querySelectorAll(DROP_TAGS.join(',')))) el.remove()
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
        el.removeAttribute(attr.name)
        continue
      }
      // Every attribute, not a list of URL ones: SVG animation can write a
      // javascript: value into href through values/to/from.
      if (isScriptUrl(attr.value) || (/^(values|to|from|by)$/.test(name) && /javascript:/i.test(attr.value))) {
        el.removeAttribute(attr.name)
      }
    }
  }
  return doc.body.innerHTML
}
