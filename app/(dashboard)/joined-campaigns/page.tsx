'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Joined campaigns — the work queue for everything you committed to.
//
// MVP used to accept campaigns silently, in bulk, as a side effect of sending a
// message, on the belief that Amazon opened a brand chat only after you joined.
// It does not. A creator could finish a session joined to thirty-four campaigns
// they never chose, with no record of it anywhere in the product.
//
// This is the other half of fixing that. Joining is now something you do when
// you are ready to make something, and this is where you see what you took on:
// what is still open, what has content, what closed empty. Ordered as a work
// queue, so the first row is the thing to make next rather than the first row
// alphabetically.
//
// Every count, every state and every sentence comes from lib/campaign-library.ts
// and is tested there, including the two rules this page must not break: never
// credit a campaign with money Amazon reported against a product, and never call
// a campaign with no end date urgent or late.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, PenLine, ExternalLink, RefreshCw, CircleAlert, CircleCheck, CircleDashed, CircleDollarSign } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'
import { requestMyCcCampaigns } from '@/lib/extension-frame'
import type { CampaignLibrary, CampaignState, LibraryRow } from '@/lib/campaign-library'

type Filter = 'all' | CampaignState

const STATE: Record<CampaignState, { label: string; color: string; icon: typeof CircleAlert; tab: string }> = {
  due: { label: 'Nothing made yet', color: '#e11d48', icon: CircleAlert, tab: 'To make' },
  made: { label: 'Content published', color: '#059669', icon: CircleCheck, tab: 'Made' },
  earning: { label: 'Published and paying', color: '#047857', icon: CircleDollarSign, tab: 'Paying' },
  missed: { label: 'Closed empty', color: '#78716c', icon: CircleDashed, tab: 'Closed' },
}

const money = (cents: number) => cents % 100 === 0 ? `$${(cents / 100).toLocaleString()}` : `$${(cents / 100).toFixed(2)}`

