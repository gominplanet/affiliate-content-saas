/**
 * POST /api/photobooth
 *
 * Professional headshot generator. Uses the photos the user already uploaded
 * under "Your Face" (face_models.source_images) as identity references and
 * gpt-image-1/2 to produce a polished headshot — for logos, email, profiles,
 * speaker bios, etc. Optional style preset + free-text prompt.
 *
 * Pro-only. Returns a base64 PNG data URL (no storage needed).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { TIERS, normalizeTier, type Tier } from '@/lib/tier'
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'
import { createOpenAIService, OpenAIService, normalizeToPng } from '@/services/openai'
import { recordUsage } from '@/lib/ai-usage'

export const maxDuration = 300

/** Photobooth monthly usage for the current user (Pro = 20 / mo, admin = ∞). */
async function loadPhotoboothUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, userId: string,
): Promise<{ tier: Tier; limit: number | null; used: number; remaining: number | null; resetLabel: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .from('integrations')
    .select('tier,subscription_period_start,subscription_period_end')
    .eq('user_id', userId)
    .single()
  const tier = normalizeTier(row?.tier)
  const limit = TIERS[tier].photoboothPerMonth
  const check = await checkUsageCap(
    supabase, userId, PRIMARY_FEATURE.photobooth, limit,
    row?.subscription_period_start ?? null, row?.subscription_period_end ?? null,
  )
  const used = check?.used ?? 0
  return {
    tier, limit, used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    resetLabel: check?.resetLabel ?? '',
  }
}

// ── Persisted shots ───────────────────────────────────────────────────────
// Generated headshots are saved in the existing `headshots` bucket so they
// survive logout. Path MUST start with the user id — the bucket's per-user RLS
// policy is ((storage.foldername(name))[1] = auth.uid()). We keep only the last
// 5 per user.
const SHOTS_BUCKET = 'headshots'
const SHOTS_KEEP_PER_FACE = 10   // cost/tidiness cap: keep the 10 most recent per face
const SHOTS_DISPLAY_CAP = 20     // album shows up to this many (≈ 2 faces × 10)
const SIGNED_TTL = 60 * 60 * 24 * 365 // 1 year
const shotsFolder = (userId: string) => `${userId}/photobooth`

// Stored filename: `{faceModelId}__{style}__{expression}__{ts}-{rand}.png`. The
// face-id prefix lets us cap storage PER FACE in one flat folder; the expression
// segment lets the thumbnail pipeline auto-pick a creator's "Excited" headshot.
// (Older shots use the legacy `{faceModelId}__{style}-...` form — still parses.)
function styleFromName(name: string): string {
  const parts = String(name).split('__')
  return (parts[1] || 'studio').split('-')[0] || 'studio'
}

interface PersistedShot { path: string; url: string; style: string; createdAt: string | null }

/** List the user's most-recent saved headshots (newest first), with signed URLs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listShots(supabase: any, userId: string): Promise<PersistedShot[]> {
  const folder = shotsFolder(userId)
  const { data: files } = await supabase.storage.from(SHOTS_BUCKET).list(folder, {
    limit: 100, sortBy: { column: 'created_at', order: 'desc' },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((files ?? []) as any[]).filter(f => f?.name && !f.name.startsWith('.')).slice(0, SHOTS_DISPLAY_CAP)
  const out: PersistedShot[] = []
  for (const f of rows) {
    const path = `${folder}/${f.name}`
    const { data: signed } = await supabase.storage.from(SHOTS_BUCKET).createSignedUrl(path, SIGNED_TTL)
    if (signed?.signedUrl) {
      out.push({ path, url: signed.signedUrl, style: styleFromName(String(f.name)), createdAt: f.created_at ?? null })
    }
  }
  return out
}

/** Keep only the newest SHOTS_KEEP_PER_FACE shots for ONE face; delete older. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pruneShots(supabase: any, userId: string, faceId: string): Promise<void> {
  const folder = shotsFolder(userId)
  const { data: files } = await supabase.storage.from(SHOTS_BUCKET).list(folder, {
    limit: 200, sortBy: { column: 'created_at', order: 'desc' },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((files ?? []) as any[]).filter(f => f?.name && f.name.startsWith(`${faceId}__`))
  const extra = rows.slice(SHOTS_KEEP_PER_FACE).map(f => `${folder}/${f.name}`)
  if (extra.length) await supabase.storage.from(SHOTS_BUCKET).remove(extra)
}

/** Built-in looks (backdrop + lighting). Free-text customPrompt is appended. */
const STYLES: Record<string, string> = {
  studio:    'Clean professional studio headshot on a smooth neutral backdrop (soft grey or white), crisp even studio lighting, sharp focus.',
  office:    'Modern office setting — a computer/desk and workspace softly blurred in the background, approachable and professional.',
  cinematic: 'Cinematic portrait — moody directional lighting, shallow depth of field, filmic colour grade, premium editorial feel.',
  magazine:  'Bright, well-lit editorial magazine-style headshot — polished, high-end commercial lighting, glossy professional finish.',
  outdoor:   'Natural outdoor daylight, soft bokeh background, warm and friendly.',
  linkedin:  'Classic LinkedIn-style professional headshot — business-casual attire, simple neutral background, confident friendly expression.',
}

