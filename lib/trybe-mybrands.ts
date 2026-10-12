// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MY BRANDS ON TRYBE (Cole Schwartz on Oink; Seb 2026-10-12: "build 1, 2 and
// 3"). Cole earns most of his money from a handful of brands: "I focus on like
// four or five brands", and he stops filming for the ones that do not approve.
// From the creator's own TRYBE numbers this reads:
//   1. per brand: earnings, videos submitted, approved, still in review,
//      rejected, the approval rate, and which 4 or 5 to focus on and which to
//      drop, each with the reason in plain words;
//   2. submissions stuck in review more than STUCK_DAYS days, with a short
//      nudge for the brand's TRYBE chat;
//   3. the brand's own best videos on TRYBE, to copy the angle that already
//      sells for it.
// TRYBE's shapes come from its own page code (brands/stats keeps brandStats
// keyed by brand id with brandName, totalEarnings in dollars, totalSubmissions,
// approvedSubmissions, commissionEnrollments; brand details keep topVideos
// with metadata.thumbnailUrl). Submissions were not seen, so every field is
// looked for under the names it is likely to have, and a count MVP could not
// read is null, never zero. Pure, so it is tested (scripts/test-trybe-mybrands).

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v.replace(/[$,]/g, '')); return Number.isFinite(n) ? n : null }
  return null
}
function pick(o: Obj, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}

/** A video in review this many days is stuck: worth a polite nudge. */
export const STUCK_DAYS = 5
/** Cole: "four or five brands". */
export const FOCUS_COUNT = 5
/** Fewer decided videos than this is too early to judge a brand. */
export const MIN_DECIDED = 3

export interface MyBrand {
  id: string
  name: string
  logo: string | null
  /** Dollars earned with the brand on TRYBE; null when TRYBE did not say. */
  earnings: number | null
  submitted: number | null
  approved: number | null
  /** From the brand's submissions when read; null when not read. */
  pending: number | null
  rejected: number | null
  enrolledAt: string | null
  programs: string[]
}

/** The keys of an answer, for an admin when nothing could be read from it. */
export function keysOf(json: unknown): string {
  const root = isObj(json) && isObj(json.data) ? json.data : json
  if (Array.isArray(root)) return `a list of ${root.length}${isObj(root[0]) ? ` (${Object.keys(root[0]).slice(0, 12).join(', ')})` : ''}`
  if (isObj(root)) return Object.keys(root).slice(0, 15).join(', ') || '(empty)'
  return typeof root
}

/** GET /backend/api/creator/v2/brands/stats?period=all: the brands the
 *  creator works with and their totals. Most earned first. */
export function readBrandStats(json: unknown): MyBrand[] {
  const root = isObj(json) && isObj(json.data) ? json.data : json
  const holder = isObj(root) ? (pick(root, ['brandStats', 'brand_stats', 'brands', 'stats', 'items']) ?? root) : root
  const entries: Array<[string, unknown]> = Array.isArray(holder)
    ? holder.map((v) => [isObj(v) ? str(v.brandId ?? v.brand_id ?? v.id) : '', v])
    : isObj(holder) ? Object.entries(holder) : []
  const out: MyBrand[] = []
  for (const [key, raw] of entries) {
    if (!isObj(raw)) continue
    const brand = isObj(raw.brand) ? raw.brand : null
    const id = str(raw.brandId ?? raw.brand_id ?? brand?.id) || key
    const name = str(pick(raw, ['brandName', 'brand_name', 'name']) ?? brand?.name)
    if (!id || !name) continue
    const enr = Array.isArray(raw.commissionEnrollments) && raw.commissionEnrollments.length ? raw.commissionEnrollments
      : isObj(raw.commissionEnrollment) ? [raw.commissionEnrollment] : Array.isArray(raw.enrollments) ? raw.enrollments : []
    const programs = enr.map((e) => (isObj(e) && isObj(e.program) ? str(e.program.name) : '')).filter(Boolean)
    const enrolledAt = enr.map((e) => (isObj(e) ? str(e.enrolledAt ?? e.enrolled_at ?? e.createdAt) : '')).filter(Boolean).sort()[0]
      || str(raw.enrolledAt ?? raw.enrolled_at) || null
    out.push({
      id, name,
      logo: str(pick(raw, ['brandLogoUrl', 'brand_logo_url', 'logoUrl', 'logo']) ?? brand?.logoUrl) || null,
      earnings: num(pick(raw, ['totalEarnings', 'total_earnings', 'earnings'])),
      submitted: num(pick(raw, ['totalSubmissions', 'total_submissions', 'submissions'])),
      approved: num(pick(raw, ['approvedSubmissions', 'approved_submissions', 'approved'])),
      pending: num(pick(raw, ['pendingSubmissions', 'pending_submissions', 'inReviewSubmissions'])),
      rejected: num(pick(raw, ['rejectedSubmissions', 'rejected_submissions', 'declinedSubmissions'])),
      enrolledAt, programs,
    })
  }
  return out.sort((a, b) => (b.earnings ?? -1) - (a.earnings ?? -1) || (b.approved ?? 0) - (a.approved ?? 0))
}

