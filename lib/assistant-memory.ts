// Lightweight per-user "long-term memory" for the AI assistant.
//
// A single rolling note per user (assistant_memory.memory) that captures
// durable facts — preferences, goals, niche focus, recurring needs,
// decisions, working style. Injected into every conversation so the
// assistant feels continuous across threads. Updated by merging new
// material (a chat exchange, or imported history) into the existing note
// via a cheap Haiku call, kept bounded so it never bloats the prompt.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'

const MAX_MEMORY_CHARS = 2800

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAssistantMemory(sb: any, userId: string): Promise<string> {
  try {
    const { data } = await sb.from('assistant_memory').select('memory').eq('user_id', userId).single()
    return (data?.memory as string) || ''
  } catch {
    return ''
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveAssistantMemory(sb: any, userId: string, memory: string): Promise<void> {
  try {
    await sb.from('assistant_memory').upsert(
      { user_id: userId, memory: memory.slice(0, MAX_MEMORY_CHARS), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  } catch { /* best-effort */ }
}

/**
 * Merge `newMaterial` into the existing memory note via Haiku and return
 * the updated note. `kind` tweights how aggressively to keep detail:
 * 'chat' = light touch (only durable takeaways from a single exchange),
 * 'import' = pull as many durable facts as possible from a larger dump.
 * Returns the existing memory unchanged on any failure.
 */
export async function mergeAssistantMemory(opts: {
  existing: string
  newMaterial: string
  kind: 'chat' | 'import'
  ctx: { userId: string | null; tier: string | null }
}): Promise<string> {
  const material = (opts.newMaterial || '').trim()
  if (!material) return opts.existing
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `You maintain a concise long-term MEMORY about a user of an affiliate-marketing app, so an AI assistant can stay continuous across chats.

CURRENT MEMORY (may be empty):
${opts.existing || '(empty)'}

NEW MATERIAL (${opts.kind === 'import' ? 'imported from the user\'s exported history from another AI tool' : 'their latest chat exchange'}):
${material.slice(0, opts.kind === 'import' ? 30000 : 4000)}

Update the memory:
- KEEP durable, reusable facts: who they are, their niche(s), goals, preferences, tone/style, tools they use, recurring needs, decisions made, constraints.
- DROP one-off Q&A, transient details, and anything not useful for future conversations.
- Merge — don't just append. De-duplicate. Resolve contradictions in favour of the newer material.
- Write as a tight bulleted note in second person ("You ...") or terse facts. Under 250 words.

Return ONLY the updated memory note, nothing else.`,
      }],
    })
    recordAnthropicUsage(msg, { userId: opts.ctx.userId, tier: opts.ctx.tier, feature: 'assistant_memory_update', model: 'claude-haiku-4-5-20251001' })
    const out = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim()
    return out ? out.slice(0, MAX_MEMORY_CHARS) : opts.existing
  } catch {
    return opts.existing
  }
}
