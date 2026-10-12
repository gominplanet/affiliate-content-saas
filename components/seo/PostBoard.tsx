'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT EACH POST NEEDS (Seb, 2026-10-11). Every post in one stage with why, in
// its own numbers, and the next steps in order, each with the button that does
// it: add a link from a post Google already shows, ask Google to read it, share
// it, fix it, rewrite the title. The stage rules live in lib/post-doctor (pure,
// tested). Plus a straight answer on backlinks from the blog's own numbers.
//
// Every action says what happened: a link that was added, a post that already
// linked there, or the reason it could not be done. A request to Google is
// remembered and shown on the post, so pressing it is not the same as nothing.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Loader2, Check, Link2, Share2, Wrench, Type, Megaphone, Map as MapIcon, ChevronDown, AlertTriangle, ListChecks, Search, Gauge, RotateCcw } from 'lucide-react'
import { buildBoard, backlinkVerdict, laneInfo, LANES, sharedLinks, lanePlan, bulkLinkPairs, requestQueue, requestedToday, PLATFORM_LABEL, REQUESTS_PER_DAY, BULK_LINKS, type DoctorPost, type Diagnosis, type Lane, type Step, type LaneInfo, type LanePlan, type PlanMove } from '@/lib/post-doctor'
import { readRequested, REQUESTED_EVENT } from '@/lib/gsc-request-client'
import RequestIndexingButton from '@/components/seo/RequestIndexingButton'
import { InfoTip } from '@/components/seo/SeoExplain'

const TONE: Record<LaneInfo['tone'], string> = {
  red: '#ff3b30', amber: '#ff9500', violet: '#7C3AED', blue: '#0a84ff', green: '#34c759', grey: '#8e8e93',
}
const DAY = 86_400_000
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / DAY)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

type LinkState = Record<string, 'busy' | 'done' | 'already' | { error: string }>

