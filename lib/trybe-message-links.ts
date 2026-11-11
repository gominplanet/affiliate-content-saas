// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE LINKS A BRAND SENDS IN ITS MESSAGES (Seb, 2026-11-10: "when a brand
// sends a message with links, like a Canva link or a Docs, a Google Doc, is
// MVP able to read that and take all of that data and information into
// consideration when it comes to creating video scripts, or at least giving
// the user maybe a TLDR?"). Hydroh's creator coach sent a product deck and a
// creator deck on Canva, two Google Docs, a Calendly link and a Discord
// invite, and asked creators to read them before filming.
//
// Which links are worth reading and how (pure, here), then the TRYBE route
// reads them on the creator's press, keeps the words, writes a short TLDR,
// and hands the words to Brand scripts for that brand:
//   Google Docs, Slides, Sheets  their plain text export (when shared with
//                                anyone with the link; otherwise said)
//   Google Drive files           the file (a PDF or picture is read by Claude)
//   Canva                        Canva's own embed answer gives the title only:
//                                Canva shows a deck to browsers, not to MVP's
//                                server, so it is said, with how to add the PDF
//   Calendly, Discord, Zoom,     not read: a booking or an invite has nothing
//   social video links           to film from, and it is said what each is
//   any other page               its words, or a PDF or picture through Claude

export type LinkKind = 'gdoc' | 'gslides' | 'gsheet' | 'gdrive' | 'canva' | 'booking' | 'invite' | 'video' | 'web'

export interface MessageLink { url: string; kind: LinkKind }

/** The http(s) links in a message, without trailing punctuation, each once,
 *  at most `max`. Pure. */
export function messageLinks(text: string, max = 10): MessageLink[] {
  const out: MessageLink[] = []
  const seen = new Set<string>()
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const url = m[0].replace(/[.,;:!?)]+$/, '')
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ url, kind: linkKind(url) })
    if (out.length >= max) break
  }
  return out
}

/** What a link is, from its address. Pure. */
export function linkKind(url: string): LinkKind {
  let h = ''
  let p = ''
  try { const u = new URL(url); h = u.hostname.toLowerCase(); p = u.pathname } catch { return 'web' }
  if (h === 'docs.google.com') {
    if (p.startsWith('/document/')) return 'gdoc'
    if (p.startsWith('/presentation/')) return 'gslides'
    if (p.startsWith('/spreadsheets/')) return 'gsheet'
    return 'gdrive'
  }
  if (h === 'drive.google.com') return 'gdrive'
  if (h === 'canva.link' || h === 'canva.com' || h.endsWith('.canva.com')) return 'canva'
  if (/(^|\.)calendly\.com$|(^|\.)cal\.com$|(^|\.)savvycal\.com$|(^|\.)zoom\.us$|meet\.google\.com$/.test(h)) return 'booking'
  if (/(^|\.)discord\.(gg|com)$|(^|\.)slack\.com$|(^|\.)t\.me$|chat\.whatsapp\.com$/.test(h)) return 'invite'
  if (/(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|loom\.com|vimeo\.com)$/.test(h)) return 'video'
  return 'web'
}

/** Where to read a link's words from: Google's own plain text or CSV export,
 *  or the file itself for a Drive file. Null when it is not read. Pure. */
export function readUrlFor(link: MessageLink): string | null {
  const id = (re: RegExp) => link.url.match(re)?.[1] ?? null
  if (link.kind === 'gdoc') { const d = id(/\/document\/d\/([\w-]{20,})/); return d ? `https://docs.google.com/document/d/${d}/export?format=txt` : null }
  if (link.kind === 'gslides') { const d = id(/\/presentation\/d\/([\w-]{20,})/); return d ? `https://docs.google.com/presentation/d/${d}/export/txt` : null }
  if (link.kind === 'gsheet') { const d = id(/\/spreadsheets\/d\/([\w-]{20,})/); return d ? `https://docs.google.com/spreadsheets/d/${d}/export?format=csv` : null }
  if (link.kind === 'gdrive') { const d = id(/\/file\/d\/([\w-]{20,})/) ?? id(/[?&]id=([\w-]{20,})/); return d ? `https://drive.google.com/uc?export=download&id=${d}` : null }
  if (link.kind === 'web') return link.url
  return null
}

/** The words on a link that opens it, naming where it goes. Pure. */
export function openWords(link: MessageLink): string {
  switch (link.kind) {
    case 'gdoc': return 'Open in Google Docs'
    case 'gslides': return 'Open in Google Slides'
    case 'gsheet': return 'Open in Google Sheets'
    case 'gdrive': return 'Open in Google Drive'
    case 'canva': return 'Open on Canva'
    case 'booking': { try { const h = new URL(link.url).hostname.replace(/^www\./, ''); return /calendly/.test(h) ? 'Open on Calendly' : /zoom/.test(h) ? 'Open on Zoom' : `Open on ${h}` } catch { return 'Open the booking page' } }
    case 'invite': { try { const h = new URL(link.url).hostname.replace(/^www\./, ''); return /discord/.test(h) ? 'Open on Discord' : `Open on ${h}` } catch { return 'Open the invite' } }
    case 'video': { try { const h = new URL(link.url).hostname.replace(/^www\./, ''); return /youtu/.test(h) ? 'Watch on YouTube' : /tiktok/.test(h) ? 'Watch on TikTok' : /instagram/.test(h) ? 'Watch on Instagram' : `Watch on ${h}` } catch { return 'Watch the video' } }
    default: { try { return `Open on ${new URL(link.url).hostname.replace(/^www\./, '')}` } catch { return 'Open the page' } }
  }
}

