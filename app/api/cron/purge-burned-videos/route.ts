// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/purge-burned-videos — daily. Deletes overlay-burned videos 30
// days after they were made, keeping any that a post still to go out points
// at (lib/burn-retention; Seb, 2026-10-28). Says what it deleted, what it kept
// and why, and deletes nothing at all when it cannot read every queue: a
// video a scheduled post needs is never deleted on a guess.
//
// Auth: Vercel cron carries `Authorization: Bearer ${CRON_SECRET}`.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BURN_BUCKET, STILL_TO_POST, burnsToDelete, pathsIn, type StoredFile } from '@/lib/burn-retention'

export const runtime = 'nodejs'
export const maxDuration = 300

const PAGE = 1000
const MAX_FOLDERS = 20_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

/** A table this database does not have holds nothing to keep. */
const missingTable = (m: string | undefined) => /does not exist|could not find the table|schema cache|PGRST205|42P01/i.test(String(m || ''))

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sb = createAdminClient() as Sb
  const started = Date.now()

  // 1. Everything still to go out, and the burned videos it points at.
  const keep = new Set<string>()
  for (const q of STILL_TO_POST) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(q.table).select('*').in(q.column, q.states).range(from, from + PAGE - 1)
      if (error) {
        if (missingTable(error.message)) break
        return NextResponse.json({ ok: false, deleted: 0, error: `Could not read ${q.table} (${error.message}), so nothing was deleted.` }, { status: 500 })
      }
      for (const p of pathsIn(data ?? [])) keep.add(p)
      if (!data || data.length < PAGE) break
    }
  }

  // 2. Each creator's folder: the burned videos past the window and not kept.
  let deleted = 0, kept = 0, failed = 0, folders = 0
  const deletedUrls: string[] = []
  const base = sb.storage.from(BURN_BUCKET)
  for (let off = 0; off < MAX_FOLDERS; off += PAGE) {
    const { data: top, error } = await base.list('', { limit: PAGE, offset: off })
    if (error) return NextResponse.json({ ok: false, deleted, error: `Could not list storage (${error.message}).` }, { status: 500 })
    for (const f of (top ?? []) as StoredFile[]) {
      if (f.id) continue // a file at the top, not a creator's folder
      if (Date.now() - started > 240_000) break
      folders++
      const files: StoredFile[] = []
      for (let o = 0; ; o += PAGE) {
        const { data: page, error: e } = await base.list(f.name, { limit: PAGE, offset: o, search: 'burned-' })
        if (e) { failed++; break }
        files.push(...((page ?? []) as StoredFile[]))
        if (!page || page.length < PAGE) break
      }
      kept += files.filter((x) => keep.has(`${f.name}/${x.name}`)).length
      const gone = burnsToDelete(f.name, files, keep)
      for (let i = 0; i < gone.length; i += 100) {
        const chunk = gone.slice(i, i + 100)
        const { error: rmErr } = await base.remove(chunk)
        if (rmErr) { failed += chunk.length; continue }
        deleted += chunk.length
        for (const p of chunk) deletedUrls.push(base.getPublicUrl(p)?.data?.publicUrl ?? '')
      }
    }
    if (!top || top.length < PAGE || Date.now() - started > 240_000) break
  }

  // 3. Nothing points at a deleted video any more: a burn job that made one
  //    keeps its history, without a link to a file that is gone.
  for (let i = 0; i < deletedUrls.length; i += 200) {
    const urls = deletedUrls.slice(i, i + 200).filter(Boolean)
    if (urls.length) await sb.from('ig_burn_jobs').update({ result_url: null }).in('result_url', urls)
  }

  return NextResponse.json({ ok: true, deleted, keptForSchedules: kept, failed, folders, seconds: Math.round((Date.now() - started) / 1000) })
}
