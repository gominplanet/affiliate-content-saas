// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /tools/fix-formatting — self-service repair for posts that render raw block
// code (e.g. "<!, wp:paragraph , >") instead of clean text. One click scans the
// user's own posts, previews what's broken, and fixes them in place — live post
// + stored copy. Pure structural fix: no rewriting, no images, no AI cost.
'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Button } from '@/components/ui/button'
import { Loader2, Wand2, ExternalLink, CheckCircle2, ShieldCheck } from 'lucide-react'

interface PostResult { postId: number; link: string; before: number; updated: boolean }
interface ScanResult {
  dryRun: boolean
  scanned: number
  postsWithIssues: number
  markersFound: number
  postsUpdated: number
  posts: PostResult[]
}

export default function FixFormattingPage() {
  const [busy, setBusy] = useState<false | 'preview' | 'apply'>(false)
  const [result, setResult] = useState<ScanResult | null>(null)

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'apply')
    try {
      const res = await fetch('/api/wordpress/repair-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Something went wrong.'); return }
      setResult(data as ScanResult)
      if (dryRun) {
        toast.success(
          data.postsWithIssues > 0
            ? `Found broken formatting in ${data.postsWithIssues} post${data.postsWithIssues === 1 ? '' : 's'}.`
            : 'No broken formatting found — all your posts look clean. 🎉',
        )
      } else {
        toast.success(`Fixed ${data.postsUpdated} post${data.postsUpdated === 1 ? '' : 's'}.`)
      }
    } catch {
      toast.error('Network error — try again.')
    } finally { setBusy(false) }
  }

  const hasIssues = (result?.postsWithIssues ?? 0) > 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <PageHero
        title="Fix broken post formatting"
        subtitle="Repairs posts that show raw code instead of clean text. Free — no rewriting, no images, no AI."
      />

      <div className="card p-5 mt-4">
        <div className="flex items-start gap-2.5 rounded-xl bg-[#34c759]/10 border border-[#34c759]/30 p-3 mb-4">
          <ShieldCheck size={16} className="text-[#34c759] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[#3a3a3c] dark:text-[#ebebf0] leading-relaxed">
            If a published post shows raw code like{' '}
            <code className="px-1 rounded bg-black/10 dark:bg-white/10">&lt;!, wp:paragraph , &gt;</code>{' '}
            in the middle of your article, this fixes it. It only repairs those broken block
            markers, <strong>never rewrites your writing</strong> and never touches images.
            It checks your published posts <em>and</em> your drafts, so anything still waiting to
            publish comes out clean too. Always <strong>Preview</strong> first.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => run(true)} loading={busy === 'preview'} disabled={!!busy}
            leftIcon={<Wand2 size={14} />}>
            Preview (dry run)
          </Button>
          <Button variant="primary" onClick={() => run(false)} loading={busy === 'apply'}
            disabled={!!busy || !hasIssues}
            title={hasIssues ? 'Apply the fixes to your posts' : 'Run a preview first'}>
            Fix {hasIssues ? `${result!.postsWithIssues} post${result!.postsWithIssues === 1 ? '' : 's'}` : 'posts'}
          </Button>
        </div>

        {busy && (
          <p className="text-xs text-[#86868b] mt-3 inline-flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Checking your posts — this can take a moment on larger blogs.
          </p>
        )}
      </div>

      {result && (
        <div className="card p-5 mt-4">
          <div className="flex items-center gap-2 mb-3">
            {result.dryRun
              ? <Wand2 size={16} className="text-[#7C3AED]" />
              : <CheckCircle2 size={16} className="text-[#34c759]" />}
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {result.dryRun ? 'Preview' : 'Fixed'} — checked {result.scanned} post{result.scanned === 1 ? '' : 's'}
            </p>
          </div>

          {!hasIssues ? (
            <p className="text-sm text-[#86868b]">No broken formatting found. Nothing to fix. 🎉</p>
          ) : (
            <>
              <p className="text-sm text-[#3a3a3c] dark:text-[#ebebf0] mb-3">
                {result.dryRun
                  ? <>Found broken formatting in <strong>{result.postsWithIssues}</strong> post{result.postsWithIssues === 1 ? '' : 's'}. Click <strong>Fix</strong> to clean them.</>
                  : <>Fixed <strong>{result.postsUpdated}</strong> of {result.postsWithIssues} post{result.postsWithIssues === 1 ? '' : 's'}.</>}
              </p>
              <ul className="flex flex-col divide-y divide-[var(--border-2)]">
                {result.posts.map(p => (
                  <li key={p.postId} className="flex items-center justify-between gap-3 py-2 text-sm">
                    {p.link ? (
                      <a href={p.link} target="_blank" rel="noopener noreferrer"
                        className="text-[#7C3AED] hover:underline inline-flex items-center gap-1 truncate">
                        {p.link.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '') || `post ${p.postId}`}
                        <ExternalLink size={11} className="flex-shrink-0" />
                      </a>
                    ) : (
                      <span className="truncate text-[#3a3a3c] dark:text-[#ebebf0]">post {p.postId}</span>
                    )}
                    <span className="text-xs text-[#86868b] flex-shrink-0">
                      {p.before} fixed{!result.dryRun && (p.updated ? ' ✓' : ' — draft/queued')}
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
