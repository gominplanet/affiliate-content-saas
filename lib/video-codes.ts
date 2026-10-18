// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// QR CODES BURNED INTO THE YOUTUBE CUT (docs/qr-on-youtube-plan.md, migration
// 441). Everything here is pure, so the rules can be tested without a database
// and without the render service.
//
// A viewer watching a review on a television cannot click anything. A QR on
// screen is the only way they reach the product.
//
// THE QR ENCODES A PERMANENT CODE, NEVER A DESTINATION. A published video
// cannot be recalled or reburned, so whatever is in that QR is there for as
// long as the video exists. The code is bound to the video; where a scan goes
// is worked out at scan time and can change for ever afterwards.
//
// A /v/ CODE CAN NEVER RESOLVE TO AN AMAZON URL. Amazon's Operating Agreement
// section 7(b) bars Associates links in connection with Internet-enabled
// televisions, and a television is the whole premise of this feature. What the
// TV displays is a URL to a page of the creator's own; the affiliate link is
// clicked later, on a phone, on a web page. That distinction is the entire
// compliance argument, so it lives in code (`neverAmazon`) with a test that
// fails if it ever stops holding, rather than in somebody's head.
//
// Passport links (/go/<code>, www.mvpl.ink/<code>) resolve to Amazon with the
// creator's tag. These resolve to content. The hop looks identical from
// outside and the endpoint is the entire difference, which is exactly why the
// two paths are kept visibly apart.

/** Where a scan lands, on the app's own origin. Kept separate from /go/. */
export const VIDEO_CODE_PATH = 'v'

/** Code alphabet and length. Base62, seven characters: 3.5e12 codes, against
 *  a worst case of a few million a year, so a mint collides effectively
 *  never. Short enough that the QR stays coarse, which is what survives
 *  compression and a living room's distance from the screen. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export const CODE_LENGTH = 7
export const CODE_RE = /^[A-Za-z0-9]{6,16}$/

/** A new code. `rand` is injectable so a test can force a collision. */
export function mintCode(rand: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length) % ALPHABET.length]
  return out
}

/** The URL that actually goes into the QR image. */
export function videoCodeUrl(code: string, appUrl: string): string {
  return `${String(appUrl || '').replace(/\/+$/, '')}/${VIDEO_CODE_PATH}/${code}`
}

// ── The invariant ────────────────────────────────────────────────────────────

/** Hosts a scan must never be sent to, in any form. Amazon itself, its own
 *  shorteners, and OUR OWN Passport redirect, which exists to end at Amazon
 *  with the creator's tag on it. A Passport link is not a safer Amazon link
 *  here: it is the same destination with a hop in front of it. */
const AMAZON_HOSTS = [
  /(^|\.)amazon\.[a-z.]{2,8}$/i,
  /(^|\.)amzn\.to$/i,
  /(^|\.)amzn\.eu$/i,
  /(^|\.)a\.co$/i,
  /(^|\.)amazon-adsystem\.com$/i,
  /(^|\.)mvpl\.ink$/i,
]

/**
 * Would sending a scan here put an Amazon destination on a television screen.
 *
 * Deliberately blunt: an unparseable URL, a non-http scheme, an Amazon host, a
 * Passport hop, or an Amazon tag riding in the query all count. A destination
 * this rejects is not shown to the viewer and no QR is burned for it.
 */
export function neverAmazon(raw: unknown): boolean {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return true
  let u: URL
  try { u = new URL(s) } catch { return true }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return true
  const host = u.hostname.toLowerCase()
  if (AMAZON_HOSTS.some((re) => re.test(host))) return true
  // Our own Passport fallback shape, on any host: anything under /go/. Not
  // the code shape, which would let a code one character short through: the
  // whole path is the Passport redirect and none of it belongs on a TV.
  if (/^\/go(\/|$)/.test(u.pathname)) return true
  // An Associates tag anywhere in the query means somebody built an affiliate
  // destination out of a host we do not recognise.
  if (/(^|&)(tag|ascsubtag|linkCode)=/i.test(u.search.replace(/^\?/, ''))) return true
  return false
}

