// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/admin/image-cost-audit  (admin only)
//
// Reconciles our RECORDED image cost (ai_usage telemetry, priced with the
// approximate PRICING table in lib/ai-usage.ts) against the REAL OpenAI bill.
//
// Why: the graphic/design path records gpt-image renders as the bare model
// name ('gpt-image-2'), which PRICING prices at $0.19 — the HIGH-quality rate —
// even though the Amazon tier renders at 'medium'. That inflates the spend
// meter and trips the monthly ceiling early. We could not tell whether the real
// gpt-image-2 medium cost is ~$0.06 or ~$0.19 from the org daily total alone,
// because it mixes model + volume. This endpoint gives the missing denominator:
// how many images we actually generated per model in a window.
//
// Usage:
//   /api/admin/image-cost-audit?from=2026-08-10&to=2026-08-14
//   add &realUsd=15.11 (the OpenAI bill for that window) to get the implied
//   real per-image cost = realUsd / (all gpt-image images in the window).
//
// Read-only. Counts across ALL users (service-role client), so it needs admin.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeTier } from '@/lib/tier'
import { PRICING, IMAGE_COST_FALLBACK } from '@/lib/ai-usage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const imageCostOf = (model: string): number =>
  PRICING[model]?.imageCost ?? IMAGE_COST_FALLBACK

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intRow } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (normalizeTier(intRow?.tier) !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const url = new URL(req.url)
  // Default window: the last 7 days. from inclusive, to exclusive.
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10)
  const fromParam = url.searchParams.get('from')
  const from = fromParam || (() => {
    const d = new Date(`${to}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 7)
    return d.toISOString().slice(0, 10)
  })()
  const realUsdRaw = url.searchParams.get('realUsd')
  const realUsd = realUsdRaw != null && realUsdRaw !== '' ? Number(realUsdRaw) : null

  const fromISO = `${from}T00:00:00.000Z`
  const toISO = `${to}T00:00:00.000Z`

  // Page through ai_usage image rows for the window (service-role: all users).
  const admin = createAdminClient()
  const byModel: Record<string, { images: number; rows: number; recordedCost: number }> = {}
  let totalImages = 0
  let totalRecorded = 0
  let scanned = 0
  const PAGE = 1000
  const MAX = 200_000 // hard backstop
  for (let offset = 0; offset < MAX; offset += PAGE) {
    const { data, error } = await admin
      .from('ai_usage')
      .select('model, images')
      .gt('images', 0)
      .gte('created_at', fromISO)
      .lt('created_at', toISO)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    for (const r of data) {
      const model = r.model || 'unknown'
      const imgs = r.images || 0
      const cost = imgs * imageCostOf(model)
      byModel[model] ??= { images: 0, rows: 0, recordedCost: 0 }
      byModel[model].images += imgs
      byModel[model].rows += 1
      byModel[model].recordedCost += cost
      totalImages += imgs
      totalRecorded += cost
      scanned += 1
    }
    if (data.length < PAGE) break
  }

  // gpt-image family only (what the design/thumbnail paths actually bill on OpenAI).
  const gptImageModels = Object.keys(byModel).filter((m) => m.startsWith('gpt-image'))
  const gptImageImages = gptImageModels.reduce((s, m) => s + byModel[m].images, 0)
  const gptImageRecorded = gptImageModels.reduce((s, m) => s + byModel[m].recordedCost, 0)

  // Round for readability.
  const round = (n: number) => Math.round(n * 100) / 100
  const models = Object.fromEntries(
    Object.entries(byModel)
      .sort((a, b) => b[1].recordedCost - a[1].recordedCost)
      .map(([m, v]) => [m, { images: v.images, rows: v.rows, recordedCost: round(v.recordedCost), recordedPerImage: round(v.recordedCost / Math.max(1, v.images)) }]),
  )

  return NextResponse.json({
    ok: true,
    window: { from, to, days: Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000) },
    scannedRows: scanned,
    totals: { images: totalImages, recordedCost: round(totalRecorded) },
    gptImage: {
      images: gptImageImages,
      recordedCost: round(gptImageRecorded),
      recordedPerImage: round(gptImageRecorded / Math.max(1, gptImageImages)),
    },
    // Pass ?realUsd=<your OpenAI bill for this window> to reconcile.
    reconcile: realUsd != null && !Number.isNaN(realUsd)
      ? {
          realOpenAiUsd: realUsd,
          // Real per-image = your bill / all gpt-image images we logged. This is
          // the number that decides the Amazon pricing (vs our recorded $0.19).
          realPerImage: round(realUsd / Math.max(1, gptImageImages)),
          overcountFactor: round(gptImageRecorded / Math.max(0.0001, realUsd)),
          note: 'realPerImage assumes the whole OpenAI bill in this window is gpt-image. If other OpenAI models (gpt-4o-mini etc.) ran too, subtract those first for a cleaner number.',
        }
      : { hint: 'Add &realUsd=15.11 (your OpenAI bill for this window) to compute the true per-image cost.' },
    byModel: models,
  })
}
