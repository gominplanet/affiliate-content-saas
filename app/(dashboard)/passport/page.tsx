'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Passport Links dashboard — clicks + countries + top products from the creator's
// geo-routing links. Reads /api/passport/analytics and renders totals, a trend, a
// country breakdown, top products, and sources.

import { useCallback, useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, Globe, MousePointerClick, MapPin, Package, TrendingUp } from 'lucide-react'
import PassportLinksCard from '@/components/brand/PassportLinksCard'

const COUNTRY: Record<string, { name: string; flag: string }> = {
  US: { name: 'United States', flag: '🇺🇸' }, GB: { name: 'United Kingdom', flag: '🇬🇧' },
  CA: { name: 'Canada', flag: '🇨🇦' }, DE: { name: 'Germany', flag: '🇩🇪' },
  FR: { name: 'France', flag: '🇫🇷' }, IT: { name: 'Italy', flag: '🇮🇹' },
  ES: { name: 'Spain', flag: '🇪🇸' }, NL: { name: 'Netherlands', flag: '🇳🇱' },
  SE: { name: 'Sweden', flag: '🇸🇪' }, PL: { name: 'Poland', flag: '🇵🇱' },
  BE: { name: 'Belgium', flag: '🇧🇪' }, JP: { name: 'Japan', flag: '🇯🇵' },
  AU: { name: 'Australia', flag: '🇦🇺' }, IN: { name: 'India', flag: '🇮🇳' },
  MX: { name: 'Mexico', flag: '🇲🇽' }, BR: { name: 'Brazil', flag: '🇧🇷' },
  SG: { name: 'Singapore', flag: '🇸🇬' }, AE: { name: 'UAE', flag: '🇦🇪' },
  SA: { name: 'Saudi Arabia', flag: '🇸🇦' }, TR: { name: 'Türkiye', flag: '🇹🇷' },
}
const cn = (c: string) => COUNTRY[c] || { name: c, flag: '🌐' }

interface Analytics {
  total: number; days: number
  byCountry: { country: string; count: number }[]
  bySource: { source: string; count: number }[]
  topProducts: { code: string; count: number; asin: string | null; label: string | null }[]
  byDay: { date: string; count: number }[]
}

