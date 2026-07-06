// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /tools/duplicates — find + merge duplicate published posts (the "same product
// reviewed twice" problem: WordPress appends -2/-3 to a colliding slug).
// Duplicates cause "Crawled – currently not indexed", split rankings, and 404s.
// Scan reads live WordPress posts; Merge 301-redirects each extra → the keeper
// then trashes the extra (recoverable from WP Trash). Keeper is overridable.
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Loader2, Copy, ExternalLink, RefreshCw, ChevronLeft, CheckCircle2, Info, GitMerge } from 'lucide-react'

interface DupPost {
  id: string
  wordpressPostId: number | null
  title: string
  url: string
  slug: string
  createdAt: string | null
  bodyImages: number
  indexed: boolean
  hasSuffix: boolean
  isKeeperSuggested: boolean
}
interface DupGroup {
  key: string
  reason: 'same-video' | 'duplicate-slug'
  keeperId: string
  posts: DupPost[]
}

function fmtDate(s: string | null): string {
  if (!s) return ''
  try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) } catch { return '' }
}

export default function DuplicatesPage() {
  const [scanning, setScanning] = useState(false)
  const [ran, setRan] = useState(false)
  const [groups, setGroups] = useState<DupGroup[]>([])
  const [scanned, setScanned] = useState(0)
  const [extraCount, setExtraCount] = useState(0)
  const [source, setSource] = useState<'wordpress' | 'database'>('wordpress')
  // Per-group chosen keeper (overrides the suggested one) + in-flight + confirm.
  const [keeperOverride, setKeeperOverride] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState<Set<string>>(new Set())   // group keys (or 'ALL')
  const [confirmKey, setConfirmKey] = useState<string | null>(null) // group key or 'ALL' awaiting 2nd click

  const keeperIdFor = (g: DupGroup) => keeperOverride[g.key] ?? g.keeperId

  async function runScan() {
    setScanning(true); setConfirmKey(null)
    try {
      const res = await fetch('/api/tools/duplicates/scan', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Scan failed'); return }
      setGroups((data.groups as DupGroup[]) ?? [])
      setScanned(data.scanned ?? 0)
      setExtraCount(data.extraCount ?? 0)
      setSource((data.source as 'wordpress' | 'database') ?? 'database')
      setKeeperOverride({})
      setRan(true)
      const n = data.groupCount ?? 0
      toast.success(n ? `Found ${n} duplicate group${n === 1 ? '' : 's'} (${data.extraCount} extra post${data.extraCount === 1 ? '' : 's'}).` : 'No duplicates found — nice and clean.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  // Merge one or more groups: 301 each non-keeper → keeper, then trash it.
  async function mergeGroups(gs: DupGroup[], busyKey: string) {
    setMerging(prev => new Set(prev).add(busyKey))
    setConfirmKey(null)
    const payload = gs.map(g => {
      const kid = keeperIdFor(g)
      const keeper = g.posts.find(p => p.id === kid) || g.posts[0]
      const extras = g.posts.filter(p => p.id !== keeper.id).map(p => ({ wordpressPostId: p.wordpressPostId, url: p.url }))
      return { keeperUrl: keeper.url, extras }
    }).filter(m => m.extras.length > 0)
    try {
      const res = await fetch('/api/tools/duplicates/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merges: payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Merge failed'); return }
      const mergedKeys = new Set(gs.map(g => g.key))
      setGroups(prev => prev.filter(g => !mergedKeys.has(g.key)))
      toast.success(`Merged — ${data.trashed} post${data.trashed === 1 ? '' : 's'} trashed and 301-redirected to the keeper.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setMerging(prev => { const n = new Set(prev); n.delete(busyKey); return n })
    }
  }

  const anyMerging = merging.size > 0

  return (
    <>
      <PageHero
        title="Duplicate posts"
        subtitle="Find the same product reviewed twice (WordPress adds -2 / -3 to colliding slugs). Merge keeps the best one, 301-redirects the extras to it, and trashes them — recovering your split rankings and killing the 404s."
      />

      <div className="max-w-4xl">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <Link href="/seo" className="inline-flex items-center gap-1 text-sm text-[#86868b] hover:text-[#7C3AED]">
            <ChevronLeft size={15} /> SEO
          </Link>
          <button onClick={runScan} disabled={scanning || anyMerging}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60">
            {scanning ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {scanning ? 'Scanning your posts…' : ran ? 'Re-scan' : 'Scan for duplicates'}
          </button>
          {groups.length > 1 && !scanning && (
            confirmKey === 'ALL' ? (
              <button onClick={() => mergeGroups(groups, 'ALL')} disabled={anyMerging}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#ff3b30] hover:bg-[#e0352b] disabled:opacity-60">
                {merging.has('ALL') ? <Loader2 size={15} className="animate-spin" /> : <GitMerge size={15} />}
                Confirm — merge all {groups.length} groups
              </button>
            ) : (
              <button onClick={() => setConfirmKey('ALL')} disabled={anyMerging}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold border disabled:opacity-60"
                style={{ color: '#7C3AED', borderColor: '#d6c6fb' }}>
                <GitMerge size={15} /> Merge all {groups.length} groups
              </button>
            )
          )}
          {ran && !scanning && (
            <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
              {groups.length} group{groups.length === 1 ? '' : 's'} · {groups.reduce((n, g) => n + (g.posts.length - 1), 0)} extra · {scanned} {source === 'wordpress' ? 'live WordPress posts' : 'MVP posts'} scanned
            </span>
          )}
        </div>

        {ran && groups.length === 0 && !scanning && (
          <div className="card p-8 text-center" style={{ color: 'var(--text-faint)' }}>
            <CheckCircle2 size={26} className="mx-auto mb-2 text-[#34c759]" />
            No duplicate posts. Your archive is clean.
          </div>
        )}

        {groups.length > 0 && (
          <>
            <div className="flex items-start gap-2 text-[12px] mb-4 p-3 rounded-lg" style={{ background: 'rgba(124,58,237,0.06)', color: 'var(--text-2)' }}>
              <Info size={14} className="mt-0.5 flex-shrink-0 text-[#7C3AED]" />
              <div>
                Each group is the same product published more than once. Click a post to pick the <span className="font-semibold text-[#248a3d]">Keep</span> (defaults to the indexed / original one). <span className="font-semibold">Merge</span> 301-redirects the extras to it and moves them to WordPress Trash — recoverable from WP → Posts → Trash.
              </div>
            </div>

            <div className="space-y-4">
              {groups.map(g => {
                const kid = keeperIdFor(g)
                const busy = merging.has(g.key)
                return (
                  <div key={g.key} className="card p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[11px] font-medium" style={{ color: 'var(--text-faint)' }}>
                        {g.reason === 'duplicate-slug' ? '🔁 Duplicate slug' : '🎬 Same video'} · {g.posts.length} posts
                      </span>
                      {confirmKey === g.key ? (
                        <button onClick={() => mergeGroups([g], g.key)} disabled={anyMerging}
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white bg-[#ff3b30] hover:bg-[#e0352b] disabled:opacity-60">
                          {busy ? <Loader2 size={13} className="animate-spin" /> : <GitMerge size={13} />} Confirm merge
                        </button>
                      ) : (
                        <button onClick={() => setConfirmKey(g.key)} disabled={anyMerging}
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold border disabled:opacity-60"
                          style={{ color: '#7C3AED', borderColor: '#d6c6fb' }}>
                          <GitMerge size={13} /> Merge
                        </button>
                      )}
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-white/10">
                      {g.posts.map(p => {
                        const isKeep = p.id === kid
                        return (
                          <button key={p.id} onClick={() => setKeeperOverride(o => ({ ...o, [g.key]: p.id }))} disabled={anyMerging}
                            title={isKeep ? 'This one is kept' : 'Click to keep this one instead'}
                            className="w-full flex items-center gap-3 py-2 text-left disabled:cursor-default">
                            <div className="w-14 flex-shrink-0">
                              {isKeep
                                ? <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#248a3d]"><CheckCircle2 size={11} /> Keep</span>
                                : <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: 'var(--text-faint)' }}><Copy size={10} /> Extra</span>}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{p.title}</p>
                              <div className="flex items-center gap-2 mt-0.5 text-[11px] flex-wrap" style={{ color: 'var(--text-faint)' }}>
                                <a href={p.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-[#7C3AED] hover:underline truncate max-w-[320px]">/{p.slug} <ExternalLink size={9} /></a>
                                {p.createdAt && <span>{fmtDate(p.createdAt)}</span>}
                                {p.indexed && <span className="text-[#248a3d]" title="Google has this URL indexed">● indexed</span>}
                                {p.bodyImages > 0 && <span>{p.bodyImages} img</span>}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {!ran && !scanning && (
          <div className="card p-8 text-center" style={{ color: 'var(--text-faint)' }}>
            <Copy size={26} className="mx-auto mb-2 opacity-60" />
            Scan your published posts for duplicates (same product reviewed twice).
          </div>
        )}
      </div>
    </>
  )
}
