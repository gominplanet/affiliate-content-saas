/**
 * /admin/blog-quality — trend dashboard for the blog-writer audit-rule
 * violations the post-gen self-check pass catches.
 *
 * Reads blog_quality_checks rows (migration 091) and renders:
 *
 *   1. Headline KPIs — posts checked last 30d, avg violations/post,
 *      avg numbers/post, % of posts under the 3-number target.
 *
 *   2. Trend bars — leak rate and number-detection by week, so we can
 *      see whether prompt tightening passes actually shifted the
 *      catalogue's quality over time.
 *
 *   3. Top leaking patterns — which audit-rule violations slip past
 *      the writing-time prompt most often. Tells us where the next
 *      tightening pass should focus.
 *
 *   4. Most recent flagged posts — links + per-post drill-down so
 *      we can read what fired and decide if the flag was real.
 *
 * Admin-only — same gate as /admin/template-performance.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface QualityCheck {
  id: string
  user_id: string
  blog_post_id: string | null
  video_id: string | null
  violations_found: number
  fixes_applied: number
  numbers_detected: number
  violation_patterns: string[]
  created_at: string
}

interface PatternStat {
  pattern: string
  count: number
  share: number
}

interface WeekBucket {
  weekStart: string
  posts: number
  avgViolations: number
  avgNumbers: number
  underThreshold: number
}

interface DashboardData {
  totalPosts: number
  cleanPosts: number
  flaggedPosts: number
  avgViolations: number
  avgNumbers: number
  postsUnderThreshold: number
  topPatterns: PatternStat[]
  weeks: WeekBucket[]
  recentFlagged: Array<{
    id: string
    created_at: string
    violations_found: number
    fixes_applied: number
    numbers_detected: number
    violation_patterns: string[]
    blog_post_url: string | null
    blog_post_title: string | null
  }>
}

async function loadDashboardData(): Promise<DashboardData> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - 90 * 86400 * 1000).toISOString()

  // Pull last 90 days of checks. 90d is enough to see the trend
  // before/after the audit's 9-rule hardening shipped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (admin as any)
    .from('blog_quality_checks')
    .select('id,user_id,blog_post_id,video_id,violations_found,fixes_applied,numbers_detected,violation_patterns,created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000)

  const checks = (rows ?? []) as QualityCheck[]

  // ── Headline KPIs ────────────────────────────────────────────────────
  const totalPosts = checks.length
  const flaggedPosts = checks.filter(c => c.violations_found > 0).length
  const cleanPosts = totalPosts - flaggedPosts
  const avgViolations = totalPosts > 0
    ? checks.reduce((s, c) => s + c.violations_found, 0) / totalPosts
    : 0
  const avgNumbers = totalPosts > 0
    ? checks.reduce((s, c) => s + c.numbers_detected, 0) / totalPosts
    : 0
  const postsUnderThreshold = checks.filter(c => c.numbers_detected < 3).length

  // ── Top patterns ─────────────────────────────────────────────────────
  // Count each pattern occurrence across all violations.
  const patternCounts = new Map<string, number>()
  for (const c of checks) {
    for (const p of (c.violation_patterns ?? [])) {
      patternCounts.set(p, (patternCounts.get(p) ?? 0) + 1)
    }
  }
  const totalViolations = checks.reduce((s, c) => s + c.violations_found, 0)
  const topPatterns: PatternStat[] = Array.from(patternCounts.entries())
    .map(([pattern, count]) => ({
      pattern,
      count,
      share: totalViolations > 0 ? (count / totalViolations) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)

  // ── Weekly buckets ───────────────────────────────────────────────────
  // Roll up by ISO week start (Monday) so the trend chart smooths out
  // day-of-week noise (creators batch generations on weekends, etc.).
  const weekMap = new Map<string, { violations: number; numbers: number; posts: number; under: number }>()
  for (const c of checks) {
    const d = new Date(c.created_at)
    // Monday-anchored week start.
    const day = d.getUTCDay() // 0 = Sun, 1 = Mon, …
    const offset = day === 0 ? 6 : day - 1
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - offset)
    monday.setUTCHours(0, 0, 0, 0)
    const key = monday.toISOString().slice(0, 10)
    const bucket = weekMap.get(key) ?? { violations: 0, numbers: 0, posts: 0, under: 0 }
    bucket.violations += c.violations_found
    bucket.numbers += c.numbers_detected
    bucket.posts += 1
    if (c.numbers_detected < 3) bucket.under += 1
    weekMap.set(key, bucket)
  }
  const weeks: WeekBucket[] = Array.from(weekMap.entries())
    .map(([weekStart, b]) => ({
      weekStart,
      posts: b.posts,
      avgViolations: b.posts > 0 ? b.violations / b.posts : 0,
      avgNumbers: b.posts > 0 ? b.numbers / b.posts : 0,
      underThreshold: b.under,
    }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
    .slice(-12) // last 12 weeks

  // ── Recent flagged posts — join blog_posts for URL + title ───────────
  const recentFlaggedChecks = checks.filter(c => c.violations_found > 0).slice(0, 20)
  const blogPostIds = recentFlaggedChecks.map(c => c.blog_post_id).filter(Boolean) as string[]
  let postIndex: Record<string, { wordpress_url: string | null; title: string | null }> = {}
  if (blogPostIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: posts } = await (admin as any)
      .from('blog_posts')
      .select('id,wordpress_url,title')
      .in('id', blogPostIds)
    for (const p of (posts ?? []) as Array<{ id: string; wordpress_url: string | null; title: string | null }>) {
      postIndex[p.id] = { wordpress_url: p.wordpress_url, title: p.title }
    }
  }
  const recentFlagged = recentFlaggedChecks.map(c => {
    const post = c.blog_post_id ? postIndex[c.blog_post_id] : null
    return {
      id: c.id,
      created_at: c.created_at,
      violations_found: c.violations_found,
      fixes_applied: c.fixes_applied,
      numbers_detected: c.numbers_detected,
      violation_patterns: c.violation_patterns,
      blog_post_url: post?.wordpress_url ?? null,
      blog_post_title: post?.title ?? null,
    }
  })

  return {
    totalPosts,
    cleanPosts,
    flaggedPosts,
    avgViolations,
    avgNumbers,
    postsUnderThreshold,
    topPatterns,
    weeks,
    recentFlagged,
  }
}

export default async function BlogQualityPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: caller } = await supabase
    .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (caller?.tier !== 'admin') redirect('/dashboard')

  const d = await loadDashboardData()
  const cleanRate = d.totalPosts > 0 ? (d.cleanPosts / d.totalPosts) * 100 : 0
  const underThresholdRate = d.totalPosts > 0 ? (d.postsUnderThreshold / d.totalPosts) * 100 : 0
  // Max for the chart bars — scale all bars against the max so we can read
  // the relative trend even when absolute counts shift week to week.
  const maxAvgViolations = d.weeks.reduce((m, w) => Math.max(m, w.avgViolations), 0) || 1
  const maxAvgNumbers = d.weeks.reduce((m, w) => Math.max(m, w.avgNumbers), 0) || 1

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Blog Quality</h1>
        <p className="text-sm text-gray-500 mt-1">
          Post-generation self-check telemetry — last 90 days across <b>{d.totalPosts.toLocaleString()}</b> posts.
          Tracks the 9-item audit-rule hardening shipped June 2026.
        </p>
      </div>

      {d.totalPosts === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center bg-gray-50">
          <p className="text-sm text-gray-600 mb-2">No self-check telemetry yet.</p>
          <p className="text-xs text-gray-500">
            Generate a blog post (any user). The self-check pass writes to
            blog_quality_checks; rows appear here on the next refresh.
          </p>
        </div>
      ) : (
        <>
          {/* Headline KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Posts checked"
              value={d.totalPosts.toLocaleString()}
              sub={`${d.cleanPosts.toLocaleString()} clean · ${d.flaggedPosts.toLocaleString()} flagged`}
            />
            <KpiCard
              label="Clean rate"
              value={`${cleanRate.toFixed(0)}%`}
              sub="Posts with 0 violations"
              accent={cleanRate >= 80 ? 'green' : cleanRate >= 60 ? 'amber' : 'red'}
            />
            <KpiCard
              label="Avg violations / post"
              value={d.avgViolations.toFixed(2)}
              sub="Lower is better"
              accent={d.avgViolations <= 0.5 ? 'green' : d.avgViolations <= 1.5 ? 'amber' : 'red'}
            />
            <KpiCard
              label="Avg numbers / post"
              value={d.avgNumbers.toFixed(1)}
              sub={`Target ≥3 · ${underThresholdRate.toFixed(0)}% below`}
              accent={d.avgNumbers >= 3 ? 'green' : d.avgNumbers >= 2 ? 'amber' : 'red'}
            />
          </div>

          {/* Trend — last 12 weeks */}
          <div className="border rounded-xl p-5">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Weekly trend</h2>
              <span className="text-xs text-gray-400">Last {d.weeks.length} weeks</span>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs text-gray-500 mb-2">Avg violations / post</p>
                <div className="space-y-1.5">
                  {d.weeks.map(w => (
                    <div key={`v-${w.weekStart}`} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-14 flex-shrink-0 font-mono">{w.weekStart.slice(5)}</span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${maxAvgViolations > 0 ? (w.avgViolations / maxAvgViolations) * 100 : 0}%`,
                            background: w.avgViolations === 0 ? '#34c759' : w.avgViolations <= 1 ? '#FFC200' : '#ff3b30',
                          }}
                        />
                      </div>
                      <span className="text-xs text-gray-600 w-12 text-right font-mono">{w.avgViolations.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-2">Avg numbers / post · target ≥3</p>
                <div className="space-y-1.5">
                  {d.weeks.map(w => (
                    <div key={`n-${w.weekStart}`} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400 w-14 flex-shrink-0 font-mono">{w.weekStart.slice(5)}</span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${maxAvgNumbers > 0 ? (w.avgNumbers / maxAvgNumbers) * 100 : 0}%`,
                            background: w.avgNumbers >= 3 ? '#34c759' : w.avgNumbers >= 2 ? '#FFC200' : '#ff3b30',
                          }}
                        />
                      </div>
                      <span className="text-xs text-gray-600 w-12 text-right font-mono">{w.avgNumbers.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Top patterns */}
          <div className="border rounded-xl p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
              Top leaking patterns
            </h2>
            {d.topPatterns.length === 0 ? (
              <p className="text-sm text-gray-500">No patterns logged yet.</p>
            ) : (
              <div className="space-y-3">
                {d.topPatterns.map(p => {
                  const maxCount = d.topPatterns[0]?.count ?? 1
                  return (
                    <div key={p.pattern}>
                      <div className="flex items-baseline justify-between gap-3 mb-1">
                        <code className="text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{p.pattern}</code>
                        <div className="text-right shrink-0">
                          <span className="font-mono text-xs font-semibold">{p.count.toLocaleString()}</span>
                          <span className="text-[11px] text-gray-500 ml-1">· {p.share.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(p.count / maxCount) * 100}%`, background: '#7C3AED' }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-4">
              Bar shows count relative to the top pattern. % is share of all violations. The pattern
              at the top is where the next prompt-tightening pass should focus.
            </p>
          </div>

          {/* Recent flagged */}
          {d.recentFlagged.length > 0 && (
            <div className="border rounded-xl p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
                Recent flagged posts
              </h2>
              <ul className="divide-y">
                {d.recentFlagged.map(r => (
                  <li key={r.id} className="py-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {r.blog_post_url ? (
                          <Link href={r.blog_post_url} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">
                            {r.blog_post_title || r.blog_post_url}
                          </Link>
                        ) : (
                          <span className="text-gray-500 italic">(post link unavailable)</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {new Date(r.created_at).toLocaleDateString()} · {r.violations_found} flagged
                        {r.fixes_applied < r.violations_found && (
                          <span className="text-amber-600"> ({r.violations_found - r.fixes_applied} paraphrase-miss)</span>
                        )}
                        {' · '}
                        <span className={r.numbers_detected < 3 ? 'text-[#ff3b30]' : ''}>{r.numbers_detected} number{r.numbers_detected === 1 ? '' : 's'}</span>
                      </div>
                      {r.violation_patterns.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.violation_patterns.map((p, i) => (
                            <code key={i} className="text-[10px] bg-gray-100 dark:bg-white/5 text-gray-600 px-1.5 py-0.5 rounded">{p}</code>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
            <b>Reading this:</b> Clean rate climbing + avg violations dropping = the prompt
            tightening landed. Avg numbers ≥3 = posts are surfacing real product specs.
            Top-pattern list shows where the next prompt pass should focus. Paraphrase-miss
            ratio (in recent flagged) shows whether Haiku is returning verbatim originals
            we can string-replace, or paraphrasing in ways we can't auto-fix.
          </div>
        </>
      )}
    </div>
  )
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: 'green' | 'amber' | 'red' }) {
  const color = accent === 'green' ? '#34c759' : accent === 'amber' ? '#FFC200' : accent === 'red' ? '#ff3b30' : '#1d1d1f'
  return (
    <div className="border rounded-xl p-4 bg-white dark:bg-[#1c1c1e]">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold leading-tight" style={{ color }}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{sub}</p>
    </div>
  )
}
