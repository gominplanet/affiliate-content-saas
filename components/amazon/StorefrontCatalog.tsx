'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// StorefrontCatalog — the FULL product list, past the ~100-row earnings cap.
// SCOUT walks the creator's PUBLIC storefront (amazon.com/shop/<handle>) and
// records every product they feature; this view lists them all and overlays the
// creator's REAL earnings (from the earnings sync) on the ones that have them.
// Self-contained: fetches /api/storefront/catalog and drives the SCOUT crawl.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Store, ExternalLink, Search, Video } from 'lucide-react'
import { requestStorefrontCatalogScan, requestCreatorHubVideosScan } from '@/lib/extension-frame'

const ACCENT = '#C2410C'
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const int = (n: number) => n.toLocaleString('en-US')

interface CatalogProduct {
  asin: string; title: string; image: string | null; listTitle: string | null
  earnings: number; revenue: number; units: number; clicks: number
  conversion: number; epc: number; hasEarnings: boolean; hasVideo: boolean; amazonUrl: string
}
interface CatalogData { ok?: boolean; hasData?: boolean; total?: number; withEarnings?: number; withVideo?: number; products?: CatalogProduct[] }
type SortKey = 'earnings' | 'clicks' | 'conversion' | 'epc'

const HANDLE_KEY = 'mvp-storefront-url'