// ── Where a scan goes ────────────────────────────────────────────────────────

export interface CodeRow {
  /** The creator's own post for this video, once one exists. */
  post_url?: string | null
  /** The shop handle as it was at burn time. */
  handle?: string | null
  asin?: string | null
  state?: string | null
}

export interface Resolution {
  url: string
  /** Which rule answered, so a report can say it rather than guess. */
  via: 'post' | 'product' | 'shop'
}

/**
 * Where this code sends a scan, right now.
 *
 * Order: the creator's own post for the video, then the product's own page on
 * their shop, then the shop itself. Most burns start at the product page and
 * never leave it, because MVP meets the video before any post exists. That is
 * fine: /shop/<handle>/<asin> is a real page from the first second, with the
 * product, the buy button on the creator's own affiliate link, their review
 * and video when they have them, and the Associates disclosure.
 *
 * `livePostUrl` is the post looked up at scan time, which is how a QR burned
 * months ago starts pointing at a post written yesterday. The stored
 * `post_url` is the fallback when that lookup fails.
 *
 * Returns null when there is nowhere real to send somebody. The caller must
 * treat that as "no QR", never as "send them to Amazon".
 */
export function resolveCode(
  row: CodeRow,
  opts: { appUrl: string; liveHandle?: string | null; livePostUrl?: string | null },
): Resolution | null {
  if ((row.state || 'active') !== 'active') return null
  const base = String(opts.appUrl || '').replace(/\/+$/, '')
  if (!base) return null

  const post = [opts.livePostUrl, row.post_url].find((u) => typeof u === 'string' && u.trim() && !neverAmazon(u))
  if (post) return { url: String(post).trim(), via: 'post' }

  const handle = String(opts.liveHandle || row.handle || '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(handle)) return null

  const asin = String(row.asin || '').toUpperCase()
  if (/^[A-Z0-9]{10}$/.test(asin)) {
    const url = `${base}/shop/${handle}/${asin}`
    return neverAmazon(url) ? null : { url, via: 'product' }
  }
  const url = `${base}/shop/${handle}`
  return neverAmazon(url) ? null : { url, via: 'shop' }
}

// ── What the creator told Amazon ─────────────────────────────────────────────

export interface QrSetup {
  /** Their published Link in Bio handle: without one there is no page to
   *  declare and nowhere for a scan to land. */
  handle?: string | null
  /** When they confirmed they added the page to their Amazon Website and
   *  Mobile App List. */
  declaredAt?: string | null
  /** The tracking ID they made for that page. */
  trackingId?: string | null
}

/** The page the creator declares with Amazon. The top level of their shop,
 *  which covers every product page beneath it. Never mvpl.ink and never the
 *  resolver: nothing is displayed on a redirect, and declaring MVP's
 *  affiliate redirect as the creator's own website would be inaccurate. */
export function declaredShopUrl(handle: string, appUrl: string): string {
  return `${String(appUrl || '').replace(/\/+$/, '')}/shop/${String(handle || '').trim().toLowerCase()}`
}

/** Amazon says a new tracking ID can take up to 24 hours to work. A burn
 *  before then puts dead links on a video that is already public. */
export const TRACKING_ID_WARMUP_MS = 24 * 60 * 60 * 1000

/**
 * What is still missing before a QR may be burned for this creator, in their
 * own words. Empty means go.
 *
 * FAIL CLOSED. A creator who has not declared the page gets no QR, not a QR
 * with a warning. The cost of being wrong is their Associates account, and a
 * video cannot be withdrawn once it is published.
 */
export function qrSetupMissing(s: QrSetup, now: number = Date.now()): string[] {
  const out: string[] = []
  const handle = String(s.handle || '').trim()
  if (!handle) out.push('a published shop page for the QR to land on')
  if (!s.declaredAt) out.push('your confirmation that this page is in your Amazon website list')
  const id = String(s.trackingId || '').trim()
  if (!id) out.push('the Amazon tracking ID you made for it')
  const at = s.declaredAt ? Date.parse(s.declaredAt) : NaN
  if (!out.length && Number.isFinite(at) && now - at < TRACKING_ID_WARMUP_MS) {
    const hours = Math.max(1, Math.ceil((TRACKING_ID_WARMUP_MS - (now - at)) / 3_600_000))
    out.push(`${hours} more hours for Amazon to switch on your new tracking ID`)
  }
  return out
}

// ── The burn ─────────────────────────────────────────────────────────────────

export type QrCorner = 'lower-right' | 'lower-left' | 'upper-right' | 'upper-left'
export type QrWhen = 'end' | 'early'

export interface QrPreset {
  /** Where on the frame. Lower right is where viewers look for it. */
  corner: QrCorner
  /** Width as a fraction of the frame. */
  widthPct: number
  /** Seconds on screen. */
  seconds: number
  /** The last seconds of the video, or early on. */
  when: QrWhen
}

/** A QR smaller than this on the finished frame does not survive YouTube's
 *  compression or the distance from a sofa to a television. Sources disagree
 *  between 300 and 400 pixels on a 1080p frame; the larger is the safe one. */
export const QR_MIN_PX = 400
export const QR_MAX_SECONDS = 20
export const QR_MIN_SECONDS = 8

const CORNERS: QrCorner[] = ['lower-right', 'lower-left', 'upper-right', 'upper-left']

/** A preset we are prepared to store, clamped rather than trusted: this is
 *  replayed by a background worker onto ten videos with nobody watching. */
export function validateQrPreset(raw: unknown): QrPreset {
  const q = (raw ?? {}) as Partial<QrPreset>
  const num = (v: unknown, lo: number, hi: number, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback
  }
  return {
    corner: CORNERS.includes(q.corner as QrCorner) ? (q.corner as QrCorner) : 'lower-right',
    widthPct: num(q.widthPct, 0.08, 0.35, 0.2),
    seconds: num(q.seconds, QR_MIN_SECONDS, QR_MAX_SECONDS, 12),
    when: q.when === 'early' ? 'early' : 'end',
  }
}

/**
 * Where the QR's top-left corner goes and how wide it is, for the render
 * service, which places a top-left corner and measures in fractions.
 *
 * THE SIZE IS RAISED, NOT REFUSED, when the creator picked one too small to
 * scan. A QR nobody can scan is the same as no QR, except that it is in the
 * video for ever, so the frame width wins over the preference.
 */
export function qrPlacement(
  p: QrPreset, frameWidth: number,
): { xPct: number; yPct: number; widthPct: number; raised: boolean } {
  const w = frameWidth > 0 ? Math.max(p.widthPct, Math.min(0.35, QR_MIN_PX / frameWidth)) : p.widthPct
  const raised = w > p.widthPct + 1e-9
  // A margin of one QR width keeps it clear of YouTube's own overlays (the
  // progress bar, the end-screen cards) and of a television's overscan.
  const margin = 0.04
  const right = p.corner === 'lower-right' || p.corner === 'upper-right'
  const lower = p.corner === 'lower-right' || p.corner === 'lower-left'
  // The QR is square, so its height as a fraction of a 16:9 frame is its
  // width times 16/9.
  const hPct = Math.min(0.9, w * (16 / 9))
  return {
    xPct: right ? Math.max(0, 1 - margin - w) : margin,
    yPct: lower ? Math.max(0, 1 - margin - hPct) : margin,
    widthPct: w,
    raised,
  }
}

/** The seconds of the finished video the QR is on screen for. An end card
 *  rides the last stretch, which is where a viewer decides. */
export function qrWindow(p: QrPreset, durationSeconds: number): { startSec: number; endSec: number } {
  const dur = Number(durationSeconds) > 0 ? Number(durationSeconds) : 0
  const secs = Math.min(p.seconds, dur > 0 ? Math.max(QR_MIN_SECONDS, dur / 2) : p.seconds)
  if (p.when === 'end' && dur > 0) return { startSec: Math.max(0, dur - secs), endSec: dur }
  const startSec = 5
  return { startSec, endSec: dur > 0 ? Math.min(dur, startSec + secs) : startSec + secs }
}
