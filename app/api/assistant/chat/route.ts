/**
 * POST /api/assistant/chat
 *   Body: { conversationId?: string, message: string }
 *
 * The in-dashboard AI assistant — product guide + affiliate coach. Knows
 * what MVP Affiliate does AND reads the user's brand profile so advice is
 * personalized. Streams the reply token-by-token; persists both the user
 * message and the assistant reply; capped per tier off ai_usage telemetry
 * (feature 'assistant_message').
 *
 * Returns a text/event stream of the reply text. The conversation id is
 * returned in the `X-Conversation-Id` response header (new chats get one
 * created server-side on first message).
 */
import { createServerClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { TIERS, type Tier } from '@/lib/tier'
import { checkUsageCap, PRIMARY_FEATURE } from '@/lib/usage-cap'

export const maxDuration = 60

const MODEL = 'claude-haiku-4-5-20251001'

function buildSystemPrompt(brand: Record<string, unknown> | null): string {
  const name = (brand?.author_name as string) || (brand?.name as string) || ''
  const niches = ((brand?.niches as string[]) || []).join(', ')
  const tone = ((brand?.tone as string[]) || []).join(', ')
  return `You are the in-app AI assistant for MVP Affiliate (mvpaffiliate.io) — half product guide, half affiliate-marketing coach. You help creators get more out of the platform and grow their affiliate income.

WHAT MVP AFFILIATE DOES (so you can guide accurately):
- YouTube Co-Pilot: the user saves an unlisted YouTube draft with an Amazon ASIN in the title; the platform writes the YouTube description (with affiliate links), SEO video tags, hashtags, and a click-magnet thumbnail, and pushes them back to YouTube Studio.
- Blog reviews: generates a full long-form review on the user's branded WordPress site (theme + plugin auto-installed), in their brand voice, grounded in the video transcript. In-body AI product images included.
- Social fan-out: one-click publish the review to Facebook, Threads, Bluesky, LinkedIn, Pinterest, and (Pro) Instagram, X, Telegram.
- Creator Campaigns (Pro): pulls Amazon Creator Connections campaigns, scouts by commission/EPC, one-click research + publish. Built for Amazon influencers & associates.
- Collaborations: generates personalized brand-collab pitch emails to land deals.
- Face Training (Pro) + native AI Instagram images (Pro): put the creator's real face in thumbnails/IG images.
- Plans: Free Trial (5 posts, no card), Creator ($49/mo, 40 posts), Pro ($199/mo, 200 posts + all the Pro features above).

SCOPE — anchored but genuinely helpful:
- Your home turf is MVP Affiliate + affiliate/creator marketing — lead there and bring conversations back to it when it's natural.
- BUT you're a real, capable assistant: help with adjacent topics (taxes/contracts for creators, video gear, email tools, scheduling, productivity) AND general questions when the user asks. Don't refuse or stiffly redirect a reasonable question just because it's off the core topic — answer it well, then, if relevant, tie it back to their creator/affiliate work.
- The exception: for high-stakes specialised advice (legal, medical, tax filing, financial/investment), give helpful general information but add a brief "confirm with a qualified professional" note. Don't pretend to be a licensed advisor.

HOW TO BEHAVE:
- Be concise and actionable. Prefer specific steps ("Go to YouTube Co-Pilot → …") over generic advice.
- For affiliate strategy questions, give concrete, experienced guidance (niches, what converts, posting cadence, how to land brand deals).
- Never invent features the platform doesn't have. If something isn't possible in MVP Affiliate, say so plainly and suggest the closest real workflow.
- Never use the word "honest". Don't fabricate stats.
${name ? `\nABOUT THIS USER (personalize your advice):\n- Name: ${name}${niches ? `\n- Niches: ${niches}` : ''}${tone ? `\n- Brand tone: ${tone}` : ''}` : ''}`
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const body = await request.json().catch(() => ({})) as { conversationId?: string; message?: string }
  const message = (body.message || '').trim()
  if (!message) return new Response(JSON.stringify({ error: 'message required' }), { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: intRow } = await sb
    .from('integrations')
    .select('tier,subscription_period_start,subscription_period_end')
    .eq('user_id', user.id).single()
  const tier = (intRow?.tier as Tier) ?? 'trial'

  // ── Cap gate ──────────────────────────────────────────────────────────────
  const cap = TIERS[tier].assistantMessagesPerMonth
  const capCheck = await checkUsageCap(
    sb, user.id, PRIMARY_FEATURE.assistant, cap,
    (intRow?.subscription_period_start as string | null) ?? null,
    (intRow?.subscription_period_end as string | null) ?? null,
  )
  if (capCheck?.exceeded) {
    return new Response(JSON.stringify({
      error: `You've used all ${cap} assistant messages on the ${TIERS[tier].label} plan this period. Resets ${capCheck.resetLabel}.`,
      limitReached: true, cap: 'assistant', currentTier: tier,
    }), { status: 429, headers: { 'Content-Type': 'application/json' } })
  }

  // ── Resolve / create conversation ──────────────────────────────────────────
  let conversationId = body.conversationId || null
  if (conversationId) {
    const { data: conv } = await sb.from('assistant_conversations')
      .select('id').eq('id', conversationId).eq('user_id', user.id).single()
    if (!conv) conversationId = null
  }
  if (!conversationId) {
    const { data: created } = await sb.from('assistant_conversations')
      .insert({ user_id: user.id, title: message.slice(0, 60) })
      .select('id').single()
    conversationId = created?.id ?? null
  }
  if (!conversationId) return new Response(JSON.stringify({ error: 'Could not start conversation' }), { status: 500 })

  // ── Load recent history for context (cap to bound tokens) ──────────────────
  const { data: history } = await sb.from('assistant_messages')
    .select('role,content').eq('conversation_id', conversationId)
    .order('created_at', { ascending: true }).limit(20)
  const priorMsgs = ((history as Array<{ role: 'user' | 'assistant'; content: string }>) || [])
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content }))

  // Persist the user's message + bump conversation timestamp.
  await sb.from('assistant_messages').insert({ conversation_id: conversationId, user_id: user.id, role: 'user', content: message })
  await sb.from('assistant_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)

  // ── Brand profile for personalization ──────────────────────────────────────
  const { data: brand } = await sb.from('brand_profiles')
    .select('name,author_name,niches,tone').eq('user_id', user.id).single()

  const anthropic = createAnthropicClient()
  const convId = conversationId
  const encoder = new TextEncoder()

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = ''
      try {
        const stream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 1200,
          system: buildSystemPrompt(brand as Record<string, unknown> | null),
          messages: [...priorMsgs, { role: 'user', content: message }],
        })
        stream.on('text', (t: string) => { full += t; controller.enqueue(encoder.encode(t)) })
        const finalMsg = await stream.finalMessage()
        recordAnthropicUsage(finalMsg, { userId: user.id, tier, feature: 'assistant_message', model: MODEL })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Assistant error'
        if (!full) controller.enqueue(encoder.encode(`Sorry — I hit an error: ${msg}`))
      } finally {
        // Persist the assistant reply (best-effort).
        if (full.trim()) {
          await sb.from('assistant_messages').insert({ conversation_id: convId, user_id: user.id, role: 'assistant', content: full })
          await sb.from('assistant_conversations').update({ updated_at: new Date().toISOString() }).eq('id', convId)
        }
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Conversation-Id': convId,
    },
  })
}
