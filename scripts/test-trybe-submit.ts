// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Send to TRYBE (Seb, 2026-10-17): a video dropped in MVP goes to a TRYBE
// brand the way TRYBE's own upload sends it, through SCOUT 1.52.0.

import { readFileSync } from 'node:fs'
import { sendToTrybe, readBrandOptions, programForTrybe, ONE_UPLOAD_MAX, type SendDeps, type TrybeCall } from '../lib/trybe-submit'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const file = (size: number) => ({ url: 'https://abc.supabase.co/storage/v1/object/sign/drop/v.mp4?token=x', name: 'v.mp4', type: 'video/mp4', size })
const base = { brandId: 'brand-1234', programId: 'prog-5678', angleId: 'angle-1', productIds: ['p1'], exclusive: true, notes: 'For the fall brief' }

/** A pretend TRYBE: answers each call, and records them. */
function fake(opts: { listHas?: boolean; failPartAt?: number; refuseComplete?: boolean } = {}) {
  const calls: Array<{ method: string; path: string; body?: any }> = []
  const puts: Array<{ uploadUrl: string; start?: number; end?: number }> = []
  const api: SendDeps['api'] = async (method, path, body) => {
    calls.push({ method, path, body })
    const ok = (json: unknown): TrybeCall => ({ ok: true, status: 200, json })
    if (path.endsWith('/submissions/upload-url')) return ok({ success: true, data: { upload: { uploadUrl: 'https://s3.example/put', submissionId: 'sub-123456', publicUrl: 'https://cdn.example/v.mp4' } } })
    if (path.endsWith('/multipart/initiate')) return ok({ success: true, data: { uploadId: 'up-1', submissionId: 'sub-999999', key: 'k/v.mp4', totalParts: 3, chunkSize: 10_000_000 } })
    if (path.endsWith('/multipart/part-url')) return ok({ success: true, data: { presignedUrl: `https://s3.example/part${(body as { partNumber?: number }).partNumber}` } })
    if (path.endsWith('/multipart/complete')) return ok({ success: true, data: { videoUrl: 'https://cdn.example/big.mp4' } })
    if (path.endsWith('/multipart/abort')) return ok({ success: true })
    if (/\/submissions\/[^/]+\/complete$/.test(path)) return opts.refuseComplete ? { ok: false, status: 400, json: { success: false, error: 'Pick a product' } } : ok({ success: true })
    if (method === 'DELETE') return ok({ success: true })
    if (path.includes('/v2/brands/') && path.endsWith('/submissions')) return ok({ success: true, data: opts.listHas === false ? [] : [{ id: 'sub-123456', status: 'PENDING_REVIEW' }, { id: 'sub-999999', status: 'PENDING_REVIEW' }] })
    return { ok: false, status: 404 }
  }
  const put: SendDeps['put'] = async (o) => {
    puts.push(o)
    if (opts.failPartAt && o.uploadUrl.endsWith(`part${opts.failPartAt}`)) return { ok: false, status: 0, error: 'network' }
    return { ok: true, status: 200, etag: `"etag-${puts.length}"` }
  }
  return { calls, puts, deps: { api, put, waitMs: 0, tries: 2 } as SendDeps }
}

