/**
 * /api/review-edit — the review editor (Labs, admin while it is tested).
 *
 * GET   the creator's videos, newest first, each with where it is, what MVP
 *       cut and why, where the B-roll went, and the finished files.
 * POST  { action }:
 *   add      { name, review: { url, name, bytes }, broll?, product?, settings? }
 *            queue a video; it starts reading at once and carries on in the
 *            background (lib/review-edit-server).
 *   change   { id, settings?, restore?: number[], cut?: number[], placementOff?: number[], prompt? }
 *            the creator's changes, saved; prompt is a typed change.
 *   make     { id }  make it again with the changes.
 *   retry    { id }  start a failed video over.
 *   finish   { id }  done with it: the raw takes are deleted now.
 *   remove   { id }  the video, its takes and its files, gone.
 */
import { NextResponse, after } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'
import { cleanSettings, clock, linesOf, DEFAULT_SETTINGS, type Plan, type Word } from '@/lib/review-edit'
import { promptChange } from '@/lib/review-edit-plan'
import { moveQueue, deleteRaw, ownPath, hasUpload, EDIT_BUCKET, type EditRow, type Src, editDb } from '@/lib/review-edit-server'
import { driveAccessToken, driveFile, isDriveId } from '@/lib/google-drive'

export const runtime = 'nodejs'
export const maxDuration = 300

const NEEDS_SQL = 'The review editor needs migration 459 in Supabase first.'
/** A step still going after this long is stuck, and can be started again. */
const STUCK_AFTER_MS = 20 * 60_000
const missing = (m?: string) => !!m && /review_edits/.test(m) && /does not exist|schema cache/i.test(m)

async function gate() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Sign in again.' }, { status: 401 }) }
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('review_edit', intg?.tier)) return { error: NextResponse.json({ error: 'The review editor is still being tested.' }, { status: 403 }) }
  return { userId: user.id, tier: String(intg?.tier || '') }
}

/** What the page shows for one video: never the whole transcript. */
function view(r: EditRow) {
  const words: Word[] = Array.isArray(r.words) ? r.words : []
  const lines = words.length ? linesOf(words) : []
  const plan = r.plan
  const textOf = (from: number, to: number, w?: [number, number]) => (w
    ? words.slice(w[0], w[1] + 1).map((x) => x.text).join(' ')
    : lines.slice(from, to + 1).map((l) => l.text).join(' '))
  return {
    id: r.id, name: r.name, status: r.status, note: r.note, product: r.product,
    createdAt: r.created_at, madeAt: r.made_at, hasBroll: !!r.broll_src,
    /** When the step it is on began: how long it has been going. */
    since: r.updated_at,
    // Uploads are deleted when done; a Drive take is the creator's and stays.
    rawDeleted: !!r.raw_deleted_at && hasUpload(r), rawInMvp: hasUpload(r) && !r.raw_deleted_at,
    fromDrive: r.review_src?.kind === 'drive',
    settings: cleanSettings(r.settings),
    review: r.info?.review ?? null,
    outputs: r.outputs ?? null,
    cuts: (plan?.cuts ?? []).map((c, k) => ({
      k, kind: c.kind, why: c.why, restored: !!c.restored,
      at: clock(c.words ? words[c.words[0]]?.start ?? 0 : lines[c.from]?.start ?? 0),
      text: textOf(c.from, c.to, c.words).slice(0, 300),
    })),
    broll: (plan?.placements ?? []).map((p, k) => ({
      k, off: !!p.off, why: p.why,
      shot: (r.shots ?? []).find((s) => s.n === p.shot)?.what ?? 'B-roll',
      line: lines[p.line]?.text?.slice(0, 160) ?? '',
      at: clock(lines[p.line]?.start ?? 0),
    })),
    zooms: (plan?.keys ?? []).length,
  }
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  const db = editDb()
  const { data, error } = await db.from('review_edits').select('*').eq('user_id', g.userId).order('created_at', { ascending: false }).limit(40)
  if (error) return NextResponse.json({ error: missing(error.message) ? NEEDS_SQL : error.message, needsSql: missing(error.message) }, { status: missing(error.message) ? 503 : 500 })
  // The settings a new video starts from: the last ones used.
  const last = (data ?? [])[0]
  return NextResponse.json({ edits: (data ?? []).map((r: EditRow) => view(r)), defaults: last ? cleanSettings(last.settings) : DEFAULT_SETTINGS })
}

