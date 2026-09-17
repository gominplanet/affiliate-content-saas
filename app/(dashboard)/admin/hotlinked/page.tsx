// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /admin/hotlinked — published posts still pointing at our image server.
//
// The number that mattered most today could only be got by pasting SQL into
// Supabase by hand. /api/cron/rehost-hotlinked now repairs these unattended,
// every two hours, and its report goes to a Vercel log nobody reads. A repair
// whose only evidence is a log line is as invisible as the bug it fixes.
//
// So this is the screen that says whether it is working. Refresh it tomorrow:
// the total should be falling.
//
// THE NEWEST COLUMN IS THE ONE TO WATCH. The sweep drains the backlog. It
// cannot stop new ones arriving, because a new one means that creator's site
// refused an upload today. Oldest climbing while newest stays today is the
// leak, not the backlog, and it needs a different fix.
'use client'

import { useState, useEffect, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'

interface Owner {
  ownerId: string
  email: string | null
  posts: number
  liveOnSite: number
  oldest: string
  newest: string
}

interface Result {
  ok: boolean
  total?: number
  owners?: Owner[]
  headline?: string
  leakOpen?: boolean
  leakNote?: string
  error?: string
}

const day = (iso: string) => {
  try { return new Date(iso).toISOString().slice(0, 10) } catch { return iso }
}

export default function HotlinkedPage() {
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState<Result | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/hotlinked-posts')
      const json = await res.json().catch(() => null)
      setResult((json as Result) ?? { ok: false, error: 'The lookup could not run.' })
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'The lookup could not run.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <>
      <PageHero
        title="Hot-linked posts"
        subtitle="Published posts whose pictures still live on our image server rather than on the creator's own site."
      />

      <div className="card p-5 mb-6">
        <p className="text-[13px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
          When a site refuses a media upload the generator embeds the picture from where it was made, so the article
          still reads properly. Those pictures are not the creator&apos;s, and fal deletes expired files without
          recovery. The sweep runs every two hours and moves them across, oldest first.
        </p>
        <p className="text-[12px] text-[#86868b] mt-2 leading-relaxed">
          The total should fall between visits. A creator whose newest is today is still producing them, which the
          sweep cannot fix: their site is refusing uploads right now.
        </p>
        <button onClick={load} disabled={loading} className="btn-secondary text-xs inline-flex items-center gap-1.5 mt-4">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {loading ? 'Counting' : 'Refresh'}
        </button>
      </div>

      {result && !result.ok && (
        <div className="card p-5 mb-6" style={{ backgroundColor: '#ff3b3012' }}>
          <p className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">
            The count could not run, so this says nothing about how many are left.
          </p>
          {result.error && <p className="text-[11px] text-[#86868b] mt-1 font-mono break-all">{result.error}</p>}
        </div>
      )}

      {result?.ok && (
        <>
          <div
            className="card p-5 mb-6"
            style={{ backgroundColor: (result.total ?? 0) === 0 ? '#34c75912' : result.leakOpen ? '#ff3b3012' : '#f59e0b12' }}
          >
            <div className="flex items-start gap-2.5">
              {(result.total ?? 0) === 0
                ? <CheckCircle2 size={16} className="text-[#34c759] mt-0.5 flex-shrink-0" />
                : <AlertTriangle size={16} className={result.leakOpen ? 'text-[#ff3b30] mt-0.5 flex-shrink-0' : 'text-[#f59e0b] mt-0.5 flex-shrink-0'} />}
              <div>
                <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{result.headline}</p>
                {result.leakNote && (
                  <p className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0] mt-1 leading-relaxed">{result.leakNote}</p>
                )}
              </div>
            </div>
          </div>

          {(result.owners ?? []).length > 0 && (
            <div className="card p-5 mb-6 overflow-x-auto">
              <table className="w-full text-[12px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr className="text-left text-[#86868b]">
                    <th className="pb-2 pr-4 font-semibold">Creator</th>
                    <th className="pb-2 pr-4 font-semibold">Posts</th>
                    <th className="pb-2 pr-4 font-semibold">Live on site</th>
                    <th className="pb-2 pr-4 font-semibold">Oldest</th>
                    <th className="pb-2 font-semibold">Newest</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.owners ?? []).map(o => {
                    const recent = Date.now() - new Date(o.newest).getTime() < 2 * 24 * 3600 * 1000
                    return (
                      <tr key={o.ownerId} className="border-t border-gray-200 dark:border-white/5">
                        <td className="py-2 pr-4 text-[#1d1d1f] dark:text-[#f5f5f7]">
                          {o.email ?? <span className="font-mono text-[11px] text-[#86868b]">{o.ownerId.slice(0, 8)}</span>}
                        </td>
                        <td className="py-2 pr-4 font-semibold">{o.posts}</td>
                        <td className="py-2 pr-4">{o.liveOnSite}</td>
                        <td className="py-2 pr-4 text-[#86868b]">{day(o.oldest)}</td>
                        {/* A newest within two days is the leak, not the backlog. */}
                        <td className={`py-2 ${recent ? 'text-[#ff3b30] font-semibold' : 'text-[#86868b]'}`}>
                          {day(o.newest)}{recent ? ' (still arriving)' : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
