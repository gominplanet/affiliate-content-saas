// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE BRAND, EVERYTHING MVP KNOWS (Seb, 2026-11-06: "a very high-end output
// of information, of data that comes from Tribe"). TrybeDaily shows what
// TRYBE's own list shows. MVP adds what only MVP has: what its creators got
// back from the brand (approved, paid, how fast), whether the samples they
// asked for came, whether the brand answered their messages, its Meta ads
// over time, its products open to samples, and its videos in TRYBE's Top 100.
//
// The scorecard reads six things a creator asks before spending a sample and
// a day of filming on a brand: does it pay, does it spend on ads, does it
// send samples, does it approve, does it decide fast, is there room. Each is
// said with where it came from, and anything not read is said as not read,
// never scored as good or bad.
//
// Members' numbers follow lib/trybe-changes poolBrands: shown only once
// POOL_MIN members have them and no one member is more than half, so no
// member's own results can be read back.
//
// Pure, so the page, the server and the tests read one copy.

import { POOL_MIN, POOL_MAX_SHARE, type ChangeKind, changeLine } from '@/lib/trybe-changes'
import { SAMPLE_WAIT_DAYS } from '@/lib/trybe-top100'

const DAY = 86_400_000

/** Rounded to the nearest 5 points, so a small pool never reads exact. */
const to5 = (x: number) => Math.round((x * 100) / 5) * 5

// ── SAMPLES, AS MVP CREATORS LOGGED THEM ────────────────────────────────────

export interface SamplePool {
  shown: boolean
  /** How many MVP creators asked it for a sample: "at least POOL_MIN" once shown. */
  members: number
  /** Of the samples asked for, the share that arrived (rounded to 5 points). */
  arrivedRate: number | null
  /** The middle number of days from asking to arriving. */
  medianDays: number | null
  /** Asked SAMPLE_WAIT_DAYS ago or more and still nothing. */
  waitingLong: number
  why: string | null
}

/** Members' sample requests to one brand, pooled. Pure. */
export function samplePool(rows: Array<{ user_id: string; requested_at: string | null; received_at: string | null }>, now = Date.now()): SamplePool {
  const asked = rows.filter((r) => r.requested_at || r.received_at)
  const by = new Map<string, number>()
  for (const r of asked) by.set(r.user_id, (by.get(r.user_id) || 0) + 1)
  const members = by.size
  const total = asked.length
  const fair = members >= POOL_MIN && total > 0 && Array.from(by.values()).every((n) => n / total <= POOL_MAX_SHARE)
  // Only asks old enough to have arrived count toward the rate.
  const due = asked.filter((r) => r.received_at || (r.requested_at && now - Date.parse(r.requested_at) >= SAMPLE_WAIT_DAYS * DAY))
  const arrived = due.filter((r) => r.received_at)
  const days = arrived
    .filter((r) => r.requested_at && r.received_at)
    .map((r) => (Date.parse(r.received_at as string) - Date.parse(r.requested_at as string)) / DAY)
    .filter((d) => Number.isFinite(d) && d >= 0 && d < 120)
    .sort((a, b) => a - b)
  const median = days.length ? days[Math.floor(days.length / 2)] : null
  const waitingLong = asked.filter((r) => !r.received_at && r.requested_at && now - Date.parse(r.requested_at) >= SAMPLE_WAIT_DAYS * DAY).length
  if (!fair) {
    return { shown: false, members: Math.min(members, POOL_MIN), arrivedRate: null, medianDays: null, waitingLong: 0,
      why: members < POOL_MIN ? `Shown once ${POOL_MIN} MVP creators have asked it for a sample.` : 'Not shown yet: one creator is most of these requests.' }
  }
  return {
    shown: true, members: POOL_MIN,
    arrivedRate: due.length ? to5(arrived.length / due.length) : null,
    medianDays: median == null ? null : Math.max(1, Math.round(median)),
    waitingLong, why: null,
  }
}