export default function PostBoard({ posts, connected, property, linksCounted, canBrandRecap, onOpenPost, onGoToGetFound, onRefreshUrls, onReload }: {
  posts: DoctorPost[]
  connected: boolean
  property: string | null
  /** False when too few post bodies are stored in MVP to count links honestly. */
  linksCounted: boolean
  canBrandRecap: boolean
  onOpenPost: (postId: string) => void
  onGoToGetFound: () => void
  onRefreshUrls: () => void
  /** Reads the board again (after links were added). */
  onReload?: () => void
}) {
  const board = useMemo(() => buildBoard(posts), [posts])
  const [lane, setLane] = useState<Lane | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [stagesHelp, setStagesHelp] = useState(false)
  const [links, setLinks] = useState<LinkState>({})
  const [requested, setRequested] = useState<Record<string, string>>({})
  const titleOf = useMemo(() => new Map(posts.map((p) => [p.postId, p.title])), [posts])

  useEffect(() => {
    const sync = () => setRequested(readRequested())
    sync()
    window.addEventListener(REQUESTED_EVENT, sync)
    return () => window.removeEventListener(REQUESTED_EVENT, sync)
  }, [])

  const active = lane && board.lanes.some((l) => l.info.id === lane) ? lane : board.lanes[0]?.info.id ?? null
  const current = board.lanes.find((l) => l.info.id === active)
  const shown = current ? (showAll ? current.posts : current.posts.slice(0, 8)) : []

  const addLink = async (fromPostId: string, toPostId: string) => {
    const k = `${fromPostId}>${toPostId}`
    setLinks((s) => ({ ...s, [k]: 'busy' }))
    try {
      const r = await fetch('/api/seo/link-to', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromPostId, toPostId }),
        signal: AbortSignal.timeout(60_000),
      })
      const d = await r.json().catch(() => ({})) as { ok?: boolean; added?: boolean; note?: string; error?: string }
      if (!r.ok || !d.ok) throw new Error(d.error || `MVP could not add the link (${r.status}).`)
      setLinks((s) => ({ ...s, [k]: d.added ? 'done' : 'already' }))
    } catch (e) {
      setLinks((s) => ({ ...s, [k]: { error: e instanceof Error ? e.message : 'MVP could not add the link.' } }))
    }
  }

  const verdict = backlinkVerdict(board)
  const allDx = useMemo(() => board.lanes.flatMap((l) => l.posts), [board])
  const plan = current ? lanePlan(current.info.id, current.posts, allDx, connected) : null

  // LINK THEM ALL (ten at a time): the same link as the per-post button, one
  // after another, each outcome kept on its post and counted at the end.
  const [bulk, setBulk] = useState<{ running: boolean; done: number; of: number; added: number; already: number; failed: string[] } | null>(null)
  const runBulkLinks = async () => {
    if (!current || bulk?.running) return
    const tried = new Set(Object.keys(links))
    const pairs = bulkLinkPairs(current.posts, tried)
    if (!pairs.length) return
    const st = { running: true, done: 0, of: pairs.length, added: 0, already: 0, failed: [] as string[] }
    setBulk({ ...st })
    for (const pr of pairs) {
      const k = `${pr.from}>${pr.to}`
      setLinks((s) => ({ ...s, [k]: 'busy' }))
      try {
        const r = await fetch('/api/seo/link-to', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromPostId: pr.from, toPostId: pr.to }), signal: AbortSignal.timeout(60_000) })
        const d = await r.json().catch(() => ({})) as { ok?: boolean; added?: boolean; error?: string }
        if (!r.ok || !d.ok) throw new Error(d.error || `MVP could not add the link (${r.status}).`)
        setLinks((s) => ({ ...s, [k]: d.added ? 'done' : 'already' }))
        if (d.added) st.added++; else st.already++
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'MVP could not add the link.'
        setLinks((s) => ({ ...s, [k]: { error: msg } }))
        st.failed.push(`${pr.toTitle}: ${msg}`)
      }
      st.done++
      setBulk({ ...st })
    }
    setBulk({ ...st, running: false })
  }

  if (posts.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      <div id="post-board" className="rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden scroll-mt-24">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-white/10">
          <p className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your posts, by the stage they are stuck at</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#a1a1a6] mt-0.5">
            Each post sits in one stage. The stages are in the order to work on them, left first: a post Google has not read cannot rank, and a post that does not rank cannot be clicked. Press a stage to see its plan and its posts.
            {!connected && ' Connect Search Console so MVP can tell which posts Google has; until then this shows links and shares only.'}
          </p>
          <button onClick={() => setStagesHelp((v) => !v)} aria-expanded={stagesHelp} className="mt-1.5 text-[12px] font-semibold text-[#7C3AED] hover:underline inline-flex items-center gap-1">
            What every stage means <ChevronDown size={12} className={stagesHelp ? 'rotate-180' : ''} />
          </button>
          {stagesHelp && (
            <ul className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {LANES.map((l) => (
                <li key={l.id} className="flex items-start gap-2 text-[12px] leading-snug">
                  <span className="mt-1 w-2 h-2 rounded-full flex-shrink-0" style={{ background: TONE[l.tone] }} />
                  <span><span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{l.title}.</span> <span className="text-[#4b4b4f] dark:text-[#b0b0b5]">{l.blurb}</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Stages */}
        <div className="px-4 pt-3 flex gap-1.5 flex-wrap">
          {board.lanes.map(({ info, posts: ps }) => {
            const on = info.id === active
            return (
              <button key={info.id} onClick={() => { setLane(info.id); setShowAll(false) }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${on ? 'bg-[#1d1d1f] text-white border-transparent dark:bg-white dark:text-[#1d1d1f]' : 'border-black/10 dark:border-white/15 text-[#4b4b4f] dark:text-[#d2d2d7] hover:border-black/25 dark:hover:border-white/30'}`}>
                <span className="w-2 h-2 rounded-full" style={{ background: TONE[info.tone] }} />
                {info.title}
                <span className="tabular-nums opacity-70">{ps.length}</span>
              </button>
            )
          })}
        </div>
        {current && !plan && <p className="px-4 pt-2 text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5]">{current.info.blurb}</p>}
        {current && plan && (
          <PlanCard plan={plan} posts={current.posts} requested={requested} property={property} links={links} bulk={bulk}
            onBulkLinks={() => void runBulkLinks()} onGoToGetFound={onGoToGetFound} onReload={onReload} />
        )}
        {current && plan && current.posts.length > 0 && (
          <p className="px-4 pt-3 text-[11px] font-bold uppercase tracking-wider text-[#86868b]">Each post, with its own numbers</p>
        )}

        <div className="p-4 pt-3 flex flex-col gap-3">
          {shown.map((p) => {
            const shared = sharedLinks(p)
            const req = p.url ? requested[p.url] : undefined
            const recentReq = req && Date.now() - Date.parse(req) < 7 * DAY ? req : null
            const linkedN = Array.isArray(p.linkedFrom) ? p.linkedFrom.length : null
            return (
              <div key={p.postId} className="rounded-lg border border-gray-100 dark:border-white/10 p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0" style={{ background: TONE[laneInfo(p.dx.lane).tone] }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 min-w-0 text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] leading-snug">{p.title}</p>
                      {p.url && <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[#86868b] hover:text-[#7C3AED] flex-shrink-0" title="Open the post"><ExternalLink size={13} /></a>}
                    </div>
                    {/* The facts behind the stage, so it is never just a label. */}
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#6e6e73] dark:text-[#a1a1a6]">
                      {connected && <span className="inline-flex items-center gap-1">{p.indexed === true ? 'In Google' : p.indexed === false ? 'Not in Google' : 'Google not checked yet'} <InfoTip id="indexed" /></span>}
                      {connected && p.indexed === true && <span className="tabular-nums inline-flex items-center gap-1">28 days: {p.impressions} views in Google · {p.clicks} clicks{p.position ? ` · position ${Math.round(p.position * 10) / 10}` : ''} <InfoTip id={p.position ? 'position' : 'impressions'} /></span>}
                      {linksCounted && linkedN !== null && (
                        <span className={`inline-flex items-center gap-1 ${linkedN === 0 ? 'text-[#ff3b30] font-medium' : ''}`}>{linkedN === 0 ? 'No other post links here' : `Linked from ${linkedN} of your posts`} <InfoTip id={linkedN === 0 ? 'orphan' : 'internal-link'} /></span>
                      )}
                      <span className={shared.length === 0 ? 'text-[#ff9500] font-medium' : ''}>
                        {shared.length === 0 ? 'Not shared from MVP yet' : `Shared on ${shared.map((s) => PLATFORM_LABEL[s] || s).join(', ')}`}
                      </span>
                      {p.inSitemap === false && <span className="text-[#ff9500] font-medium inline-flex items-center gap-1">Not in your sitemap <InfoTip id="sitemap" /></span>}
                      {recentReq && <span className="text-[#34c759] font-medium">Opened in Search Console {ago(recentReq)}</span>}
                    </div>
                    <p className="mt-1.5 text-[12px] text-[#3a3a3c] dark:text-[#d2d2d7]">{p.dx.why}</p>

                    <ol className="mt-2 flex flex-col gap-1.5">
                      {p.dx.steps.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-[12px]">
                          <span className="w-4 h-4 mt-0.5 rounded-full bg-black/5 dark:bg-white/10 text-[10px] font-semibold flex items-center justify-center flex-shrink-0 tabular-nums text-[#4b4b4f] dark:text-[#d2d2d7]">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">{s.text}</span>
                            <StepAction step={s} post={p} connected={connected} property={property} canBrandRecap={canBrandRecap}
                              recentReq={recentReq} links={links} titleOf={titleOf}
                              onAddLink={addLink} onOpenPost={onOpenPost} onGoToGetFound={onGoToGetFound} onRefreshUrls={onRefreshUrls} />
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            )
          })}
          {current && current.posts.length > 8 && (
            <button onClick={() => setShowAll((v) => !v)} className="self-start text-[12px] font-semibold text-[#7C3AED] hover:underline inline-flex items-center gap-1">
              <ChevronDown size={12} className={showAll ? 'rotate-180' : ''} /> {showAll ? 'Show fewer' : `Show all ${current.posts.length}`}
            </button>
          )}
          {!linksCounted && (
            <p className="text-[11px] text-[#86868b]">MVP cannot count the links between your posts yet: most post bodies are not stored in MVP. Press the Sync from WordPress button further down, and the link counts appear here.</p>
          )}
        </div>
      </div>

      {board.shareFirst.length > 0 && (
        <div id="share-first" className="scroll-mt-24 rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-white/10">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] inline-flex items-center gap-1.5"><Share2 size={14} className="text-[#7C3AED]" /> Share these first</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#a1a1a6] mt-0.5">Not shared from MVP yet, and the ones a share helps most: closest to page one, then the newest. A share is not a ranking signal by itself. It brings first readers, and every reader is a chance of a link from another site.</p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-white/5">
            {board.shareFirst.map((p) => (
              <div key={p.postId} className="flex items-center gap-3 px-4 py-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: TONE[laneInfo(p.dx.lane).tone] }} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] truncate">{p.title}</span>
                  <span className="block text-[11px] text-[#86868b]">{laneInfo(p.dx.lane).title}</span>
                </span>
                <Link href={`/content?tab=posts&q=${encodeURIComponent(p.title.slice(0, 60))}`} className="text-[11px] font-semibold text-white bg-[#7C3AED] rounded-full px-2.5 py-1 flex-shrink-0">Share it</Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <BacklinkCard verdict={verdict} canBrandRecap={canBrandRecap} />
    </div>
  )
}

const MOVE_ICON: Record<PlanMove['kind'], typeof Link2> = {
  sitemap: MapIcon, link_all: Link2, request_today: Search, share: Share2, improve: Wrench, titles: Type, brand: Megaphone, pace: Gauge,
}

/** The plan for the whole stage: what is going on, then the moves in order,
 *  each done for the stage at once where it can be. */
function PlanCard({ plan, posts, requested, property, links, bulk, onBulkLinks, onGoToGetFound, onReload }: {
  plan: LanePlan
  posts: (DoctorPost & { dx: Diagnosis })[]
  requested: Record<string, string>
  property: string | null
  links: LinkState
  bulk: { running: boolean; done: number; of: number; added: number; already: number; failed: string[] } | null
  onBulkLinks: () => void
  onGoToGetFound: () => void
  onReload?: () => void
}) {
  const [showQueue, setShowQueue] = useState(false)
  const nextPairs = bulkLinkPairs(posts, new Set(Object.keys(links)))
  const today = requestedToday(requested)
  const queue = requestQueue(posts, requested)
  const btn = 'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold'
  const primary = `${btn} text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50`
  const quiet = `${btn} border border-black/10 dark:border-white/15 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED]/60`

  return (
    <div className="mx-4 mt-3 rounded-lg border border-[#7C3AED]/25 bg-[#7C3AED]/[0.04] p-3">
      <p className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] inline-flex items-center gap-1.5"><ListChecks size={15} className="text-[#7C3AED]" /> {plan.headline}</p>
      <p className="mt-1 text-[12px] text-[#3a3a3c] dark:text-[#d2d2d7]">{plan.why}</p>
      <ol className="mt-3 flex flex-col gap-3">
        {plan.moves.map((m, i) => {
          const Icon = MOVE_ICON[m.kind]
          const done = m.count === 0 && m.kind !== 'pace'
          return (
            <li key={m.kind} className="flex items-start gap-2.5">
              <span className={`w-5 h-5 mt-0.5 rounded-full text-[11px] font-semibold flex items-center justify-center flex-shrink-0 tabular-nums ${done ? 'bg-[#34c759]/15 text-[#34c759]' : 'bg-[#7C3AED]/10 text-[#7C3AED]'}`}>{done ? <Check size={11} /> : i + 1}</span>
              <div className="flex-1 min-w-0 text-[12px]">
                <p className={done ? 'text-[#6e6e73] dark:text-[#a1a1a6]' : 'text-[#1d1d1f] dark:text-[#f5f5f7]'}><Icon size={12} className="inline -mt-0.5 mr-1 text-[#7C3AED]" />{m.text}</p>
                {!done && m.kind === 'sitemap' && <button onClick={onGoToGetFound} className={`${quiet} mt-1.5`}><MapIcon size={12} /> Go to Get my blog found</button>}
                {m.kind === 'link_all' && m.count > 0 && (
                  <div className="mt-1.5 flex flex-col gap-1 items-start">
                    {bulk?.running ? (
                      <span className="inline-flex items-center gap-1.5 text-[#7C3AED] font-medium"><Loader2 size={12} className="animate-spin" /> Adding links: {bulk.done} of {bulk.of}. Each post is republished on WordPress, so keep this page open.</span>
                    ) : nextPairs.length > 0 ? (
                      <button onClick={onBulkLinks} className={primary}><Link2 size={12} /> Add {nextPairs.length === 1 ? 'the link' : `the next ${nextPairs.length} links`}</button>
                    ) : (
                      <span className="text-[#6e6e73] dark:text-[#a1a1a6]">Every link MVP could add here was tried. Reload the board to see the new counts.</span>
                    )}
                    {!bulk?.running && nextPairs.length > 0 && <span className="text-[11px] text-[#86868b]">Up to {BULK_LINKS} per press, never more than 2 new links from any one post. Each link is a card at the end of a post Google already shows.</span>}
                    {bulk && !bulk.running && (
                      <span className={`text-[12px] ${bulk.failed.length ? 'text-[#ff9500]' : 'text-[#34c759]'} font-medium`}>
                        {bulk.added} link{bulk.added === 1 ? '' : 's'} added{bulk.already ? `, ${bulk.already} already there` : ''}{bulk.failed.length ? `, ${bulk.failed.length} not added` : ''}.
                        {onReload && bulk.added > 0 && <button onClick={onReload} className="ml-2 inline-flex items-center gap-1 text-[#7C3AED] hover:underline"><RotateCcw size={11} /> Reload the board</button>}
                      </span>
                    )}
                    {bulk && !bulk.running && bulk.failed.length > 0 && (
                      <ul className="text-[11px] text-[#ff3b30] list-disc pl-4">{bulk.failed.slice(0, 5).map((f, j) => <li key={j}>{f}</li>)}</ul>
                    )}
                  </div>
                )}
                {m.kind === 'request_today' && (
                  <div className="mt-1.5">
                    <button onClick={() => setShowQueue((v) => !v)} className={queue.length ? primary : quiet}>
                      <Search size={12} /> {queue.length ? `Today's ${queue.length}` : 'Done for today'} <ChevronDown size={12} className={showQueue ? 'rotate-180' : ''} />
                    </button>
                    <span className="ml-2 text-[11px] text-[#86868b]">{today} of about {REQUESTS_PER_DAY} opened today in this browser.</span>
                    {showQueue && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {queue.length === 0 && <p className="text-[11px] text-[#86868b]">{today >= REQUESTS_PER_DAY ? `That is about ${REQUESTS_PER_DAY} today. Come back tomorrow for the next ones.` : 'Every post here was asked about in the last week. Asking again does not speed Google up.'}</p>}
                        {queue.map((p) => (
                          <div key={p.postId} className="flex items-center gap-2 flex-wrap">
                            {p.url && <RequestIndexingButton url={p.url} property={property} small />}
                            <span className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] truncate max-w-[24rem]">{p.title}</span>
                          </div>
                        ))}
                        {queue.length > 0 && <p className="text-[11px] text-[#86868b]">Each one opens Search Console on that page: press Request indexing there. MVP remembers what you opened, and tomorrow lists the next ones.</p>}
                      </div>
                    )}
                  </div>
                )}
                {!done && m.kind === 'share' && <button onClick={() => document.getElementById('share-first')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className={`${quiet} mt-1.5`}><Share2 size={12} /> See which to share first</button>}
                {m.kind === 'titles' && <Link href="/tools/title-audit" className={`${quiet} mt-1.5`}><Type size={12} /> Open Title Check</Link>}
                {m.kind === 'brand' && <button onClick={() => document.getElementById('backlinks')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className={`${quiet} mt-1.5`}><Megaphone size={12} /> Where real links come from</button>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function StepAction({ step, post, connected, property, canBrandRecap, recentReq, links, titleOf, onAddLink, onOpenPost, onGoToGetFound, onRefreshUrls }: {
  step: Step
  post: DoctorPost & { dx: Diagnosis }
  connected: boolean
  property: string | null
  canBrandRecap: boolean
  recentReq: string | null
  links: LinkState
  titleOf: Map<string, string>
  onAddLink: (fromPostId: string, toPostId: string) => void
  onOpenPost: (postId: string) => void
  onGoToGetFound: () => void
  onRefreshUrls: () => void
}) {
  const btn = 'mt-1 mr-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold'
  const primary = `${btn} text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-50`
  const quiet = `${btn} border border-black/10 dark:border-white/15 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#7C3AED]/60`

  switch (step.kind) {
    case 'fix':
      return step.href ? <div><Link href={step.href} className={quiet}><Wrench size={11} /> Open the tool</Link></div> : null
    case 'sitemap':
      return <div><button onClick={onGoToGetFound} className={quiet}><MapIcon size={11} /> Go to Get my blog found</button></div>
    case 'address':
      return <div><button onClick={onRefreshUrls} className={quiet}>Refresh post URLs</button></div>
    case 'request':
      if (!connected || !post.url) return <p className="text-[11px] text-[#86868b] mt-0.5">Connect Search Console first.</p>
      return (
        <div className="mt-1 flex flex-col gap-1 items-start">
          <RequestIndexingButton url={post.url} property={property} small again={!!recentReq} />
          {recentReq && <span className="text-[11px] text-[#86868b]">Opened {ago(recentReq)}. Asking again within a week does not speed Google up.</span>}
        </div>
      )
    case 'share':
      return <div><Link href={`/content?tab=posts&q=${encodeURIComponent(post.title.slice(0, 60))}`} className={primary}><Share2 size={11} /> Share it</Link></div>
    case 'improve':
      return <div><button onClick={() => onOpenPost(post.postId)} className={quiet}><Wrench size={11} /> Open its checks</button></div>
    case 'title':
      return <div><Link href={step.href || '/tools/title-audit'} className={quiet}><Type size={11} /> Title Check</Link></div>
    case 'brand':
      return canBrandRecap
        ? <div><Link href="/brand-recap" className={quiet}><Megaphone size={11} /> Brand recap</Link></div>
        : <p className="text-[11px] text-[#86868b] mt-0.5">Send the brand the review link with a short note: brands often add reviews to their own site or socials.</p>
    case 'wait':
      return null
    case 'link': {
      const linked = new Set(post.linkedFrom ?? [])
      const sources = (post.linkSources ?? []).filter((s) => !linked.has(s.postId))
      if (post.dx.lane === 'working') return null
      if (sources.length === 0) {
        return <p className="text-[11px] text-[#86868b] mt-0.5">MVP found no post in Google on the same topic yet. Link to it when you publish the next one.</p>
      }
      return (
        <div className="mt-1 flex flex-col gap-1">
          <span className="text-[11px] text-[#86868b]">MVP adds a card linking here to the end of the post you pick, and republishes it:</span>
          {sources.map((s) => {
            const st = links[`${s.postId}>${post.postId}`]
            const err = st && typeof st === 'object' ? st.error : null
            return (
              <div key={s.postId} className="flex items-center gap-2 flex-wrap">
                <button disabled={st === 'busy' || st === 'done' || st === 'already'} onClick={() => onAddLink(s.postId, post.postId)}
                  className={`${st === 'done' || st === 'already' ? quiet : primary} !mt-0`}>
                  {st === 'busy' ? <Loader2 size={11} className="animate-spin" /> : st === 'done' || st === 'already' ? <Check size={11} /> : <Link2 size={11} />}
                  {st === 'done' ? 'Linked from' : st === 'already' ? 'Already links from' : 'Link from'}
                </button>
                <span className="text-[11px] text-[#1d1d1f] dark:text-[#f5f5f7] truncate max-w-[22rem]">{titleOf.get(s.postId) || s.title}</span>
                {err && <span className="basis-full text-[11px] text-[#ff3b30] inline-flex items-center gap-1"><AlertTriangle size={11} /> {err}</span>}
              </div>
            )
          })}
        </div>
      )
    }
  }
}

function BacklinkCard({ verdict, canBrandRecap }: { verdict: ReturnType<typeof backlinkVerdict>; canBrandRecap: boolean }) {
  const [open, setOpen] = useState(false)
  const tone = verdict.need === 'yes' ? '#7C3AED' : verdict.need === 'not_yet' ? '#ff9500' : '#34c759'
  return (
    <div id="backlinks" className="scroll-mt-24 rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left px-4 py-3 flex items-start gap-3">
        <Link2 size={16} className="mt-0.5 flex-shrink-0" style={{ color: tone }} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Do you need backlinks? {verdict.headline}</span>
          <span className="block text-xs text-[#6e6e73] dark:text-[#a1a1a6] mt-0.5">{verdict.detail}</span>
        </span>
        <ChevronDown size={16} className={`text-[#86868b] flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100 dark:border-white/10 grid gap-4 sm:grid-cols-2 text-[12px] text-[#3a3a3c] dark:text-[#d2d2d7]">
          <div>
            <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Where real links come from, for a review blog</p>
            <ul className="flex flex-col gap-1.5 list-disc pl-4">
              <li><strong>The brands you review.</strong> Send them the review. Brands add reviews to their site, press page or socials, and that is a link from a site Google already trusts on the topic.{canBrandRecap && <> <Link href="/brand-recap" className="text-[#7C3AED] hover:underline">Brand recap</Link> writes the message.</>}</li>
              <li><strong>Your own YouTube videos.</strong> Put the review link in the description of the video it came from. Google treats it as a hint rather than a vote, but viewers arrive and Google finds the post.</li>
              <li><strong>Pinterest.</strong> One pin per review. Pinterest is a search engine for products; pins send readers for months.</li>
              <li><strong>Answers.</strong> Where someone asks the exact question your review answers (Reddit, Quora, Facebook Groups), answer it and link the review. Only where it truly answers; anything else gets removed.</li>
              <li><strong>Journalist requests.</strong> Qwoted, Featured and Source of Sources list writers looking for product testers to quote. A quote with a link from a real publication is worth more than fifty directory links.</li>
            </ul>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Never</p>
              <ul className="flex flex-col gap-1.5 list-disc pl-4">
                <li>Buy links, packages of links, or "guest posts" sold for a fee. Google's spam rules name all of these, and a blog can lose its rankings over them.</li>
                <li>Swap links in bulk with other blogs, or drop your link in comment sections and forums that have nothing to do with it.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Free, and inside your control</p>
              <ul className="flex flex-col gap-1.5 list-disc pl-4">
                <li>Links between your own posts. The board above adds them in one click, from the posts Google already shows.</li>
                <li>Bing: sign in to Bing Webmaster Tools and import your site from Search Console. MVP already sends every new post to Bing and Copilot the moment it publishes.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