// ── Submissions ──────────────────────────────────────────────────────────────

export type SubStatus = 'pending' | 'approved' | 'rejected' | 'other'

export interface Submission {
  id: string
  status: SubStatus
  /** TRYBE's own word for it, shown when MVP could not place it. */
  rawStatus: string
  /** When it was submitted (ms); null when TRYBE did not say. */
  at: number | null
  product: string | null
  thumbnail: string | null
}

/** TRYBE's status word, in whichever spelling it uses. "Pending approval"
 *  is in review; after that approved is checked before "pending", so
 *  "APPROVED_PENDING_PAYOUT" is not called stuck in review; "not approved" is
 *  a rejection. */
export function subStatus(raw: string): SubStatus {
  const s = raw.toLowerCase().replace(/[\s-]+/g, '_')
  if (!s) return 'other'
  if (/(not_approved|unapproved|reject|declin|denied|refus|fail)/.test(s)) return 'rejected'
  if (/(pending|awaiting|waiting)_(for_)?(approval|review)|(in|under)_review/.test(s)) return 'pending'
  if (/(approv|accept|live|publish|paid|payout|complete)/.test(s)) return 'approved'
  if (/(pend|review|submit|wait|process|new|queue)/.test(s)) return 'pending'
  return 'other'
}

const dateOf = (v: unknown): number | null => {
  if (typeof v === 'number' && v > 0) return v < 1e12 ? v * 1000 : v
  const t = Date.parse(str(v))
  return Number.isFinite(t) ? t : null
}

/** GET /backend/api/creator/v2/brands/{id}/submissions: one entry per video. */
export function readSubmissions(json: unknown): Submission[] {
  const root = isObj(json) && (Array.isArray(json.data) || isObj(json.data)) ? json.data : json
  const list = Array.isArray(root) ? root
    : isObj(root) ? ([root.items, root.submissions, root.data, root.results].find(Array.isArray) as unknown[] | undefined) || [] : []
  const out: Submission[] = []
  for (const raw of list) {
    if (!isObj(raw)) continue
    const id = str(raw.id ?? raw.submissionId ?? raw.submission_id ?? raw._id)
    if (!id) continue
    const rawStatus = str(pick(raw, ['status', 'submissionStatus', 'reviewStatus', 'approvalStatus', 'state']))
    const product = isObj(raw.product) ? raw.product : null
    const meta = isObj(raw.metadata) ? raw.metadata : null
    out.push({
      id,
      status: subStatus(rawStatus),
      rawStatus,
      at: dateOf(pick(raw, ['submittedAt', 'submitted_at', 'createdAt', 'created_at', 'uploadedAt'])),
      product: str(product?.title ?? product?.name ?? raw.productName ?? raw.product_name ?? raw.productTitle) || null,
      thumbnail: str(raw.thumbnailUrl ?? raw.thumbnail_url ?? meta?.thumbnailUrl ?? raw.thumbnail) || null,
    })
  }
  return out
}

/** Pending and rejected counts from a brand's submissions, onto its totals. */
export function withSubmissions(b: MyBrand, subs: Submission[]): MyBrand {
  return {
    ...b,
    pending: subs.filter((s) => s.status === 'pending').length,
    rejected: subs.filter((s) => s.status === 'rejected').length,
  }
}

/** Approved out of the videos the brand has decided on. With nothing read
 *  about pending or rejected, approved out of everything sent. */
export function approvalRate(b: MyBrand): { rate: number | null; decided: number | null; exact: boolean } {
  if (b.approved == null) return { rate: null, decided: null, exact: false }
  if (b.rejected != null) {
    const decided = b.approved + b.rejected
    return { rate: decided ? b.approved / decided : null, decided, exact: true }
  }
  if (b.submitted != null && b.pending != null) {
    const decided = Math.max(0, b.submitted - b.pending)
    return { rate: decided ? Math.min(1, b.approved / decided) : null, decided, exact: true }
  }
  if (b.submitted) return { rate: Math.min(1, b.approved / b.submitted), decided: b.submitted, exact: false }
  return { rate: null, decided: 0, exact: false }
}