// ── REPLIES, AS MVP CREATORS SAW THEM ───────────────────────────────────────

export interface ReplyPool {
  shown: boolean
  members: number
  /** Of the requests MVP creators sent, the share the brand answered. */
  rate: number | null
  /** The middle number of days to the answer. */
  medianDays: number | null
  why: string | null
}

/** Members' requests to one brand and whether it answered, pooled. Pure. */
export function replyPool(rows: Array<{ user_id: string; status: string | null; sent_at: string | null; replied_at: string | null }>): ReplyPool {
  const sent = rows.filter((r) => (r.status === 'sent' || r.status === 'already') && r.sent_at)
  const by = new Map<string, number>()
  for (const r of sent) by.set(r.user_id, (by.get(r.user_id) || 0) + 1)
  const members = by.size
  const fair = members >= POOL_MIN && Array.from(by.values()).every((n) => n / sent.length <= POOL_MAX_SHARE)
  if (!fair) {
    return { shown: false, members: Math.min(members, POOL_MIN), rate: null, medianDays: null,
      why: members < POOL_MIN ? `Shown once ${POOL_MIN} MVP creators have messaged it.` : 'Not shown yet: one creator is most of these messages.' }
  }
  const replied = sent.filter((r) => r.replied_at)
  const days = replied
    .map((r) => (Date.parse(r.replied_at as string) - Date.parse(r.sent_at as string)) / DAY)
    .filter((d) => Number.isFinite(d) && d >= 0 && d < 90)
    .sort((a, b) => a - b)
  return { shown: true, members: POOL_MIN, rate: to5(replied.length / sent.length), medianDays: days.length ? Math.round(days[Math.floor(days.length / 2)] * 10) / 10 : null, why: null }
}

// ── META ADS OVER TIME ──────────────────────────────────────────────────────

export interface SeriesPoint { at: string; value: number }

/** The brand's Meta ads counts over time, from MVP's changes log ("ads": from
 *  before to after) and its latest count. Oldest first, one point a day at
 *  most (the day's last count). Pure. */
