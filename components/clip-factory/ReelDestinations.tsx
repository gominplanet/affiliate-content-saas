'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Where a Clip Factory Reel goes. The Page is named before posting (and can be
// picked when there are several). After it is up, it can be shared into the
// creator's Facebook Groups with SCOUT: Meta lets no app post into a Group, so
// SCOUT opens the Group and fills the post (the Reel's link first, so Facebook
// shows the playable Reel), and the creator presses Post.
import { useEffect, useRef, useState } from 'react'
import { isFacebookGroupLink, isFacebookGroupPostLink, isFacebookReelLink } from '@/lib/facebook-group-link'
import { pageReelCaption } from '@/lib/reel-group-caption'
import { pickNicheGroup } from '@/lib/facebook-niche'
export { pageReelCaption }
import { Loader2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import type { FacebookGroupPostStatus } from '@/lib/extension-frame'

export type ReelPage = { id: string; name: string; isDefault: boolean }
export type ReelGroup = { name: string; url: string; niche?: string | null; keywords?: string | null }

export function ReelPagePicker(p: { pages: ReelPage[] | null; value: string; onChange: (id: string) => void; error?: string | null }) {
  if (p.error) return <p className="text-[12px] text-[#ff3b30]">Your Facebook Pages could not be loaded: {p.error}</p>
  if (!p.pages) return <p className="text-[12px] text-[#86868b] inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Finding your Facebook Page…</p>
  if (!p.pages.length) return <p className="text-[12px] text-[#ff3b30]">No Facebook Page is connected, so the Reel has nowhere to go. Connect one under Connect Socials.</p>
  if (p.pages.length === 1) return <p className="text-[12.5px] text-[#1d1d1f] dark:text-[#f5f5f7]">Posts as a Reel on your Page <b>{p.pages[0].name}</b>.</p>
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-[#1d1d1f] dark:text-[#f5f5f7] flex-wrap">
      Posts as a Reel on
      <select id="reel-page" value={p.value} onChange={(e) => p.onChange(e.target.value)}
        className="rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1 text-[12.5px]">
        {p.pages.map((pg) => <option key={pg.id} value={pg.id}>{pg.name}{pg.isDefault ? ' (default)' : ''}</option>)}
      </select>
    </label>
  )
}

type FillState = { state: 'working' } | { state: 'done'; filled: boolean; message: string }

export function ShareReelToGroups(p: { reelUrl: string; text: string; groups: ReelGroup[] | null }) {
  // The Reel's own link goes first: Facebook builds the post's card from the
  // first link, and this one plays the Reel right in the Group.
  const post = [p.reelUrl, p.text.trim()].filter(Boolean).join('\n\n')
  const [fill, setFill] = useState<Record<number, FillState>>({})

  async function share(i: number, g: ReelGroup) {
    try { await navigator.clipboard.writeText(post) } catch { /* the message still says what to do */ }
    setFill((m) => ({ ...m, [i]: { state: 'working' } }))
    const { requestFacebookGroupPrefill } = await import('@/lib/extension-frame')
    const res = await requestFacebookGroupPrefill(g.url, post, null)
    setFill((m) => ({
      ...m,
      [i]: res.filled
        ? { state: 'done', filled: true, message: `SCOUT filled the post in ${g.name}. Check it in the Facebook tab and press Post.` }
        : { state: 'done', filled: false, message: res.error || 'SCOUT could not fill it. The post is copied: paste it in the Group yourself.' },
    }))
  }

  return (
    <div className="rounded-xl border border-[#1877F2]/30 bg-[#1877F2]/[0.04] p-3 flex flex-col gap-2">
      <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Share this Reel to your Groups</p>
      <p className="text-[12px] text-[#6e6e73] dark:text-[#b0b0b5] leading-snug">
        Facebook lets no app post into a Group, so SCOUT opens the Group and fills the post: the Reel&apos;s link first (it shows as the playable Reel), then your text. You press Post.
      </p>
      {p.groups === null && <p className="text-[12px] text-[#86868b]"><Loader2 size={12} className="inline animate-spin" /> Loading your Groups…</p>}
      {p.groups && p.groups.length === 0 && (
        <p className="text-[12px] text-[#86868b]">No Groups saved yet. Add them in <a href="/brand" className="text-[#7C3AED] hover:underline">Brand Profile</a> under Facebook Groups.</p>
      )}
      {p.groups && p.groups.map((g, i) => {
        const f = fill[i]
        return (
          <div key={g.url} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12.5px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] min-w-0 truncate">{g.name}</span>
              <button onClick={() => share(i, g)} disabled={f?.state === 'working'}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white bg-[#1877F2] disabled:opacity-60">
                {f?.state === 'working' ? <><Loader2 size={12} className="animate-spin" /> SCOUT is filling it…</> : 'Fill with SCOUT'}
              </button>
            </div>
            {f?.state === 'done' && <p className={`text-[12px] ${f.filled ? 'text-[#10B981]' : 'text-[#ff9500]'}`}>{f.message}</p>}
          </div>
        )
      })}
      <button onClick={() => navigator.clipboard.writeText(post).then(() => toast.success('Group post copied'), () => toast.error('Copy failed'))}
        className="self-start inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1877F2] hover:underline">
        <Copy size={12} /> Copy the Group post instead
      </button>
    </div>
  )
}

// ── GROUP FIRST, THEN THE PAGE (Labs facebook_setup) ───────────────────────
//
// A Reel's caption link does not sell: on a limited Page it cannot be tapped,
// and Michelle's cream Reel had 259 views and 0 clicks. So the clip goes into
// the creator's Group first, with the affiliate link right under the video,
// and the Page Reel links to THAT Group post: a Facebook link, which Meta
// never counts as an outside link. A viewer taps once and lands on the post
// with the product link, not on a Group to search through.
//
// One click: SCOUT opens the Group, attaches the clip and writes the post;
// the creator presses Post; SCOUT reads the new post's address; MVP posts the
// Reel on the Page with "Get it here 👉 <that post>" as its first line (only
// the first lines of a Reel caption show on a phone). Every way this can stop
// is said in words, and the Reel never goes out linking to a guess.


type FlowLine = { tone: 'wait' | 'ok' | 'warn' | 'bad'; text: string }

export function ReelGroupFirst(p: {
  groups: ReelGroup[]
  clipUrl: string | null
  pageId: string
  pageName: string | null
  defaultCaption: string
  /** Set by the publish panel's button: the Group post's text, and when. */
  start: { text: string; at: number } | null
  onBusy: (busy: boolean) => void
  onReelPosted: (url: string | null, description: string) => void
  /** For the Facebook hub's record: the clip's source video and title. */
  sourceVideoId?: string | null
  clipTitle?: string | null
  /** The clip's length: over 90 seconds Facebook takes no Reel, so it goes on
   *  the Page as a video post instead. */
  clipSeconds?: number | null
}) {
  // THE MATCHING NICHE GROUP first: the kitchen clip goes to the Kitchen
  // Group, by the words saved with each Group. Changeable below.
  const [groupIdx, setGroupIdx] = useState(() => pickNicheGroup(p.groups, `${p.clipTitle ?? ''} ${p.defaultCaption}`))
  const [caption, setCaption] = useState(p.defaultCaption)
  const [lines, setLines] = useState<FlowLine[]>([])
  const [manual, setManual] = useState<{ link: string } | null>(null)
  const [retry, setRetry] = useState<string | null>(null)
  const mounted = useRef(true)
  const lastStart = useRef<number | null>(null)
  // ONE PAGE POST. The creator can go on by hand while SCOUT still watches;
  // whichever comes first posts, and the watch stops.
  const pageStarted = useRef(false)
  // THE PAGE REEL POSTS ITSELF (SCOUT 1.50.0, migration 435): the server job
  // that posts the Reel once SCOUT sees the Group post. Set, every way of
  // posting the Reel from this page goes through it, so it posts once.
  const jobRef = useRef<string | null>(null)
  // WHAT FACEBOOK SENT (SCOUT 1.46.4+): the watch's request log, for support.
  const [watchId, setWatchId] = useState<string | null>(null)
  const [watchSeen, setWatchSeen] = useState<FacebookGroupPostStatus | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [copyFallback, setCopyFallback] = useState<string | null>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (!caption && p.defaultCaption) setCaption(p.defaultCaption) }, [p.defaultCaption, caption])

  const group = p.groups[Math.min(groupIdx, p.groups.length - 1)]
  const say = (l: FlowLine) => { if (mounted.current) setLines((xs) => [...xs, l]) }
  // One line that keeps moving (a running clock and Facebook's own step), so
  // a slow Facebook never looks like a frozen page.
  const sayLive = (l: FlowLine) => { if (mounted.current) setLines((xs) => (xs.length && (xs[xs.length - 1] as FlowLine & { live?: boolean }).live ? [...xs.slice(0, -1), { ...l, live: true } as FlowLine] : [...xs, { ...l, live: true } as FlowLine])) }
  const clock = (ms: number) => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` }
  const longClip = (p.clipSeconds ?? 0) > 90

  // The Facebook hub's record of what went where. Best effort.
  function record(groupPostUrl: string, pagePostUrl: string | null) {
    void fetch('/api/facebook/hub', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'clip', sourceId: p.clipUrl, videoId: p.sourceVideoId ?? null, title: p.clipTitle ?? null, groupUrl: group?.url ?? null, groupPostUrl, pagePostUrl }),
    }).catch(() => {})
  }

  // The creator's own link (or the Group) for a Reel job: MVP's server posts it.
  async function jobManual(link: string, how: 'post' | 'group') {
    const id = jobRef.current
    if (!id) return
    setRetry(null); setManual(null)
    const what = longClip ? 'video' : 'Reel'
    say({ tone: 'wait', text: `Sending the ${what} to ${p.pageName || 'your Page'}, linking to ${how === 'post' ? 'your Group post' : 'your Group'}…` })
    p.onBusy(true)
    try {
      const r = await fetch('/api/clip-factory/reel-job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'manual', id, how, link }), signal: AbortSignal.timeout(290_000) })
      const j = await r.json().catch(() => ({})) as { ok?: boolean; already?: boolean; status?: string; error?: string; pageUrl?: string | null }
      if (j.ok) {
        say({ tone: 'ok', text: j.already ? `MVP had already posted the ${what} on ${p.pageName || 'your Page'}.` : `Done. Facebook took the ${what}: it appears on ${p.pageName || 'your Page'} once processed, linking to ${how === 'post' ? 'your Group post' : 'your Group'}.` })
        p.onReelPosted(j.pageUrl ?? null, caption)
      } else {
        say({ tone: 'bad', text: `Your Group post is up, but the ${what} did not go out: ${j.error || `MVP did not get an answer (${r.status}).`}` })
        setRetry(link)
      }
    } catch {
      say({ tone: 'bad', text: `Facebook took too long to answer. Check ${p.pageName || 'your Page'} before trying again: it may still appear.` })
      setRetry(link)
    } finally { p.onBusy(false) }
  }

  // Ask MVP's server to keep the Reel as a job and hand SCOUT its key. Null
  // when this cannot run in the background (an older SCOUT, migration 435 not
  // in yet): the page then posts the Reel itself, as before.
  async function startReelJob(watch: string): Promise<string | null> {
    try {
      const r = await fetch('/api/clip-factory/reel-job', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', clipUrl: p.clipUrl, caption, clipSeconds: p.clipSeconds ?? undefined, socialAccountId: p.pageId || undefined, sourceVideoId: p.sourceVideoId ?? undefined, title: p.clipTitle ?? undefined, groupUrl: group?.url }),
      })
      const j = await r.json().catch(() => ({})) as { ok?: boolean; id?: string; token?: string }
      if (!j.ok || !j.id || !j.token) return null
      const { requestFacebookReelJob } = await import('@/lib/extension-frame')
      const h = await requestFacebookReelJob(watch, { id: j.id, token: j.token })
      if (h.state !== 'handed') {
        void fetch('/api/clip-factory/reel-job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', id: j.id }) }).catch(() => {})
        return null
      }
      return j.id
    } catch { return null }
  }

  // While this page is open it shows where the job stands; closed, the job
  // carries on without it.
  async function followJob(id: string) {
    const what = longClip ? 'video' : 'Reel'
    const end = Date.now() + 4 * 3600_000
    let last = ''
    while (mounted.current && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 5000))
      type JobRow = { status?: string; note?: string | null; page_post_url?: string | null; group_post_url?: string | null }
      let job: JobRow | null = null
      try {
        const r = await fetch('/api/clip-factory/reel-job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', id }) })
        job = ((await r.json().catch(() => ({}))) as { job?: JobRow }).job ?? null
      } catch { continue }
      if (!job?.status || job.status === last) continue
      last = job.status
      if (job.status === 'waiting') continue
      if (job.status === 'posting') { sayLive({ tone: 'wait', text: `Your Group post is up. MVP is posting the ${what} on ${p.pageName || 'your Page'}…` }); continue }
      if (job.status === 'posted') {
        say({ tone: 'ok', text: `Done. MVP posted the ${what} on ${p.pageName || 'your Page'}, linking to ${job.note ? 'your Group' : 'your Group post'}. It appears once Facebook has processed it.` })
        setManual(null)
        p.onReelPosted(job.page_post_url ?? null, caption)
        return
      }
      if (job.status === 'cancelled') return
      say({ tone: job.status === 'failed' ? 'bad' : 'warn', text: job.note || `The ${what} was not posted.` })
      setManual({ link: '' })
      if (job.status === 'failed' && job.group_post_url) setRetry(job.group_post_url)
      return
    }
  }

  async function postReel(link: string, how: 'post' | 'group', isRetry = false) {
    if (jobRef.current) { await jobManual(link, how); return }
    if (pageStarted.current && !isRetry) return
    pageStarted.current = true
    setRetry(null)
    setManual(null)
    const description = [`Get it here 👉 ${link}`, caption.trim()].filter(Boolean).join('\n\n')
    const what = longClip ? 'video' : 'Reel'
    const where = how === 'post' ? 'your Group post' : 'your Group'
    if (longClip) say({ tone: 'warn', text: `This clip is ${clock((p.clipSeconds ?? 0) * 1000)} long. Facebook only takes Page Reels up to 1:30, so it goes on ${p.pageName || 'your Page'} as a video post, with the same first line.` })
    say({ tone: 'wait', text: `Sending the ${what} to ${p.pageName || 'your Page'}, linking to ${where}…` })
    p.onBusy(true)
    const began = Date.now()
    try {
      const res = await fetch('/api/clip-factory/facebook-reel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Answer as soon as Facebook takes it; this page watches the rest.
        body: JSON.stringify({ videoUrl: p.clipUrl, description, wait: false, clipSeconds: p.clipSeconds ?? undefined, ...(p.pageId ? { socialAccountId: p.pageId } : {}) }),
        signal: AbortSignal.timeout(290_000),
      })
      const data = await res.json().catch(() => ({ error: res.status === 504 ? `Facebook took too long to take the ${what}. Check ${p.pageName || 'your Page'} before trying again, it may still appear.` : `MVP did not get an answer (${res.status}).` }))
      if (!res.ok || !data.ok) throw new Error(data.error || `Facebook did not post the ${what}.`)
      // WATCHED UNTIL IT IS LIVE, or Facebook says why not, or ten minutes.
      let state: string = data.state
      let failed: string | null = null
      while (state === 'processing' && data.videoId && mounted.current && Date.now() - began < 10 * 60_000) {
        sayLive({ tone: 'wait', text: `Facebook has the ${what} and is working on it (${clock(Date.now() - began)}).` })
        await new Promise((r) => setTimeout(r, 5000))
        try {
          const c = await fetch('/api/clip-factory/facebook-reel', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkVideoId: data.videoId, ...(p.pageId ? { socialAccountId: p.pageId } : {}) }),
            signal: AbortSignal.timeout(30_000),
          })
          const cj = await c.json().catch(() => ({}))
          if (cj.state === 'published') state = 'published'
          else if (cj.state === 'failed') { state = 'failed'; failed = cj.error || 'Facebook could not process it.' }
          else if (cj.phase) sayLive({ tone: 'wait', text: `Facebook is ${cj.phase} (${clock(Date.now() - began)}).` })
        } catch { /* read again */ }
      }
      if (failed) throw new Error(failed)
      say({ tone: 'ok', text: state === 'published'
        ? `Done. The ${what} is live on ${data.page || 'your Page'}, and its first line links to ${where}.`
        : `Facebook took the ${what} and is still processing it after ${clock(Date.now() - began)}. It appears on ${data.page || 'your Page'} once done, linking to ${where}.` })
      p.onReelPosted(data.url || null, String(data.description || description))
      record(link, data.url || null)
    } catch (e) {
      // THE GROUP POST IS UP, THE REEL IS NOT: said as exactly that.
      const msg = e instanceof Error ? (/timed? ?out|abort/i.test(e.message) ? `Facebook took too long to answer. Check ${p.pageName || 'your Page'} before trying again: it may still appear.` : e.message) : 'Facebook refused it.'
      say({ tone: 'bad', text: `Your Group post is up, but the ${what} did not go out: ${msg}` })
      setRetry(link)
      record(link, null)
    } finally { p.onBusy(false) }
  }

  async function run(text: string) {
    if (!group || !p.clipUrl) return
    setLines([]); setManual(null); setRetry(null); pageStarted.current = false
    setWatchId(null); setWatchSeen(null); setCopied(null); setCopyFallback(null)
    try { await navigator.clipboard.writeText(text) } catch { /* the lines below say what to do */ }
    say({ tone: 'wait', text: `SCOUT is opening ${group.name || 'your Group'} and attaching the clip…` })
    p.onBusy(true)
    const { requestFacebookGroupPrefill, getFacebookGroupPostStatus } = await import('@/lib/extension-frame')
    const res = await requestFacebookGroupPrefill(group.url, text, { kind: 'clip', url: p.clipUrl })
    p.onBusy(false)
    if (!res.filled) { say({ tone: 'bad', text: res.error || 'SCOUT could not fill the Group post. The text is copied: paste it in the Group yourself.' }); return }
    say({ tone: res.clipAttached === false ? 'warn' : 'ok', text: `The post is ready in ${group.name || 'your Group'} in the Facebook tab. ${res.media || 'Press Post there.'}`.replace(/\s+/g, ' ').trim() })
    if (!res.canWatch || !res.watchId) {
      say({ tone: 'warn', text: 'Your SCOUT cannot see the post go up. After you press Post, paste the Group post\'s link below (click its time stamp and copy the address).' })
      setManual({ link: '' })
      return
    }
    setWatchId(res.watchId)
    // IN THE BACKGROUND when it can be (Seb, 2026-10-16: "are we able to get
    // this done in the background like pinned comments on youtube?").
    const jobId = await startReelJob(res.watchId)
    if (jobId) {
      jobRef.current = jobId
      pageStarted.current = true
      say({ tone: 'ok', text: `You can close this tab. After you press Post, Facebook processes the video (often several minutes), and MVP then posts the ${longClip ? 'video' : 'Reel'} on ${p.pageName || 'your Page'} by itself, linking to that Group post. Keep the Facebook tab open until it is up.` })
      say({ tone: 'wait', text: 'Waiting for your Group post. Posted and nothing is happening after a while? Paste the post\'s link below, or post linking to your Group.' })
      setManual({ link: '' })
      await followJob(jobId)
      return
    }
    say({ tone: 'wait', text: 'Waiting for you to press Post. Keep this tab open: after you post, Facebook processes the video first, which can take several minutes, and MVP carries on by itself. Posted and nothing is happening? Paste the post\'s link below, or post linking to your Group.' })
    // The way on by hand, from the start, so a watch that misses the post
    // never leaves the creator stuck (Seb, 2026-10-13).
    setManual({ link: '' })
    // Facebook can process a video post for many minutes; SCOUT watches for 30.
    const end = Date.now() + 32 * 60 * 1000
    while (mounted.current && Date.now() < end && !pageStarted.current) {
      await new Promise((r) => setTimeout(r, 3000))
      if (pageStarted.current) return
      const st = await getFacebookGroupPostStatus(res.watchId)
      if (mounted.current && st.state !== 'unknown') setWatchSeen(st)
      if (st.state === 'watching') continue
      // The Group post's own address, or, for a video, the Reel address its
      // timestamp opens (the video with the post's text and links).
      if (st.state === 'posted' && st.url && (isFacebookGroupPostLink(st.url) || isFacebookReelLink(st.url))) { await postReel(st.url, 'post'); return }
      if (st.state === 'posted' || st.state === 'posted_no_link') {
        say({ tone: 'warn', text: 'SCOUT saw your Group post go up but could not read its own link. In Facebook, click the time under your name on the post (like "Just now"), copy the address (for a video it starts facebook.com/reel/), and paste it below. Or post the Reel linking to your Group.' })
        setManual({ link: '' })
        return
      }
      say({ tone: 'warn', text: st.state === 'closed'
        ? 'The Facebook tab closed before SCOUT saw the post go up. If you posted it, paste its link below.'
        : st.state === 'not_seen'
          ? 'SCOUT did not see the post appear. If your Group approves posts first, it shows up once approved. Paste its link below when it is up.'
          : 'SCOUT stopped watching before it saw the post. If you posted it, paste its link below.' })
      setManual({ link: '' })
      return
    }
  }

  useEffect(() => {
    if (!p.start || p.start.at === lastStart.current) return
    lastStart.current = p.start.at
    void run(p.start.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.start])

  // Read fresh from SCOUT on every copy: the watch goes on after the creator
  // moves on by hand. Says which it copied, so an old answer is not passed off
  // as a fresh one.
  async function copyLog() {
    if (!watchId) return
    const { getFacebookGroupPostStatus, getScoutStatus, facebookLogText } = await import('@/lib/extension-frame')
    const [fresh, scout] = await Promise.all([getFacebookGroupPostStatus(watchId), getScoutStatus().catch(() => ({ version: null }))])
    const st = fresh.state !== 'unknown' ? fresh : watchSeen
    if (fresh.state !== 'unknown' && mounted.current) setWatchSeen(fresh)
    const text = facebookLogText(st, scout.version)
    try {
      await navigator.clipboard.writeText(text)
      setCopyFallback(null)
      setCopied(fresh.state !== 'unknown' ? 'Copied. Paste it to MVP support.' : 'SCOUT did not answer just now, so this is the last copy MVP had. Copied.')
    } catch {
      setCopied('Your browser blocked the copy. Select the text below and copy it yourself.')
      setCopyFallback(text)
    }
    if (mounted.current) setWatchSeen((x) => x ?? st)
  }
  const logRows = watchSeen?.log?.length ?? null

  const tone = (t: FlowLine['tone']) => t === 'ok' ? 'text-[#10B981]' : t === 'bad' ? 'text-[#ff3b30]' : t === 'warn' ? 'text-[#ff9500]' : 'text-[#6e6e73] dark:text-[#b0b0b5]'

  return (
    <div className="rounded-xl border border-[#1877F2]/30 bg-[#1877F2]/[0.04] p-3 flex flex-col gap-2.5">
      <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your Group gets the clip with the link. Your Page gets the Reel, pointing to it.</p>
      <ol className="text-[12px] text-[#6e6e73] dark:text-[#b0b0b5] leading-snug list-decimal pl-4 flex flex-col gap-0.5">
        <li><b className="text-[#1d1d1f] dark:text-[#f5f5f7]">You check the post below</b> and press <b className="text-[#1d1d1f] dark:text-[#f5f5f7]">Post to my Group + Page</b>.</li>
        <li><b className="text-[#1d1d1f] dark:text-[#f5f5f7]">SCOUT</b> opens your Group, attaches the clip and writes the post with your product link.</li>
        <li><b className="text-[#1d1d1f] dark:text-[#f5f5f7]">You press Post</b> in Facebook. Facebook lets no app press it for you.</li>
        <li><b className="text-[#1d1d1f] dark:text-[#f5f5f7]">MVP</b> posts the Reel on {p.pageName || 'your Page'}, with a link to that exact Group post on its first line.</li>
      </ol>
      {p.groups.length > 1 && (
        <label className="flex items-center gap-2 text-[12.5px] text-[#1d1d1f] dark:text-[#f5f5f7] flex-wrap">
          Group:
          <select value={groupIdx} onChange={(e) => setGroupIdx(Number(e.target.value))}
            className="rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1 text-[12.5px]">
            {p.groups.map((g, i) => <option key={g.url} value={i}>{g.niche ? `${g.niche}: ` : ''}{g.name || g.url}</option>)}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">The Reel&apos;s caption on your Page</span>
        <span className="text-[11.5px] text-[#86868b]">On Facebook it reads: &quot;Get it here 👉&quot; and the link to your Group post, your disclaimer, #ad #sponsored, this text, then its hashtags.</span>
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4}
          className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-[#1c1c1e] px-2.5 py-2 text-[12.5px] text-[#1d1d1f] dark:text-[#f5f5f7]" />
      </label>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-1">
          {lines.map((l, i) => (
            <li key={i} className={`text-[12px] leading-snug flex items-start gap-1.5 ${tone(l.tone)}`}>
              {l.tone === 'wait' && i === lines.length - 1 ? <Loader2 size={12} className="animate-spin mt-0.5 shrink-0" /> : <span aria-hidden className="shrink-0">{l.tone === 'ok' ? '✓' : l.tone === 'bad' ? '✗' : l.tone === 'warn' ? '!' : '·'}</span>}
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
      {manual && (
        <div className="flex flex-col gap-1.5">
          <input value={manual.link} onChange={(e) => setManual({ link: e.target.value })} placeholder="facebook.com/groups/your-group/posts/… or facebook.com/reel/…"
            className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2.5 py-1.5 text-[12.5px] font-mono" />
          <div className="flex gap-2 flex-wrap">
            <button disabled={!(isFacebookGroupPostLink(manual.link.trim()) || isFacebookReelLink(manual.link.trim()))} onClick={() => void postReel(manual.link.trim(), 'post')}
              className="rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white bg-[#1877F2] disabled:opacity-50">Post the Reel linking to this post</button>
            {group && isFacebookGroupLink(group.url) && (
              <button onClick={() => void postReel(group.url, 'group')} className="rounded-lg px-2.5 py-1 text-[12px] font-semibold border border-[#1877F2]/40 text-[#1877F2]">Link to my Group instead</button>
            )}
          </div>
        </div>
      )}
      {retry && (
        <button onClick={() => void postReel(retry, isFacebookGroupPostLink(retry) ? 'post' : 'group', true)} className="self-start rounded-lg px-2.5 py-1 text-[12px] font-semibold text-white bg-[#1877F2]">Try the Reel again</button>
      )}
      {watchId && (
        <details className="rounded-lg border border-black/10 dark:border-white/15 px-2.5 py-1.5 text-[11.5px] text-[#6e6e73] dark:text-[#b0b0b5]">
          <summary className="cursor-pointer select-none font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
            What Facebook sent (for support){logRows === null ? '' : logRows === 0 ? ': nothing yet' : `: ${logRows} requests`}
          </summary>
          <div className="mt-1.5 flex flex-col gap-1.5">
            <p>While SCOUT watches for your Group post it notes the name of each request Facebook&apos;s page makes, and any post number in the answer. Never what you typed, your password or your login. Copy it and paste it to support so SCOUT can learn to find your post faster.</p>
            {watchSeen && !Array.isArray(watchSeen.log) && (
              <p className="text-[#ff9500]">Your SCOUT does not record this yet. It needs SCOUT 1.46.4 or later.</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => void copyLog()} className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11.5px] font-semibold border border-[#1877F2]/40 text-[#1877F2]"><Copy size={11} /> Copy</button>
              {copied && <span>{copied}</span>}
            </div>
            {copyFallback && <textarea readOnly value={copyFallback} rows={6} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-2 py-1 text-[11px] font-mono" />}
          </div>
        </details>
      )}
    </div>
  )
}
