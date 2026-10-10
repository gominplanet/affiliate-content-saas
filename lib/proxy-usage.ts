// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE DOWNLOAD PROXY'S DATA THIS BILLING PERIOD (Seb, 2026-10-09). The Webshare
// plan ran out at 3.2 of 3 GB and every YouTube fetch failed for every member
// until someone noticed. This reads the plan's limit and what has been used
// since the period started, so the admin page warns at 80% instead.
//
// Webshare API v2, key in WEBSHARE_API_KEY (Webshare dashboard, API, Keys):
//   GET /api/v2/subscription/                plan, start_date, end_date
//   GET /api/v2/subscription/plan/<plan>/    bandwidth_limit (GB, 0 = unlimited)
//   GET /api/v2/stats/aggregate/             bandwidth_total (bytes), bandwidth_projected

const BASE = 'https://proxy.webshare.io/api/v2'
export const PROXY_WARN_PCT = 80

export type ProxyUsage =
  | { ok: true; usedGb: number; limitGb: number | null; pct: number | null; projectedGb: number | null; periodStart: string; periodEnd: string }
  | { ok: false; error: string }

/** Bytes to GB, two decimals. Pure. */
export function toGb(bytes: unknown): number {
  const n = Number(bytes)
  return Number.isFinite(n) ? Math.round((n / 1e9) * 100) / 100 : 0
}

/** The share of the plan used, or null for an unlimited plan. Pure. */
export function usedPct(usedGb: number, limitGb: number | null): number | null {
  if (!limitGb || limitGb <= 0) return null
  return Math.round((usedGb / limitGb) * 100)
}

async function get(path: string, key: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Token ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) throw new Error(String(body.detail || `Webshare said ${res.status}`))
  return body
}

export async function proxyUsage(key = process.env.WEBSHARE_API_KEY): Promise<ProxyUsage> {
  if (!key) return { ok: false, error: 'WEBSHARE_API_KEY is not set in Vercel. Create a key in Webshare (API, Keys), add it, and redeploy.' }
  try {
    const sub = await get('/subscription/', key)
    const plan = sub.plan
    const start = String(sub.start_date || '')
    const end = String(sub.end_date || '')
    if (!plan || !start) return { ok: false, error: 'Webshare did not return the current plan or billing period.' }
    const planRow = await get(`/subscription/plan/${encodeURIComponent(String(plan))}/`, key)
    const limit = Number(planRow.bandwidth_limit)
    const limitGb = Number.isFinite(limit) && limit > 0 ? limit : null
    const now = new Date().toISOString()
    const stats = await get(`/stats/aggregate/?plan_id=${encodeURIComponent(String(plan))}&timestamp__gte=${encodeURIComponent(start)}&timestamp__lte=${encodeURIComponent(now)}`, key)
    const usedGb = toGb(stats.bandwidth_total)
    const projected = Number(stats.bandwidth_projected)
    return {
      ok: true, usedGb, limitGb, pct: usedPct(usedGb, limitGb),
      projectedGb: Number.isFinite(projected) && projected > 0 ? toGb(projected) : null,
      periodStart: start, periodEnd: end,
    }
  } catch (e) {
    return { ok: false, error: `Could not read Webshare: ${e instanceof Error ? e.message : String(e)}` }
  }
}
