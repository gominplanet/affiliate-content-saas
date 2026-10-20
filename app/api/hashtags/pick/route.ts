// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/hashtags/pick — a caption with its hashtags picked by the engine
// for one platform (lib/hashtag-data researchedTags: researched live, that
// platform's rule and counts; the caption's own tags are suggestions). For
// screens that move a caption to another platform (Shorts Studio's TikTok
// and Instagram buttons) so it does not carry the tags picked for the first.
//   body: { platform, text, about?, brand? }
// Never fails the caller's post: on any trouble it answers with the text as
// it came, and `picked: false` says so.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { researchedTags } from '@/lib/hashtag-data'
import { TAG_RULES, type TagPlatform } from '@/lib/hashtag-engine'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { platform?: string; text?: string; about?: string; brand?: string }
  const text = String(body.text || '').slice(0, 5000)
  if (!text.trim() || !(String(body.platform) in TAG_RULES)) return NextResponse.json({ ok: true, text, picked: false })
  const r = await researchedTags(text, { platform: body.platform as TagPlatform, about: String(body.about || '').slice(0, 500), brand: body.brand ? String(body.brand).slice(0, 200) : null, userId: user.id })
  return NextResponse.json({ ok: true, text: r.text, picked: !!r.pick, tags: r.pick?.tags.map((t) => ({ tag: t.tag, why: t.why })) ?? [] })
}
