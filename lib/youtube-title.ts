// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Build a YouTube Shorts title in the punchy "hook + hashtags" style creators
 * expect: `Giant Screen, Tiny Distance #Shorts #projector #homecinema`.
 *
 * #Shorts always leads the tag list (helps YouTube classify it as a Short), then
 * the clip's own niche hashtags, deduped and only as many as fit inside YouTube's
 * 100-character title limit.
 */
export function buildYouTubeShortTitle(hook: string, hashtags: string[] = []): string {
  const base = (hook || 'New Short').replace(/\s+/g, ' ').trim().slice(0, 100)

  // Normalize: strip a leading #, drop blanks, dedupe case-insensitively, and
  // never repeat "shorts" (we always lead with #Shorts).
  const seen = new Set<string>(['shorts'])
  const tags: string[] = ['#Shorts']
  for (const raw of hashtags) {
    const t = String(raw).replace(/^#+/, '').replace(/\s+/g, '').trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(`#${t}`)
  }

  // Append tags only while they fit within 100 chars.
  let title = base
  for (const tag of tags) {
    if (`${title} ${tag}`.length <= 100) title = `${title} ${tag}`
    else break
  }
  return title.slice(0, 100)
}
