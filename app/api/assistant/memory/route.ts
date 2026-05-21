/**
 * GET    /api/assistant/memory   → the user's current long-term memory note
 * POST   /api/assistant/memory   → import text (paste / file export from
 *                                   ChatGPT, Claude, etc.); distilled + merged
 *                                   into the memory note. Body: { text }
 * DELETE /api/assistant/memory   → clear the memory note
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAssistantMemory, saveAssistantMemory, mergeAssistantMemory } from '@/lib/assistant-memory'
import type { Tier } from '@/lib/tier'

export const maxDuration = 60

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memory = await getAssistantMemory(supabase as any, user.id)
  return NextResponse.json({ memory })
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { text } = await request.json().catch(() => ({})) as { text?: string }
  const material = (text || '').trim()
  if (!material) return NextResponse.json({ error: 'Nothing to import' }, { status: 400 })
  if (material.length > 200_000) return NextResponse.json({ error: 'That export is too large — paste the most relevant parts (under ~200k characters).' }, { status: 413 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: intRow } = await sb.from('integrations').select('tier').eq('user_id', user.id).single()
  const tier = (intRow?.tier as Tier) ?? 'trial'

  const existing = await getAssistantMemory(sb, user.id)
  const updated = await mergeAssistantMemory({
    existing,
    newMaterial: material,
    kind: 'import',
    ctx: { userId: user.id, tier },
  })
  if (updated === existing) {
    return NextResponse.json({ ok: true, memory: existing, note: 'Nothing durable to add from that import.' })
  }
  await saveAssistantMemory(sb, user.id, updated)
  return NextResponse.json({ ok: true, memory: updated })
}

export async function DELETE() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await saveAssistantMemory(supabase as any, user.id, '')
  return NextResponse.json({ ok: true })
}
