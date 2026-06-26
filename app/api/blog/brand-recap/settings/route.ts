// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET/PUT /api/blog/brand-recap/settings — the customizable "Share with brand"
// message template, stored on brand_profiles.brand_recap_settings (migration
// 140). GET returns the saved settings or the in-code default (so the editor
// always has something to show); PUT saves. Owner-scoped.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { DEFAULT_RECAP_TEMPLATE, type BrandRecapSettings } from '@/lib/brand-recap'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brand } = await (supabase as any)
    .from('brand_profiles')
    .select('name, author_name, website_url, brand_recap_settings')
    .eq('user_id', ownerId)
    .maybeSingle()

  const saved = (brand?.brand_recap_settings ?? null) as Partial<BrandRecapSettings> | null
  const settings: BrandRecapSettings = {
    template: saved?.template || DEFAULT_RECAP_TEMPLATE,
    tone: saved?.tone || 'warm',
    senderName: saved?.senderName || (brand?.author_name as string) || (brand?.name as string) || '',
    siteUrl: saved?.siteUrl || (brand?.website_url as string) || '',
  }
  return NextResponse.json({ settings, isCustomized: !!saved })
}

export async function PUT(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  let body: Partial<BrandRecapSettings>
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const tone = body.tone === 'professional' || body.tone === 'casual' ? body.tone : 'warm'
  const settings: BrandRecapSettings = {
    template: typeof body.template === 'string' && body.template.trim() ? body.template.slice(0, 4000) : DEFAULT_RECAP_TEMPLATE,
    tone,
    senderName: (body.senderName || '').toString().slice(0, 120),
    siteUrl: (body.siteUrl || '').toString().slice(0, 200),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('brand_profiles')
    .update({ brand_recap_settings: settings })
    .eq('user_id', ownerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, settings })
}
