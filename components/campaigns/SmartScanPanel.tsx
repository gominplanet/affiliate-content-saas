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

const RULE_CHIPS = [
  '≥15% commission', '≥100 days left', '$45–$300', '≥200 sold/mo', '★3.8+',
  'video carousel required', 'no supplements · food · pharmacy · clothing',
]

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

  async function run() {
    setRunning(true); setError(null); setNote(null); setMatches(null); setSkippedCovered(0)
    try {
      const res = await requestCcSmartScan(CC_SMART_RULES)
      if (!res.ok) {
        setError(
          res.error === 'not-installed'
            ? 'SCOUT isn’t connected — install it (see "How it works" above), then scan again.'
            : res.error === 'timeout'
              ? 'The scan ran long and timed out — try again; a shorter opportunities list scans faster.'
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
      if (s?.blocked) setNote('Amazon asked for a pause partway through — these results are partial. Wait ~15 minutes before scanning again.')
      else if (s?.truncated) setNote(`Checked the top ${s.deepChecked} of ${s.passedOnCard} on-card candidates (Amazon-safe pacing). Scan again later to go deeper.`)
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
            Smart Scan <span className="font-normal" style={{ color: 'var(--text-faint)' }}>· MVP&apos;s proven rules — not a filter form</span>
          </p>
          <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>
            One click. SCOUT sweeps your whole Affiliate+ opportunities list and MVP keeps only campaigns that pass
            every rule below — then ranks them and shows the buy-to-review math. Products already in your queue are skipped.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {RULE_CHIPS.map(c => (
              <span key={c} className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                style={{ background: 'rgba(124,58,237,0.10)', color: '#7C3AED' }}>{c}</span>
            ))}
          </div>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white flex-shrink-0 disabled:opacity-70"
          style={{ background: '#7C3AED' }}
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? 'Scanning… (a few minutes)' : 'Smart Scan'}
        </button>
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
              ? 'No campaigns passed every rule this pass — that’s the rulebook doing its job. Try again when new opportunities land.'
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
