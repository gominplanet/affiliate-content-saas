// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHICH OF A CREATOR'S POSTS NEED REBUILDING FROM THEIR OWN VIDEO. Pure.
//
// A creator found posts made from his own videos that read as research: no
// transcript could be read when they were written, so the writer had only the
// listing, and some posts said so ("researched from the product listing...,
// not a first-hand test") right under his own embedded review. MVP now reads
// the audio when captions are refused, so rebuilding fixes them. The admin
// repair (app/api/admin/rebuild-posts) does that on our cost, in place, and
// this decides which posts it offers.

/** Sentences that say a post was not made from first-hand use. Each one is
 *  false on a post built from the creator's own video. */
const RESEARCH_SIGNALS: Array<{ label: string; rx: RegExp }> = [
  { label: 'says it was researched from the listing', rx: /researched from the product listing/i },
  { label: 'says it is not a first-hand test', rx: /not a first[- ]hand test/i },
  // Only about the product itself: "I didn't use a pencil to mark the holes"
  // is a step in a real review, not a denial.
  { label: 'says the product was not tested', rx: /(?:have not|haven['’]t) (?:personally |actually )?(?:tested|tried|used|reviewed) (?:this|these|the|it)\b|(?:did not|didn['’]t) (?:personally |actually )(?:test|try|use|review)\b|not (?:personally )?tested (?:this|these) products?/i },
]

const stripTags = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#8217;|&rsquo;/g, '’').replace(/\s+/g, ' ')

/** What in the post's text says it was not first-hand, as short labels. */
export function researchSignals(html: string | null | undefined): string[] {
  const text = stripTags(String(html || ''))
  return RESEARCH_SIGNALS.filter((s) => s.rx.test(text)).map((s) => s.label)
}

export type RepairCandidate = {
  hasTranscript: boolean
  signals: string[]
}

/** Why a post is worth rebuilding, or [] when it looks fine. */
export function repairReasons(c: RepairCandidate): string[] {
  const out: string[] = []
  if (!c.hasTranscript) out.push('written without a transcript of the video')
  out.push(...c.signals)
  return out
}

/** A saved transcript worth writing from: the text column, or word cues. */
export function hasUsableTranscript(transcript: unknown, cues: unknown): boolean {
  if (typeof transcript === 'string' && transcript.trim().length >= 80) return true
  if (!Array.isArray(cues)) return false
  const chars = cues.reduce((n: number, c: { text?: unknown }) => n + String(c?.text ?? '').trim().length, 0)
  return chars >= 80
}
