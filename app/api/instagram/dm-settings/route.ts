/**
 * GET/POST /api/instagram/dm-settings — the signed-in user's Instagram
 * comment→DM automation config (global; per-post link is auto-resolved at send
 * time). Phase 1. See project_ig_comment_to_dm.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const DEFAULTS = {
  enabled: false,
  keyword: 'LINK',
  message_template: 'Here you go 🔗 {link}\n\nReply STOP to opt out.',
  reply_to_comment: true,
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('ig_dm_settings').select('enabled,keyword,message_template,reply_to_comment')
    .eq('user_id', user.id).maybeSingle()
  return NextResponse.json({ settings: data ?? DEFAULTS })
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean; keyword?: string; message_template?: string; reply_to_comment?: boolean
  }

  const keyword = (body.keyword ?? DEFAULTS.keyword).trim().slice(0, 40)
  const message_template = (body.message_template ?? DEFAULTS.message_template).slice(0, 900)
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
    updated_at: new Date().toISOString(),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('ig_dm_settings').upsert(row, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, settings: row })
}
