/**
 * POST /api/admin/designer-text-test
 *
 * Test endpoint for the designer thumbnail text overlay system. Takes a base
 * image URL (or data URI) + headline and returns the composited PNG as
 * base64 + the picker's decisions for inspection. Admin-only.
 *
 * Body:
 *   {
 *     baseImageUrl: string         // http(s) URL or data:image/... URI
 *     headline:     string         // raw headline to render
 *     productContext?: string      // optional context for picker
 *     forceTemplateId?: string     // override picker (block-display / banner-pill / badge-score)
 *     subjectSide?: 'left' | 'right'  // which side the subject occupies (text goes opposite)
 *   }
 *
 * Response:
 *   {
 *     pngDataUri: string                  // ready to drop into <img src>
 *     picked: { templateId, content, palette }
 *     width: number
 *     height: number
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { renderDesignerOverlay } from '@/lib/thumbnail-text-templates'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const baseImageUrl = String(body.baseImageUrl || '').trim()
  const headline = String(body.headline || '').trim()
  if (!baseImageUrl || !headline) {
    return NextResponse.json({ error: 'baseImageUrl and headline are required' }, { status: 400 })
  }

  try {
    const result = await renderDesignerOverlay({
      baseImageUrl,
      headline,
      productContext: body.productContext ? String(body.productContext) : null,
      forceTemplateId: body.forceTemplateId ? String(body.forceTemplateId) : undefined,
      randomize: body.randomize === true,
      subjectSide: body.subjectSide === 'left' ? 'left' : body.subjectSide === 'right' ? 'right' : undefined,
      verticalAnchor: body.verticalAnchor === 'bottom' ? 'bottom' : body.verticalAnchor === 'center' ? 'center' : 'top',
      userId: user.id,
      tier: (caller?.tier as string) ?? null,
    })

    return NextResponse.json({
      pngDataUri: `data:image/png;base64,${result.png.toString('base64')}`,
      picked: result.picked,
      width: result.width,
      height: result.height,
      renderError: result.renderError ?? null,
    })
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'render failed',
    }, { status: 500 })
  }
}