export async function POST(request: Request) {
  const g = await gate()
  if ('error' in g) return g.error
  const db = editDb()
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action || '')
  const now = new Date().toISOString()
  const own = (u: unknown) => typeof u === 'string' && ownPath(u, g.userId) !== null

  if (action === 'add') {
    // A take picked in Google Drive is checked with Google first: MVP can
    // open it, and it is a video. An upload must be in this creator's folder.
    let token: string | null = null
    const src = async (v: unknown): Promise<Src | { error: string } | null> => {
      const o = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null
      if (!o) return null
      if (isDriveId(o.driveId)) {
        if (!token) {
          const t = await driveAccessToken(db, g.userId)
          if (!t.ok) return { error: t.error }
          token = t.token
        }
        const f = await driveFile(token, o.driveId)
        if (!f.ok) return { error: f.error }
        return { kind: 'drive', fileId: f.file.id, name: f.file.name.slice(0, 200), bytes: f.file.bytes ?? undefined }
      }
      if (!own(o.url)) return null
      return { kind: 'upload', url: String(o.url), path: ownPath(String(o.url), g.userId)!, name: String(o.name || '').slice(0, 200), bytes: Number(o.bytes) || undefined }
    }
    const review = await src(body.review)
    if (!review) return NextResponse.json({ error: 'Add your talking take first.' }, { status: 400 })
    if ('error' in review) return NextResponse.json({ error: review.error }, { status: 400 })
    const broll = body.broll ? await src(body.broll) : null
    if (body.broll && !broll) return NextResponse.json({ error: 'That B-roll file is not one of your uploads in MVP. Add it again.' }, { status: 400 })
    if (broll && 'error' in broll) return NextResponse.json({ error: `The B-roll take: ${broll.error}` }, { status: 400 })
    const settings = cleanSettings(body.settings)
    if (settings.logo && !own(settings.logo.url)) settings.logo = null
    const { data, error } = await db.from('review_edits').insert({
      user_id: g.userId, name: String(body.name || review.name || 'Review').slice(0, 120), status: 'queued', note: 'In line to be read',
      review_src: review, broll_src: broll, product: typeof body.product === 'string' ? body.product.trim().slice(0, 300) || null : null, settings,
    }).select('*').single()
    if (error || !data) return NextResponse.json({ error: missing(error?.message) ? NEEDS_SQL : error?.message || 'Not saved.' }, { status: missing(error?.message) ? 503 : 500 })
    // Start now; the cron carries on with anything this does not finish.
    after(async () => { try { await moveQueue(db, { userId: g.userId, readBudget: 1 }) } catch { /* the cron picks it up */ } })
    return NextResponse.json({ ok: true, edit: view(data as EditRow) })
  }

  const id = typeof body.id === 'string' ? body.id : ''
  const { data: found } = await db.from('review_edits').select('*').eq('id', id).eq('user_id', g.userId).maybeSingle()
  const row = found as EditRow | null
  if (!row) return NextResponse.json({ error: 'That video is not in your list.' }, { status: 404 })

  if (action === 'change') {
    let settings = cleanSettings(body.settings ?? row.settings, cleanSettings(row.settings))
    if (settings.logo && !own(settings.logo.url)) settings.logo = cleanSettings(row.settings).logo
    let plan: Plan | null = row.plan ? { ...row.plan, cuts: [...row.plan.cuts], placements: [...row.plan.placements] } : null
    const nums = (v: unknown) => new Set((Array.isArray(v) ? v : []).map(Number))
    if (plan) {
      const restore = nums(body.restore), recut = nums(body.cut), off = nums(body.placementOff), on = nums(body.placementOn)
      plan.cuts = plan.cuts.map((c, k) => (restore.has(k) ? { ...c, restored: true } : recut.has(k) ? { ...c, restored: false } : c))
      plan.placements = plan.placements.map((p, k) => (off.has(k) ? { ...p, off: true } : on.has(k) ? { ...p, off: false } : p))
    }
    let said: string | null = null
    if (typeof body.prompt === 'string' && body.prompt.trim()) {
      if (!plan || !row.words) return NextResponse.json({ error: 'MVP is still reading this video. Type the change once it is read.' }, { status: 409 })
      const out = await promptChange({ prompt: body.prompt, settings, plan, words: row.words, lines: linesOf(row.words), who: { userId: g.userId, tier: g.tier } })
      settings = out.settings; plan = out.plan; said = out.said
    }
    const { error } = await db.from('review_edits').update({ settings, plan, updated_at: now }).eq('id', row.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, said, edit: view({ ...row, settings, plan } as EditRow) })
  }

  if (action === 'make' || action === 'retry') {
    if (row.raw_deleted_at && hasUpload(row)) return NextResponse.json({ error: 'The raw takes for this video were deleted, so it cannot be made again. Add them again.' }, { status: 409 })
    // Working on it, unless that step has gone on far too long: then it is
    // stuck (a restart lost it), and the creator may start it again.
    const stuck = Date.now() - Date.parse(row.updated_at) > STUCK_AFTER_MS
    if (['reading', 'making'].includes(row.status) && !stuck) return NextResponse.json({ error: 'MVP is working on this one right now.' }, { status: 409 })
    const status = (action === 'retry' && !row.plan) || row.status === 'reading' ? 'queued' : 'ready_to_make'
    await db.from('review_edits').update({ status, attempts: 0, note: status === 'queued' ? 'In line to be read' : 'In line to be made', updated_at: now }).eq('id', row.id)
    after(async () => { try { await moveQueue(db, { userId: g.userId, readBudget: status === 'queued' ? 1 : 0 }) } catch { /* the cron picks it up */ } })
    return NextResponse.json({ ok: true })
  }

  if (action === 'finish') {
    await deleteRaw(db, row)
    return NextResponse.json({ ok: true })
  }

  if (action === 'remove') {
    if (row.status === 'making') return NextResponse.json({ error: 'It is being made right now. Remove it once it is done.' }, { status: 409 })
    await deleteRaw(db, row)
    const files = [...Object.values(row.outputs || {}).map((o) => ownPath(o.url, g.userId)), `${g.userId}/edit-title-${row.id}.png`].filter((p): p is string => !!p)
    if (files.length) await db.storage.from(EDIT_BUCKET).remove(files)
    await db.from('review_edits').delete().eq('id', row.id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
