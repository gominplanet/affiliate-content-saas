// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/admin/import-cc-catalog/stage   (admin only)
//
// Receives ONE BATCH of parsed campaign rows from the browser uploader and
// upserts them into the staging table cc_campaign_catalog_import. The heavy CSV
// is parsed + batched client-side (streaming), so each request here is small
// (~1-2k rows). Pass reset:true on the very first batch to clear staging before
// a fresh import. After all batches, the admin clicks Merge (separate endpoint).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { toUserMessage } from '@/lib/friendly-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface InRow {
  campaign_id?: unknown
  campaign_name?: unknown
  brand_name?: unknown
  asins?: unknown
  commission_pct?: unknown
  starts_at?: unknown
  ends_at?: unknown
  budget?: unknown
  budget_remaining?: unknown
  available_slot?: unknown
  total_slot?: unknown
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    if (normalizeTier(intRow?.tier) !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

    const body = await request.json().catch(() => ({})) as { rows?: InRow[]; reset?: boolean }
    const admin = createAdminClient()

    // First batch of a fresh import: empty the staging table.
    if (body.reset) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any).from('cc_campaign_catalog_import').delete().not('campaign_id', 'is', null)
      if (error) return NextResponse.json({ error: toUserMessage(error, 'Could not clear staging.') }, { status: 500 })
    }

    const clean = (body.rows ?? []).map(normalizeRow).filter((r): r is StageRow => r !== null)
    if (!clean.length) return NextResponse.json({ ok: true, inserted: 0 })

    // Upsert on campaign_id (a CSV may repeat a campaign across files/rows; last
    // wins). Chunked further just in case a batch is oversized.
    let inserted = 0
    for (let i = 0; i < clean.length; i += 1000) {
      const chunk = clean.slice(i, i + 1000)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin as any)
        .from('cc_campaign_catalog_import')
        .upsert(chunk, { onConflict: 'campaign_id', ignoreDuplicates: false })
      if (error) return NextResponse.json({ error: toUserMessage(error, 'Row insert failed.'), detail: error.message?.slice(0, 200), insertedSoFar: inserted }, { status: 500 })
      inserted += chunk.length
    }
    return NextResponse.json({ ok: true, inserted })
  } catch (err) {
    console.error('[import-cc-catalog/stage]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: toUserMessage(err, 'Upload batch failed.') }, { status: 500 })
  }
}

interface StageRow {
  campaign_id: string
  campaign_name: string
  brand_name: string | null
  asins: string[]
  commission_pct: number
  starts_at: string | null
  ends_at: string
  budget: number | null
  budget_remaining: number | null
  available_slot: number | null
  total_slot: number | null
}

// Coerce a loosely-typed incoming row into a valid staging row, or null to skip.
function normalizeRow(r: InRow): StageRow | null {
  const campaign_id = str(r.campaign_id)
  const campaign_name = str(r.campaign_name)
  const ends_at = dateStr(r.ends_at)
  const commission_pct = num(r.commission_pct)
  // Required NOT NULL columns — skip a row that can't satisfy them.
  if (!campaign_id || !campaign_name || !ends_at || commission_pct == null) return null
  const asins = Array.isArray(r.asins)
    ? [...new Set(r.asins.map(a => String(a || '').toUpperCase()).filter(a => /^[A-Z0-9]{10}$/.test(a)))]
    : []
  return {
    campaign_id: campaign_id.slice(0, 200),
    campaign_name: campaign_name.slice(0, 500),
    brand_name: str(r.brand_name)?.slice(0, 300) ?? null,
    asins,
    commission_pct,
    starts_at: dateStr(r.starts_at),
    ends_at,
    budget: num(r.budget),
    budget_remaining: num(r.budget_remaining),
    available_slot: int(r.available_slot),
    total_slot: int(r.total_slot),
  }
}

// Strip NUL + C0 control chars (keeps tab/newline/CR). Postgres text can't store
// NUL and rejects the whole batch with "unsupported Unicode escape sequence".
// Amazon CSV exports carry them. Built via RegExp() so the SOURCE stays ASCII.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g')
function str(v: unknown): string | null {
  const s = (v == null ? '' : String(v)).replace(CONTROL_CHARS, '').trim()
  return s || null
}
function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : null
}
function int(v: unknown): number | null { const n = num(v); return n == null ? null : Math.round(n) }
// Accept ISO (YYYY-MM-DD) as-is; try to parse other formats to ISO date. null if unparseable.
function dateStr(v: unknown): string | null {
  const s = str(v); if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const t = Date.parse(s)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().slice(0, 10)
}