/** Why a link is not read, said plainly, or null when it is. Pure. */
export function notReadWhy(link: MessageLink): string | null {
  if (link.kind === 'booking') return 'A booking page, nothing to read for scripts.'
  if (link.kind === 'invite') return 'An invite to a community, nothing to read for scripts.'
  if (link.kind === 'video') return 'A video link. MVP does not watch videos sent in messages yet; open it to watch.'
  return null
}

/** What a read link answered, said for a creator, from Google's or the
 *  site's status. Pure. */
export function answerWhy(kind: LinkKind, status: number, landedOnSignIn: boolean): string {
  const google = kind === 'gdoc' || kind === 'gslides' || kind === 'gsheet' || kind === 'gdrive'
  if (google && (landedOnSignIn || status === 401 || status === 403)) return 'Not shared with anyone who has the link, so MVP cannot read it. Ask the brand to share it that way, or open it yourself.'
  if (status === 404) return 'The link answered that nothing is there (404).'
  return `The link answered ${status}.`
}

/** One read link, as kept. A PDF the creator added has a `file:` url. */
export interface ReadLink {
  url: string
  kind: LinkKind
  title: string | null
  ok: boolean
  why: string | null
  /** The words read, capped. */
  text: string
  /** Longer than MVP could copy out: only its first part was read (2026-11-11). */
  cut?: boolean
}

/** A PDF the creator added (not a link in a message). Pure. */
export const isAddedFile = (l: { url: string }) => l.url.startsWith('file:')

/** The TLDR MVP writes from the words read. */
export interface LinksTldr { points: string[]; say: string[]; avoid: string[] }

/** What is kept for a creator and a brand. */
export interface LinksDigest {
  at: string
  brandName: string
  links: ReadLink[]
  tldr: LinksTldr | null
  why: string | null
}

export const LINK_TEXT_MAX = 8000
/** A PDF the brand sent, added by the creator: read whole (Seb, 2026-11-11:
 *  "take into consideration everything in it before scripting"). */
export const PDF_TEXT_MAX = 60000
/** What Brand scripts get of it all: room for a long brand guide. */
export const SCRIPT_TEXT_MAX = 60000

/** The words of what the brand sent, for the script writer, and which
 *  documents went in whole: the TLDR, then the PDFs the creator added, then
 *  the links. Pure. */
export function docsForScripts(d: LinksDigest | null): { text: string; docs: Array<{ title: string; whole: boolean }> } {
  if (!d) return { text: '', docs: [] }
  const parts: string[] = []
  if (d.tldr) {
    if (d.tldr.points.length) parts.push(`In short:\n${d.tldr.points.map((p) => `- ${p}`).join('\n')}`)
    if (d.tldr.say.length) parts.push(`Say or show:\n${d.tldr.say.map((p) => `- ${p}`).join('\n')}`)
    if (d.tldr.avoid.length) parts.push(`Avoid:\n${d.tldr.avoid.map((p) => `- ${p}`).join('\n')}`)
  }
  const docs: Array<{ title: string; whole: boolean }> = []
  let used = parts.join('\n\n').length
  const read = d.links.filter((l) => l.ok && l.text)
  for (const l of [...read.filter(isAddedFile), ...read.filter((l) => !isAddedFile(l))]) {
    const title = l.title || l.url
    const head = `From "${title}":\n`
    const room = SCRIPT_TEXT_MAX - used - head.length - 2
    if (room < 400) { docs.push({ title, whole: false }); continue }
    const body = l.text.slice(0, room)
    parts.push(head + body)
    used += head.length + body.length + 2
    docs.push({ title, whole: body.length === l.text.length && !l.cut })
  }
  return { text: parts.join('\n\n').slice(0, SCRIPT_TEXT_MAX), docs }
}

/** The words of the read links, for the script writer, capped. Pure. */
export function digestForScripts(d: LinksDigest | null): string {
  return docsForScripts(d).text
}

/** The TLDR as Claude answered it, checked: lists of short plain lines, no
 *  dashes, at most 8, 6 and 6. Null when it is not that. Pure. */
export function readTldr(raw: string): LinksTldr | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>
    const list = (v: unknown, n: number) => (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && x.trim().length > 2)
      .map((x) => x.replace(/\s*[–—]\s*/g, ', ').replace(/\s+-\s+/g, ', ').trim().slice(0, 240)).slice(0, n)
    const t = { points: list(j.points, 8), say: list(j.say, 6), avoid: list(j.avoid, 6) }
    return t.points.length || t.say.length || t.avoid.length ? t : null
  } catch { return null }
}