export type Verdict = 'focus' | 'keep' | 'drop' | 'early'
export interface Judged { brand: MyBrand; verdict: Verdict; why: string; rate: number | null; exactRate: boolean; perVideo: number | null }

const money = (n: number) => `$${n >= 1000 ? Math.round(n).toLocaleString('en-US') : n % 1 ? n.toFixed(2) : String(n)}`

/** Which brands to put the work into, Cole's way: the few that pay and
 *  approve get the videos; a brand that keeps rejecting, or never paid after
 *  a fair try, is dropped. Too few decisions is said as too early, not judged. */
export function judgeBrands(list: MyBrand[], now = Date.now()): Judged[] {
  const rows: Judged[] = list.map((b) => {
    const r = approvalRate(b)
    const perVideo = b.earnings != null && b.approved ? b.earnings / b.approved : null
    const days = b.enrolledAt ? (now - Date.parse(b.enrolledAt)) / 86_400_000 : null
    const decided = r.decided ?? 0
    if (decided >= 4 && r.rate != null && r.rate < 0.34) {
      return { brand: b, verdict: 'drop' as const, why: `Approves ${Math.round(r.rate * 100)}% of your videos (${b.approved} of ${decided}). Your time pays better elsewhere.`, rate: r.rate, exactRate: r.exact, perVideo }
    }
    if ((b.submitted ?? 0) >= 5 && !b.earnings && !b.approved && days != null && days >= 30) {
      return { brand: b, verdict: 'drop' as const, why: `${b.submitted} videos in ${Math.round(days)} days and nothing approved or paid yet.`, rate: r.rate, exactRate: r.exact, perVideo }
    }
    if (decided < MIN_DECIDED && !b.earnings) {
      return { brand: b, verdict: 'early' as const, why: decided ? `Only ${decided} video${decided === 1 ? '' : 's'} decided so far: too early to judge.` : 'No video decided yet: too early to judge.', rate: r.rate, exactRate: r.exact, perVideo }
    }
    return { brand: b, verdict: 'keep' as const, why: '', rate: r.rate, exactRate: r.exact, perVideo }
  })
  // The focus few: most earned, then the best approval rate, among the brands
  // that have paid something and are not dropped.
  const focus = rows.filter((j) => j.verdict === 'keep' && (j.brand.earnings ?? 0) > 0)
    .sort((a, b) => (b.brand.earnings ?? 0) - (a.brand.earnings ?? 0) || (b.rate ?? 0) - (a.rate ?? 0))
    .slice(0, FOCUS_COUNT)
  for (const j of focus) {
    j.verdict = 'focus'
    const bits = [`${money(j.brand.earnings ?? 0)} earned`]
    if (j.rate != null) bits.push(`${Math.round(j.rate * 100)}% approved`)
    if (j.perVideo != null) bits.push(`about ${money(Math.round(j.perVideo))} per approved video`)
    j.why = `${bits.join(', ')}. Film more for this one.`
  }
  for (const j of rows) {
    if (j.verdict !== 'keep' || j.why) continue
    j.why = (j.brand.earnings ?? 0) > 0
      ? `${money(j.brand.earnings ?? 0)} earned: keep it going, after your focus brands.`
      : j.rate != null ? `${Math.round(j.rate * 100)}% approved and nothing paid yet: give it a few more videos.` : 'Nothing paid yet.'
  }
  const order: Record<Verdict, number> = { focus: 0, keep: 1, early: 2, drop: 3 }
  return rows.sort((a, b) => order[a.verdict] - order[b.verdict] || (b.brand.earnings ?? 0) - (a.brand.earnings ?? 0))
}

// ── Stuck in review ──────────────────────────────────────────────────────────

/** Videos in review more than STUCK_DAYS days, oldest first. A video with no
 *  date is never called stuck. */
export function stuckOf(subs: Submission[], now = Date.now()): Submission[] {
  const cut = now - STUCK_DAYS * 86_400_000
  return subs.filter((s) => s.status === 'pending' && s.at != null && s.at < cut).sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
}

export const daysAgo = (at: number, now = Date.now()) => Math.max(0, Math.floor((now - at) / 86_400_000))

/** A short, friendly nudge for the brand's TRYBE chat. Pure, so the words are
 *  tested: no dashes, no pressure, one clear question. */