;(async () => {
  // Small file: one upload link, the file, then the finish, then seen in the list.
  {
    const t = fake()
    const r = await sendToTrybe({ ...base, file: file(5_000_000) }, t.deps)
    const link = t.calls.find((c) => c.path.endsWith('/upload-url'))
    check('a small video asks for one upload link with the brand, program and file', !!link && link.body.brandId === 'brand-1234' && link.body.programId === 'prog-5678' && link.body.fileSize === 5_000_000 && link.body.fileType === 'video/mp4')
    check('the file goes to the link TRYBE gave, whole', t.puts.length === 1 && t.puts[0].uploadUrl === 'https://s3.example/put' && t.puts[0].start === undefined)
    const fin = t.calls.find((c) => /\/submissions\/sub-123456\/complete$/.test(c.path))
    check('the finish sends the asset, products, angle, program and the exclusive answer', !!fin && fin.body.assetUrl === 'https://cdn.example/v.mp4' && fin.body.productCategories[0] === 'p1' && fin.body.angleId === 'angle-1' && fin.body.programId === 'prog-5678' && fin.body.sharingOnOtherPlatforms === false && fin.body.creatorComment === 'For the fall brief')
    check('"Sent" only once the brand’s submissions list has it', r.state === 'in_review' && r.submissionId === 'sub-123456' && r.status === 'PENDING_REVIEW')
  }
  // Big file: parts, ETags, join, finish.
  {
    const t = fake()
    const size = 25_000_000
    const r = await sendToTrybe({ ...base, file: file(size) }, t.deps)
    check('a video of 20 MB or more goes in parts', size >= ONE_UPLOAD_MAX && t.calls.some((c) => c.path.endsWith('/multipart/initiate')) && !t.calls.some((c) => c.path.endsWith('/upload-url')))
    check('each part is its own byte range, the last one short', t.puts.length === 3 && t.puts[0].start === 0 && t.puts[0].end === 10_000_000 && t.puts[2].start === 20_000_000 && t.puts[2].end === size)
    const join = t.calls.find((c) => c.path.endsWith('/multipart/complete'))
    check('the parts are joined with their ETags and the count', !!join && join.body.parts.length === 3 && join.body.parts[1].etag === '"etag-2"' && join.body.expectedTotalParts === 3)
    check('the finish uses the joined video', t.calls.some((c) => /sub-999999\/complete$/.test(c.path) && c.body.assetUrl === 'https://cdn.example/big.mp4') && r.state === 'in_review')
  }
  // A part that never gets there: retried, then the half made submission taken back.
  {
    const t = fake({ failPartAt: 2 })
    const r = await sendToTrybe({ ...base, file: file(25_000_000) }, t.deps)
    check('a part that fails is tried again before stopping', t.puts.filter((p) => p.uploadUrl.endsWith('part2')).length === 2)
    check('a stopped send aborts the upload and deletes the half made submission', r.state === 'failed' && t.calls.some((c) => c.path.endsWith('/multipart/abort')) && t.calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/submissions/sub-999999')) && /part 2/.test(r.error || ''))
  }
  // A refusal is said in TRYBE's words, not retried, and taken back.
  {
    const t = fake({ refuseComplete: true })
    const r = await sendToTrybe({ ...base, file: file(1_000_000) }, t.deps)
    check('TRYBE’s refusal is shown in its words, tried once, then taken back', r.state === 'failed' && /Pick a product/.test(r.error || '') && t.calls.filter((c) => /complete$/.test(c.path) && !c.path.includes('multipart')).length === 1 && t.calls.some((c) => c.method === 'DELETE'))
  }
  // Taken but not seen in the list: said as not confirmed, never "in review".
  {
    const t = fake({ listHas: false })
    const r = await sendToTrybe({ ...base, file: file(1_000_000) }, t.deps)
    check('taken but not in the list yet is its own state', r.state === 'sent_unconfirmed' && r.submissionId === 'sub-123456')
  }
  // Nothing starts without a brand or a file.
  {
    const t = fake()
    const a = await sendToTrybe({ ...base, brandId: '', file: file(1_000) }, t.deps)
    const b = await sendToTrybe({ ...base, file: { ...file(0) } }, t.deps)
    check('no brand or no file stops before anything is sent', a.state === 'failed' && b.state === 'failed' && t.calls.length === 0)
  }
  check('a "legacy:" program is sent as none, as TRYBE’s own page does', programForTrybe('legacy:Main') === undefined && programForTrybe('p-1') === 'p-1' && programForTrybe(null) === undefined)

  // The brand's programs, angles and products.
  const opts = readBrandOptions(
    { success: true, data: { hasProducts: true, programs: [{ programId: 'pa', programName: 'UGC', rateSummary: '$50 per video', programBrief: { angles: [{ id: 'a1', name: 'Morning routine', description: 'Show it at 7am' }] } }, { programId: 'pb', programName: 'Ads', programBrief: { angles: [{ id: 'a1', name: 'dup' }, { id: 'a2', name: 'Unboxing' }] } }] } },
    { success: true, data: [{ id: 'pr1', title: 'Band 2.0', imageUrl: 'https://cdn.example/b.jpg' }, { title: 'no id' }] },
  )
  check('programs, angles once each with their program, and products are read', opts.programs.length === 2 && opts.programs[0].subtitle === '$50 per video' && opts.angles.length === 2 && opts.angles[1].programId === 'pb' && opts.products.length === 1 && opts.products[0].name === 'Band 2.0' && opts.needsProduct)
  const legacy = readBrandOptions({ data: { programName: 'Creator program', programBrief: { angles: [] } } }, { data: { products: [] } })
  check('a brand with no program list has TRYBE’s one legacy program', legacy.programs.length === 1 && legacy.programs[0].id === 'legacy:Creator program')

  // SCOUT 1.52.0
  const bg = read('extension/background.js')
  check('SCOUT allows only the upload calls it needs', /submissions\\\/upload-url\$\//.test(bg) && /multipart\\\/\(initiate\|part-url\|complete\|abort\)\$\//.test(bg) && /\{ method: 'DELETE', re: /.test(bg))
  check('SCOUT copies the file from MVP with no cookies, by byte range for a part', /async function trybePutFileInPage\(fileUrl, uploadUrl, contentType, start, end\)/.test(bg) && /credentials: 'omit', headers: ranged \? \{ Range: 'bytes=' \+ start/.test(bg) && /x\.withCredentials = false/.test(bg) && /getResponseHeader\('ETag'\)/.test(bg))
  check('SCOUT answers MVP_TRYBE_PUT_FILE', /msg\.type === 'MVP_TRYBE_PUT_FILE'/.test(bg) && /requestTrybePutFile/.test(read('lib/extension-frame.ts')))
  // Up to the next entry's own section (1.53.2 Request to join, held by test-trybe-outreach).
  const sendPart = bg.slice(bg.indexOf('1.52.0 SEND TO TRYBE'), bg.indexOf('1.53.2 REQUEST TO JOIN', bg.indexOf('1.52.0 SEND TO TRYBE')))
  const writes = sendPart.split('\n').filter((l) => /method: '(POST|DELETE)'/.test(l))
  check('Send to TRYBE writes only the creator\'s own submissions: 3 upload POSTs and 1 DELETE', writes.length === 4
    && writes.every((l) => l.includes('\\/backend\\/api\\/creator\\/submissions\\/')) && writes.filter((l) => /DELETE/.test(l)).length === 1)
  check('SCOUT is 1.52.0 or newer', (() => { const v = String(JSON.parse(read('extension/manifest.json')).version).split('.').map(Number); return v[0] > 1 || (v[0] === 1 && (v[1] > 52 || (v[1] === 52 && v[2] >= 0))) })() && /SCOUT_TRYBE_SUBMIT_MIN_VERSION = '1\.52\.0'/.test(read('lib/scout-version.ts')))

  if (failures.length) { console.error('❌ trybe submit guard failed:\n  - ' + failures.join('\n  - ')); process.exit(1) }
  console.log('✓ trybe submit guard passed')
})()
