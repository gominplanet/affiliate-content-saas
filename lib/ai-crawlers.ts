// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// AI-crawler access check — does a site's robots.txt let the AI answer engines
// read it? A creator's affiliate content can't be quoted by ChatGPT / Perplexity
// / Google AI Overviews if their crawler is blocked, and many WordPress/SEO-
// plugin defaults (or a copied robots.txt) quietly block them. This parses
// robots.txt and reports, per bot, whether it's allowed — the "open the doors"
// half of the AIO push, surfaced as a fixable check.

/** The crawlers that feed the major AI answer engines, with who they serve. */
export const AI_CRAWLERS: Array<{ token: string; label: string; serves: string }> = [
  { token: 'GPTBot', label: 'GPTBot', serves: 'ChatGPT (training)' },
  { token: 'OAI-SearchBot', label: 'OAI-SearchBot', serves: 'ChatGPT Search' },
  { token: 'ChatGPT-User', label: 'ChatGPT-User', serves: 'ChatGPT (live browse)' },
  { token: 'PerplexityBot', label: 'PerplexityBot', serves: 'Perplexity' },
  { token: 'Google-Extended', label: 'Google-Extended', serves: 'Gemini / AI Overviews' },
  { token: 'ClaudeBot', label: 'ClaudeBot', serves: 'Claude' },
  { token: 'CCBot', label: 'CCBot', serves: 'Common Crawl (many LLMs)' },
  { token: 'Applebot-Extended', label: 'Applebot-Extended', serves: 'Apple Intelligence' },
]

export interface AiCrawlerCheck {
  token: string
  label: string
  serves: string
  allowed: boolean
}

export interface AiCrawlerReport {
  /** robots.txt was found and read. When false, treat all as ALLOWED (no file = no block). */
  robotsFound: boolean
  crawlers: AiCrawlerCheck[]
  allowedCount: number
  blockedCount: number
}

/** Parse robots.txt into { user-agent(lowercased) → disallow paths }. Groups are
 *  separated by blank lines / a new User-agent line; a group can name several
 *  agents. Comments (#) and unknown directives are ignored. */
function parseRobots(txt: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  let current: string[] = []
  let sawDirective = false
  const lines = txt.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const field = m[1].toLowerCase()
    const value = m[2].trim()
    if (field === 'user-agent') {
      // A User-agent after a directive starts a fresh group.
      if (sawDirective) { current = []; sawDirective = false }
      const ua = value.toLowerCase()
      current.push(ua)
      if (!map.has(ua)) map.set(ua, [])
    } else if (field === 'disallow' || field === 'allow') {
      sawDirective = true
      if (field === 'disallow' && current.length) {
        for (const ua of current) {
          const arr = map.get(ua) || []
          arr.push(value)
          map.set(ua, arr)
        }
      }
    }
  }
  return map
}

/** A bot is BLOCKED when its group (or the wildcard group it falls back to) has a
 *  Disallow that covers the site root ("/" or empty-with-root semantics). */
function isBlocked(map: Map<string, string[]>, token: string): boolean {
  const key = token.toLowerCase()
  const disallows = map.has(key) ? map.get(key)! : map.get('*')
  if (!disallows || !disallows.length) return false
  // "Disallow: /" blocks everything. An empty "Disallow:" explicitly allows all.
  return disallows.some(d => d === '/' )
}

export function analyzeRobots(txt: string | null): AiCrawlerReport {
  if (txt == null) {
    // No robots.txt = nothing is blocked.
    const crawlers = AI_CRAWLERS.map(c => ({ ...c, allowed: true }))
    return { robotsFound: false, crawlers, allowedCount: crawlers.length, blockedCount: 0 }
  }
  const map = parseRobots(txt)
  const crawlers: AiCrawlerCheck[] = AI_CRAWLERS.map(c => ({ ...c, allowed: !isBlocked(map, c.token) }))
  const blockedCount = crawlers.filter(c => !c.allowed).length
  return { robotsFound: true, crawlers, allowedCount: crawlers.length - blockedCount, blockedCount }
}

/** Fetch + analyze a site's robots.txt. Never throws — a fetch failure reads as
 *  "no robots.txt found" (nothing blocked), which is the safe, honest default. */
export async function checkAiCrawlers(siteUrl: string): Promise<AiCrawlerReport> {
  const base = siteUrl.replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/robots.txt`, { signal: AbortSignal.timeout(12_000), redirect: 'follow' })
    if (!res.ok) return analyzeRobots(null)
    const ct = res.headers.get('content-type') || ''
    // A themed 404 HTML page is not a robots.txt — treat as absent.
    if (/text\/html/i.test(ct)) return analyzeRobots(null)
    const txt = await res.text()
    if (/<html|<!doctype/i.test(txt.slice(0, 200))) return analyzeRobots(null)
    return analyzeRobots(txt)
  } catch {
    return analyzeRobots(null)
  }
}
