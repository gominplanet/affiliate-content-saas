/**
 * Decode HTML entities in a PLAIN-TEXT string.
 *
 * WordPress returns titles/excerpts with entities (`&#038;` = &, `&#8217;` = ’,
 * `&#8211;` = –, `&amp;`, …). Those are correct inside HTML, but when the string
 * is dropped into a React text node or a plain-text message (social captions,
 * the brand-recap message, the Library title), the raw `&#038;` shows literally.
 * This decodes them back to real characters. Server-safe (no DOM).
 *
 * Handles any numeric form (`&#NNN;` / `&#xHH;`) plus the common named entities,
 * and loops a few times so a double-encoded value (`&amp;#038;`) fully resolves.
 */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', trade: '™', reg: '®',
  copy: '©', deg: '°', middot: '·', bull: '•',
  frac12: '½', frac14: '¼', frac34: '¾', times: '×',
}

function decodeOnce(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, ent: string) => {
    if (ent[0] === '#') {
      const hex = ent[1] === 'x' || ent[1] === 'X'
      const code = hex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try { return String.fromCodePoint(code) } catch { return m }
      }
      return m
    }
    const named = NAMED[ent.toLowerCase()]
    return named !== undefined ? named : m
  })
}

export function decodeHtmlEntities(input: string | null | undefined): string {
  if (!input) return ''
  let s = String(input)
  let prev = ''
  for (let i = 0; i < 3 && s !== prev; i++) {
    prev = s
    s = decodeOnce(s)
  }
  return s
}
