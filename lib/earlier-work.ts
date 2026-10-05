// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// BUILD ON WHAT MVP ALREADY MADE (Seb, 2026-10-05: "use what's been created to
// extrapolate new data"). A writer handed an earlier post, article or script
// about the same thing starts from its researched facts instead of paying to
// research them again, and still writes every sentence fresh.
//
// Only the creator's own rows (every read filters by user_id). Text only, and
// capped, so the earlier piece informs the writer without crowding out what
// the new piece is actually about (a new video's transcript, a new angle).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const UUID = /^[0-9a-f-]{36}$/i

/** HTML or JSON down to plain words, capped. Pure. */
export function plainText(v: unknown, max = 6000): string {
  const raw = typeof v === 'string' ? v : JSON.stringify(v ?? '')
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[{}"[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** The writer's brief for building on an earlier piece. Pure. */
export function earlierBrief(o: { what: string; title: string; url?: string | null; text: string; newPiece: string }): string {
  return [
    `WHAT YOU ALREADY PUBLISHED ON THIS: ${o.what} "${o.title.slice(0, 160)}"${o.url ? ` (${o.url})` : ''}.`,
    `Reuse its facts, specs and research where they still hold. ${o.newPiece} Write every sentence fresh, never copy a sentence from it${o.url ? ', and link to it once as further reading' : ''}.`,
    o.text,
  ].join('\n')
}

/** An earlier blog post or article as writer source material, or null. */
export async function earlierPostSource(db: Db, userId: string, postId: string | null | undefined, newPiece: string): Promise<string | null> {
  if (!postId || !UUID.test(postId)) return null
  try {
    const { data } = await db.from('blog_posts').select('title, content, wordpress_url, post_type').eq('id', postId).eq('user_id', userId).maybeSingle()
    const text = plainText(data?.content)
    if (text.length < 200) return null
    return earlierBrief({ what: data?.post_type === 'article' ? 'the article' : 'the post', title: String(data?.title || ''), url: data?.wordpress_url ?? null, text, newPiece })
  } catch { return null }
}

/** An earlier script as writer source material, or null. */
export async function earlierScriptSource(db: Db, userId: string, scriptId: string | null | undefined): Promise<string | null> {
  if (!scriptId || !UUID.test(scriptId)) return null
  try {
    const { data } = await db.from('video_scripts').select('product_title, style, script').eq('id', scriptId).eq('user_id', userId).maybeSingle()
    const text = plainText(data?.script, 4000)
    if (text.length < 200) return null
    return earlierBrief({ what: 'the script', title: String(data?.product_title || data?.style || 'earlier script'), text, newPiece: 'This new script takes a different hook and structure, so a viewer who saw the first video still gets something new.' })
  } catch { return null }
}
