/**
 * GET /api/admin/image-diagnostic
 *
 * Admin-only. Answers "is gpt-image actually working, or is everything falling
 * back to the paid fal models?" — the question behind an unexpectedly high fal
 * bill. Reports the OpenAI config and runs two live probes:
 *   - generate: plain text→image (confirms key + org verification + model access)
 *   - edit:     a tiny reference-based edit (the EXACT path the composers use)
 * If BOTH ok, gpt-image works and production fallbacks are content-policy
 * refusals on face/product prompts. If generate fails with "must be verified",
 * the org isn't verified for image gen and EVERY image is falling back to fal.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createOpenAIService, OpenAIService } from '@/services/openai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await (supabase as any).from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const config = {
    apiKeySet: !!process.env.OPENAI_API_KEY,
    orgIdSet: !!process.env.OPENAI_ORG_ID,
    imageModel: OpenAIService.imageModel(),
  }
  if (!config.apiKeySet) {
    return NextResponse.json({ ok: false, config, reason: 'no_api_key', advice: 'OPENAI_API_KEY is not set — every image is falling back to fal.' })
  }

  let generate: { ok: boolean; model: string; error?: string }
  let edit: { ok: boolean; model: string; error?: string }
  try {
    const svc = createOpenAIService()
    // Run both probes; the edit probe is the one that mirrors production.
    ;[generate, edit] = await Promise.all([svc.testImageGenerate(), svc.testImageEdit()])
  } catch (e) {
    return NextResponse.json({ ok: false, config, reason: 'service_init_failed', error: e instanceof Error ? e.message : String(e) })
  }

  const verifyProblem = /verif|must be verified|organization/i.test(generate.error || '') || /verif|must be verified|organization/i.test(edit.error || '')
  let reason: string
  let advice: string
  if (generate.ok && edit.ok) {
    reason = 'healthy'
    advice = 'gpt-image works on both text→image and reference edits. Production fallbacks to fal are content-policy refusals on specific prompts (usually real faces or brand/product images), not a config problem.'
  } else if (verifyProblem) {
    reason = 'org_not_verified'
    advice = 'The OpenAI organization is not verified for image generation, so EVERY gpt-image call fails and falls back to the paid fal models. Verify the org at platform.openai.com (Settings → Organization → verify), and set OPENAI_ORG_ID to that verified org.'
  } else if (!generate.ok) {
    reason = 'generate_failing'
    advice = 'Basic text→image is failing (not a refusal) — likely a key, model-access, or billing issue on the OpenAI account. See the error below.'
  } else {
    reason = 'edit_failing'
    advice = 'Text→image works but reference-based edits fail — the composers use edits, so this is why fal is doing the work. See the edit error below.'
  }

  return NextResponse.json({ ok: generate.ok && edit.ok, config, reason, advice, generate, edit })
}