export default function JoinedCampaignsPage() {
  const [data, setData] = useState<CampaignLibrary | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [writing, setWriting] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/campaigns/library')
      setData(await r.json())
    } catch { setData(null) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // Pull the authoritative joined list off Amazon. A campaign joined on Amazon
  // directly is the same commitment as one joined here, and a list that only
  // knows about MVP's own accepts would quietly under-report the work.
  const sync = useCallback(async () => {
    setSyncing(true)
    const tId = 'joined-sync'
    toast.loading('Reading your joined campaigns from Amazon…', { id: tId, duration: Infinity })
    try {
      const res = await requestMyCcCampaigns()
      if (!res.ok) {
        toast.error(res.error === 'not-installed'
          ? 'SCOUT extension not detected. Install it and sign in to Amazon, then try again.'
          : res.reason || res.error || 'Amazon did not answer.', { id: tId, duration: 8000 })
        return
      }
      const campaigns = res.campaigns || []
      await fetch('/api/campaigns/sync-joined', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaigns }),
      })
      toast.success(`${campaigns.length} joined ${campaigns.length === 1 ? 'campaign' : 'campaigns'} read from Amazon.`, { id: tId, duration: 5000 })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed', { id: tId, duration: 8000 })
    } finally { setSyncing(false) }
  }, [load])

  // Write the post for a campaign, from the row that says it is missing.
  const write = useCallback(async (row: LibraryRow) => {
    setWriting(row.asin)
    const tId = `write-${row.asin}`
    toast.loading('Writing your post… (~1-2 min, keep this tab open)', { id: tId, duration: Infinity })
    try {
      const res = await fetch('/api/campaigns/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asin: row.asin, campaignName: row.product || undefined, endsAt: row.endsAt || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.error) { toast.error(j?.error || `Failed (${res.status})`, { id: tId, duration: 8000 }); return }
      toast.success('Blog post published.', { id: tId, duration: 6000 })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate', { id: tId, duration: 8000 })
    } finally { setWriting(null) }
  }, [load])

  const rows = (data?.rows ?? []).filter(r => filter === 'all' || r.state === filter)
  const s = data?.summary

  return (
    <>
      <PageHero
        title="Joined campaigns"
        subtitle="Everything you have committed to, and what came of it. Joining is what makes a campaign’s boosted commission apply to what you publish, so a joined campaign with nothing published pays nothing."
        actions={
          <button onClick={sync} disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold border disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Read from Amazon
          </button>
        }
      />

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] py-10 justify-center" style={{ color: 'var(--text-faint)' }}>
          <Loader2 size={15} className="animate-spin" /> Working out what you joined…
        </div>
      ) : !data ? (
        <p className="text-[13px]" style={{ color: 'var(--text-soft)' }}>Could not load your campaigns. Reload the page to try again.</p>
      ) : (
        <>
          {/* The verdict, in the creator's terms, before any list. */}
          <div className="rounded-2xl border p-4 sm:p-5 mb-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <p className="text-[14px] font-bold leading-relaxed" style={{ color: 'var(--text)' }}>{data.verdict}</p>
            <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-soft)' }}>{data.doThis}</p>
            {s && s.joined > 0 && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 pt-3.5" style={{ borderTop: '1px solid var(--border)' }}>
                {([
                  ['Joined', s.joined, 'var(--text)'],
                  ['To make', s.due, STATE.due.color],
                  ['Made', s.made, STATE.made.color],
                  ['Closed empty', s.missed, STATE.missed.color],
                ] as const).map(([label, n, color]) => (
                  <div key={label}>
                    <p className="text-[10.5px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>{label}</p>
                    <p className="text-[16px] font-bold tabular-nums" style={{ color }}>{n}</p>
                  </div>
                ))}
                {s.earnedCents != null && (
                  <div>
                    <p className="text-[10.5px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>Amazon paid on these products</p>
                    <p className="text-[16px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>{money(s.earnedCents)}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {s && s.joined > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {([['all', `All ${s.joined}`], ['due', `${STATE.due.tab} ${s.due}`], ['made', `${STATE.made.tab} ${s.made - s.earning}`], ['earning', `${STATE.earning.tab} ${s.earning}`], ['missed', `${STATE.missed.tab} ${s.missed}`]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k as Filter)}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold border"
                  style={filter === k
                    ? { borderColor: '#7C3AED', background: 'rgba(124,58,237,0.10)', color: '#7C3AED' }
                    : { borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {rows.length === 0 ? (
            <p className="text-[13px] py-8 text-center" style={{ color: 'var(--text-faint)' }}>
              {s && s.joined === 0
                ? <>Nothing joined yet. <Link href="/cc-campaigns" className="font-semibold" style={{ color: '#7C3AED' }}>Browse campaigns</Link>, message any brand you like without joining, and join one when you are ready to make something for it.</>
                : 'Nothing in this group.'}
            </p>
          ) : (
            <div className="space-y-2">
              {rows.map(r => {
                const st = STATE[r.state]
                const Icon = st.icon
                const urgent = r.state === 'due' && r.daysLeft != null && r.daysLeft <= 7
                return (
                  <div key={r.asin} className="rounded-xl border p-3 flex items-start gap-3"
                    style={{ borderColor: urgent ? 'rgba(225,29,72,0.35)' : 'var(--border)', background: 'var(--surface)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {r.imageUrl
                      ? <img src={r.imageUrl} alt="" className="w-12 h-12 rounded-lg object-contain flex-shrink-0" style={{ background: 'var(--surface-2)' }} />
                      : <div className="w-12 h-12 rounded-lg flex-shrink-0" style={{ background: 'var(--surface-2)' }} />}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Icon size={13} style={{ color: st.color, flexShrink: 0 }} />
                        <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                          {r.product || r.brand || r.asin}
                        </span>
                        {r.commissionPct != null && (
                          <span className="text-[10px] font-bold px-1.5 py-[1px] rounded flex-shrink-0" style={{ background: 'rgba(124,58,237,0.12)', color: '#7C3AED' }}>
                            {r.commissionPct}%{r.perSaleCents != null ? ` · ${money(r.perSaleCents)} a sale` : ''}
                          </span>
                        )}
                      </div>
                      {r.brand && r.product && (
                        <p className="text-[11.5px] truncate" style={{ color: 'var(--text-faint)' }}>{r.brand}</p>
                      )}
                      <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: urgent ? st.color : 'var(--text-soft)' }}>{r.note}</p>
                      {r.content.length > 0 && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                          {r.content.filter(c => c.url).slice(0, 4).map((c, i) => (
                            <a key={i} href={c.url as string} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11.5px] font-medium hover:underline" style={{ color: '#7C3AED' }}>
                              <ExternalLink size={11} /> {c.title || c.kind}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      {r.state === 'due' && (
                        <button onClick={() => write(r)} disabled={writing === r.asin}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-50"
                          style={{ background: 'linear-gradient(45deg, #7C3AED 0%, #bc1888 100%)' }}>
                          {writing === r.asin ? <Loader2 size={12} className="animate-spin" /> : <PenLine size={12} />} Write the post
                        </button>
                      )}
                      {r.detailsUrl && (
                        <a href={r.detailsUrl} target="_blank" rel="noreferrer"
                          className="text-[11.5px] font-medium hover:underline" style={{ color: 'var(--text-faint)' }}>
                          On Amazon
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <p className="text-[11px] mt-5 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            One row per product. Amazon runs several campaigns for the same product across different windows, and being
            joined to three of them is still one thing to make. Money shown is what Amazon reported against the product
            itself, across every link you have anywhere, so it is never attributed to one post.
          </p>
        </>
      )}
    </>
  )
}
