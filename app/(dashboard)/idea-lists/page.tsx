// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Idea Lists → Shopping Guide. Paste an Amazon idea-list URL (or, once SCOUT
// syncs them, pick from your synced lists), MVP scores the products and writes
// a curated shopping-guide post linking each pick + your full list.
'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import PageHero from '@/components/layout/PageHero'
import { toast } from 'sonner'
import { Loader2, Search, Sparkles, ExternalLink, ListChecks, Pencil, Trash2 } from 'lucide-react'
import { errText } from '@/lib/err-text'

const BlogEditModal = dynamic(() => import('@/components/content/BlogEditModal'), { ssr: false })

interface Item { asin: string; title: string | null; image: string | null }
const PURPLE = '#7C3AED'

export default function IdeaListsPage() {
  const [url, setUrl] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scan, setScan] = useState<{ title: string | null; declaredCount: number | null; items: Item[]; partial: boolean } | null>(null)
  const [count, setCount] = useState(10)
  const [generating, setGenerating] = useState(false)
  const [done, setDone] = useState<{ url: string; title: string; picked: number; postId: string | null; wpPostId: number | null } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const runScan = async () => {
    if (!url.trim()) { toast.error('Paste your Amazon idea-list link.'); return }
    setScanning(true); setScan(null); setDone(null)
    try {
      const res = await fetch('/api/idea-list/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) })
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not read that list.')
      setScan({ title: d.title, declaredCount: d.declaredCount, items: d.items, partial: d.partial })
      setCount(Math.min(10, Math.max(3, Math.min(d.items.length, 10))))
    } catch (e) { toast.error(errText(e)) }
    finally { setScanning(false) }
  }

  const generate = async () => {
    if (!scan) return
    setGenerating(true); setDone(null)
    try {
      const res = await fetch('/api/idea-list/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: scan.items, listTitle: scan.title, listUrl: url.trim(), count }),
      })
      const d = await res.json()
      if (!res.ok || !d.ok) throw new Error(d.error || 'Could not build the guide.')
      setDone({ url: d.url, title: d.title, picked: d.picked, postId: d.postId ?? null, wpPostId: d.wpPostId ?? null })
      toast.success('Shopping guide published')
    } catch (e) { toast.error(errText(e)) }
    finally { setGenerating(false) }
  }

  const removePost = async () => {
    if (!done) return
    if (!confirm('Delete this post? It will be removed from your blog.')) return
    setDeleting(true)
    try {
      const res = await fetch('/api/blog/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(done.postId ? { postId: done.postId } : { wpPostId: done.wpPostId }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Delete failed.')
      toast.success('Post deleted')
      setDone(null)
    } catch (e) { toast.error(errText(e)) }
    finally { setDeleting(false) }
  }

  const maxPicks = Math.min(15, scan?.items.length ?? 15)

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <PageHero
        title="Idea Lists → Shopping Guide"
        subtitle="Turn an Amazon idea list into a curated shopping-guide post. MVP scores the products, picks the best, and links each one plus your full list."
      />

      {/* Paste a list URL */}
      <div className="rounded-xl border border-black/5 dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4 mt-4">
        <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">Paste your Amazon idea-list link</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void runScan() }} placeholder="https://www.amazon.com/shop/yourhandle/list/…" className="flex-1 rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]" />
          <button onClick={runScan} disabled={scanning || !url.trim()} className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: PURPLE }}>
            {scanning ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            {scanning ? 'Reading…' : 'Read list'}
          </button>
        </div>
        <p className="text-[11px] text-[#86868b] mt-2 inline-flex items-center gap-1.5"><ListChecks size={12} /> Coming with the SCOUT update: pick from all your synced idea lists, no link needed.</p>
      </div>

      {/* Scan result */}
      {scan && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{scan.title || 'Your list'}</p>
            <p className="text-[12px] text-[#86868b]">{scan.items.length}{scan.declaredCount && scan.declaredCount > scan.items.length ? ` of ${scan.declaredCount}` : ''} products read</p>
          </div>
          {scan.partial && (
            <div className="rounded-lg border border-[#ff9500]/40 bg-[#ff9500]/10 p-2.5 text-[11px] text-[#9a5d00] dark:text-[#ffcf8f] mb-3">
              Amazon lazy-loads long lists, so a pasted link reads the first {scan.items.length}. That&apos;s plenty to pick a top {count}. The SCOUT update will capture all {scan.declaredCount}.
            </div>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
            {scan.items.slice(0, 15).map(it => (
              <div key={it.asin} className="rounded-lg border border-black/5 dark:border-white/10 overflow-hidden bg-white dark:bg-[#2c2c2e] p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {it.image ? <img src={it.image} alt={it.title || it.asin} className="w-full h-16 object-contain" /> : <div className="h-16 flex items-center justify-center text-[10px] text-[#c7c7cc]">{it.asin}</div>}
                <p className="text-[10px] text-[#4b4b4f] dark:text-[#b0b0b5] mt-1 line-clamp-2">{it.title || it.asin}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end gap-3 rounded-xl border border-[#7C3AED]/25 bg-[#7C3AED]/5 p-4">
            <div className="flex-1">
              <p className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">How many picks in the guide?</p>
              <div className="flex items-center gap-3">
                <input type="range" min={3} max={maxPicks} value={Math.min(count, maxPicks)} onChange={e => setCount(Number(e.target.value))} className="flex-1 accent-[#7C3AED]" />
                <span className="text-[13px] font-bold text-[#7C3AED] tabular-nums w-6 text-center">{Math.min(count, maxPicks)}</span>
              </div>
              <p className="text-[11px] text-[#86868b] mt-1">Scored by your sales, demand, deals, campaigns and ratings.</p>
            </div>
            <button onClick={generate} disabled={generating} className="shrink-0 inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-[14px] font-bold text-white disabled:opacity-60" style={{ backgroundColor: PURPLE }}>
              {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {generating ? 'Writing your guide…' : `Create shopping guide`}
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className="mt-4 rounded-xl border border-[#34c759]/30 bg-[#34c759]/[0.06] p-4">
          <p className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Published: {done.title}</p>
          <p className="text-[12px] text-[#4b4b4f] dark:text-[#b0b0b5] mt-0.5 mb-2.5">{done.picked} picks, a fresh thumbnail, and a link to your full list.</p>
          <div className="flex flex-wrap items-center gap-3">
            <a href={done.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#7C3AED] hover:underline">View the post <ExternalLink size={13} /></a>
            {done.postId && (
              <button onClick={() => setEditOpen(true)} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#7C3AED]"><Pencil size={13} /> Edit</button>
            )}
            <button onClick={removePost} disabled={deleting} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#ff3b30] hover:underline disabled:opacity-50">
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
            </button>
          </div>
        </div>
      )}

      {editOpen && done?.postId && (
        <BlogEditModal postId={done.postId} onClose={() => setEditOpen(false)} onSaved={() => toast.success('Saved to your blog')} />
      )}
    </div>
  )
}
