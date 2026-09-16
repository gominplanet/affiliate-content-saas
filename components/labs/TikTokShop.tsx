// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TikTok Shop (LABS) — the products a creator has added, and the box they add
// them from.
//
// IT IS A PASTE, AND THE SCREEN SAYS SO. There is no scan and there cannot be
// one: a TikTok showcase is an in-app mini program with no web page behind it,
// so neither our server nor a browser extension can read a creator's catalogue.
// Calling this a sync or an import would set up the exact expectation the
// platform cannot meet, and the creator would spend their first minute looking
// for the button that imports all fifty.
'use client'

import { useCallback, useEffect, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, Plus, Trash2, Star, ShoppingBag, ExternalLink, FlaskConical, PenLine } from 'lucide-react'
import { toast } from 'sonner'

const muted = { color: 'var(--text-2)' } as const

interface Row {
  id: string
  product_id: string
  share_url: string
  title: string
  description: string | null
  image_url: string | null
  price: string | null
  currency_symbol: string | null
  rating: number | null
  review_count: number | null
  sold_count: number | null
  seller_name: string | null
  region: string | null
  created_at: string
}

/** 2883 reads as 2.9K on TikTok's own page, and a creator comparing the two
 *  should see the same number, not a rounding they have to reconcile. */
function compactCount(n: number | null): string | null {
  if (n === null || !Number.isFinite(n)) return null
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export default function TikTokShop() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  // Held ON SCREEN rather than only in a toast. Adding a product is the one
  // thing this page does, and a creator whose link was refused needs the reason
  // still readable while they go back to TikTok for a different one.
  const [addError, setAddError] = useState<string | null>(null)
  const [migrationNeeded, setMigrationNeeded] = useState<string | null>(null)
  // The product currently being written about, so the card shows its own
  // spinner rather than a page-wide one that hides which product is running.
  const [writing, setWriting] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/labs/tiktok-shop/resolve')
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (j.migrationNeeded) setMigrationNeeded(j.migrationNeeded as string)
        setAddError((j.error as string) || 'Could not load your products.')
        return
      }
      setRows((j.products as Row[]) || [])
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not load your products.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function add() {
    const pasted = url.trim()
    if (!pasted || adding) return
    setAdding(true); setAddError(null); setMigrationNeeded(null)
    try {
      const r = await fetch('/api/labs/tiktok-shop/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: pasted }),
      })
      const j = await r.json().catch(() => ({}))
      if (j.migrationNeeded) setMigrationNeeded(j.migrationNeeded as string)
      if (!r.ok || !j.ok) {
        // The route distinguishes "could not read it" from "read it but could
        // not save it", and so does the screen: the second one is not the
        // creator's link being wrong.
        setAddError((j.error as string) || 'Could not add that product.')
        if (j.product) {
          toast.error(`Read "${String((j.product as { title: string }).title).slice(0, 40)}…" but it did not save.`)
        }
        return
      }
      setUrl('')
      toast.success(`Added ${String((j.product as { title: string }).title).slice(0, 48)}…`)
      await load()
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Could not add that product.')
    } finally { setAdding(false) }
  }

  async function writePost(p: Row) {
    if (writing) return
    setWriting(p.product_id)
    // A blog post takes minutes. Saying so beats a spinner that looks stuck.
    toast('Writing the post. This takes a couple of minutes, and it publishes to your site when it is done.')
    try {
      const r = await fetch('/api/blog/from-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiktokProductId: p.product_id, includeImages: true }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { toast.error((j.error as string) || 'Could not write that post.', { duration: 10000 }); return }
      // Two separate things, and both are reported. `note` means the post is
      // live but MVP did not record it; `linkNote` means the link style was
      // swapped for this destination. Neither is a failure of the request.
      if (j.note) toast.warning(j.note as string, { duration: 12000 })
      if (j.linkNote) toast.message(j.linkNote as string, { duration: 10000 })
      toast.success('Published. Opening it now.')
      if (j.url) window.open(j.url as string, '_blank', 'noopener')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not write that post.', { duration: 10000 })
    } finally { setWriting(null) }
  }

  async function remove(id: string, title: string) {
    if (!window.confirm(`Remove "${title.slice(0, 60)}" from your TikTok Shop products? The product stays on TikTok; this only removes it from MVP.`)) return
    const r = await fetch('/api/labs/tiktok-shop/resolve', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (r.ok) { setRows(prev => prev.filter(x => x.id !== id)); toast.success('Removed.') }
    else toast.error('Could not remove that one.')
  }

  return (
    <>
      <PageHero
        title="TikTok Shop"
        accent="rgba(248,113,113,0.18)"
        subtitle={
          <>Paste a product link from your TikTok Shop showcase and MVP reads its title, price, rating, reviews and photo. Then write about it anywhere: a blog post, a pin, a Facebook post, with the link pointing back at the product.</>
        }
        actions={
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(248,113,113,0.12)', color: '#DC2626' }}>
            <FlaskConical size={12} /> Labs
          </span>
        }
      />

      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        {/* ── Add a product ─────────────────────────────────────────────── */}
        <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-[13px] font-semibold mb-1" style={{ color: 'var(--text)' }}>Add a product</p>
          {/* Said plainly, because the alternative is a creator hunting for an
              "import all" button that cannot exist. */}
          <p className="text-[12px] mb-3" style={muted}>
            One at a time. TikTok does not publish your showcase anywhere MVP can read it, so there is no bulk import. Open the product in TikTok Shop, tap Share, copy the link, paste it here.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void add() }}
              placeholder="https://shop.tiktok.com/us/pdp/…"
              className="flex-1 px-3 py-2 rounded-lg border text-[13px]"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            />
            <button
              type="button" onClick={() => void add()} disabled={adding || !url.trim()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-60"
              style={{ background: '#DC2626' }}>
              {adding ? <><Loader2 size={14} className="animate-spin" /> Reading…</> : <><Plus size={14} /> Add product</>}
            </button>
          </div>

          {addError && (
            <div className="mt-3 rounded-lg border p-3" style={{ borderColor: '#d9770655', background: 'rgba(217,119,6,0.06)' }}>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text)' }}>{addError}</p>
              {migrationNeeded && (
                <p className="text-[11px] mt-1.5" style={muted}>Migration needed: <code>{migrationNeeded}</code></p>
              )}
            </div>
          )}

          {/* The pasted link is the creator's money. Saying so once, here, is
              cheaper than a support thread about a missing commission. */}
          <p className="text-[11px] mt-3" style={muted}>
            MVP publishes the exact link you paste, so the attribution that credits the sale to you stays on it.
          </p>
        </div>

        {/* ── The products ──────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-16" style={muted}>
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border p-10 text-center" style={{ borderColor: 'var(--border)' }}>
            <ShoppingBag size={22} className="mx-auto mb-2" style={{ color: 'var(--text-3)' }} />
            <p className="text-[13px] font-medium" style={{ color: 'var(--text)' }}>No products yet</p>
            <p className="text-[12px] mt-1" style={muted}>Paste your first product link above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map(p => (
              <div key={p.id} className="rounded-2xl border overflow-hidden flex flex-col"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.image_url} alt={p.title} loading="lazy"
                    className="w-full aspect-square object-cover" style={{ background: 'var(--bg)' }} />
                ) : (
                  <div className="w-full aspect-square flex items-center justify-center" style={{ background: 'var(--bg)' }}>
                    <ShoppingBag size={20} style={{ color: 'var(--text-3)' }} />
                  </div>
                )}
                <div className="p-3 flex flex-col gap-1.5 flex-1">
                  <p className="text-[12px] font-medium leading-snug line-clamp-3" style={{ color: 'var(--text)' }}>{p.title}</p>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {p.price
                      ? <span className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>{p.currency_symbol || '$'}{p.price}</span>
                      // Never a blank where a price goes: an empty slot reads as
                      // free, and the reason it is missing is worth one line.
                      : <span className="text-[11px]" style={muted}>Price not listed on the page</span>}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] flex-wrap" style={muted}>
                    {p.rating !== null && (
                      <span className="inline-flex items-center gap-0.5">
                        <Star size={11} style={{ color: '#f59e0b', fill: '#f59e0b' }} />
                        {p.rating}{p.review_count !== null ? ` (${p.review_count})` : ''}
                      </span>
                    )}
                    {p.sold_count !== null && <span>{compactCount(p.sold_count)} sold</span>}
                  </div>
                  {p.seller_name && <p className="text-[11px] truncate" style={muted}>Sold by {p.seller_name}</p>}
                  <div className="mt-auto pt-2 flex flex-col gap-2">
                    <button type="button" onClick={() => void writePost(p)} disabled={!!writing}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-white disabled:opacity-60"
                      style={{ background: '#DC2626' }}>
                      {writing === p.product_id
                        ? <><Loader2 size={12} className="animate-spin" /> Writing…</>
                        : <><PenLine size={12} /> Write a blog post</>}
                    </button>
                    <div className="flex items-center gap-2">
                      <a href={p.share_url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-medium underline" style={muted}>
                        <ExternalLink size={11} /> On TikTok
                      </a>
                      <button type="button" onClick={() => void remove(p.id, p.title)}
                        className="ml-auto inline-flex items-center gap-1 text-[11px]" style={muted}>
                        <Trash2 size={11} /> Remove
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {rows.length > 0 && (
          // Honest about where this stops today. Writing a post from one of
          // these is the next slice, and a card that looks clickable but is not
          // is worse than a sentence saying so.
          <p className="text-[11px] text-center" style={muted}>
            A blog post publishes to your connected site with the link pointing at that product. Pins and social posts land next.
          </p>
        )}
      </div>
    </>
  )
}
