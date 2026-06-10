/**
 * GET  /api/youtube/thumbnail-style  → { style: { borderStyleIndex, accentColor, face } | null }
 * POST /api/youtube/thumbnail-style  { borderStyleIndex?, accentColor?, face?, clear? }
 *                                    → save (or clear) the creator's ONE brand thumbnail style.
 *
 * The brand style is the creator's DEFAULT look for the Co-Pilot thumbnail block:
 * which neon border, the title accent colour, and the face mode (auto-match / off /
 * product-only / a specific likeness model). The CLIENT prefills the block from this
 * on mount; the generate-thumbnail route never reads it (the block sends values live).
 * Stored as brand_profiles.thumbnail_brand_style (migration 122). DISTINCT from
 * /api/thumbnail-styles (a library of reference IMAGES that flavor the AI scene).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { NEON_BORDER_STYLE_COUNT } from '@/lib/thumbnail-simple-bake'

export const maxDuration = 20

interface BrandThumbStyle {
  borderStyleIndex: number | null
  accentColor: string | null
  // 'auto' = vision-match a likeness · 'off' = no face lock · 'product' = product-only
  // (no human) · or a face_models.id for a specific likeness.
  face: string | null
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/
const UUID_RE = /^[0-9a-fA-F-]{36}$/
const FACE_MODES = new Set(['auto', 'off', 'product'])

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('brand_profiles')
    .select('thumbnail_brand_style')
    .eq('user_id', user.id)
    .maybeSingle()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const style = ((data as any)?.thumbnail_brand_style as BrandThumbStyle | null) ?? null
  return NextResponse.json({ ok: true, style })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as {
    borderStyleIndex?: number | null
    accentColor?: string | null
    face?: string | null
    clear?: boolean
  }

  // Clearing → null the column (back to varied borders + default yellow accent).
  if (body.clear) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('brand_profiles')
      .update({ thumbnail_brand_style: null })
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, style: null })
  }

  // Border index: integer in [0, COUNT-1], or null = keep borders varied.
  let borderStyleIndex: number | null = null
  if (body.borderStyleIndex !== null && body.borderStyleIndex !== undefined) {
    const n = Math.floor(Number(body.borderStyleIndex))
    if (!Number.isFinite(n) || n < 0 || n >= NEON_BORDER_STYLE_COUNT) {
      return NextResponse.json({ error: `borderStyleIndex must be 0-${NEON_BORDER_STYLE_COUNT - 1} or null` }, { status: 400 })
    }
    borderStyleIndex = n
  }

  // Accent colour: #RRGGBB or null (→ default yellow at render time).
  let accentColor: string | null = null
  if (body.accentColor) {
    if (!HEX_RE.test(body.accentColor)) {
      return NextResponse.json({ error: 'accentColor must be a #RRGGBB hex string' }, { status: 400 })
    }
    accentColor = body.accentColor.toUpperCase()
  }

  // Face: a mode ('auto'|'off'|'product') or one of the user's own face_models id.
  let face: string | null = null
  if (body.face) {
    if (FACE_MODES.has(body.face)) {
      face = body.face
    } else if (UUID_RE.test(body.face)) {
      const { data: fm } = await supabase
        .from('face_models')
        .select('id')
        .eq('id', body.face)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!fm) return NextResponse.json({ error: 'face model not found' }, { status: 404 })
      face = body.face
    } else {
      return NextResponse.json({ error: "face must be 'auto', 'off', 'product', or a face-model id" }, { status: 400 })
    }
  }

  const style: BrandThumbStyle = { borderStyleIndex, accentColor, face }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('brand_profiles')
    .update({ thumbnail_brand_style: style })
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, style })
}