export function metaSeries(changes: Array<{ kind: string; before: string | null; after: string | null; at: string }>, latest: { count: number | null; at: string | null }): SeriesPoint[] {
  const pts: SeriesPoint[] = []
  const num = (v: string | null) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? n : null }
  const ads = changes.filter((c) => c.kind === 'ads' && Number.isFinite(Date.parse(c.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  if (ads.length) {
    const first = num(ads[0].before)
    // The count before the first change, a day earlier, so the line starts where it was.
    if (first != null) pts.push({ at: new Date(Date.parse(ads[0].at) - DAY).toISOString(), value: first })
    for (const c of ads) { const a = num(c.after); if (a != null) pts.push({ at: c.at, value: a }) }
  }
  if (latest.count != null && latest.at && Number.isFinite(Date.parse(latest.at))) {
    const last = pts[pts.length - 1]
    if (!last || Date.parse(latest.at) > Date.parse(last.at)) pts.push({ at: latest.at, value: latest.count })
  }
  const byDay = new Map<string, SeriesPoint>()
  for (const p of pts) byDay.set(p.at.slice(0, 10), p)
  return Array.from(byDay.values()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/** How a series moved, in words: "up 14 in 30 days". Null with fewer than two points. Pure. */
export function seriesMove(pts: SeriesPoint[], unit: string): string | null {
  if (pts.length < 2) return null
  const a = pts[0], b = pts[pts.length - 1]
  const days = Math.max(1, Math.round((Date.parse(b.at) - Date.parse(a.at)) / DAY))
  const d = b.value - a.value
  if (d === 0) return `steady at ${b.value} ${unit} over ${days} day${days === 1 ? '' : 's'}`
  return `${d > 0 ? 'up' : 'down'} ${Math.abs(d)} ${unit} in ${days} day${days === 1 ? '' : 's'}`
}

// ── WHAT HAPPENED TO IT ON TRYBE ────────────────────────────────────────────

export interface TimelineItem { at: string; kind: ChangeKind; line: string }

/** The brand's changes on TRYBE, newest first, in plain words. Pure. */
export function timelineOf(changes: Array<{ kind: string; before: string | null; after: string | null; at: string }>): TimelineItem[] {
  const kinds: ChangeKind[] = ['new', 'left', 'back', 'pay', 'tier', 'ads', 'top100']
  return changes
    .filter((c) => (kinds as string[]).includes(c.kind) && Number.isFinite(Date.parse(c.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((c) => ({ at: c.at, kind: c.kind as ChangeKind, line: changeLine({ kind: c.kind as ChangeKind, before: c.before, after: c.after }) }))
}

// ── ITS PRODUCTS ON TRYBE ───────────────────────────────────────────────────

export interface DossierProduct { name: string; image: string | null; price: string | null; samples: boolean; featured: boolean; options: number }

/** TRYBE's public product list for the brand, for the page: active products,
 *  featured first, then open to samples. Only an explicit yes is a sample. Pure. */
export function dossierProducts(json: unknown): DossierProduct[] {
  const o = json && typeof json === 'object' ? json as Record<string, unknown> : {}
  const list = Array.isArray(o.data) ? o.data : Array.isArray(json) ? json : []
  const out: DossierProduct[] = []
  const seen = new Set<string>()
  for (const raw of list as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Record<string, unknown>
    if (p.isActive === false) continue
    const name = String(p.title ?? p.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const meta = p.metadata && typeof p.metadata === 'object' ? p.metadata as Record<string, unknown> : {}
    const edges = meta.variants && typeof meta.variants === 'object' && Array.isArray((meta.variants as Record<string, unknown>).edges) ? (meta.variants as Record<string, unknown>).edges as unknown[] : []
    const prices = edges.map((e) => Number((e as { node?: { price?: unknown } })?.node?.price)).filter((n) => Number.isFinite(n) && n > 0)
    const lo = prices.length ? Math.min(...prices) : NaN
    const hi = prices.length ? Math.max(...prices) : NaN
    const money = (n: number) => `$${n.toFixed(2).replace(/\.00$/, '')}`
    const img = String(p.imageUrl ?? '')
    out.push({
      name, image: /^https:\/\//i.test(img) ? img : null,
      price: Number.isFinite(lo) ? (hi > lo ? `${money(lo)} to ${money(hi)}` : money(lo)) : null,
      samples: p.allowSamples === true, featured: p.isFeatured === true, options: edges.length,
    })
  }
  return out.sort((a, b) => Number(b.featured) - Number(a.featured) || Number(b.samples) - Number(a.samples))
}

// ── THE SCORECARD ───────────────────────────────────────────────────────────

export type Grade = 'strong' | 'fair' | 'weak' | 'unknown'
export type DimensionId = 'pay' | 'ads' | 'samples' | 'approval' | 'speed' | 'room'

export interface Dimension {
  id: DimensionId
  label: string
  grade: Grade
  /** 0 to 100, null when not read. */
  score: number | null
  /** The figure, short: "$45 a video", "38 Meta ads", "Not read". */
  value: string
  /** Where it came from, or why it is not known. */
  source: string
}

export interface ScoreInput {
  pay: { dollars: number | null; short: string | null; basis: string | null }
  meta: { count: number | null; own: boolean; fresh: boolean; top100Hits: number | null }
  samples: { trybe: boolean | null; products: { open: number; total: number } | null; pool: SamplePool | null }
  pool: { approvalRate: number | null; reviewDays: number | null; slowShare: number | null } | null
  crowd: { level: 'open' | 'filling' | 'crowded' | null; why: string | null } | null
  replies: ReplyPool | null
}

const gradeOf = (score: number | null): Grade => (score == null ? 'unknown' : score >= 70 ? 'strong' : score >= 45 ? 'fair' : 'weak')
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** The six things, each graded with where it came from. Pure. */
export function scorecard(s: ScoreInput): Dimension[] {
  const dims: Dimension[] = []

  // PAY: dollars per approved video. $60+ is top of TRYBE, $15 is the floor.
  {
    const d = s.pay.dollars
    const score = d == null ? null : clamp(((d - 10) / 50) * 100)
    dims.push({ id: 'pay', label: 'Pays', grade: gradeOf(score), score,
      value: d != null ? `$${Math.round(d)} a video` : s.pay.short || 'Not known',
      source: d != null ? (s.pay.basis === 'members' ? 'From MVP creators’ results' : s.pay.basis === 'yours' ? 'From your own results' : 'From its pay terms on TRYBE') : s.pay.short ? 'Pays on results only, no fixed figure' : 'TRYBE does not show its pay' })
  }

  // AD SPEND: its own Meta ads running now, and its videos in TRYBE's Top 100.
  {
    const m = s.meta
    let score: number | null = null
    let value = 'Not counted'
    let source = 'MVP has not counted its Meta ads yet'
    if (m.count != null && m.fresh && m.own) {
      score = clamp(m.count >= 40 ? 100 : m.count >= 20 ? 85 : m.count >= 8 ? 70 : m.count >= 3 ? 50 : m.count >= 1 ? 35 : 5)
      if ((m.top100Hits ?? 0) > 0) score = clamp(score + 15)
      value = `${m.count} Meta ad${m.count === 1 ? '' : 's'}`
      source = `Running now, Meta Ad Library${(m.top100Hits ?? 0) > 0 ? `, and ${m.top100Hits} video${m.top100Hits === 1 ? '' : 's'} in TRYBE’s Top 100` : ''}`
    } else if (m.count != null && m.fresh && !m.own) {
      value = 'Unclear'
      source = 'Its name is too common to count on Meta'
    } else if ((m.top100Hits ?? 0) > 0) {
      score = 75
      value = `${m.top100Hits} in Top 100`
      source = 'Videos in TRYBE’s Top 100 run as its ads'
    }
    dims.push({ id: 'ads', label: 'Spends on ads', grade: gradeOf(score), score, value, source })
  }

  // SAMPLES: MVP creators' arrivals first, then its products, then TRYBE's word.
  {
    const p = s.samples.pool
    const prod = s.samples.products
    let score: number | null = null
    let value = 'Not known'
    let source = 'Neither TRYBE nor its products say'
    if (p?.shown && p.arrivedRate != null) {
      score = clamp(p.arrivedRate)
      value = `${p.arrivedRate}% arrived`
      source = `From ${POOL_MIN}+ MVP creators${p.medianDays != null ? `, in about ${p.medianDays} day${p.medianDays === 1 ? '' : 's'}` : ''}`
    } else if (s.samples.trybe === false || (prod && prod.total > 0 && prod.open === 0)) {
      score = 0
      value = 'No samples'
      source = prod && prod.total > 0 ? `None of its ${prod.total} products take sample requests` : 'TRYBE says it takes no sample requests'
    } else if (prod && prod.open > 0) {
      score = 65
      value = `${prod.open} of ${prod.total} products`
      source = 'Open to sample requests on TRYBE'
    } else if (s.samples.trybe === true) {
      score = 65
      value = 'Takes requests'
      source = 'TRYBE says it takes sample requests'
    }
    dims.push({ id: 'samples', label: 'Sends samples', grade: gradeOf(score), score, value, source })
  }

  // APPROVAL: the share of MVP creators' videos it approved.
  {
    const r = s.pool?.approvalRate ?? null
    const score = r == null ? null : clamp(((r - 30) / 55) * 100)
    dims.push({ id: 'approval', label: 'Approves videos', grade: gradeOf(score), score,
      value: r == null ? 'Not enough yet' : `${r}% approved`,
      source: r == null ? `Shown once ${POOL_MIN} MVP creators have results with it` : `From ${POOL_MIN}+ MVP creators’ videos` })
  }

  // SPEED: how many days it takes to decide a video.
  {
    const d = s.pool?.reviewDays ?? null
    const score = d == null ? null : clamp(100 - ((d - 2) / 18) * 100)
    dims.push({ id: 'speed', label: 'Decides fast', grade: gradeOf(score), score,
      value: d == null ? 'Not enough yet' : `${d} day${d === 1 ? '' : 's'}`,
      source: d == null ? `Shown once ${POOL_MIN} MVP creators have timed it` : `Middle wait for a decision, ${POOL_MIN}+ MVP creators${s.pool?.slowShare != null ? `; ${s.pool.slowShare}% waited over 2 weeks` : ''}` })
  }

  // ROOM: how crowded it is with creators.
  {
    const l = s.crowd?.level ?? null
    const score = l == null ? null : l === 'open' ? 90 : l === 'filling' ? 55 : 20
    dims.push({ id: 'room', label: 'Room for you', grade: gradeOf(score), score,
      value: l == null ? 'Not known' : l === 'open' ? 'Open' : l === 'filling' ? 'Filling' : 'Crowded',
      source: s.crowd?.why || 'TRYBE does not give its creator count' })
  }
  return dims
}

export interface Verdict { score: number | null; word: string; read: number; of: number; line: string }

/** One verdict from the six, with how many were read. A brand with fewer than
 *  three read says so instead of a score. No samples at all is never a strong bet. Pure. */
export function verdictOf(dims: Dimension[]): Verdict {
  const known = dims.filter((d) => d.score != null)
  const of = dims.length
  if (known.length < 3) return { score: null, word: 'Not enough read', read: known.length, of, line: `MVP has read ${known.length} of the ${of} things that make a brand worth it. The rest fill in as MVP creators work with it.` }
  const weights: Record<DimensionId, number> = { pay: 1.3, ads: 1.2, samples: 1.1, approval: 1.2, speed: 0.8, room: 0.7 }
  const total = known.reduce((n, d) => n + weights[d.id], 0)
  let score = Math.round(known.reduce((n, d) => n + (d.score as number) * weights[d.id], 0) / total)
  const noSamples = dims.find((d) => d.id === 'samples')?.score === 0
  if (noSamples) score = Math.min(score, 54)
  const word = score >= 75 ? 'Strong bet' : score >= 58 ? 'Worth a try' : score >= 40 ? 'Mixed' : 'Risky'
  const best = [...known].sort((a, b) => (b.score as number) - (a.score as number))[0]
  const worst = [...known].sort((a, b) => (a.score as number) - (b.score as number))[0]
  const line = best === worst ? `${best.label}: ${best.value}.` : `Best: ${best.label.toLowerCase()} (${best.value}). Weakest: ${worst.label.toLowerCase()} (${worst.value}).`
  return { score, word, read: known.length, of, line }
}

// ── LIVE FROM TRYBE ─────────────────────────────────────────────────────────
// The brand's own page on TRYBE (GET creator/v2/brands/{id}/details, read by
// SCOUT from the creator's signed-in tab): its numbers as TRYBE shows them
// today. TRYBE's field names are not published, so each is looked for under
// the names it is likely to have, one level deep, and only what is found is
// shown. The keys TRYBE sent are kept for the team, so a missing number can
// be traced.

export interface LiveBrandRead {
  numbers: Array<{ id: 'creators' | 'subs30' | 'subsTotal' | 'score' | 'payout' | 'rating'; label: string; value: string; sub: string }>
  program: string | null
  approval: string | null
  keys: string[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** The numbers on the brand's TRYBE page, by name, one level deep. Pure. */
export function readLiveBrand(json: unknown): LiveBrandRead {
  const root = isObj(json) && isObj(json.data) ? json.data : json
  const o: Obj = isObj(root) ? (isObj(root.brand) ? { ...(root.brand as Obj), ...root } : root) : {}
  const nested = Object.values(o).filter(isObj)
  const find = (keys: string[]): unknown => {
    for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]
    for (const n of nested) for (const k of keys) if (n[k] != null && n[k] !== '') return n[k]
    return undefined
  }
  const num = (v: unknown): number | null => { const n = typeof v === 'number' ? v : typeof v === 'string' && /\d/.test(v) && !/[a-z]{3,}/i.test(v) ? parseFloat(v.replace(/[^0-9.]/g, '')) : NaN; return Number.isFinite(n) && n >= 0 ? n : null }
  const label = (v: unknown): string | null => (typeof v === 'string' && /\d/.test(v) && v.length <= 20 ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : null)
  const numbers: LiveBrandRead['numbers'] = []
  const creators = label(find(['creatorLabel', 'totalCreators', 'creatorsCount', 'creatorCount', 'numCreators', 'activeCreators', 'creators']))
  if (creators) numbers.push({ id: 'creators', label: 'Creators', value: creators, sub: 'Working with it on TRYBE' })
  const s30 = num(find(['submissionsLast30Days', 'submissions30d', 'subs30', 'last30DaysSubmissions', 'recentSubmissions', 'submissionsThisMonth']))
  if (s30 != null) numbers.push({ id: 'subs30', label: 'Videos in 30 days', value: s30.toLocaleString('en-US'), sub: 'Submitted to it in the last 30 days' })
  const st = num(find(['totalSubmissions', 'submissionsTotal', 'subsTotal', 'submissionCount', 'submissionsCount']))
  if (st != null) numbers.push({ id: 'subsTotal', label: 'Videos all time', value: st.toLocaleString('en-US'), sub: 'Submitted to it since it joined' })
  const score = num(find(['trybeScore', 'brandScore', 'score']))
  if (score != null && score <= 100) numbers.push({ id: 'score', label: 'TRYBE score', value: `${Math.round(score)}`, sub: 'Of 100: how fast it reviews, launches ads and replies' })
  const pd = num(find(['payoutDays', 'payoutFrequencyDays', 'paidEveryDays', 'paymentTermsDays']))
  if (pd != null && pd > 0 && pd <= 90) numbers.push({ id: 'payout', label: 'Pays every', value: `${Math.round(pd)} day${pd === 1 ? '' : 's'}`, sub: pd <= 7 ? 'Weekly, the TRYBE norm' : 'Slower than weekly' })
  const rating = num(find(['reviewRating', 'averageRating']))
  const rc = num(find(['reviewCount', 'ratingsCount', 'ratingCount']))
  if (rating != null && rating > 0 && rating <= 5) numbers.push({ id: 'rating', label: 'Rating', value: `${rating.toFixed(1)} ★`, sub: rc != null ? `From ${rc} creator review${rc === 1 ? '' : 's'}` : 'Creators’ stars' })
  const programs = [o.programs, o.commissionPrograms].find(Array.isArray) as unknown[] | undefined
  const prog = find(['programName']) ?? (programs && isObj(programs[0]) ? (programs[0] as Obj).name : undefined)
  const ap = find(['joinApproval', 'approvalType', 'joinType'])
  const auto = find(['autoApprove', 'autoApproval', 'autoAccept'])
  return {
    numbers,
    program: typeof prog === 'string' && prog.trim() ? prog.trim().slice(0, 80) : null,
    approval: auto === true ? 'Approves creators automatically' : auto === false ? 'Reviews each creator who asks to join' : typeof ap === 'string' ? (/auto/i.test(ap) ? 'Approves creators automatically' : /manual|review/i.test(ap) ? 'Reviews each creator who asks to join' : null) : null,
    keys: Object.keys(o).slice(0, 80),
  }
}
