// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /tools/clean-links — "Lasso refugee" cleanup. Removes duplicated affiliate-tag
// artifacts (e.g. ...&tag=you-20&tag=you-20) baked into post HTML after another
// plugin was deleted. Pure text fix: no article regeneration, no images, no AI
// cost. Always previews first (dry run); writing only happens on Apply.
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Button } from '@/components/ui/button'
import { Loader2, Wand2, ExternalLink, CheckCircle2, ShieldCheck } from 'lucide-react'

interface PostResult { id: number; link: string; fixed: number; updated: boolean }
interface ScanResult {
  dryRun: boolean
  scanned: number
  postsWithIssues: number
  duplicateTagsFound: number
  postsUpdated: number
  posts: PostResult[]
}

export default function CleanLinksPage() {
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState<false | 'preview' | 'apply'>(false)
  const [result, setResult] = useState<ScanResult | null>(null)

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'apply')
    try {
      const res = await fetch('/api/wordpress/clean-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: category.trim() || undefined, dryRun }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Something went wrong.'); return }
      setResult(data as ScanResult)
      if (dryRun) {
        toast.success(
          data.postsWithIssues > 0
            ? `Found ${data.duplicateTagsFound} duplicate tag${data.duplicateTagsFound === 1 ? '' : 's'} across ${data.postsWithIssues} post${data.postsWithIssues === 1 ? '' : 's'}.`
            : 'No duplicate-tag artifacts found — nothing to clean. 🎉',
        )
      } else {
        toast.success(`Cleaned ${data.postsUpdated} post${data.postsUpdated === 1 ? '' : 's'}.`)
      }
    } catch {
      toast.error('Network error — try again.')
    } finally { setBusy(false) }
  }

  const hasIssues = (result?.postsWithIssues ?? 0) > 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <PageHero
        title="Clean affiliate links"
        subtitle="Removes duplicate affiliate-tag leftovers from old plugins (like Lasso). Free — no rewriting, no images."
      />

      <div className="card p-5 mt-4">
        <div className="flex items-start gap-2.5 rounded-xl bg-[#34c759]/10 border border-[#34c759]/30 p-3 mb-4">
          <ShieldCheck size={16} className="text-[#34c759] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[#3a3a3c] dark:text-[#ebebf0] leading-relaxed">
            This only collapses a <strong>duplicated affiliate tag</strong> in your links (e.g.{' '}
            <code className="px-1 rounded bg-black/10 dark:bg-white/10">&amp;tag=you-20&amp;tag=you-20</code>{' '}
            → <code className="px-1 rounded bg-black/10 dark:bg-white/10">&amp;tag=you-20</code>). It never
            changes where a link goes, never rewrites your article, and never touches images. Always{' '}
            <strong>Preview</strong> first.
          </p>
        </div>

        <label className="block text-xs font-semibold text-[#3a3a3c] dark:text-[#ebebf0] mb-1">
          Limit to a category (optional)
        </label>
        <input
          value={category}
          onChange={e => setCategory(e.target.value)}
          placeholder="e.g. blog — leave blank to scan all published posts"
          className="input-field h-9 px-3 text-sm w-full mb-4"
        />

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => run(true)} loading={busy === 'preview'} disabled={!!busy}
            leftIcon={<Wand2 size={14} />}>
            Preview (dry run)
          </Button>
          <Button variant="primary" onClick={() => run(false)} loading={busy === 'apply'}
            disabled={!!busy || !hasIssues}
            title={hasIssues ? 'Apply the fixes to your live posts' : 'Run a preview first'}>
            Apply fixes{hasIssues ? ` (${result!.postsWithIssues})` : ''}
          </Button>
        </div>
      </div>

      {result && (
        <div className="card p-5 mt-4">
          <div className="flex items-center gap-2 mb-3">
            {result.dryRun
              ? <Wand2 size={16} className="text-[#7C3AED]" />
              : <CheckCircle2 size={16} className="text-[#34c759]" />}
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {result.dryRun ? 'Preview' : 'Applied'} — scanned {result.scanned} posts
            </p>
          </div>

          {!hasIssues ? (
            <p className="text-sm text-[#86868b]">No duplicate-tag artifacts found. Nothing to fix. 🎉</p>
          ) : (
            <>
              <p className="text-sm text-[#3a3a3c] dark:text-[#ebebf0] mb-3">
                {result.dryRun
                  ? <>Found <strong>{result.duplicateTagsFound}</strong> duplicate tag(s) across <strong>{result.postsWithIssues}</strong> post(s). Click <strong>Apply fixes</strong> to clean them.</>
                  : <>Cleaned <strong>{result.postsUpdated}</strong> of {result.postsWithIssues} post(s).</>}
              </p>
              <ul className="flex flex-col divide-y divide-[var(--border-2)]">
                {result.posts.map(p => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <a href={p.link} target="_blank" rel="noopener noreferrer"
                      className="text-[#7C3AED] hover:underline inline-flex items-center gap-1 truncate">
                      {p.link.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '') || `post ${p.id}`}
                      <ExternalLink size={11} className="flex-shrink-0" />
                    </a>
                    <span className="text-xs text-[#86868b] flex-shrink-0">
                      {p.fixed} fixed{!result.dryRun && (p.updated ? ' ✓' : ' — failed')}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
