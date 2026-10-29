// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TELL THE BRAND ABOUT THE UPLOAD (Seb, 2026-10-29: "once that video is
// uploaded and sent, it would be great to be able to open the active chat we
// have with that brand to be able to send them a message telling them of our
// upload"). After TRYBE has a video in a brand's review, the upload page
// offers one short message for that brand's TRYBE chat, ready to edit: one
// message for every video sent to that brand in one go, never one each.
// It is sent only by the creator's tap, never on its own, and goes through
// the same pay check as every TRYBE message (it never talks rates).
// Pure, tested in scripts/test-trybe-upload-note.

/** "A", "A and B", or "A, B and more". */
function productList(products: string[]): string {
  const p = Array.from(new Set(products.map((x) => x.trim()).filter(Boolean)))
  if (!p.length) return ''
  if (p.length === 1) return p[0]
  if (p.length === 2) return `${p[0]} and ${p[1]}`
  return `${p[0]}, ${p[1]} and more`
}

/** The message for the brand's chat, about the videos just sent. Pure. */
export function uploadNoteText(brand: string, videos: { products: string[] }[], creatorName = ''): string {
  const n = Math.max(1, videos.length)
  const what = productList(videos.flatMap((v) => v.products))
  const first = creatorName.trim().split(/\s+/)[0] || ''
  return [
    `Hi ${brand} team! I just sent you ${n === 1 ? 'a new video' : `${n} new videos`}${what ? ` for ${what}` : ''}. ${n === 1 ? 'It is' : 'They are'} in your review now.`,
    'Happy to make any changes you would like.',
    `Thanks${first ? `, ${first}` : ''}!`,
  ].join('\n\n')
}

/** When this browser last told each brand about an upload. */
export const TOLD_KEY = 'mvp.trybe.uploadTold'

export function readTold(): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(TOLD_KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
export function rememberTold(brandId: string, at = new Date()): void {
  try { localStorage.setItem(TOLD_KEY, JSON.stringify({ ...readTold(), [brandId]: at.toISOString() })) } catch { /* only a convenience */ }
}

/** The time this brand was told today, or null. Pure. */
export function toldToday(told: Record<string, string>, brandId: string, now = new Date()): Date | null {
  const t = Date.parse(told[brandId] ?? '')
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return d.toDateString() === now.toDateString() ? d : null
}
