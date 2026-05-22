/**
 * GET /api/admin/openai-check[?test=1]
 *
 * Admin-only diagnostic for the GPT Image setup. Reports which OpenAI env
 * vars are present (never echoes the API key) and, with ?test=1, runs a tiny
 * live image generation to confirm the key + org + model work and the org is
 * verified for image generation — surfacing OpenAI's exact error if not.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createOpenAIService, OpenAIService } from '@/services/openai'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: caller } = await (supabase as any)
      .from('integrations').select('tier').eq('user_id', user.id).single()
    if (caller?.tier !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const apiKey = process.env.OPENAI_API_KEY || ''
    const config = {
      apiKeySet: !!apiKey,
      apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
      orgId: process.env.OPENAI_ORG_ID || null,
      imageModel: OpenAIService.imageModel(),
    }

    const runTest = new URL(request.url).searchParams.get('test') === '1'
    let liveTest: { ok: boolean; model: string; error?: string } | null = null
    if (runTest) {
      if (!apiKey) {
        liveTest = { ok: false, model: config.imageModel, error: 'OPENAI_API_KEY is not set' }
      } else {
        liveTest = await createOpenAIService().testImageGenerate()
      }
    }

    return NextResponse.json({ ok: true, config, liveTest })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
