// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SEND TO TRYBE (Seb, 2026-10-17: "if someone uploads a vertical video to MVP
// and says, this is for a tribe campaign, I want to be able to send it to
// Tribe, and this is the brand that I'm sending it to"). A video the creator
// dropped in MVP goes to a TRYBE brand they joined, the way TRYBE's own
// upload sends it (read from TRYBE's brand page code, 2026-10-17):
//
//   1. under 20 MB: POST /api/creator/submissions/upload-url
//        { brandId, programId, fileName, fileType, fileSize }
//        -> { upload: { uploadUrl, submissionId, publicUrl } }, then PUT the file
//      20 MB and up: POST .../multipart/initiate (same body)
//        -> { uploadId, submissionId, key, totalParts, chunkSize };
//        per part POST .../multipart/part-url { uploadId, key, partNumber,
//        submissionId } -> { presignedUrl }, PUT the bytes, keep the ETag;
//        POST .../multipart/complete { uploadId, key, submissionId, parts:
//        [{ partNumber, etag }], expectedTotalParts } -> { videoUrl }
//   2. POST /api/creator/submissions/{id}/complete { assetUrl, mimeType,
//      productCategories, sharingOnOtherPlatforms, creatorComment, angleId,
//      programId } (a "legacy:" program id is sent as none, as TRYBE does)
//   3. the brand's submissions read back: "Sent" only when the video is there.
//
// SCOUT 1.52.0 does each call in its own TRYBE tab, signed in as the creator,
// and copies the file from MVP's storage (MVP_TRYBE_PUT_FILE); this runs the
// steps, so a fix needs no new SCOUT. A send that stopped part way takes its
// half made submission back. Pure but for the calls passed in, so it is tested
// (scripts/test-trybe-submit.ts).

import { readSubmissions } from '@/lib/trybe-mybrands'

/** TRYBE's own line between one upload and an upload in parts. */
export const ONE_UPLOAD_MAX = 0x1400000
const API = '/backend/api/creator'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null }
/** TRYBE answers { success, data }: the data, or the answer itself. */
const dataOf = (json: unknown): Obj => (isObj(json) && isObj(json.data) ? json.data : isObj(json) ? json : {})

// ── What a brand offers to send to ───────────────────────────────────────────

export interface BrandOptions {
  programs: Array<{ id: string; name: string; subtitle: string | null }>
  angles: Array<{ id: string; name: string; description: string | null; programId: string }>
  products: Array<{ id: string; name: string; image: string | null }>
  /** The brand wants a product picked (TRYBE's hasProducts). */
  needsProduct: boolean
}

/** A brand's programs, brief angles and products, from GET
 *  /api/creator/v2/brands/{id}/details and .../products, the way TRYBE's page
 *  reads them: a brand with no program list has one "legacy:" program. Pure. */
