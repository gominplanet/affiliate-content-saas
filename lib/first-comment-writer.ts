// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Writes a pinned first comment for a video that has no generated one. Server
// only. Never throws: a model that is down or refuses gives the plain comment
// from lib/first-comment-text, so a video is never left without one because a
// call failed, and the result says which it was.
import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { cleanFirstComment, fallbackFirstComment, withLinkDisclosure } from '@/lib/first-comment-text'

const MODEL = 'claude-haiku-4-5-20251001'

export async function writeFirstComment(input: {
  userId: string; tier?: string | null
  title: string | null; description?: string | null; link: string | null
}): Promise<{ text: string; written: 'ai' | 'plain' }> {
  const link = input.link
  try {
    const anthropic = createAnthropicClient()
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: 'You write the pinned first comment for a YouTube product review video. Reply with the comment text only, no quotes, no preamble.',
      messages: [{
        role: 'user',
        content: `VIDEO TITLE: ${String(input.title || '').slice(0, 200)}
DESCRIPTION (first part): ${String(input.description || '').replace(/\s+/g, ' ').slice(0, 900)}
${link ? `PRODUCT LINK: ${link}` : 'PRODUCT LINK: none'}

Write 2 or 3 short, friendly sentences in the creator's voice:
- open with one useful takeaway from the video (no hype, no claims the video does not make, no health or medical claims)
${link ? `- include the product link exactly as given, followed by "(paid link)", right after a short lead-in that names the product, like "Check out the [product] here:" (MVP adds which store it opens)` : '- no links'}
- end with a question that invites viewers to reply
- no hashtags, no emojis at the start, no em dashes`,
      }],
    })
    recordAnthropicUsage(msg, { userId: input.userId, tier: input.tier ?? null, feature: 'first_comment_writer', model: MODEL })
    const block = msg.content.find((c) => c.type === 'text') as { type: 'text'; text: string } | undefined
    let text = cleanFirstComment(block?.text)
    // A comment that dropped the link it was given is not the comment asked for.
    if (link && !text.includes(link)) text = `${text}\n\n${link} (paid link)`.trim()
    text = withLinkDisclosure(text, link)
    if (text.length >= 20) return { text, written: 'ai' }
  } catch { /* the plain comment below */ }
  return { text: fallbackFirstComment(input.title, link), written: 'plain' }
}
