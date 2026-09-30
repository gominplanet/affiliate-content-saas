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
// EVERY PICTURE IN EVERY POST, checked in the background (lib/post-logo-sweep)
// and listed here as it goes, with a button that replaces a post's pictures.
// The button's result is said per post: replaced, or why not.
//
// WHAT IT CANNOT SEE, said on the page and not only in the response. Generated
// YouTube thumbnails are handed to the creator and uploaded by them; MVP keeps
// no copy, so there is nothing to enumerate. A creator who reads "no store
// logos" here has learned that about their BLOG. Letting them read it as
// "my channel is clear" would be worse than not offering the check.
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import SeoHubTabs from '@/components/seo/SeoHubTabs'
import { Loader2, AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, ScanSearch, RefreshCw } from 'lucide-react'

interface Finding {
  postId: string
  title: string
  url: string
  postUrl: string | null
  wordpressPostId: number | null
  verdict: 'found' | 'unreadable'
  marks: string[]
  reason?: string
}

interface Stored {
  ok: boolean
  covers?: string
  results?: Finding[]
  checkedPosts?: number
  waitingPosts?: number
  error?: string
}

interface RunResult extends Stored {
  headline?: string
  found?: number
  unreadable?: number
  postsExamined?: number
  imagesChecked?: number
  moreLikely?: boolean
}

type Redo = { state: 'working' } | { state: 'done'; text: string } | { state: 'failed'; text: string }

