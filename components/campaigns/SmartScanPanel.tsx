'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// MVP Smart Scan — the opinionated alternative to generic CC filter tools:
// one click, no criteria form. SCOUT sweeps the whole Affiliate+ grid and MVP
// applies its PROVEN rulebook (lib/cc-smart-rules.ts) + skips products you've
// already got in your queue, then ranks what's left with a score and the WHY.
//
// Every match offers both plays:
//   💌 Message brand  — the collab / free-product route (existing outreach modal)
//   🛒 Buy to review  — MVP's preferred route: invest in the product, make the
//      review, earn it back through the campaign. The break-even line makes the
//      decision concrete ("$89 in → $22/sale → 5 sales to break even").

import { useState } from 'react'
import { Sparkles, Loader2, ExternalLink, MessageCircle, ShoppingCart, Play } from 'lucide-react'
import { requestCcSmartScan } from '@/lib/extension-frame'
import { CC_SMART_RULES, passesGates, scoreMatch, type ScoredMatch } from '@/lib/cc-smart-rules'
import type { MessageBrandCampaign } from '@/components/campaigns/MessageBrandModal'

export default function SmartScanPanel({
  coveredAsins,
  onMessageBrand,
}: {
  /** ASINs already in the user's queue / covered by their content — skipped. */
  coveredAsins: string[]
  onMessageBrand: (c: MessageBrandCampaign) => void
}) {
  const [running, setRunning] = useState(false)
  const [matches, setMatches] = useState<ScoredMatch[] | null>(null)
  const [skippedCovered, setSkippedCovered] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Optional focus — narrows WHERE the deep-check budget goes, never the rules.
  const [focus, setFocus] = useState('')

  async function run() {
    setRunning(true); setError(null); setNote(null); setMatches(null); setSkippedCovered(0)
    try {
      const res = await requestCcSmartScan(CC_SMART_RULES, focus)
      if (!res.ok) {
        setError(
          res.error === 'not-installed'
            ? 'SCOUT isn’t connected — install it (see "How it works" above), then scan again.'
            : res.error === 'timeout'
              ? 'The scan ran long and timed out — try again; a shorter opportunities list scans faster.'
              : res.error === 'sponsored-tab'
                ? 'Your Creator Connections tab is on "Sponsored Products for Creators". Switch it to the "Affiliate+ campaigns" tab (or close it and let SCOUT open its own), then scan again.'
                : `Scan failed (${res.error || 'unknown'}). Open your Creator Connections tab once, then retry.`,
        )
        return
      }
      const covered = new Set(coveredAsins.map(a => a.toUpperCase()))
      const raw = res.matches ?? []
      const fresh = raw.filter(m => !(m.asin && covered.has(m.asin.toUpperCase())))
      setSkippedCovered(raw.length - fresh.length)
      const scored = fresh
        .filter(m => passesGates(m, CC_SMART_RULES)) // defense in depth vs stale extension
        .map(m => scoreMatch(m, CC_SMART_RULES))
        .sort((a, b) => b.score - a.score)
      setMatches(scored)
      const s = res.stats
      // Drop breakdown — dimension labels only, never the thresholds. Doubles
      // as the extraction-health signal: a pile-up on "couldn't read the page"
      // means selectors need tuning, not that the market is empty.
      const d = s?.drops
      const dropBits: string[] = []
      if (d) {
        if (d.sales) dropBits.push(`sales volume ×${d.sales}`)
        if (d.carousel) dropBits.push(`no product-page video ×${d.carousel}`)
        if (d.price) dropBits.push(`price ×${d.price}`)
        if (d.rating) dropBits.push(`rating ×${d.rating}`)
        if (d.category) dropBits.push(`excluded category ×${d.category}`)
        if (d.unreadable) dropBits.push(`couldn't read the page ×${d.unreadable}`)
      }
      const dropLine = dropBits.length ? ` Dropped on: ${dropBits.join(' · ')}.` : ''
      if (s?.blocked) setNote(`Amazon asked for a pause partway through — these results are partial. Wait ~15 minutes before scanning again.${dropLine}`)
      else if (s?.truncated) setNote(`Checked the top ${s.deepChecked} of ${s.passedOnCard} on-card candidates (Amazon-safe pacing). Scan again later to go deeper.${dropLine}`)
      else if (dropBits.length) setNote(`Deep-checked ${s?.deepChecked ?? 0} candidates.${dropLine}`)
    } catch {
      setError('Scan failed unexpectedly — reload the page and try again.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="card mb-5 overflow-hidden">
      <div className="px-4 py-3 flex items-start gap-3 flex-wrap">
        <span className="grid place-items-center w-7 h-7 rounded-lg flex-shrink-0 mt-0.5" style={{ background: 'rgba(124,58,237,0.12)' }}>
          <Sparkles size={14} className="text-[#7C3AED]" />
        </span>
        <div className="flex-1 min-w-[240px]">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
            Smart Scan <span className="font-normal" style={{ color: 'var(--text-faint)' }}>· powered by MVP&apos;s proprietary campaign criteria</span>
          </p>
          <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
            One click. SCOUT sweeps your whole Affiliate+ opportunities list and MVP keeps only the campaigns worth
            your time — vetted for real commission, runway, demand, product quality and review visibility — then ranks
            them and shows the buy-to-review math. Products already in your queue are skipped.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <input
            value={focus}
            onChange={e => setFocus(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !running) run() }}
            placeholder="Focus (optional) — e.g. massage gun"
            title="Optional: a keyword or brand to focus the scan. SCOUT searches the full Creator Connections catalog for it, so the rulebook's deep-checks concentrate on that niche. Leave empty to sweep everything."
            disabled={running}
            className="text-[12px] px-3 py-2 rounded-lg bg-white dark:bg-[#1c1c1e] border border-gray-200 dark:border-white/10 focus:border-[#7C3AED] focus:outline-none w-[210px] disabled:opacity-60"
            style={{ color: 'var(--text)' }}
          />
          <button
            onClick={run}
            disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-70"
            style={{ background: '#7C3AED' }}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? 'Scanning… (a few minutes)' : 'Smart Scan'}
          </button>
        </div>
      </div>

      {running && (
        <div className="px-4 pb-3 text-[12px]" style={{ color: 'var(--text-faint)' }}>
          Sweeping the grid, then deep-checking the best candidates one by one (price · monthly units · rating · video carousel) —
          paced so Amazon stays happy. Please don&apos;t browse Amazon while this runs.
        </div>
      )}
      {error && <div className="px-4 pb-3 text-[12px] text-[#ff3b30]">{error}</div>}
      {note && !error && <div className="px-4 pb-3 text-[12px]" style={{ color: 'var(--text-faint)' }}>{note}</div>}

      {matches && !error && (
        <div className="border-t border-gray-100 dark:border-white/10">
          <div className="px-4 py-2 text-[12px]" style={{ color: 'var(--text-faint)' }}>
            {matches.length === 0
              ? 'Nothing cleared MVP’s bar this pass — that’s the vetting doing its job. Try again when new opportunities land.'
              : <>Found <b style={{ color: 'var(--text)' }}>{matches.length}</b> campaign{matches.length !== 1 ? 's' : ''} worth your time{skippedCovered > 0 ? ` · ${skippedCovered} already in your queue skipped` : ''}.</>}
          </div>
          <div className="divide-y divide-gray-100 dark:divide-white/10">
            {matches.map((m) => (
              <div key={`${m.asin || m.detailsUrl}`} className="px-4 py-3 flex gap-3 items-start">
                {m.image
                  ? <img src={m.image} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-gray-100" />
                  : <div className="w-12 h-12 rounded-lg flex-shrink-0" style={{ background: 'rgba(124,58,237,0.08)' }} />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center justify-center min-w-[38px] px-1.5 py-0.5 rounded-md text-[12px] font-bold text-white"
                      style={{ background: m.score >= 80 ? '#34c759' : m.score >= 65 ? '#7C3AED' : '#86868b' }}>
                      {m.score}
                    </span>
                    <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text)' }}>
                      {m.campaignName || m.asin}{m.brand ? <span className="font-normal" style={{ color: 'var(--text-faint)' }}> · {m.brand}</span> : null}
                    </p>
                  </div>
                  <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                    {m.reasons.join(' · ')}
                  </p>
                  {m.roi && (
                    <p className="text-[11px] mt-1 font-medium" style={{ color: '#34c759' }}>
                      Buy to review: ${m.roi.costUsd.toFixed(0)} in → ${m.roi.perSaleUsd.toFixed(2)}/sale back → break even at {m.roi.breakEvenSales} sales
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <button
                      onClick={() => onMessageBrand({
                        product: m.campaignName || m.asin || 'this product',
                        asin: m.asin || '',
                        commissionPct: m.commissionPct,
                        detailsUrl: m.detailsUrl || '',
                        brandLabel: m.brand || undefined,
                      })}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border"
                      style={{ borderColor: 'rgba(124,58,237,0.4)', color: '#7C3AED' }}
                    >
                      <MessageCircle size={11} /> Message brand
                    </button>
                    {m.asin && (
                      <a
                        href={`https://www.amazon.com/dp/${m.asin}`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white"
                        style={{ background: '#34c759' }}
                      >
                        <ShoppingCart size={11} /> Buy to review
                      </a>
                    )}
                    {m.detailsUrl && (
                      <a
                        href={m.detailsUrl}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        <ExternalLink size={11} /> Open campaign
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
