// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MVP x LTK — admin/Pro Labs tool. LTK (LiketoKnow.it / ShopLTK) has NO public
// API and forbids scraping, so this is NOT a browse-the-catalogue tool like
// MVP x Levanta / PartnerBoost. Instead the creator brings their OWN LTK link +
// a short product description, and MVP writes a fact-grounded post around it
// with the LTK link as the CTA — owned content that funnels traffic to their
// LTK shop. Nothing touches LTK's platform (same model as pasting an Amazon tag).

'use client'

import { useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { FlaskConical, Loader2, ExternalLink, CheckCircle2, Sparkles, Lock } from 'lucide-react'

const PINK = 'rgba(236,72,153,0.30)' // LTK skews fashion/lifestyle — warmer accent

export default function LtkPage() {
  const [ltkUrl, setLtkUrl] = useState('')
  const [productName, setProductName] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [publishLive, setPublishLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ url?: string; editUrl?: string; draft?: boolean; error?: string; forbidden?: boolean } | null>(null)
  const [peeking, setPeeking] = useState(false)
  const [peeked, setPeeked] = useState('')        // the URL we last auto-filled from (dedupe)
  const [prefillNote, setPrefillNote] = useState<string | null>(null)

  const canSubmit = /^https?:\/\//i.test(ltkUrl.trim()) && productName.trim().length > 1 && !busy

  // Best-effort: when the link field loses focus, try to pull the product name +
  // image off the LTK page so the creator doesn't have to type them. Only FILLS
  // EMPTY fields — never overwrites what the creator already entered. Silent on
  // failure (LTK is a JS SPA; OG tags are hit-or-miss), so it's a bonus, not a gate.
  async function peek() {
    const u = ltkUrl.trim()
    if (!/^https?:\/\//i.test(u) || u === peeked || busy) return
    setPeeked(u); setPeeking(true); setPrefillNote(null)
    try {
      const res = await fetch('/api/ltk/peek', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      })
      const j = await res.json().catch(() => ({}))
      if (!j.ok) return
      const filled: string[] = []
      if (j.name && !productName.trim()) { setProductName(j.name); filled.push('product name') }
      if (j.imageUrl && !imageUrl.trim()) { setImageUrl(j.imageUrl); filled.push('image') }
      setPrefillNote(
        filled.length
          ? `Pre-filled the ${filled.join(' + ')} from your link — double-check and edit if needed.`
          : "Couldn't read product details from that link — just fill them in below.",
      )
    } catch { /* silent — manual fields remain the source of truth */ }
    finally { setPeeking(false) }
  }

  async function generate() {
    if (!canSubmit) return
    setBusy(true); setResult(null)
    try {
      const res = await fetch('/api/ltk/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ltkUrl: ltkUrl.trim(),
          productName: productName.trim(),
          description: description.trim() || undefined,
          imageUrl: imageUrl.trim() || undefined,
          draft: !publishLive,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 403) { setResult({ forbidden: true, error: j.error }); return }
      if (!j.ok) { setResult({ error: j.error || 'Generation failed' }); return }
      setResult({ url: j.wordpressUrl, editUrl: j.editUrl, draft: j.draft })
      // Clear the product fields for the next one; keep nothing sensitive.
      setProductName(''); setDescription(''); setImageUrl('')
    } catch {
      setResult({ error: 'Network error — try again.' })
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-lg px-3 py-2.5 text-[14px] outline-none'
  const inputStyle = { background: 'var(--surface-bright)', border: '1px solid var(--border)', color: 'var(--text)' } as const

  return (
    <div className="max-w-3xl mx-auto px-5 lg:px-8 py-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(236,72,153,0.14)', color: '#EC4899', border: '1px solid rgba(236,72,153,0.28)' }}>
          <FlaskConical size={11} /> MVP Labs · Pro
        </span>
      </div>

      <PageHero
        title="MVP x LTK"
        subtitle="Turn any LTK pick into an SEO blog post + social content — written in your voice, with your LTK link as the call-to-action. The owned content LTK doesn't give you, funnelling traffic straight to your shop."
        accent={PINK}
      />

      {/* How it works — collapsible, open by default. */}
      <details open className="rounded-xl border mt-5 mb-6" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <summary className="cursor-pointer select-none px-5 py-4 text-[14px] font-semibold flex items-center gap-2" style={{ color: 'var(--text)' }}>
          <Sparkles size={15} className="text-[#EC4899]" /> How this works (and why it&apos;s LTK-safe)
        </summary>
        <div className="px-5 pb-5 text-[13.5px] leading-relaxed space-y-3" style={{ color: 'var(--text-soft)' }}>
          <p><strong style={{ color: 'var(--text)' }}>LTK has no public API</strong> and its terms don&apos;t allow outside tools to read your shop or post for you — so MVP never touches LTK. Instead, <strong style={{ color: 'var(--text)' }}>you bring the link</strong>: copy your own commissionable LTK URL for a product (your <code className="px-1 rounded" style={{ background: 'var(--surface-bright)' }}>liketk.it</code> / <code className="px-1 rounded" style={{ background: 'var(--surface-bright)' }}>shopltk.com</code> link) and MVP builds the content around it.</p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li><strong style={{ color: 'var(--text)' }}>Paste your LTK link</strong> for the product (grab it from your LTK app — Copy link). Your link carries your commission + your audience&apos;s discount; MVP uses it exactly as-is.</li>
            <li><strong style={{ color: 'var(--text)' }}>Name the product</strong> and add a couple of lines about it (what it is, who it&apos;s for). MVP tries to read the product name + image straight off your link to save you typing — confirm or tweak whatever it fills, and add your own notes (that&apos;s what makes the post genuinely yours).</li>
            <li><strong style={{ color: 'var(--text)' }}>Generate</strong> → MVP writes a fact-grounded review in your brand voice, builds a designed hero/CTA image, and publishes it to your WordPress (as a draft, or live) with a <em>&ldquo;Shop it on LTK&rdquo;</em> button pointing at your link.</li>
          </ol>
          <p>The result is SEO-able, owned content that ranks on Google and funnels readers to your LTK shop — something LTK&apos;s in-app posts can&apos;t do for you. Requires a connected WordPress site + a saved Brand Profile.</p>
        </div>
      </details>

      {/* Form */}
      <div className="rounded-xl border p-5 space-y-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
        <div>
          <label htmlFor="ltk-url" className="block text-[13px] font-medium mb-1.5 flex items-center gap-2" style={{ color: 'var(--text)' }}>
            Your LTK link <span style={{ color: '#EC4899' }}>*</span>
            {peeking && <span className="inline-flex items-center gap-1 text-[11px] font-normal" style={{ color: 'var(--text-faint)' }}><Loader2 size={11} className="animate-spin" /> reading link…</span>}
          </label>
          <input id="ltk-url" className={input} style={inputStyle} value={ltkUrl} onChange={e => setLtkUrl(e.target.value)} onBlur={peek} placeholder="https://liketk.it/…  or  https://www.shopltk.com/explore/you/…" />
          {prefillNote && <p className="mt-1.5 text-[12px]" style={{ color: 'var(--text-faint)' }}>{prefillNote}</p>}
        </div>
        <div>
          <label htmlFor="ltk-name" className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--text)' }}>Product name <span style={{ color: '#EC4899' }}>*</span></label>
          <input id="ltk-name" className={input} style={inputStyle} value={productName} onChange={e => setProductName(e.target.value)} placeholder="e.g. Quince Mongolian Cashmere Sweater" />
        </div>
        <div>
          <label htmlFor="ltk-desc" className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--text)' }}>A few details <span style={{ color: 'var(--text-faint)' }}>(optional, but better posts)</span></label>
          <textarea id="ltk-desc" className={input} style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }} value={description} onChange={e => setDescription(e.target.value)} placeholder="What it is, who it's for, why you picked it, fit/quality notes, price range — a couple of sentences in your own words." />
        </div>
        <div>
          <label htmlFor="ltk-img" className="block text-[13px] font-medium mb-1.5" style={{ color: 'var(--text)' }}>Product image URL <span style={{ color: 'var(--text-faint)' }}>(optional)</span></label>
          <input id="ltk-img" className={input} style={inputStyle} value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://…/product.jpg — used for the hero + CTA image" />
        </div>

        <div className="flex items-center justify-between gap-4 pt-1">
          <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--text-soft)' }}>
            <input type="checkbox" checked={publishLive} onChange={e => setPublishLive(e.target.checked)} />
            Publish live now <span style={{ color: 'var(--text-faint)' }}>(off = save as draft)</span>
          </label>
          <button
            onClick={generate}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[14px] font-semibold text-white transition-opacity disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#EC4899,#A855F7)' }}
          >
            {busy ? <><Loader2 size={15} className="animate-spin" /> Writing…</> : <>Generate post</>}
          </button>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="mt-4 rounded-xl border p-4 text-[14px]" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          {result.forbidden ? (
            <p className="flex items-center gap-2" style={{ color: 'var(--text-soft)' }}><Lock size={15} /> {result.error || 'MVP x LTK is a Pro feature.'}</p>
          ) : result.error ? (
            <p style={{ color: '#ff6b6b' }}>{result.error}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3" style={{ color: 'var(--text)' }}>
              <CheckCircle2 size={16} className="text-[#34c759]" />
              <span>{result.draft ? 'Draft created' : 'Published'} on WordPress.</span>
              {result.url && <a href={result.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 underline" style={{ color: '#EC4899' }}>View post <ExternalLink size={13} /></a>}
              {result.editUrl && <a href={result.editUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 underline" style={{ color: 'var(--text-soft)' }}>Edit in WP <ExternalLink size={13} /></a>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
