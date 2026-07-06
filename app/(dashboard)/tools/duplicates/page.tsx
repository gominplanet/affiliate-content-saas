// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /tools/duplicates — find duplicate / near-duplicate published posts (the
// "same product reviewed twice" problem: WordPress appends -2/-3 to a colliding
// slug). Duplicates cause "Crawled – currently not indexed", self-cannibalization
// in search, and 404s once the extras get cleaned up. v1 is READ-ONLY detection:
// it groups the dupes and suggests which one to keep. The one-click merge (301
// the extras → keeper, then trash them) ships next as an explicit action.
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Loader2, Copy, ExternalLink, RefreshCw, ChevronLeft, CheckCircle2, Info } from 'lucide-react'

interface DupPost {
  id: string
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

  async function runScan() {
    setScanning(true)
    try {
      const res = await fetch('/api/tools/duplicates/scan', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Scan failed'); return }
      setGroups((data.groups as DupGroup[]) ?? [])
      setScanned(data.scanned ?? 0)
      setExtraCount(data.extraCount ?? 0)
      setSource((data.source as 'wordpress' | 'database') ?? 'database')
      setRan(true)
      const n = data.groupCount ?? 0
      toast.success(n ? `Found ${n} duplicate group${n === 1 ? '' : 's'} (${data.extraCount} extra post${data.extraCount === 1 ? '' : 's'}).` : 'No duplicates found — nice and clean.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  return (
    <>
      <PageHero
        title="Duplicate posts"
        subtitle="Find the same product reviewed twice (WordPress adds -2 / -3 to colliding slugs). Duplicates cause Google's “Crawled – not indexed”, split your rankings, and leave 404s behind — this finds them so you can keep the best one."
      />

      <div className="max-w-4xl">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/seo" className="inline-flex items-center gap-1 text-sm text-[#86868b] hover:text-[#7C3AED]">
            <ChevronLeft size={15} /> SEO
          </Link>
          <button onClick={runScan} disabled={scanning}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60">
            {scanning ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {scanning ? 'Scanning your posts…' : ran ? 'Re-scan' : 'Scan for duplicates'}
          </button>
          {ran && !scanning && (
            <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
              {groups.length} group{groups.length === 1 ? '' : 's'} · {extraCount} extra · {scanned} {source === 'wordpress' ? 'live WordPress posts' : 'MVP posts'} scanned
            </span>
          )}
        </div>

        {ran && groups.length === 0 && !scanning && (
          <div className="card p-8 text-center" style={{ color: 'var(--text-faint)' }}>
            <CheckCircle2 size={26} className="mx-auto mb-2 text-[#34c759]" />
            No duplicate posts detected. Your archive is clean.
          </div>
        )}

        {groups.length > 0 && (
          <>
            <div className="flex items-start gap-2 text-[12px] mb-4 p-3 rounded-lg" style={{ background: 'rgba(124,58,237,0.06)', color: 'var(--text-2)' }}>
              <Info size={14} className="mt-0.5 flex-shrink-0 text-[#7C3AED]" />
              <div>
                Each group is the same product published more than once. The <span className="font-semibold text-[#248a3d]">✓ Keep</span> tag marks the strongest copy (already indexed by Google, or the original). One-click merge — 301-redirect the extras to the keeper, then trash them — is coming next. For now you can open each extra in WordPress and trash it, then set a redirect to the keeper.
              </div>
            </div>

            <div className="space-y-4">
              {groups.map(g => (
                <div key={g.key} className="card p-3">
                  <div className="text-[11px] font-medium mb-2" style={{ color: 'var(--text-faint)' }}>
                    {g.reason === 'duplicate-slug' ? '🔁 Duplicate slug' : '🎬 Same video'} · {g.posts.length} posts
                  </div>
                  <div className="divide-y divide-gray-100 dark:divide-white/10">
                    {g.posts.map(p => (
                      <div key={p.id} className="flex items-center gap-3 py-2">
                        <div className="w-14 flex-shrink-0">
                          {p.isKeeperSuggested
                            ? <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#248a3d]"><CheckCircle2 size={11} /> Keep</span>
                            : <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold" style={{ color: 'var(--text-faint)' }}><Copy size={10} /> Extra</span>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{p.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] flex-wrap" style={{ color: 'var(--text-faint)' }}>
                            <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[#7C3AED] hover:underline truncate max-w-[320px]">/{p.slug} <ExternalLink size={9} /></a>
                            {p.createdAt && <span>{fmtDate(p.createdAt)}</span>}
                            {p.indexed && <span className="text-[#248a3d]" title="Google has this URL indexed">● indexed</span>}
                            {p.bodyImages > 0 && <span>{p.bodyImages} img</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!ran && !scanning && (
          <div className="card p-8 text-center" style={{ color: 'var(--text-faint)' }}>
            <Copy size={26} className="mx-auto mb-2 opacity-60" />
            Scan your published posts for duplicates (same product reviewed twice). Read-only — nothing is changed.
          </div>
        )}
      </div>
    </>
  )
}