export function readBrandOptions(details: unknown, products: unknown): BrandOptions {
  const d = dataOf(details)
  const raw = Array.isArray(d.programs) && d.programs.length ? d.programs as unknown[]
    : str(d.programName) ? [{ programId: `legacy:${str(d.programName)}`, programName: d.programName, programBrief: d.programBrief, hasProducts: d.hasProducts }] : []
  const programs: BrandOptions['programs'] = []
  const angles: BrandOptions['angles'] = []
  let needsProduct = false
  for (const p of raw) {
    if (!isObj(p)) continue
    const id = str(p.programId ?? p.id)
    if (!id) continue
    programs.push({ id, name: str(p.programName ?? p.name) || 'Program', subtitle: str(p.rateSummary) || null })
    if (p.hasProducts === true) needsProduct = true
    const brief = isObj(p.programBrief) ? p.programBrief : null
    for (const a of Array.isArray(brief?.angles) ? brief!.angles as unknown[] : []) {
      if (!isObj(a)) continue
      const aid = str(a.id)
      if (aid && !angles.some((x) => x.id === aid)) angles.push({ id: aid, name: str(a.name) || 'Angle', description: str(a.description) || null, programId: id })
    }
  }
  const pd = isObj(products) ? products.data : products
  const pRoot: unknown[] = Array.isArray(pd) ? pd : isObj(pd) && Array.isArray(pd.products) ? pd.products : []
  const list = pRoot.flatMap((x) => {
    if (!isObj(x)) return []
    const id = str(x.id)
    return id ? [{ id, name: str(x.title ?? x.name) || 'Product', image: /^https:\/\//.test(str(x.imageUrl)) ? str(x.imageUrl) : null }] : []
  })
  return { programs, angles, products: list, needsProduct: needsProduct || d.hasProducts === true }
}

/** The program id TRYBE takes: none for its "legacy:" stand in. Pure. */
export const programForTrybe = (id: string | null | undefined): string | undefined => (id && !id.startsWith('legacy:') ? id : undefined)

// ── The send ─────────────────────────────────────────────────────────────────

export interface SendInput {
  brandId: string
  programId: string | null
  angleId: string | null
  productIds: string[]
  /** Only on TRYBE: TRYBE's "not shared on other platforms". */
  exclusive: boolean
  notes: string
  file: { url: string; name: string; type: string; size: number }
}

export interface TrybeCall { ok: boolean; status?: number; json?: unknown; error?: string }
export interface PutCall { ok: boolean; status?: number; etag?: string | null; error?: string | null; detail?: string }
export interface SendDeps {
  api: (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => Promise<TrybeCall>
  put: (o: { fileUrl: string; uploadUrl: string; contentType: string; start?: number; end?: number }) => Promise<PutCall>
  /** Each step in words, with the parts done when there are parts. */
  onStep?: (text: string, done?: number, total?: number) => void
  /** Tries per call: the network fails now and then on big files. */
  tries?: number
  /** Waits between tries (ms); 0 in tests. */
  waitMs?: number
}

export type SendState = 'in_review' | 'sent_unconfirmed' | 'failed'
export interface SendResult { state: SendState; submissionId: string | null; steps: string[]; error: string | null; status?: string | null }

const why = (r: TrybeCall | PutCall) => {
  const j = 'json' in r && isObj(r.json) ? r.json : null
  const msg = j ? str(j.error ?? j.message ?? (isObj(j.data) ? j.data.error : '')) : ''
  return [msg || ('error' in r ? r.error : '') || null, r.status ? `TRYBE answered ${r.status}` : null].filter(Boolean).join(', ') || 'no answer'
}

/** Send one video to one brand. Never throws: every way it can end is a state. */
export async function sendToTrybe(input: SendInput, deps: SendDeps): Promise<SendResult> {
  const steps: string[] = []
  const say = (t: string, done?: number, total?: number) => { steps.push(t); deps.onStep?.(t, done, total) }
  const tries = Math.max(1, deps.tries ?? 3)
  const wait = (n: number) => new Promise((r) => setTimeout(r, (deps.waitMs ?? 2000) * n))
  const retry = async <T extends TrybeCall | PutCall>(f: () => Promise<T>): Promise<T> => {
    let last: T | null = null
    for (let i = 0; i < tries; i++) {
      last = await f().catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }) as T)
      // A refusal (4xx) is not tried again: it will say the same.
      if (last.ok || (last.status && last.status >= 400 && last.status < 500)) return last
      if (i < tries - 1) await wait(i + 1)
    }
    return last as T
  }
  const f = input.file
  if (!input.brandId) return { state: 'failed', submissionId: null, steps, error: 'No brand picked.' }
  if (!/^https:\/\//.test(f.url) || !(f.size > 0)) return { state: 'failed', submissionId: null, steps, error: 'MVP does not have this video file yet.' }
  const type = f.type || 'video/mp4'
  const start = { brandId: input.brandId, programId: programForTrybe(input.programId), fileName: f.name || 'video.mp4', fileType: type, fileSize: f.size }
  let submissionId: string | null = null
  let assetUrl = ''
  let multipart: { uploadId: string; key: string } | null = null

  // Anything made before a stop is taken back, so no half sent video waits on TRYBE.
  const takeBack = async () => {
    if (multipart && submissionId) await deps.api('POST', `${API}/submissions/multipart/abort`, { uploadId: multipart.uploadId, key: multipart.key, submissionId }).catch(() => null)
    if (submissionId) await deps.api('DELETE', `${API}/submissions/${encodeURIComponent(submissionId)}`).catch(() => null)
  }
  const fail = async (error: string): Promise<SendResult> => { await takeBack(); say(`Stopped: ${error}`); return { state: 'failed', submissionId: null, steps, error } }

  if (f.size < ONE_UPLOAD_MAX) {
    say('Asking TRYBE for an upload link')
    const r = await retry(() => deps.api('POST', `${API}/submissions/upload-url`, start))
    const up = isObj(dataOf(r.json).upload) ? dataOf(r.json).upload as Obj : null
    if (!r.ok || !up || !str(up.uploadUrl) || !str(up.submissionId)) return fail(`TRYBE gave no upload link (${why(r)}).`)
    submissionId = str(up.submissionId)
    assetUrl = str(up.publicUrl)
    say('Sending the video to TRYBE', 0, 1)
    const p = await retry(() => deps.put({ fileUrl: f.url, uploadUrl: str(up.uploadUrl), contentType: type }))
    if (!p.ok) return fail(`the video did not reach TRYBE (${why(p)}${p.detail ? `: ${p.detail}` : ''}).`)
    say('Video on TRYBE', 1, 1)
  } else {
    say('Asking TRYBE to take the video in parts')
    const r = await retry(() => deps.api('POST', `${API}/submissions/multipart/initiate`, start))
    const d = dataOf(r.json)
    const total = num(d.totalParts), size = num(d.chunkSize)
    if (!r.ok || !str(d.uploadId) || !str(d.submissionId) || !str(d.key) || !total || !size) return fail(`TRYBE did not start the upload (${why(r)}).`)
    submissionId = str(d.submissionId)
    multipart = { uploadId: str(d.uploadId), key: str(d.key) }
    const parts: Array<{ partNumber: number; etag: string }> = []
    for (let i = 0; i < total; i++) {
      const partNumber = i + 1
      const from = i * size, to = Math.min(from + size, f.size)
      if (from >= f.size) break
      say(`Sending part ${partNumber} of ${total}`, i, total)
      const u = await retry(() => deps.api('POST', `${API}/submissions/multipart/part-url`, { uploadId: multipart!.uploadId, key: multipart!.key, partNumber, submissionId }))
      const url = str(dataOf(u.json).presignedUrl)
      if (!u.ok || !url) return fail(`TRYBE gave no link for part ${partNumber} (${why(u)}).`)
      const p = await retry(() => deps.put({ fileUrl: f.url, uploadUrl: url, contentType: type, start: from, end: to }))
      if (!p.ok || !p.etag) return fail(`part ${partNumber} did not reach TRYBE (${p.ok ? 'no ETag came back' : why(p)}${p.detail ? `: ${p.detail}` : ''}).`)
      parts.push({ partNumber, etag: p.etag })
    }
    say('Joining the parts on TRYBE', total, total)
    const mp = multipart
    const c = await retry(() => deps.api('POST', `${API}/submissions/multipart/complete`, { uploadId: mp.uploadId, key: mp.key, submissionId, parts, expectedTotalParts: total }))
    assetUrl = str(dataOf(c.json).videoUrl)
    if (!c.ok || !assetUrl) return fail(`TRYBE did not join the parts (${why(c)}).`)
    multipart = null
  }

  say('Finishing the submission: brand, angle and products')
  const done = await retry(() => deps.api('POST', `${API}/submissions/${encodeURIComponent(submissionId!)}/complete`, {
    assetUrl, mimeType: type, productCategories: input.productIds, sharingOnOtherPlatforms: !input.exclusive,
    creatorComment: input.notes.trim().slice(0, 2000), angleId: input.angleId || undefined, programId: programForTrybe(input.programId),
  }))
  if (!done.ok) return fail(`TRYBE did not take the submission (${why(done)}).`)

  // SEEN, NOT ASSUMED: "Sent" only when the brand's submissions list has it.
  say('Checking your submissions on TRYBE')
  const list = await deps.api('GET', `${API}/v2/brands/${encodeURIComponent(input.brandId)}/submissions`).catch(() => null)
  const seen = list?.ok ? readSubmissions(list.json).find((s) => s.id === submissionId) : null
  if (seen) { say(`In your TRYBE submissions: ${seen.rawStatus || 'in review'}`); return { state: 'in_review', submissionId, steps, error: null, status: seen.rawStatus || null } }
  say('TRYBE took it, but it is not in your submissions list yet')
  return { state: 'sent_unconfirmed', submissionId, steps, error: null, status: null }
}
