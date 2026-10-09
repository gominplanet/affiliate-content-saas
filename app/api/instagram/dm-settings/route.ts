/**
 * GET/POST /api/instagram/dm-settings — the signed-in user's Instagram
 * comment→DM automation config (global; per-post link is auto-resolved at send
 * time). Phase 1. See project_ig_comment_to_dm.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { stripStopLine } from '@/lib/ig-dm'

export const dynamic = 'force-dynamic'

const DEFAULTS = {
  enabled: false,
  keyword: 'LINK',
  message_template: 'Here you go 🔗 {link}',
  reply_to_comment: true,
  // Every post on the account, not only MVP's (migration 422).
  any_post: true,
  fallback_link: null as string | null,
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('ig_dm_settings').select('*')
    .eq('user_id', user.id).maybeSingle()
  // Read whole, so the two columns migration 422 adds read as their defaults
  // until it runs, and the saved template comes back without the STOP line.
  const settings = data ? { ...DEFAULTS, ...data, any_post: data.any_post !== false, message_template: stripStopLine(data.message_template) || DEFAULTS.message_template } : DEFAULTS
  return NextResponse.json({ settings })
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean; keyword?: string; message_template?: string; reply_to_comment?: boolean
    any_post?: boolean; fallback_link?: string | null
  }

  const keyword = (body.keyword ?? DEFAULTS.keyword).trim().slice(0, 40)
  const message_template = stripStopLine(body.message_template ?? DEFAULTS.message_template).slice(0, 900)
  const fallback_link = String(body.fallback_link ?? '').trim() || null
  if (fallback_link && !/^https?:\/\/\S+$/i.test(fallback_link)) {
    return NextResponse.json({ error: 'The backup link must be a full link starting with https://' }, { status: 400 })
  }
  if (!keyword) return NextResponse.json({ error: 'Keyword required' }, { status: 400 })
  // Guardrail: the DM must carry the link, so require the {link} placeholder
  // (or a bare URL) — otherwise the automation would DM a keyword with no link.
  if (!message_template.includes('{link}') && !/https?:\/\//i.test(message_template)) {
    return NextResponse.json({ error: 'Message must include {link} so the post link is sent.' }, { status: 400 })
  }

  const row = {
    user_id: user.id,
    enabled: !!body.enabled,
    keyword,
    message_template,
    reply_to_comment: body.reply_to_comment !== false,
    any_post: body.any_post !== false,
    fallback_link,
    updated_at: new Date().toISOString(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('ig_dm_settings').upsert(row, { onConflict: 'user_id' })
  if (error && /any_post|fallback_link/i.test(error.message)) {
    // Migration 422 not run yet: save the rest and say so, rather than refuse
    // the whole save over two new columns.
    const { any_post: _a, fallback_link: _f, ...older } = row
    void _a; void _f
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e2 } = await (supabase as any).from('ig_dm_settings').upsert(older, { onConflict: 'user_id' })
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
    return NextResponse.json({ ok: true, settings: row, warning: 'Saved, except "every post" and the backup link: run migration 422 in Supabase first.' })
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, settings: row })
}