export function nudgeText(brand: string, stuck: Submission[], now = Date.now()): string {
  const n = stuck.length
  const oldest = stuck.reduce((m, s) => (s.at != null && s.at < m ? s.at : m), now)
  const d = daysAgo(oldest, now)
  const products = Array.from(new Set(stuck.map((s) => s.product).filter((p): p is string => !!p))).slice(0, 2)
  const what = n === 1 ? 'the video I submitted' : `the ${n} videos I submitted`
  const about = products.length ? ` for ${products.join(' and ')}` : ''
  const they = n === 1 ? 'It is' : 'They are'
  return [
    `Hi ${brand} team! Quick check in on ${what}${about}. ${they} still in review after ${d} days.`,
    `Is there anything you would like me to change so ${n === 1 ? 'it' : 'they'} can go live? Happy to adjust the hook or the call to action.`,
    'Thanks so much!',
  ].join('\n\n')
}

// ── Copy what wins ───────────────────────────────────────────────────────────

export interface TopVideo { id: string; thumbnail: string | null; video: string | null; caption: string | null }

/** A brand's best videos: topVideos in GET brands/{id}/details (id,
 *  metadata.thumbnailUrl), or the list GET brands/{id}/top-formats sends. */
export function readTopVideos(json: unknown): TopVideo[] {
  const root = isObj(json) && (isObj(json.data) || Array.isArray(json.data)) ? json.data : json
  const holder = isObj(root) ? (isObj(root.brand) ? { ...root.brand, ...root } : root) : root
  const list = Array.isArray(holder) ? holder
    : isObj(holder) ? ([holder.topVideos, holder.top_videos, holder.topFormats, holder.formats, holder.videos, holder.items].find(Array.isArray) as unknown[] | undefined) || [] : []
  const out: TopVideo[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    if (!isObj(raw)) continue
    const meta = isObj(raw.metadata) ? raw.metadata : {}
    const id = str(raw.id ?? raw.submissionId ?? raw.submission_id)
    const thumbnail = str(meta.thumbnailUrl ?? raw.thumbnailUrl ?? raw.thumbnailSrc ?? raw.thumbnail) || null
    const video = str(meta.previewUrl ?? raw.previewUrl ?? meta.videoUrl ?? raw.videoUrl ?? raw.videoSrc ?? meta.streamUrl ?? raw.streamUrl) || null
    if (!id || seen.has(id) || (!thumbnail && !video)) continue
    seen.add(id)
    const caption = str(pick(meta, ['title', 'caption', 'description', 'hook']) ?? pick(raw, ['title', 'caption', 'description', 'hook'])) || null
    out.push({ id, thumbnail, video, caption: caption ? caption.slice(0, 300) : null })
  }
  return out
}

/** The words of one video, from GET submissions/{id}/script, when TRYBE
 *  shares them. null when it holds no text MVP can read. */
export function readScript(json: unknown): string | null {
  const root = isObj(json) && (isObj(json.data) || typeof json.data === 'string') ? json.data : json
  if (typeof root === 'string') return root.trim().slice(0, 1500) || null
  if (!isObj(root)) return null
  const direct = pick(root, ['script', 'transcript', 'text', 'content', 'body'])
  if (typeof direct === 'string' && direct.trim()) return direct.trim().slice(0, 1500)
  // A list of lines or segments.
  const parts = [direct, root.segments, root.lines, root.sections].find(Array.isArray) as unknown[] | undefined
  if (parts) {
    const t = parts.map((p) => (typeof p === 'string' ? p : isObj(p) ? str(p.text ?? p.content ?? p.line) : '')).filter(Boolean).join(' ').trim()
    return t ? t.slice(0, 1500) : null
  }
  if (isObj(direct)) return readScript(direct)
  return null
}

/** What goes to the video plan: their winning videos' words, cleaned, at most
 *  three, so the plan copies an angle that already sells. */
export function winnersForPlan(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((t) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim().slice(0, 900) : '')).filter((t) => t.length >= 12).slice(0, 3)
}

/** The prompt block for the video plan: copy the angle, never the words. */
export function winnersBlock(winners: string[]): string {
  return [
    `THE BRAND'S OWN BEST VIDEOS ON TRYBE (these already sell for this brand). Copy what works in them: the angle, the order, the kind of hook, the proof they show. Never copy their sentences word for word.`,
    ...winners.map((w, i) => `Video ${i + 1}: ${w}`),
  ].join('\n')
}
