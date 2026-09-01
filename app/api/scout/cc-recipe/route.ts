// /api/scout/cc-recipe — durable, per-account backup of SCOUT's learned Creator
// Connections send/search recipe, so a reinstall or a switch between the
// sideloaded and Web Store builds never forces the creator to re-teach it.
//
// GET  → the saved { send, search } templates for the signed-in creator (or null).
// POST → save { send, search } for the signed-in creator.
//
// We persist ONLY the request templates (method, url, body template with the
// content/contextToken/campaignId placeholders). Never cookies or auth headers:
// SCOUT replays these cookie-authed from the creator's own live Amazon session,
// so no secret is needed or stored.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

interface RecipeTemplate { url: string; method: string; bodyTemplate: string }

// Keep only the three safe fields, and require a real body template. Anything
// else (headers, cookies, tokens) is dropped so nothing sensitive is ever stored.
function sanitize(v: unknown): RecipeTemplate | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const url = typeof o.url === 'string' ? o.url : ''
  const method = typeof o.method === 'string' ? o.method : 'POST'
  const bodyTemplate = typeof o.bodyTemplate === 'string' ? o.bodyTemplate : ''
  if (!/^https:\/\/[^ ]+\/connect\/api\//i.test(url)) return null // must be the CC API
  if (!bodyTemplate || bodyTemplate.length > 8000) return null
  return { url, method: method.toUpperCase() === 'GET' ? 'GET' : 'POST', bodyTemplate }
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // cc_send_recipe / cc_search_recipe are added by migration 307; cast around the
  // generated types until they're regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('integrations').select('cc_send_recipe, cc_search_recipe').eq('user_id', user.id).maybeSingle()
  return NextResponse.json({
    ok: true,
    send: data?.cc_send_recipe ?? null,
    search: data?.cc_search_recipe ?? null,
  })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { send?: unknown; search?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const send = sanitize(body.send)
  const search = sanitize(body.search)
  // Both must be valid templates — a partial recipe can't replay a send.
  if (!send || !search) return NextResponse.json({ error: 'A complete send + search recipe is required.' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('integrations')
    .update({ cc_send_recipe: send, cc_search_recipe: search })
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