/** Facial expressions (independent of LOOK). Empty `neutral` → the default
 *  relaxed-confident line. The energetic ones double as punchy thumbnail faces. */
const EXPRESSIONS: Record<string, string> = {
  neutral:   '',
  happy:     'a warm, genuine smile — friendly and approachable',
  excited:   'visibly excited and energetic — bright wide eyes and a big enthusiastic smile',
  surprised: 'a genuine surprised reaction — eyebrows raised, eyes wide, mouth slightly open in a "wow"',
  laughing:  'laughing naturally — joyful and candid, eyes lit up',
  focused:   'focused and determined — calm intensity, looking straight at the camera',
  serious:   'serious and composed — confident, no smile',
  angry:     'an intense, fired-up reaction — furrowed brow, strong emotion',
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // ── Pro gate + monthly cap ────────────────────────────────────────────
    const usage = await loadPhotoboothUsage(supabase, user.id)
    const tier = usage.tier
    // Paid-tier gate: photoboothPerMonth === 0 → off (trial). Creator/Pro have a
    // monthly cap; admin is unlimited (null limit).
    if (usage.limit === 0) {
      return NextResponse.json({
        error: 'Photobooth is available on paid plans. Upgrade to Creator or Pro to generate headshots.',
        limitReached: true, cap: 'photobooth', currentTier: tier,
        upgrade: { tier: 'creator', label: TIERS.creator.label, limit: TIERS.creator.photoboothPerMonth },
      }, { status: 403 })
    }
    // 20 / month for Pro (admin = unlimited). Reject before spending on gpt-image.
    if (usage.limit !== null && usage.used >= usage.limit) {
      return NextResponse.json({
        error: `You've used all ${usage.limit} Photobooth headshots for this billing period. Resets ${usage.resetLabel}.`,
        limitReached: true, cap: 'photobooth', currentTier: tier,
        usage: { used: usage.used, limit: usage.limit, remaining: 0, resetLabel: usage.resetLabel },
      }, { status: 429 })
    }

    const body = await request.json() as {
      faceModelId?: string
      style?: string
      expression?: string
      customPrompt?: string
      size?: '1024x1024' | '1024x1536' | '1536x1024'
    }
    if (!body.faceModelId) return NextResponse.json({ error: 'Pick a face first.' }, { status: 400 })

    // ── Load the face's reference photos ──────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fm } = await (supabase as any)
      .from('face_models')
      .select('name,source_images')
      .eq('id', body.faceModelId)
      .eq('user_id', user.id)
      .single()
    const srcImages: string[] = Array.isArray(fm?.source_images) ? fm.source_images : []
    if (!fm || srcImages.length === 0) {
      return NextResponse.json({ error: 'That face has no photos. Add one under "Your Face" first.' }, { status: 400 })
    }

    const refImages: Array<{ data: Uint8Array; filename: string; mime: string }> = []
    for (const path of srcImages.slice(0, 5)) {
      const { data: file } = await supabase.storage.from('headshots').download(path)
      if (!file) continue
      try {
        const png = await normalizeToPng(new Uint8Array(await file.arrayBuffer()))
        refImages.push({ data: png, filename: `face_${refImages.length}.png`, mime: 'image/png' })
      } catch (e) {
        console.warn('[photobooth] skipping unreadable reference photo', path, e)
      }
    }
    if (refImages.length === 0) {
      return NextResponse.json({ error: 'Could not load the reference photos. Try re-adding your face.' }, { status: 500 })
    }

    // ── Build the headshot prompt ─────────────────────────────────────────
    const styleLine = (body.style && STYLES[body.style]) ? STYLES[body.style] : STYLES.studio
    const expressionClause = (body.expression && EXPRESSIONS[body.expression])
      ? EXPRESSIONS[body.expression]
      : 'a relaxed, confident professional expression'
    const custom = (body.customPrompt || '').trim().slice(0, 400)
    const size = (body.size === '1024x1536' || body.size === '1536x1024') ? body.size : '1024x1024'

    const prompt = `Professional headshot portrait, photorealistic, high resolution.

REFERENCE IMAGES: use these ONLY to capture the MAIN subject's exact facial identity, hair, and likeness. The photos may also contain OTHER people (a partner or friend) — IGNORE everyone else; lock onto the single most prominent main subject (the largest, most central face).
IDENTITY (critical): render EXACTLY that one person, completely ALONE. Do NOT blend, merge, average, or mix in any other face. There must be ONLY ONE person in the output — absolutely no second person, partner, companion, or any extra face/head/shoulder/arm of anyone else anywhere in the frame. It must clearly be the same individual — flattering but unmistakably them.

SHOT: head-and-shoulders portrait, person centred, looking at the camera, ${expressionClause}, natural realistic skin texture (not plastic or over-retouched), flattering professional lighting, sharp focus on the eyes.
LOOK: ${styleLine}${custom ? `\nADDITIONAL DIRECTION: ${custom}` : ''}
Do NOT render any text, captions, watermarks, or logos.`

    const imageModel = OpenAIService.imageModel()
    const openai = createOpenAIService()
    const b64 = await openai.generateWithReferences({ prompt, images: refImages, size, quality: 'high', model: imageModel })

    recordUsage({
      userId: user.id, tier,
      feature: 'photobooth_image', model: imageModel, images: 1,
    })

    const styleKey = body.style && STYLES[body.style] ? body.style : 'studio'

    // Persist to storage so it survives logout; keep only the last 5. If the
    // save fails we still return the freshly-generated data URL so the user
    // gets their image — just without the persisted/signed copy.
    let imageUrl = `data:image/png;base64,${b64}`
    let savedPath: string | null = null
    try {
      const exprKey = (body.expression && EXPRESSIONS[body.expression]) ? body.expression : 'neutral'
      const fileName = `${body.faceModelId}__${styleKey}__${exprKey}__${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
      const path = `${shotsFolder(user.id)}/${fileName}`
      const { error: upErr } = await supabase.storage
        .from(SHOTS_BUCKET)
        .upload(path, Buffer.from(b64, 'base64'), { contentType: 'image/png', upsert: false })
      if (upErr) throw upErr
      savedPath = path
      await pruneShots(supabase, user.id, body.faceModelId)
      const { data: signed } = await supabase.storage.from(SHOTS_BUCKET).createSignedUrl(path, SIGNED_TTL)
      if (signed?.signedUrl) imageUrl = signed.signedUrl
    } catch (e) {
      console.warn('[photobooth] could not persist headshot:', e)
    }

    // usage.used is the count BEFORE this generation; reflect this one now so
    // the client countdown updates immediately (recordUsage is async).
    const usedAfter = usage.used + 1
    return NextResponse.json({
      ok: true,
      image: imageUrl,
      path: savedPath,
      style: styleKey,
      usage: {
        used: usedAfter,
        limit: usage.limit,
        remaining: usage.limit === null ? null : Math.max(0, usage.limit - usedAfter),
        resetLabel: usage.resetLabel,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[photobooth] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** GET /api/photobooth — usage countdown + the user's last 5 saved headshots. */
export async function GET() {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const [usage, shots] = await Promise.all([
      loadPhotoboothUsage(supabase, user.id),
      listShots(supabase, user.id).catch(() => [] as PersistedShot[]),
    ])
    return NextResponse.json({ ok: true, usage, shots })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** DELETE /api/photobooth { path } — remove one saved headshot. */
export async function DELETE(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { path } = await request.json().catch(() => ({})) as { path?: string }
    // Only allow deleting the caller's own photobooth objects.
    if (!path || !path.startsWith(`${shotsFolder(user.id)}/`)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
    }
    const { error } = await supabase.storage.from(SHOTS_BUCKET).remove([path])
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
