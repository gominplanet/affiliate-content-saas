// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /tools/logo-check — find published pictures carrying a retailer's logo.
//
// A creator generated a thumbnail, got an Amazon logo rendered into it, and
// pulled his video down. The prompt that caused it is fixed, so pictures made
// from now on are clean. Everything made before it is still published, and
// nothing anywhere could say which.
//
// That is not a cosmetic worry. The Associates Operating Agreement governs
// where an associate may put Amazon's marks, and a picture MVP generated is a
// mark MVP put there on somebody's behalf. The creator is the one carrying it.
//
// WHAT IT CANNOT SEE, said on the page and not only in the response. Generated
// YouTube thumbnails are handed to the creator and uploaded by them; MVP keeps
// no copy, so there is nothing to enumerate. A creator who reads "no store
// logos" here has learned that about their BLOG. Letting them read it as
// "my channel is clear" would be worse than not offering the check.
'use client'

import { useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import SeoHubTabs from '@/components/seo/SeoHubTabs'
import { Loader2, AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, ScanSearch } from 'lucide-react'

interface Finding {
  postId: string
  title: string
  url: string
  postUrl: string | null
  verdict: 'found' | 'unreadable' | 'clean'
  marks: string[]
  reason?: string
}

interface ScanResult {
  ok: boolean
  headline?: string
  covers?: string
  found?: number
  clean?: number
  unreadable?: number
  postsExamined?: number
  imagesChecked?: number
  results?: Finding[]
  moreLikely?: boolean
  error?: string
}

export default function LogoCheckPage() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ScanResult | null>(null)

  async function run(limit: number) {
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch('/api/thumbnails/logo-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
      })
      const json = await res.json().catch(() => null)
      setResult((json as ScanResult) ?? { ok: false, error: 'The check could not run.' })
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'The check could not run.' })
    } finally {
      setRunning(false)
    }
  }

  const findings = (result?.results ?? []).filter(r => r.verdict === 'found')
  const unreadable = (result?.results ?? []).filter(r => r.verdict === 'unreadable')

  return (
    <>
      <PageHero
        title="Logo check"
        subtitle="Find published pictures carrying a store's logo, so you can replace them before anyone else notices."
      />
      <SeoHubTabs />

      <div className="card p-5 mb-6">
        <p className="text-[13px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
          Amazon and the other retailers set rules about where an affiliate may show their logo, and a picture with
          one on it can put your account at risk. MVP no longer draws them. Anything made before that changed is
          still on your site, and this looks through it.
        </p>
        <p className="text-[12px] text-[#86868b] mt-2 leading-relaxed">
          It reads the pictures on your published posts. It cannot see thumbnails you uploaded to YouTube yourself,
          because MVP does not keep a copy of those, so a clean result here is about your blog rather than your channel.
        </p>
        <div className="flex items-center gap-2 mt-4">
          <button onClick={() => run(20)} disabled={running} className="btn-primary text-xs inline-flex items-center gap-1.5">
            {running ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />}
            {running ? 'Checking' : 'Check my recent posts'}
          </button>
          <button onClick={() => run(40)} disabled={running} className="btn-secondary text-xs">
            Check more
          </button>
        </div>
      </div>

      {result && !result.ok && (
        <div className="card p-5 mb-6" style={{ backgroundColor: '#ff3b3012' }}>
          <p className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">
            The check could not run, so this says nothing about your pictures either way.
          </p>
          {result.error && <p className="text-[11px] text-[#86868b] mt-1 font-mono break-all">{result.error}</p>}
        </div>
      )}

      {result?.ok && (
        <>
          <div
            className="card p-5 mb-6"
            style={{ backgroundColor: (result.found ?? 0) > 0 ? '#ff3b3012' : (result.unreadable ?? 0) > 0 ? '#f59e0b12' : '#34c75912' }}
          >
            <div className="flex items-start gap-2.5">
              {(result.found ?? 0) > 0
                ? <AlertTriangle size={16} className="text-[#ff3b30] mt-0.5 flex-shrink-0" />
                : (result.unreadable ?? 0) > 0
                  ? <HelpCircle size={16} className="text-[#f59e0b] mt-0.5 flex-shrink-0" />
                  : <CheckCircle2 size={16} className="text-[#34c759] mt-0.5 flex-shrink-0" />}
              <div>
                <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{result.headline}</p>
                <p className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0] mt-1">
                  Looked at {result.imagesChecked ?? 0} picture{result.imagesChecked === 1 ? '' : 's'} across{' '}
                  {result.postsExamined ?? 0} post{result.postsExamined === 1 ? '' : 's'}.
                  {result.moreLikely ? ' There are older posts this did not reach; press Check more to carry on.' : ''}
                </p>
              </div>
            </div>
          </div>

          {findings.length > 0 && (
            <div className="card p-5 mb-6">
              <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">
                Pictures to replace
              </h3>
              <ul className="flex flex-col gap-3">
                {findings.map(f => (
                  <li key={f.postId} className="flex items-start gap-3 py-2 border-b border-gray-200 dark:border-white/5 last:border-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt="" className="w-20 h-12 object-cover rounded flex-shrink-0 bg-black/5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">{f.title || 'Untitled post'}</p>
                      <p className="text-[12px] text-[#ff3b30] mt-0.5">
                        {f.marks.length ? f.marks.join(', ') : 'a retailer mark'}
                      </p>
                      {f.postUrl && (
                        <a
                          href={f.postUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-[#7C3AED] font-semibold mt-1"
                        >
                          Open the post <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-[#86868b] mt-3">
                Regenerate the picture on each of these from the post row, and the new one will be clean.
              </p>
            </div>
          )}

          {/* Its own section, never folded into the clean count. An image we
              could not open is unchecked, and showing it as a pass is how
              somebody concludes their back catalogue is clear when part of it
              was never looked at. */}
          {unreadable.length > 0 && (
            <div className="card p-5 mb-6">
              <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
                Not checked
              </h3>
              <p className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0] mb-3">
                These could not be opened, so nothing is known about them either way.
              </p>
              <ul className="flex flex-col gap-1.5">
                {unreadable.map(f => (
                  <li key={f.postId} className="text-[12px] text-[#86868b]">
                    <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">{f.title || 'Untitled post'}</span>
                    {f.reason ? ` — ${f.reason}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  )
}