export default function PassportPage() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  const load = useCallback(async (d: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/passport/analytics?days=${d}`)
      const j = await res.json()
      setData(j?.ok ? j : null)
    } catch { setData(null) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load(days) }, [days, load])

  const total = data?.total ?? 0
  const countriesReached = data?.byCountry.length ?? 0
  const topCountry = data?.byCountry[0]
  const topProduct = data?.topProducts[0]
  const peakDay = data?.byDay.reduce((m, d) => Math.max(m, d.count), 0) || 1

  return (
    <>
      <PageHero title="Passport Links" subtitle="Where your clicks come from, which products drive them, and how your geo-routing links are performing across every country." />

      {/* Setup — turn it on + enter per-country tags (lives here, self-contained). */}
      <div className="mb-6">
        <PassportLinksCard />
      </div>

      {/* Range */}
      <div className="flex items-center gap-2 mb-5">
        {[7, 30, 90].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors ${days === d ? 'border-[#7C3AED] text-[#7C3AED] bg-[#7C3AED]/10' : 'border-[var(--border-2)] text-[var(--text-3)]'}`}>
            Last {d} days
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-3)] py-16"><Loader2 size={18} className="animate-spin" /> Loading your clicks…</div>
      ) : total === 0 ? (
        <div className="card p-8 text-center">
          <Globe size={28} className="mx-auto mb-3 text-[#7C3AED]" />
          <p className="text-sm font-semibold text-[var(--text)]">No clicks yet</p>
          <p className="text-[13px] mt-1 max-w-md mx-auto text-[var(--text-3)]">
            Turn Passport Links on above, then drop your links in posts, YouTube descriptions, or your bio. Every click that comes back shows up here, grouped by country and product.
          </p>
        </div>
      ) : (
        <>
          {/* Stat tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Stat icon={<MousePointerClick size={16} />} label="Total clicks" value={total.toLocaleString()} accent="#7C3AED" />
            <Stat icon={<MapPin size={16} />} label="Countries reached" value={String(countriesReached)} accent="#0a84ff" />
            <Stat icon={<Globe size={16} />} label="Top country" value={topCountry ? `${cn(topCountry.country).flag} ${cn(topCountry.country).name}` : '—'} sub={topCountry ? `${topCountry.count.toLocaleString()} clicks` : ''} accent="#34c759" />
            <Stat icon={<Package size={16} />} label="Top product" value={topProduct ? (topProduct.label || topProduct.asin || '—') : '—'} sub={topProduct ? `${topProduct.count.toLocaleString()} clicks` : ''} accent="#ff9500" truncate />
          </div>

          {/* Trend */}
          <div className="card p-4 mb-5">
            <div className="flex items-center gap-2 mb-3" style={{ color: '#7C3AED' }}>
              <TrendingUp size={15} /><span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>Clicks over time</span>
            </div>
            <div className="flex items-end gap-[3px] h-24">
              {data!.byDay.map((d) => (
                <div key={d.date} className="flex-1 rounded-t" title={`${d.date}: ${d.count}`}
                  style={{ height: `${Math.max(2, (d.count / peakDay) * 100)}%`, background: d.count ? '#7C3AED' : 'var(--surface-2)', minWidth: 2 }} />
              ))}
            </div>
            <div className="flex justify-between text-[10px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
              <span>{data!.byDay[0]?.date}</span><span>{data!.byDay[data!.byDay.length - 1]?.date}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-5">
            {/* By country */}
            <div className="card p-4">
              <p className="text-[11px] uppercase tracking-wide font-semibold mb-3" style={{ color: 'var(--text-faint)' }}>Clicks by country</p>
              <div className="space-y-2">
                {data!.byCountry.slice(0, 10).map((c) => (
                  <div key={c.country} className="flex items-center gap-2">
                    <span className="text-[13px] w-40 flex-shrink-0 truncate" style={{ color: 'var(--text)' }}>{cn(c.country).flag} {cn(c.country).name}</span>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                      <div className="h-full rounded-full" style={{ width: `${(c.count / total) * 100}%`, background: '#7C3AED' }} />
                    </div>
                    <span className="text-[12px] font-semibold w-12 text-right tabular-nums" style={{ color: 'var(--text-soft)' }}>{c.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top products */}
            <div className="card p-4">
              <p className="text-[11px] uppercase tracking-wide font-semibold mb-3" style={{ color: 'var(--text-faint)' }}>Top products</p>
              <div className="space-y-2">
                {data!.topProducts.map((p) => (
                  <div key={p.code} className="flex items-center gap-2">
                    <span className="text-[12.5px] flex-1 min-w-0 truncate" style={{ color: 'var(--text)' }} title={p.label || p.asin || p.code}>{p.label || p.asin || p.code}</span>
                    <span className="text-[12px] font-semibold flex-shrink-0 tabular-nums" style={{ color: 'var(--text-soft)' }}>{p.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* By source */}
          {data!.bySource.length > 0 && (
            <div className="card p-4">
              <p className="text-[11px] uppercase tracking-wide font-semibold mb-3" style={{ color: 'var(--text-faint)' }}>Where clicks came from</p>
              <div className="flex flex-wrap gap-2">
                {data!.bySource.map((s) => (
                  <span key={s.source} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px]" style={{ background: 'var(--surface-2)', color: 'var(--text-soft)' }}>
                    {s.source} <b style={{ color: 'var(--text)' }}>{s.count.toLocaleString()}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}

function Stat({ icon, label, value, sub, accent, truncate }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent: string; truncate?: boolean }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-1.5" style={{ color: accent }}>{icon}<span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-faint)' }}>{label}</span></div>
      <p className={`text-[18px] font-extrabold ${truncate ? 'truncate' : ''}`} style={{ color: 'var(--text)' }} title={truncate ? value : undefined}>{value}</p>
      {sub ? <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>{sub}</p> : null}
    </div>
  )
}
