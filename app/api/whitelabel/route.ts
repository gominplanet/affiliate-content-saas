/**
 * GET  /api/whitelabel  → current user's whitelabel config (resolved)
 * PATCH /api/whitelabel → update brand name / accent / logo URL
 *
 * Logo uploads go through PATCH with a `logoUrl` field — the actual file
 * upload to Supabase Storage happens client-side via the storage client,
 * we just persist the resolved URL. Keeps this route lean.
 *
 * Pro-gated: non-Pro callers get 403 with a tier_not_allowed code so the
 * UI can render the "upgrade to Pro" paywall instead of pretending the
 * save worked.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { sanitizeHex, whitelabelFromRow } from '@/lib/whitelabel'

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('integrations')
    .select('tier, whitelabel_logo_url, whitelabel_brand_name, whitelabel_accent_color')
    .eq('user_id', user.id)
    .maybeSingle()

  const config = whitelabelFromRow(data)
  return NextResponse.json({
    config,
    tier: data?.tier ?? 'trial',
    // Raw nullable fields so the UI knows when a value is the explicit
    // default vs. a customised one (logoUrl: null vs. "" matters).
    raw: {
      logoUrl: data?.whitelabel_logo_url ?? null,
      brandName: data?.whitelabel_brand_name ?? null,
      accentColor: data?.whitelabel_accent_color ?? null,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Tier gate — only Pro/admin can write here. Doubles as a real-time
  // gate (a downgrade kicks in immediately on the next save).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = (integ?.tier as string | undefined) ?? 'trial'
  if (tier !== 'pro' && tier !== 'admin') {
    return NextResponse.json({
      error: 'White-label branding requires the Pro tier',
      code: 'tier_not_allowed',
    }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: any = {}

  // Each field is independently updatable — caller sets only what changed.
  // Passing null / '' explicitly RESETS to default; missing key = no change.
  if ('brandName' in body) {
    const raw = body.brandName
    if (raw === null || raw === '') {
      updates.whitelabel_brand_name = null
    } else if (typeof raw === 'string' && raw.trim().length >= 1 && raw.trim().length <= 40) {
      updates.whitelabel_brand_name = raw.trim()
    } else {
      return NextResponse.json({ error: 'brandName must be 1-40 characters' }, { status: 400 })
    }
  }

  if ('accentColor' in body) {
    const raw = body.accentColor
    if (raw === null || raw === '') {
      updates.whitelabel_accent_color = null
    } else {
      const normalised = sanitizeHex(raw)
      if (!normalised) {
        return NextResponse.json({ error: 'accentColor must be a 7-char hex (#RRGGBB)' }, { status: 400 })
      }
      updates.whitelabel_accent_color = normalised
    }
  }

  if ('logoUrl' in body) {
    const raw = body.logoUrl
    if (raw === null || raw === '') {
      updates.whitelabel_logo_url = null
    } else if (typeof raw === 'string' && /^https?:\/\//.test(raw) && raw.length <= 500) {
      updates.whitelabel_logo_url = raw
    } else {
      return NextResponse.json({ error: 'logoUrl must be an http(s) URL under 500 chars' }, { status: 400 })
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('integrations')
    .update(updates)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return the freshly-resolved config so the client can re-render
  // immediately without a second round-trip.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: refreshed } = await (supabase as any)
    .from('integrations')
    .select('tier, whitelabel_logo_url, whitelabel_brand_name, whitelabel_accent_color')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({ ok: true, config: whitelabelFromRow(refreshed) })
}
