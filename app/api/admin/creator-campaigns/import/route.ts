/**
 * POST /api/admin/creator-campaigns/import
 *
 * Admin-only. Accepts the Amazon Creator Connections weekly export .zip,
 * parses every .csv inside, and upserts every row into
 * public.creator_connections_catalog. Users then search the catalog via
 * /api/campaigns/catalog/search instead of each uploading their own zip.
 *
 * Body: multipart/form-data with a single `file` field (the .zip).
 *
 * Strategy:
 *   1. Stream every .csv out of the zip server-side (no client-side limit).
 *   2. Extract the columns we filter on (asin, commission, end_date, etc.)
 *      and precompute days_left + has_budget_and_slots so the user search
 *      can filter with cheap SQL conditions.
 *   3. Upsert in chunks of 1000 keyed on (campaign_id, asin) — preserves
 *      ordering, handles partial failures gracefully.
 *   4. Clean up rows from previous imports older than this batch start so
 *      expired campaigns naturally roll off.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Long-running parse + bulk upsert — bigger ceiling for big zips.
export const runtime = 'nodejs'
export const maxDuration = 300

type Row = {
  asin: string
  campaign_id: string
  campaign_name: string | null
  brand: string | null
  commission: number | null
  ends_at: string | null     // YYYY-MM-DD
  days_left: number | null
  budget_remain: number
  slots_available: number
  has_budget_and_slots: boolean
}

export async function POST(request: Request) {
  // Top-level try/catch so ANY uncaught throw inside the import flow
  // (corrupted zip, JSZip decompression-bomb guard, malformed CSV, OOM,
  // Supabase service-role rejection) returns JSON instead of letting
  // Vercel send its plain-text "An error occurred" fallback. The client
  // parses our response as JSON, so a non-JSON body throws
  // SyntaxError("Unexpected token 'A'") on the user's side and they
  // have no idea what actually failed. JSON always.
  try {
    return await runImport(request)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[creator-campaigns/import] uncaught:', e)
    return NextResponse.json({
      error: `Import crashed: ${e instanceof Error ? e.message : 'unknown error'}. Check the Vercel function logs for the full stack — this usually means the zip was malformed, the function ran out of memory, or hit the per-invocation timeout.`,
    }, { status: 500 })
  }
}

async function runImport(request: Request): Promise<NextResponse> {
  // ── Admin gate ────────────────────────────────────────────────────────────
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any)
    .from('integrations').select('tier').eq('user_id', user.id).single()
  if (caller?.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  // ── Accept a Supabase Storage URL (NOT a direct multipart file)
  //    because Vercel caps multipart bodies at ~4.5 MB and Amazon's
  //    weekly export is bigger than that. Client uploads the zip to
  //    Supabase Storage first, then POSTs the public URL here for
  //    server-side parsing. ────────────────────────────────────────────────
  const body = await request.json().catch(() => null) as { upstreamUrl?: string } | null
  const upstreamUrl = (body?.upstreamUrl || '').trim()
  // Accept both public URLs (.../storage/v1/object/public/...) and signed
  // URLs (.../storage/v1/object/sign/...?token=...). Both have the same
  // *.supabase.{co,in} host shape; the path differs. Use URL() to validate
  // the hostname so signed-URL query strings don't trip the regex.
  let host = ''
  try { host = new URL(upstreamUrl).host } catch { /* falls through */ }
  if (!upstreamUrl || !/\.supabase\.(co|in)$/.test(host)) {
    return NextResponse.json({
      error: 'Expected JSON body { upstreamUrl } pointing at a Supabase Storage .zip (public or signed URL)',
    }, { status: 400 })
  }

  // Fetch the zip from Supabase Storage with a generous timeout — these
  // files can be 50+ MB.
  let buf: ArrayBuffer
  try {
    const fetchRes = await fetch(upstreamUrl, { signal: AbortSignal.timeout(120_000) })
    if (!fetchRes.ok) {
      return NextResponse.json({
        error: `Could not fetch zip from upstream (${fetchRes.status})`,
      }, { status: 502 })
    }
    buf = await fetchRes.arrayBuffer()
  } catch (e) {
    return NextResponse.json({
      error: `Could not fetch zip: ${e instanceof Error ? e.message : 'unknown'}`,
    }, { status: 502 })
  }
  if (buf.byteLength < 100) {
    return NextResponse.json({ error: 'Upstream file is empty / too small to be a real export' }, { status: 400 })
  }

  // ── Parse the zip + every CSV inside ─────────────────────────────────────
  const [{ default: JSZip }, { streamCsv }] = await Promise.all([
    import('jszip'),
    import('@/lib/parse-csv'),
  ])
  const zip = await JSZip.loadAsync(buf)
  const csvs = Object.values(zip.files).filter(f => !f.dir && /\.csv$/i.test(f.name))
  if (csvs.length === 0) {
    return NextResponse.json({ error: 'No .csv files found inside the zip' }, { status: 400 })
  }

  const now = Date.now()
  const rows: Row[] = []
  let scannedTotal = 0

  for (const entry of csvs) {
    const text = await entry.async('string')
    let idx: Record<string, number> | null = null
    await streamCsv(text, (cols, i) => {
      if (i === 0) {
        idx = {}
        cols.forEach((h, k) => {
          const x = h.toLowerCase()
          // Same column-detection logic as the legacy client-side parser
          // (services/.../campaigns/page.tsx). 'end' alone false-matches
          // 'campaign start' and 'recommended' — be more specific.
          if (x.includes('asin')) idx!.asin = k
          else if (x.includes('campaign name')) idx!.name = k
          else if (x.includes('campaign id')) idx!.cid = k
          else if (x.includes('brand')) idx!.brand = k
          else if (x.includes('campaign end') || x.includes('end date')) idx!.end = k
          else if (x.includes('commission')) idx!.comm = k
          else if (x.includes('remain')) idx!.budget = k
          else if (x.includes('available')) idx!.slots = k
        })
        return true
      }
      if (!idx) return true
      scannedTotal++

      const asinRaw = cols[idx.asin] ?? ''
      const asin = (asinRaw.match(/[A-Z0-9]{10}/) || [])[0] || ''
      if (!asin) return true

      const campaignId = idx.cid != null ? (cols[idx.cid] ?? '').trim() : ''
      if (!campaignId) return true // need a stable key for upsert

      const name = (cols[idx.name] ?? '').trim() || null
      const brand = (cols[idx.brand] ?? '').trim() || null
      const comm = parseFloat((cols[idx.comm] ?? '').replace(/[^\d.]/g, ''))
      const commission = isNaN(comm) ? null : comm
      const endCell = (cols[idx.end] ?? '').trim()
      const dm = endCell.match(/(\d{4})-(\d{2})-(\d{2})/)
      let endsAt: string | null = null
      let daysLeft: number | null = null
      if (dm) {
        endsAt = `${dm[1]}-${dm[2]}-${dm[3]}`
        const endMs = Date.UTC(+dm[1], +dm[2] - 1, +dm[3])
        daysLeft = Math.floor((endMs - now) / 86400000)
      }
      const budgetRemain = parseFloat((cols[idx.budget] ?? '').replace(/[^\d.]/g, '')) || 0
      const slots = parseFloat((cols[idx.slots] ?? '').replace(/[^\d.]/g, '')) || 0

      // Pre-filter at parse time: only keep rows that any reasonable user
      // search would actually surface. The old "store everything" approach
      // bloated the catalog to 470k rows on the weekly export — Postgres
      // can handle that, but cold-cache queries against 470k rows + indexes
      // were exceeding the statement timeout. Cutting at upload time keeps
      // the working set in Postgres's shared buffer almost always.
      //
      // Filters:
      //   - commission > 0     (no commission = nobody will ever queue this)
      //   - days_left > 0 or null  (expired campaigns are useless)
      //   - has_budget_and_slots  (no budget AND no slots = not actionable)
      // Expected reduction: ~470k → ~100-150k rows (3-4x smaller).
      if ((commission ?? 0) <= 0) return true
      if (daysLeft !== null && daysLeft <= 0) return true
      if (!(budgetRemain > 0 && slots > 0)) return true

      rows.push({
        asin,
        campaign_id: campaignId,
        campaign_name: name,
        brand,
        commission,
        ends_at: endsAt,
        days_left: daysLeft,
        budget_remain: budgetRemain,
        slots_available: slots,
        has_budget_and_slots: budgetRemain > 0 && slots > 0,
      })
      return true
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({
      error: 'Parsed the zip but found 0 valid rows. Check the column headers in the CSVs.',
      scanned: scannedTotal,
    }, { status: 400 })
  }

  // Dedupe within this batch on (campaign_id, asin) — Amazon's export can
  // contain near-duplicates, and we'd hit "ON CONFLICT DO UPDATE cannot
  // affect row a second time" otherwise.
  const seen = new Set<string>()
  const deduped = rows.filter(r => {
    const key = `${r.campaign_id} ${r.asin}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // ── Bulk upsert in chunks via service role (bypasses RLS) ───────────────
  // Chunk size 500 (down from 1000) so we stay well under Postgres's
  // per-statement timeout (~30s on Supabase) even when the row has many
  // columns + 6 indexes to maintain on each upsert.
  // We tolerate a chunk failure (retry once with smaller chunks, then
  // skip) so one slow chunk doesn't lose the whole 196k-row upload.
  const batchStart = new Date().toISOString()
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const CHUNK = 500
  let upserted = 0
  const failedChunks: Array<{ start: number; end: number; error: string }> = []

  async function upsertChunk(chunk: Array<Row & { imported_at: string }>): Promise<{ ok: true } | { ok: false; error: string }> {
    const { error } = await sb
      .from('creator_connections_catalog')
      .upsert(chunk, { onConflict: 'campaign_id,asin' })
    return error ? { ok: false, error: error.message } : { ok: true }
  }

  for (let i = 0; i < deduped.length; i += CHUNK) {
    const chunk = deduped.slice(i, i + CHUNK).map(r => ({
      ...r,
      imported_at: batchStart,
    }))
    let result = await upsertChunk(chunk)
    // On timeout, retry with quarter-sized sub-chunks before giving up.
    if (!result.ok && /timeout|canceling statement/i.test(result.error)) {
      const SUB = Math.max(50, Math.floor(CHUNK / 4))
      let subOk = true
      for (let j = 0; j < chunk.length; j += SUB) {
        const sub = chunk.slice(j, j + SUB)
        const r2 = await upsertChunk(sub)
        if (!r2.ok) { subOk = false; break }
      }
      if (subOk) result = { ok: true }
    }
    if (!result.ok) {
      failedChunks.push({ start: i, end: i + chunk.length, error: result.error })
      // Log + skip — don't abort the entire 196k-row upload because of one
      // bad chunk. Caller sees `failed_chunks` in the response so they can
      // re-run for just the missed range if needed.
      // eslint-disable-next-line no-console
      console.log(`[creator-campaigns-import] chunk ${i}-${i + chunk.length} FAILED: ${result.error}`)
      continue
    }
    upserted += chunk.length
  }

  // ── Clean up rows older than this batch (expired or replaced campaigns).
  //    Anything not present in this upload AND last touched before batchStart
  //    is stale and gets dropped so the catalog reflects the latest export. ─
  const { error: cleanupErr, count: deletedCount } = await sb
    .from('creator_connections_catalog')
    .delete({ count: 'exact' })
    .lt('imported_at', batchStart)
  if (cleanupErr) {
    // Non-fatal — the new rows are in, we just couldn't clean up old ones.
    return NextResponse.json({
      ok: true,
      scanned: scannedTotal,
      upserted,
      deduped_count: deduped.length,
      stale_cleanup_error: cleanupErr.message,
    })
  }

  return NextResponse.json({
    ok: true,
    scanned: scannedTotal,
    upserted,
    deduped_count: deduped.length,
    stale_deleted: deletedCount ?? 0,
    failed_chunks: failedChunks,
    batch_at: batchStart,
  })
}