export default function LogoCheckPage() {
  const [stored, setStored] = useState<Stored | null>(null)
  const [running, setRunning] = useState(false)
  const [run, setRun] = useState<RunResult | null>(null)
  const [redo, setRedo] = useState<Record<string, Redo>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/thumbnails/logo-scan', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      setStored((json as Stored) ?? { ok: false, error: 'The list could not be loaded.' })
    } catch (e) {
      setStored({ ok: false, error: e instanceof Error ? e.message : 'The list could not be loaded.' })
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function checkNow(limit: number) {
    setRunning(true)
    setRun(null)
    try {
      const res = await fetch('/api/thumbnails/logo-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit }),
      })
      const json = await res.json().catch(() => null) as RunResult | null
      setRun(json ?? { ok: false, error: 'The check could not run.' })
      if (json?.ok) setStored(json)
    } catch (e) {
      setRun({ ok: false, error: e instanceof Error ? e.message : 'The check could not run.' })
    } finally {
      setRunning(false)
    }
  }

  // Replaces every picture in the post (Library's "Add images" route), then
  // the post is looked at again. What the screen says is what the route did.
  async function replace(postId: string, wordpressPostId: number) {
    setRedo(r => ({ ...r, [postId]: { state: 'working' } }))
    try {
      const res = await fetch('/api/blog/refresh-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wordpressPostId }),
      })
      const j = await res.json().catch(() => ({})) as { error?: string; count?: number }
      if (!res.ok) {
        setRedo(r => ({ ...r, [postId]: { state: 'failed', text: j.error || `Not replaced (${res.status}).` } }))
        return
      }
      const n = typeof j.count === 'number' ? j.count : 0
      setRedo(r => ({ ...r, [postId]: n > 0
        ? { state: 'done', text: `Replaced with ${n} new picture${n === 1 ? '' : 's'}. It will be checked again shortly.` }
        : { state: 'failed', text: 'The old pictures were removed but no new ones could be made. The post has no pictures now.' } }))
    } catch (e) {
      setRedo(r => ({ ...r, [postId]: { state: 'failed', text: e instanceof Error ? e.message : 'Not replaced.' } }))
    }
  }

  const byPost = useMemo(() => {
    const m = new Map<string, { title: string; postUrl: string | null; wordpressPostId: number | null; found: Finding[]; unreadable: Finding[] }>()
    for (const f of stored?.results ?? []) {
      const g = m.get(f.postId) ?? { title: f.title, postUrl: f.postUrl, wordpressPostId: f.wordpressPostId, found: [], unreadable: [] }
      if (f.verdict === 'found') g.found.push(f); else g.unreadable.push(f)
      m.set(f.postId, g)
    }
    return [...m.entries()]
  }, [stored])
  const withLogos = byPost.filter(([, g]) => g.found.length > 0)
  const unchecked = byPost.filter(([, g]) => g.found.length === 0 && g.unreadable.length > 0)
  const checked = stored?.checkedPosts ?? 0
  const waiting = stored?.waitingPosts ?? 0

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
          still on your site, and MVP is looking through every picture in every post, a few at a time.
        </p>
        <p className="text-[12px] text-[#86868b] mt-2 leading-relaxed">
          It reads the pictures on your published posts. It cannot see thumbnails you uploaded to YouTube yourself,
          because MVP does not keep a copy of those, so a clean result here is about your blog rather than your channel.
        </p>
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <button onClick={() => checkNow(10)} disabled={running} className="btn-primary text-xs inline-flex items-center gap-1.5">
            {running ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />}
            {running ? 'Checking' : 'Check 10 posts now'}
          </button>
          <button onClick={() => checkNow(25)} disabled={running} className="btn-secondary text-xs">
            Check 25
          </button>
        </div>
      </div>

      {stored && !stored.ok && (
        <div className="card p-5 mb-6" style={{ backgroundColor: '#ff3b3012' }}>
          <p className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">
            The results could not be loaded, so this says nothing about your pictures either way.
          </p>
          {stored.error && <p className="text-[11px] text-[#86868b] mt-1 font-mono break-all">{stored.error}</p>}
        </div>
      )}

      {run && !run.ok && (
        <div className="card p-5 mb-6" style={{ backgroundColor: '#ff3b3012' }}>
          <p className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">
            The check could not run, so this says nothing about your pictures either way.
          </p>
          {run.error && <p className="text-[11px] text-[#86868b] mt-1 font-mono break-all">{run.error}</p>}
        </div>
      )}

      {run?.ok && (
        <div className="card p-4 mb-6">
          <p className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">{run.headline}</p>
          <p className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0] mt-1">
            Just now: {run.imagesChecked ?? 0} picture{run.imagesChecked === 1 ? '' : 's'} in {run.postsExamined ?? 0} post{run.postsExamined === 1 ? '' : 's'}.
          </p>
        </div>
      )}

      {stored?.ok && (
        <div
          className="card p-5 mb-6"
          style={{ backgroundColor: withLogos.length > 0 ? '#ff3b3012' : unchecked.length > 0 || waiting > 0 ? '#f59e0b12' : '#34c75912' }}
        >
          <div className="flex items-start gap-2.5">
            {withLogos.length > 0
              ? <AlertTriangle size={16} className="text-[#ff3b30] mt-0.5 flex-shrink-0" />
              : unchecked.length > 0 || waiting > 0
                ? <HelpCircle size={16} className="text-[#f59e0b] mt-0.5 flex-shrink-0" />
                : <CheckCircle2 size={16} className="text-[#34c759] mt-0.5 flex-shrink-0" />}
            <div>
              <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                {withLogos.length > 0
                  ? `${withLogos.length} post${withLogos.length === 1 ? ' has' : 's have'} a picture with a store's logo.`
                  : checked === 0
                    ? 'None of your posts has been checked yet.'
                    : waiting > 0
                      ? `No store logos in the ${checked} post${checked === 1 ? '' : 's'} checked so far.`
                      : `All ${checked} post${checked === 1 ? '' : 's'} checked. No store logos.`}
              </p>
              <p className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0] mt-1">
                {checked} checked, {waiting} still to check{waiting > 0 ? ' (MVP carries on in the background; come back later or press Check now)' : ''}.
                {unchecked.length > 0 ? ` ${unchecked.length} post${unchecked.length === 1 ? ' has' : 's have'} pictures that could not be opened, listed below.` : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {withLogos.length > 0 && (
        <div className="card p-5 mb-6">
          <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">
            Posts to fix
          </h3>
          <ul className="flex flex-col gap-3">
            {withLogos.map(([postId, g]) => {
              const r = redo[postId]
              return (
                <li key={postId} className="flex items-start gap-3 py-2 border-b border-gray-200 dark:border-white/5 last:border-0">
                  <div className="flex gap-1 flex-shrink-0">
                    {g.found.slice(0, 3).map(f => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={f.url} src={f.url} alt="" className="w-16 h-10 object-cover rounded bg-black/5" />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">{g.title || 'Untitled post'}</p>
                    <p className="text-[12px] text-[#ff3b30] mt-0.5">
                      {g.found.length} picture{g.found.length === 1 ? '' : 's'}: {[...new Set(g.found.flatMap(f => f.marks))].join(', ') || 'a retailer mark'}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {g.wordpressPostId && (
                        <button
                          onClick={() => replace(postId, g.wordpressPostId as number)}
                          disabled={r?.state === 'working' || r?.state === 'done'}
                          className="btn-secondary text-[11px] inline-flex items-center gap-1"
                        >
                          {r?.state === 'working' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                          {r?.state === 'working' ? 'Replacing' : 'Replace the pictures'}
                        </button>
                      )}
                      {g.postUrl && (
                        <a href={g.postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[#7C3AED] font-semibold">
                          Open the post <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                    {r && r.state !== 'working' && (
                      <p className={`text-[11px] mt-1 ${r.state === 'done' ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{r.text}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="text-[11px] text-[#86868b] mt-3">
            Replace the pictures makes new ones for every picture in the article from the product&apos;s real photo, and removes
            any Amazon site graphic. The post&apos;s featured image is not changed here.
          </p>
        </div>
      )}

      {/* Its own section, never folded into the clean count. An image we
          could not open is unchecked, and showing it as a pass is how
          somebody concludes their back catalogue is clear when part of it
          was never looked at. */}
      {unchecked.length > 0 && (
        <div className="card p-5 mb-6">
          <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">
            Not checked
          </h3>
          <p className="text-[12px] text-[#6e6e73] dark:text-[#ebebf0] mb-3">
            These pictures could not be opened, so nothing is known about them either way.
          </p>
          <ul className="flex flex-col gap-1.5">
            {unchecked.map(([postId, g]) => (
              <li key={postId} className="text-[12px] text-[#86868b]">
                <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">{g.title || 'Untitled post'}</span>
                {g.unreadable[0]?.reason ? `: ${g.unreadable[0].reason}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