export default function StorefrontCatalog() {
  const [data, setData] = useState<CatalogData | null>(null)
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [sort, setSort] = useState<SortKey>('earnings')
  const [q, setQ] = useState('')
  const [onlyNoEarn, setOnlyNoEarn] = useState(false)
  const [onlyNoVideo, setOnlyNoVideo] = useState(false)
  const [syncingVideos, setSyncingVideos] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/storefront/catalog')
      setData(await r.json())
    } catch { setData({ hasData: false }) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    try { const saved = localStorage.getItem(HANDLE_KEY); if (saved) setUrl(saved) } catch { /* private mode */ }
    void load()
  }, [load])

  const runImport = useCallback(async () => {
    let clean = url.trim()
    if (!/amazon\.[a-z.]+\/shop\//i.test(clean)) {
      setMsg({ ok: false, text: 'Paste your storefront link — it looks like amazon.com/shop/yourname' })
      return
    }
    // Force an absolute https:// URL. Without the scheme the extension resolves it
    // relative to its own chrome-extension:// origin (chrome-extension://…/www.
    // amazon.com/shop/…#mvp-sync) and can't open it, which is exactly the "Cannot
    // access contents of url" failure.
    if (!/^https?:\/\//i.test(clean)) clean = `https://${clean.replace(/^\/+/, '')}`
    try { localStorage.setItem(HANDLE_KEY, clean) } catch { /* ignore */ }
    setImporting(true); setMsg(null)
    try {
      const r = await requestStorefrontCatalogScan(clean)
      if (r.ok) {
        await load()
        setMsg({
          ok: true,
          text: r.count
            ? (r.partial
                ? `Imported ${r.count} product${r.count === 1 ? '' : 's'} so far — your storefront has more than one pass can read. Click Import full storefront again to pick up the rest.`
                : `Imported ${r.count} product${r.count === 1 ? '' : 's'} from your storefront.`)
            : 'Checked your storefront — nothing new to add.',
        })
      } else if (r.error === 'not-installed') {
        setMsg({ ok: false, text: 'Install SCOUT first — it reads your public storefront. Then Import again.' })
      } else if (r.error === 'bad-url') {
        setMsg({ ok: false, text: 'That link isn’t a storefront URL. It should look like amazon.com/shop/yourname.' })
      } else if (r.error === 'no-products') {
        setMsg({ ok: false, text: 'Opened your storefront but couldn’t read any products. Open it once on Amazon and let it fully load, then Import again.' })
      } else {
        setMsg({ ok: false, text: `Couldn’t read your storefront just now${r.error ? ` (${r.error})` : ''}. Open it once on Amazon, then Import again.` })
      }
    } catch {
      setMsg({ ok: false, text: 'Import failed — try again in a moment.' })
    } finally { setImporting(false) }
  }, [url, load])

  const syncVideos = useCallback(async () => {
    setSyncingVideos(true); setMsg(null)
    try {
      const r = await requestCreatorHubVideosScan()
      if (r.ok) {
        await load()
        setMsg({
          ok: true,
          text: r.count
            ? (r.partial
                ? `Found ${r.count} products so far — Creator Hub had more than we could read in one pass. Run "Sync my videos" again to pick up the rest.`
                : `Found ${r.count} product${r.count === 1 ? '' : 's'} you have a video for.`)
            : 'Checked Creator Hub — no videos found.',
        })
      } else if (r.error === 'not-installed') {
        setMsg({ ok: false, text: 'Install SCOUT first — it reads your Creator Hub. Then Sync videos again.' })
      } else if (r.error === 'no-videos') {
        setMsg({ ok: false, text: 'Opened Creator Hub but couldn’t read any videos. Open it once on Amazon, then Sync videos again.' })
      } else {
        setMsg({ ok: false, text: `Couldn’t read Creator Hub just now${r.error ? ` (${r.error})` : ''}. Open it once on Amazon, then try again.` })
      }
    } catch {
      setMsg({ ok: false, text: 'Video sync failed — try again in a moment.' })
    } finally { setSyncingVideos(false) }
  }, [load])

  const all = data?.products ?? []
  const filtered = all
    .filter((p) => (onlyNoEarn ? !p.hasEarnings : true))
    .filter((p) => (onlyNoVideo ? !p.hasVideo : true))
    .filter((p) => (q ? (p.title || '').toLowerCase().includes(q.toLowerCase()) || p.asin.toLowerCase().includes(q.toLowerCase()) : true))
    .sort((a, b) => (b[sort] as number) - (a[sort] as number))

  return (
    <div className="rounded-2xl border mb-8 overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="px-4 sm:px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Store size={16} style={{ color: ACCENT }} />
          <p className="font-bold text-[14px]" style={{ color: 'var(--text)' }}>Your full storefront</p>
          {data?.hasData && (
            <span className="text-[12px]" style={{ color: 'var(--text-soft)' }}>
              — {int(data.total ?? 0)} products{typeof data.withEarnings === 'number' ? `, ${int(data.withEarnings)} earning` : ''}{typeof data.withVideo === 'number' ? `, ${int(data.withVideo)} with video` : ''}
            </span>
          )}
        </div>
        <p className="text-[12px] mb-3" style={{ color: 'var(--text-soft)' }}>
          Every product you feature (not just your top 100), with your real earnings shown where you have them. Great for spotting features that get clicks but don&rsquo;t sell.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.amazon.com/shop/yourname"
            className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-[13px] bg-transparent"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          <button
            onClick={() => void runImport()}
            disabled={importing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: ACCENT }}
          >
            {importing ? <><Loader2 size={14} className="animate-spin" /> Importing…</> : 'Import full storefront'}
          </button>
          <button
            onClick={() => void syncVideos()}
            disabled={syncingVideos}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold border disabled:opacity-60"
            style={{ borderColor: ACCENT, color: ACCENT }}
            title="Read your Creator Hub to mark which products you have a video for"
          >
            {syncingVideos ? <><Loader2 size={14} className="animate-spin" /> Syncing videos…</> : <><Video size={14} /> Sync my videos</>}
          </button>
        </div>
        {msg && <p className="text-[12px] mt-2" style={{ color: msg.ok ? '#16a34a' : '#c0392b' }}>{msg.text}</p>}
      </div>

      {loading ? (
        <div className="p-6 flex items-center gap-2 text-[13px]" style={{ color: 'var(--text-soft)' }}>
          <Loader2 size={15} className="animate-spin" /> Loading your storefront…
        </div>
      ) : !all.length ? (
        <div className="p-6 text-[13px]" style={{ color: 'var(--text-soft)' }}>
          No storefront products imported yet. Paste your storefront link above and click Import — SCOUT reads it in the background.
        </div>
      ) : (
        <>
          <div className="px-4 sm:px-5 py-2.5 border-b flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: 'var(--border)' }}>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter products…"
                className="rounded-lg border pl-8 pr-3 py-1.5 text-[12.5px] bg-transparent" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} />
            </div>
            <div className="flex items-center gap-1.5 text-[11px] flex-wrap" style={{ color: 'var(--text-soft)' }}>
              <label className="inline-flex items-center gap-1 mr-2 cursor-pointer">
                <input type="checkbox" checked={onlyNoEarn} onChange={(e) => setOnlyNoEarn(e.target.checked)} /> Not earning
              </label>
              <label className="inline-flex items-center gap-1 mr-2 cursor-pointer">
                <input type="checkbox" checked={onlyNoVideo} onChange={(e) => setOnlyNoVideo(e.target.checked)} /> No video
              </label>
              Sort:
              {(['earnings', 'clicks', 'conversion', 'epc'] as SortKey[]).map((k) => (
                <button key={k} onClick={() => setSort(k)} className="px-2 py-0.5 rounded-md capitalize"
                  style={sort === k ? { background: ACCENT, color: '#fff' } : { color: 'var(--text-soft)' }}>{k}</button>
              ))}
            </div>
          </div>
          <div className="divide-y max-h-[560px] overflow-auto" style={{ borderColor: 'var(--border)' }}>
            {filtered.map((p) => (
              <div key={p.asin} className="flex items-center gap-3 px-4 sm:px-5 py-2.5">
                {p.image
                  ? <img src={p.image} alt="" className="w-10 h-10 rounded-md object-cover flex-shrink-0" style={{ background: 'var(--surface-2, transparent)' }} />
                  : <div className="w-10 h-10 rounded-md flex-shrink-0" style={{ background: 'var(--border)' }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] truncate flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
                    {p.hasVideo && <Video size={12} className="flex-shrink-0" style={{ color: ACCENT }} aria-label="Has video" />}
                    <span className="truncate">{p.title}</span>
                  </p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>{p.listTitle || p.asin}</p>
                </div>
                {p.hasEarnings ? (
                  <div className="hidden sm:flex items-center gap-4 text-[11.5px] flex-shrink-0" style={{ color: 'var(--text-soft)' }}>
                    <span title="Clicks">{int(p.clicks)} clk</span>
                    <span title="Conversion">{p.conversion}%</span>
                    <span className="font-semibold" style={{ color: 'var(--text)' }} title="Earnings">{usd(p.earnings)}</span>
                  </div>
                ) : (
                  <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0" style={{ background: 'rgba(107,114,128,0.15)', color: 'var(--text-soft)' }}>not in top 100</span>
                )}
                <a href={p.amazonUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0" style={{ color: 'var(--text-faint)' }} title="View on Amazon"><ExternalLink size={13} /></a>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
