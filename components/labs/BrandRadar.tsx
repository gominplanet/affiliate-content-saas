// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Brand Radar (LABS) — pull a creator's full Amazon storefront + TikTok through an
// external provider (server-side, so it never times out like the in-browser crawl)
// and give them: (1) a SEARCHABLE list of every brand they've worked with, merged
// across both, and (2) a TRYBE cross-check — paste the brands a marketplace shows
// and instantly see which ones they already promote. Ships dark until a provider
// token is set.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Radar, Store, Music2, Search, Check, AlertCircle, Sparkles, Tag, ShoppingBag } from 'lucide-react'
import PageHero from '@/components/layout/PageHero'

const ACCENT = '#7C3AED'

interface Providers { apify: boolean; socialcrawl: boolean }
interface WorkedBrand { key: string; brand: string; amazon: number; tiktok: number; confident: boolean; image: string | null }
interface EnrichStatus { configured: boolean; total: number; withBrand: number; remaining: number }
interface MatchRow { name: string; worked: boolean; brand?: string; amazon?: number; tiktok?: number; confident?: boolean; sources?: string[] }

export default function BrandRadar() {
  const [providers, setProviders] = useState<Providers | null>(null)
  const [enrich, setEnrich] = useState<EnrichStatus | null>(null)
  const [amazonHandle, setAmazonHandle] = useState('')
  const [tiktokHandle, setTiktokHandle] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Unified searchable brand list.
  const [q, setQ] = useState('')
  const [brands, setBrands] = useState<WorkedBrand[]>([])
  const [stats, setStats] = useState<{ total: number; amazonBrands: number; tiktokBrands: number } | null>(null)

  // TRYBE cross-check.
  const [trybeInput, setTrybeInput] = useState('')
  const [matches, setMatches] = useState<MatchRow[] | null>(null)
  const [checking, setChecking] = useState(false)

  const loadMeta = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        fetch('/api/creator/sync').then(r => r.ok ? r.json() : null),
        fetch('/api/storefront/enrich-brands').then(r => r.ok ? r.json() : null),
      ])
      if (s?.ok) setProviders(s.providers)
      if (e?.ok) setEnrich({ configured: !!e.configured, total: e.total, withBrand: e.withBrand, remaining: e.remaining })
    } catch { /* ignore */ }
  }, [])

  const loadBrands = useCallback(async (query: string) => {
    try {
      const r = await fetch(`/api/creator/brands?q=${encodeURIComponent(query)}`)
      const d = await r.json().catch(() => null)
      if (d?.ok) { setBrands(d.brands || []); setStats({ total: d.total, amazonBrands: d.amazonBrands, tiktokBrands: d.tiktokBrands }) }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { void loadMeta(); void loadBrands('') }, [loadMeta, loadBrands])
  // Debounced search.
  useEffect(() => { const t = setTimeout(() => void loadBrands(q), 220); return () => clearTimeout(t) }, [q, loadBrands])

  async function startSync(source: 'amazon_storefront' | 'tiktok', handle: string) {
    setBusy(source); setMsg(null)
    try {
      const res = await fetch('/api/creator/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, handle }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg({ ok: false, text: d.error || 'Could not start the sync.' }); return }
      if (d.async) setMsg({ ok: true, text: 'Syncing your storefront in the background — this can take a few minutes. Your brands fill in as it lands.' })
      else setMsg({ ok: true, text: `Scanned ${d.postsScanned ?? 0} TikToks, found ${d.brands?.length ?? 0} brands.` })
      await loadMeta(); await loadBrands(q)
    } catch { setMsg({ ok: false, text: 'Something went wrong. Try again.' }) }
    finally { setBusy(null) }
  }

  async function runEnrich() {
    setBusy('enrich'); setMsg(null)
    try {
      const res = await fetch('/api/storefront/enrich-brands', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (d.configured === false) setMsg({ ok: false, text: 'Brand enrichment isn’t connected yet.' })
      else setMsg({ ok: true, text: `Enriched ${d.enriched ?? 0} products.${d.remaining ? ` ${d.remaining} left — run again for the rest.` : ''}` })
      await loadMeta(); await loadBrands(q)
    } catch { setMsg({ ok: false, text: 'Enrichment failed. Try again.' }) }
    finally { setBusy(null) }
  }

  async function checkTrybe() {
    const names = trybeInput.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).slice(0, 500)
    if (!names.length) return
    setChecking(true)
    try {
      const res = await fetch('/api/creator/brands/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names }) })
      const d = await res.json().catch(() => ({}))
      setMatches(d.matches || [])
    } catch { setMatches([]) }
    finally { setChecking(false) }
  }

  const anyProvider = providers && (providers.apify || providers.socialcrawl)

  return (
    <div className="max-w-5xl mx-auto">
      <PageHero
        accent={ACCENT}
        title="Brand Radar"
        subtitle="Every brand you’ve worked with, from your Amazon storefront and TikTok — searchable, and matchable against any brand marketplace."
      />

      {providers && !anyProvider && (
        <div className="rounded-2xl border p-5 mb-5 flex items-start gap-3" style={{ borderColor: 'rgba(124,58,237,0.3)', background: 'linear-gradient(180deg, rgba(124,58,237,0.05), transparent)' }}>
          <AlertCircle size={18} style={{ color: ACCENT }} className="flex-shrink-0 mt-0.5" />
          <div className="text-[13px]" style={{ color: 'var(--text-soft)' }}>
            <p className="font-semibold" style={{ color: 'var(--text)' }}>Connect a data provider to fill your brand list</p>
            <p className="mt-1">Brand Radar syncs server-side (so a big store never times out). Add an <b>Apify</b> token for Amazon and/or a <b>SocialCrawl</b> key for TikTok, and your brands populate here.</p>
          </div>
        </div>
      )}

      {/* ── Your brands: unified + searchable ─────────────────────────────── */}
      <section className="rounded-2xl border p-5 mb-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Tag size={16} style={{ color: ACCENT }} />
          <h2 className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>Brands you’ve worked with</h2>
        </div>
        <p className="text-[12.5px] mb-3" style={{ color: 'var(--text-soft)' }}>
          {stats ? <><b>{stats.total}</b> brands · {stats.amazonBrands} from Amazon · {stats.tiktokBrands} from TikTok</> : 'Merged from your Amazon storefront and TikTok.'}
        </p>
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input
            value={q} onChange={e => setQ(e.target.value)} placeholder="Search your brands…"
            className="w-full rounded-lg border pl-9 pr-3 py-2 text-[13px] bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
        </div>
        {brands.length === 0 ? (
          <p className="text-[12.5px] py-4 text-center" style={{ color: 'var(--text-faint)' }}>
            {q ? 'No brands match that search.' : 'No brands yet — sync your storefront or TikTok below.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[440px] overflow-y-auto pr-1">
            {brands.map(b => (
              <div key={b.key} className="flex items-center gap-2.5 rounded-xl border p-2.5" style={{ borderColor: 'var(--border)' }}>
                {b.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={b.image} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                  : <div className="w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 text-[12px] font-bold" style={{ background: 'rgba(124,58,237,0.10)', color: ACCENT }}>{b.brand.slice(0, 1).toUpperCase()}</div>}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{b.brand}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {b.amazon > 0 && <span className="inline-flex items-center gap-0.5 text-[10px]" style={{ color: '#C2410C' }}><ShoppingBag size={9} /> {b.amazon}</span>}
                    {b.tiktok > 0 && <span className="inline-flex items-center gap-0.5 text-[10px]" style={{ color: ACCENT }}><Music2 size={9} /> {b.tiktok}</span>}
                  </div>
                </div>
                {b.confident && (
                  <span className="flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(52,199,89,0.16)', color: '#1f7a4d' }}>
                    <Check size={10} /> Partner
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── TRYBE cross-check ─────────────────────────────────────────────── */}
      <section className="rounded-2xl border p-5 mb-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Search size={16} style={{ color: ACCENT }} />
          <h2 className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>Check brands against your history</h2>
        </div>
        <p className="text-[12.5px] mb-3" style={{ color: 'var(--text-soft)' }}>
          Paste brand names from TRYBE (or any marketplace), one per line, to see which you’ve <b>already worked with</b> — the ones you’re promoting for free and could pitch.
        </p>
        <textarea
          value={trybeInput} onChange={e => setTrybeInput(e.target.value)} rows={4}
          placeholder={'Jive Nutrition\nSwell Labs\nPhysician\'s Choice\nCuts Clothing'}
          className="w-full rounded-lg border px-3 py-2 text-[13px] bg-transparent mb-2"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
        />
        <button
          onClick={() => void checkTrybe()} disabled={checking || !trybeInput.trim()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: ACCENT }}
        >
          {checking ? <><Loader2 size={14} className="animate-spin" /> Checking…</> : <><Radar size={14} /> Check these brands</>}
        </button>

        {matches && (
          <div className="mt-3">
            <p className="text-[12px] mb-2" style={{ color: 'var(--text-faint)' }}>
              {matches.filter(m => m.worked).length} of {matches.length} you’ve already worked with
            </p>
            <div className="space-y-1.5">
              {matches.map((m, i) => (
                <div key={`${m.name}-${i}`} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]" style={{ borderColor: 'var(--border)' }}>
                  {m.worked
                    ? <span className="w-5 h-5 rounded-full grid place-items-center flex-shrink-0" style={{ background: '#34c759', color: '#fff' }}><Check size={12} strokeWidth={3} /></span>
                    : <span className="w-5 h-5 rounded-full border flex-shrink-0" style={{ borderColor: 'var(--border)' }} />}
                  <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--text)' }}>{m.name}</span>
                  {m.worked
                    ? <span className="flex-shrink-0 text-[11px]" style={{ color: 'var(--text-soft)' }}>
                        worked with{m.amazon ? ` · ${m.amazon} Amazon` : ''}{m.tiktok ? ` · ${m.tiktok} TikTok` : ''}
                      </span>
                    : <span className="flex-shrink-0 text-[11px]" style={{ color: 'var(--text-faint)' }}>new to you</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── Sync controls ─────────────────────────────────────────────────── */}
      <section className="rounded-2xl border p-5 mb-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <h2 className="text-[15px] font-bold mb-3" style={{ color: 'var(--text)' }}>Sync your sources</h2>

        {/* Amazon */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Store size={14} style={{ color: '#C2410C' }} />
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Amazon storefront</span>
            <span className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: providers?.apify ? 'rgba(52,199,89,0.14)' : 'var(--surface-2,#f2f2f4)', color: providers?.apify ? '#1f7a4d' : 'var(--text-faint)' }}>
              {providers?.apify ? 'Apify connected' : 'Apify not connected'}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input value={amazonHandle} onChange={e => setAmazonHandle(e.target.value)} placeholder="your handle or amazon.com/shop/yourname"
              className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            <button onClick={() => void startSync('amazon_storefront', amazonHandle)} disabled={!providers?.apify || busy === 'amazon_storefront' || !amazonHandle.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: '#C2410C' }}>
              {busy === 'amazon_storefront' ? <><Loader2 size={14} className="animate-spin" /> Starting…</> : <><Radar size={14} /> Sync</>}
            </button>
          </div>
          {enrich && enrich.total > 0 && (
            <div className="mt-2 flex items-center gap-2 flex-wrap text-[12px]" style={{ color: 'var(--text-soft)' }}>
              <Sparkles size={13} style={{ color: ACCENT }} />
              <span><b style={{ color: 'var(--text)' }}>{enrich.withBrand}</b>/{enrich.total} products branded{enrich.remaining ? ` · ${enrich.remaining} to enrich` : ''}</span>
              {enrich.remaining > 0 && (
                <button onClick={() => void runEnrich()} disabled={busy === 'enrich' || !enrich.configured}
                  className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border disabled:opacity-50" style={{ borderColor: ACCENT, color: ACCENT }}>
                  {busy === 'enrich' ? <><Loader2 size={11} className="animate-spin" /> Enriching…</> : <><Tag size={11} /> Enrich brands</>}
                </button>
              )}
            </div>
          )}
        </div>

        {/* TikTok */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Music2 size={14} style={{ color: ACCENT }} />
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>TikTok</span>
            <span className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ background: providers?.socialcrawl ? 'rgba(52,199,89,0.14)' : 'var(--surface-2,#f2f2f4)', color: providers?.socialcrawl ? '#1f7a4d' : 'var(--text-faint)' }}>
              {providers?.socialcrawl ? 'SocialCrawl connected' : 'SocialCrawl not connected'}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input value={tiktokHandle} onChange={e => setTiktokHandle(e.target.value)} placeholder="your TikTok @handle"
              className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-[13px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            <button onClick={() => void startSync('tiktok', tiktokHandle)} disabled={!providers?.socialcrawl || busy === 'tiktok' || !tiktokHandle.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
              {busy === 'tiktok' ? <><Loader2 size={14} className="animate-spin" /> Scanning…</> : <><Radar size={14} /> Scan</>}
            </button>
          </div>
        </div>
      </section>

      {msg && <p className="text-[12.5px] mb-4 px-1" style={{ color: msg.ok ? '#16a34a' : '#c0392b' }}>{msg.text}</p>}
    </div>
  )
}
