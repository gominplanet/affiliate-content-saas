// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/cron/drain-cc-import  (Vercel cron, every minute)
//
// Server-side drain of the weekly CC catalog merge, so an admin kicks it off and
// walks away instead of babysitting an open browser tab (a backgrounded tab gets
// throttled to a crawl — the "merging all night" problem). Each tick merges
// batches for ~50s, then, once every staged row is merged, purges the fall-outs.
// State (phase + purge cursor) rides on the `cc_import_drain` system_flags row so
// successive ticks resume exactly where the last stopped.
//
// It ONLY acts when an admin has armed the drain (system_flags.cc_import_drain
// active=true, set by the "Merge in background" button). Reuses the SAME RPCs as
// the foreground merge (merge_cc_catalog_step / merge_cc_catalog_purge_cursor).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ccMergeMode, ccShouldPurge, ccShouldHideMissing } from '@/lib/cc-merge-mode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DRAIN_KEY = 'cc_import_drain'
const ACTIVE_KEY = 'cc_import_active'
const BATCH = 500
const PURGE_SCAN = 5000
const HIDE_SCAN = 5000

const missing = (msg: string | undefined) =>
  /could not find the function|does not exist|schema cache|PGRST202/i.test(msg || '')

export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient()

  // Armed?
  const { data: flag } = await admin.from('system_flags').select('active,value').eq('key', DRAIN_KEY).maybeSingle()
  if (!flag?.active) return NextResponse.json({ ok: true, idle: true })

  // SAFETY: never run against an empty staging table — the purge deletes every
  // catalog row not in staging, so an empty staging would wipe the whole live
  // catalog. If staging got cleared (e.g. a new upload truncated it mid-drain),
  // disarm and bail instead. Cheap existence check (limit 1), not a count.
  const { data: sample, error: sampleErr } = await admin
    .from('cc_campaign_catalog_import').select('campaign_id').limit(1)
  if (sampleErr) return NextResponse.json({ ok: false, error: sampleErr.message }, { status: 500 })
  if (!sample || sample.length === 0) {
    await admin.from('system_flags').update({ active: false, value: { phase: 'aborted', reason: 'staging empty' }, updated_at: new Date().toISOString() }).eq('key', DRAIN_KEY)
    return NextResponse.json({ ok: true, aborted: 'staging empty' })
  }

  const s = (flag.value || {}) as { phase?: string; cursor?: string; upserted?: number; purged?: number; scanned?: number; mode?: string; hidden?: number }
  // The admin's choice rides on the flag, set when the drain was armed. An older
  // flag with no mode reads as 'replace', which is what it was doing.
  const mode = ccMergeMode(s.mode)
  let phase: 'merge' | 'purge' | 'hide' = s.phase === 'purge' ? 'purge' : s.phase === 'hide' ? 'hide' : 'merge'
  let cursor = typeof s.cursor === 'string' ? s.cursor : ''
  let upserted = Number(s.upserted || 0)
  let purged = Number(s.purged || 0)
  let scannedTotal = Number(s.scanned || 0)
  let hidden = Number(s.hidden || 0)

  // Keep enrichment paused while we work (refresh so a stale flag can't linger).
  try {
    await admin.from('system_flags').upsert(
      { key: ACTIVE_KEY, active: true, updated_at: new Date().toISOString() }, { onConflict: 'key' },
    )
  } catch { /* pre-216 DB — proceed without the pause flag */ }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const save = async (extra: any = {}) => {
    try {
      await admin.from('system_flags')
        .update({ value: { phase, cursor, upserted, purged, scanned: scannedTotal, mode, hidden, ...extra }, updated_at: new Date().toISOString() })
        .eq('key', DRAIN_KEY)
    } catch { /* best-effort */ }
  }

  const deadline = Date.now() + 50_000

  // ── Merge phase ──────────────────────────────────────────────────────────
  if (phase === 'merge') {
    let n = BATCH
    while (n >= BATCH && Date.now() < deadline) {
      const { data, error } = await admin.rpc('merge_cc_catalog_step', { p_limit: BATCH })
      if (error) {
        if (missing(error.message)) {
          await save({ error: 'merge functions missing — run migration 202' })
          return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        }
        // Transient (lock/statement/HTTP timeout) — committed batches stick, resume next tick.
        console.error('[drain-cc-import merge]', error.message)
        break
      }
      n = Number(data ?? 0)
      upserted += n
    }
    if (n < BATCH) { phase = 'purge'; cursor = '' } // fully drained → purge
    await save()
  }

  const finish = async (value: Record<string, unknown>) => {
    await admin.from('system_flags')
      .update({ active: false, value: { phase: 'done', mode, upserted, finishedAt: new Date().toISOString(), ...value } })
      .eq('key', DRAIN_KEY)
    try { await admin.from('system_flags').update({ active: false, updated_at: new Date().toISOString() }).eq('key', ACTIVE_KEY) } catch { /* best-effort */ }
  }

  // Add-only deletes nothing, so it never enters the purge. Instead, once
  // staging is drained, campaigns MISSING from the upload are marked full
  // (lib/cc-merge-mode ccShouldHideMissing, migration 403): Amazon's export
  // leaves out campaigns that can no longer be joined. Placed OUTSIDE the merge
  // block on purpose: a drain resumed on a later tick arrives with phase already
  // past 'merge' and must still reach this.
  if (phase === 'purge' && !ccShouldPurge(mode)) {
    let staged: number | null = null
    try {
      const { count } = await admin.from('cc_campaign_catalog_import').select('campaign_id', { count: 'estimated', head: true })
      staged = count == null ? null : Number(count)
    } catch { staged = null }
    if (!ccShouldHideMissing(mode, staged)) {
      await finish({ purged: 0, purgeSkipped: true, hidden: 0, hideSkipped: staged == null ? 'could not count the upload' : 'upload looks partial' })
      return NextResponse.json({ ok: true, done: true, mode, upserted, purged: 0, purgeSkipped: true, hideSkipped: true })
    }
    phase = 'hide'; cursor = ''; hidden = 0; scannedTotal = 0
    await save()
  }

  // ── Hide phase (add-only): missing campaigns marked full, never deleted ──
  if (phase === 'hide') {
    let done = false
    while (Date.now() < deadline) {
      const { data, error } = await admin.rpc('hide_cc_missing_cursor', { p_limit: HIDE_SCAN, p_after: cursor })
      if (error) {
        if (missing(error.message)) {
          await finish({ purged: 0, purgeSkipped: true, hidden, hideSkipped: 'run migration 403' })
          return NextResponse.json({ ok: true, done: true, mode, upserted, hideSkipped: 'run migration 403' })
        }
        console.error('[drain-cc-import hide]', error.message)
        break
      }
      const row = Array.isArray(data) ? data[0] : data
      const scanned = Number(row?.scanned ?? 0)
      scannedTotal += scanned
      hidden += Number(row?.hidden ?? 0)
      if (row?.last_id != null) cursor = String(row.last_id)
      if (scanned < HIDE_SCAN) { done = true; break }
    }
    if (done) {
      await finish({ purged: 0, purgeSkipped: true, hidden, scanned: scannedTotal })
      return NextResponse.json({ ok: true, done: true, mode, upserted, hidden })
    }
    await save()
    return NextResponse.json({ ok: true, phase, upserted, hidden, scanned: scannedTotal })
  }

  // ── Purge phase ──────────────────────────────────────────────────────────
  if (phase === 'purge' && Date.now() < deadline) {
    let done = false
    // A PURGE THAT NEVER RAN DOES NOT FINISH AS DONE. The missing-function note
    // was saved and then overwritten by the 'done' write below, so the admin
    // saw a clean finish with nothing purged and no reason.
    let purgeError: string | null = null
    while (Date.now() < deadline) {
      const { data, error } = await admin.rpc('merge_cc_catalog_purge_cursor', { p_limit: PURGE_SCAN, p_after: cursor })
      if (error) {
        if (missing(error.message)) { purgeError = 'The purge function is missing. Run migration 220.'; done = true; break }
        console.error('[drain-cc-import purge]', error.message)
        break
      }
      const row = Array.isArray(data) ? data[0] : data
      const scanned = Number(row?.scanned ?? 0)
      scannedTotal += scanned
      purged += Number(row?.deleted ?? 0)
      if (row?.last_id != null) cursor = String(row.last_id)
      if (scanned < PURGE_SCAN) { done = true; break } // reached the end of the catalog
    }
    await save(purgeError ? { error: purgeError } : {})
    if (done) {
      // Finished. Disarm the drain and release the enrichment pause.
      await admin.from('system_flags')
        .update({ active: false, value: { phase: 'done', mode, upserted, purged, finishedAt: new Date().toISOString(), ...(purgeError ? { error: purgeError, purgeSkipped: true } : {}) } })
        .eq('key', DRAIN_KEY)
      try { await admin.from('system_flags').update({ active: false, updated_at: new Date().toISOString() }).eq('key', ACTIVE_KEY) } catch { /* best-effort */ }
      return NextResponse.json({ ok: !purgeError, done: true, upserted, purged, ...(purgeError ? { error: purgeError } : {}) })
    }
  }

  return NextResponse.json({ ok: true, phase, upserted, purged })
}
