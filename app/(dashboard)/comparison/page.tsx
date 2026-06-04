'use client'

/**
 * Compare & Guides — paste up to 10 YouTube URLs (each a product you reviewed)
 * and MVP writes a multi-product COMPARISON (ranked, with a winner) or a
 * BUYING GUIDE ("best for ___"). One post against your cap.
 */
import { useState, useEffect } from 'react'
import PageHero from '@/components/layout/PageHero'
import FeatureLockedCard from '@/components/ui/FeatureLockedCard'
import { createBrowserClient } from '@/lib/supabase/client'
import { Scale, Plus, X, Loader2, ExternalLink, Trophy, ListChecks } from 'lucide-react'
import { SitePicker } from '@/components/SitePicker'
import { normalizeTier } from '@/lib/tier'
import { effectiveTier, VIEW_AS_EVENT } from '@/lib/view-as'

const MAX_URLS = 10

export default function ComparisonPage() {
  const supabase = createBrowserClient()
  const [urls, setUrls] = useState<string[]>(['', ''])
  const [mode, setMode] = useState<'comparison' | 'guide'>('comparison')
  const [topic, setTopic] = useState('')
  const [heroDataUrl, setHeroDataUrl] = useState<string | null>(null)
  const [heroName, setHeroName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; title: string; productCount: number; mode: string } | null>(null)
  const [tier, setTier] = useState<string | null>(null)
  // Multi-site: which WordPress site to publish this comparison to. Null
  // → SitePicker auto-selects the user's default. Hidden for single-site users.
  const [siteId, setSiteId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Stash the real DB tier separately from the effective tier so that
    // when the admin flips the View-as dropdown, we can re-resolve the
    // effective tier without re-querying Supabase.
    let realTier: string = 'trial'

    const apply = () => {
      if (cancelled) return
      // effectiveTier() returns the View-as override for admins, otherwise
      // the real tier. Non-admins get untouched real-tier behavior — this
      // is purely a preview override.
      setTier(effectiveTier(realTier))
    }

    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { realTier = 'trial'; apply(); return }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await supabase
          .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
        realTier = (data?.tier as string | undefined) ?? 'trial'
        apply()
      } catch {
        realTier = 'trial'
        apply()
      }
    })()

    // React to admin View-as switches without a page reload.
    window.addEventListener(VIEW_AS_EVENT, apply)
    return () => { cancelled = true; window.removeEventListener(VIEW_AS_EVENT, apply) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tier restructure 2026-06-04: Comparison + Buying Guides are now Pro-only.
  // (Was Creator+; Creator users see the FeatureLockedCard upsell now.)
  const isPro = tier === 'pro' || tier === 'admin'
  const validCount = urls.filter(u => u.trim()).length

  const setUrl = (i: number, v: string) => setUrls(prev => prev.map((u, idx) => (idx === i ? v : u)))
  const addUrl = () => setUrls(prev => (prev.length >= MAX_URLS ? prev : [...prev, '']))
  const removeUrl = (i: number) => setUrls(prev => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)))

  async function generate() {
    setBusy(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/blog/comparison', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrls: urls.map(u => u.trim()).filter(Boolean), format: mode, topic: topic.trim() || undefined, heroImageDataUrl: heroDataUrl || undefined, siteId }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) { setError(data.error || 'Generation failed'); return }
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally { setBusy(false) }
  }

  return (
    <>
      <PageHero
        title="Compare & Guides"
        subtitle="Turn the products you've reviewed into a ranked comparison or a buying guide — published straight to your blog."
      />

      {tier !== null && !isPro && (
        <FeatureLockedCard
          icon={<Scale size={28} strokeWidth={1.8} />}
          feature="Compare & Buying Guides"
          description="Paste 2-10 YouTube videos (each a product you reviewed). MVP writes a ranked head-to-head comparison or a 'best for ___' buying guide, with a verdict box, pros/cons, and a mobile-optimized comparison table — published straight to WordPress."
          bullets={[
            'Multi-product head-to-head with a named winner',
            'Buying guide mode: "best for ___" so readers self-select',
            'Verdict box at the top, comparison table mid-article',
            'Mobile layout + Schema.org markup so the post ranks',
            'Publishes straight to your WordPress site',
          ]}
          requiredTier="pro"
          currentTier={normalizeTier(tier)}
        />
      )}

      {(tier === null || isPro) && (
      <div className="max-w-2xl flex flex-col gap-5">
        {/* Format toggle */}
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">What should MVP write?</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMode('comparison')}
              className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition ${mode === 'comparison' ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40'}`}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]"><Trophy size={14} className="text-[#ff9500]" /> Comparison</span>
              <span className="text-xs text-[#86868b]">Head-to-head, ranked, names a winner.</span>
            </button>
            <button
              onClick={() => setMode('guide')}
              className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition ${mode === 'guide' ? 'border-[#7C3AED] bg-[#7C3AED]/5' : 'border-gray-200 dark:border-white/10 hover:border-[#7C3AED]/40'}`}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]"><ListChecks size={14} className="text-[#34c759]" /> Buying Guide</span>
              <span className="text-xs text-[#86868b]">&ldquo;Best for ___&rdquo; — helps readers self-select.</span>
            </button>
          </div>
        </div>

        {/* Topic (optional) */}
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Topic / title <span className="text-[#86868b] font-normal">(optional — MVP infers it from your videos)</span></label>
          <input
            type="text"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            placeholder='e.g. "Best Wine Travel Protectors in 2026"'
            className="input-field"
            disabled={busy}
          />
        </div>

        {/* Hero image — AI-generated by default, optional user upload */}
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Hero image <span className="text-[#86868b] font-normal">(optional — we generate one automatically)</span></label>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-200 dark:border-white/10 cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={busy}
                onChange={e => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  if (f.size > 8 * 1024 * 1024) { setError('Hero image must be under 8 MB.'); return }
                  const reader = new FileReader()
                  reader.onload = () => { setHeroDataUrl(reader.result as string); setHeroName(f.name) }
                  reader.readAsDataURL(f)
                }}
              />
              Upload your own
            </label>
            {heroName && (
              <span className="flex items-center gap-1.5 text-xs text-[#34c759] font-medium">
                {heroName}
                <button onClick={() => { setHeroDataUrl(null); setHeroName(null) }} disabled={busy} className="text-[#86868b] hover:text-[#ff3b30]"><X size={13} /></button>
              </span>
            )}
            {!heroName && <span className="text-xs text-[#86868b]">Leave blank and MVP designs an AI hero for the category.</span>}
          </div>
        </div>

        {/* URL inputs */}
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">YouTube video URLs <span className="text-[#86868b] font-normal">({validCount}/{MAX_URLS} — one product per video)</span></label>
          <div className="flex flex-col gap-2">
            {urls.map((u, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-[#86868b] w-5 text-right">{i + 1}.</span>
                <input
                  type="url"
                  value={u}
                  onChange={e => setUrl(i, e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  className="input-field flex-1 text-sm"
                  disabled={busy}
                />
                {urls.length > 2 && (
                  <button onClick={() => removeUrl(i)} disabled={busy} className="p-1.5 rounded-md text-[#86868b] hover:text-[#ff3b30] hover:bg-[#ff3b30]/5 transition" title="Remove">
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {urls.length < MAX_URLS && (
            <button onClick={addUrl} disabled={busy} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[#7C3AED] hover:underline disabled:opacity-50">
              <Plus size={13} /> Add another product
            </button>
          )}
        </div>

        {error && <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">{error}</p>}

        {result && (
          <div className="rounded-xl border border-[#34c759]/30 bg-[#34c759]/5 px-4 py-3">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Published! &ldquo;{result.title}&rdquo;</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">{result.productCount} products · {result.mode === 'comparison' ? 'comparison' : 'buying guide'}</p>
            <a href={result.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#7C3AED] hover:underline">
              View post <ExternalLink size={12} />
            </a>
          </div>
        )}

        {/* Multi-site picker: invisible for single-site users; dropdown
            with default pre-selected for Pro multi-site users. */}
        <SitePicker value={siteId} onChange={setSiteId} label="Publish to" />

        <button
          onClick={generate}
          disabled={busy || !isPro || validCount < 2}
          className="btn-primary self-start"
          title={validCount < 2 ? 'Add at least 2 product videos' : undefined}
        >
          {busy
            ? <><Loader2 size={14} className="animate-spin" /> Researching {validCount} products & writing…</>
            : <><Scale size={14} /> Generate {mode === 'comparison' ? 'comparison' : 'buying guide'}</>}
        </button>
        {busy && <p className="text-xs text-[#86868b] -mt-2">This can take a minute or two — resolving each product, ranking, generating images, and publishing.</p>}
      </div>
      )}
    </>
  )
}
