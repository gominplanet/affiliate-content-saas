// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Build YouTube video tags (snippet.tags) from a clip's hashtags. YouTube tags
 * are plain keyword phrases, not hashtags, so we un-camelCase each hashtag into
 * a searchable phrase: "#WavyHairTool" -> "wavy hair tool".
 *
 * YouTube caps the COMBINED length of all tags at ~500 chars; we stay under 450
 * and at most 15 tags.
 */
export function buildYouTubeTags(hashtags: string[] = [], hook = ''): string[] {
  const seen = new Set<string>()
  const collected: string[] = []
  const push = (t: string) => {
    const v = t.replace(/\s+/g, ' ').trim().toLowerCase()
    if (v.length < 2 || v.length > 40) return
    if (seen.has(v)) return
    seen.add(v)
    collected.push(v)
  }

  for (const raw of hashtags || []) {
    const bare = String(raw).replace(/^#+/, '').trim()
    if (!bare) continue
    // camelCase / PascalCase / snake / kebab -> spaced phrase.
    const phrase = bare
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    push(phrase)
  }

  // A couple of tags from the hook's meaningful words (drop punctuation/stopwords).
  const hookWords = (hook || '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !STOP.has(w))
  if (hookWords.length >= 2) push(hookWords.slice(0, 3).join(' '))

  // Fit within YouTube's ~500-char combined limit (stay under 450), cap count.
  const out: string[] = []
  let total = 0
  for (const t of collected) {
    total += t.length + 1
    if (total > 450 || out.length >= 15) break
    out.push(t)
  }
  return out
}

const STOP = new Set(['this', 'that', 'with', 'your', 'from', 'just', 'have', 'will', 'they', 'them', 'anymore', 'more', 'best', 'these', 'those', 'here'])
