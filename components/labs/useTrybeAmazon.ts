'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE AMAZON MATCH WHEREVER A TRYBE BRAND OR PRODUCT SHOWS (Seb, 2026-10-14:
// "add the amazon match to most places where a trybe item/brand is shown").
// One call to the server's amazon_match for the brands and products a tab
// shows, kept for ten minutes in this page so every tab reads it once.
// A failed read is kept as the error, never as "not on Amazon".

import { useEffect, useMemo, useState } from 'react'
import type { LiveAmazon, FilmedLive } from '@/components/labs/TrybeFinderControls'

export interface ProductAmazonMatch { yourVideos: number; videoLinks: string[]; products?: FilmedLive[] }
const TTL = 10 * 60_000
const brandCache = new Map<string, { at: number; v: LiveAmazon }>()
const productCache = new Map<string, { at: number; v: ProductAmazonMatch }>()
const fresh = (at: number) => Date.now() - at < TTL
export const productKey = (brand: string, name: string) => `${brand}|${name}`

export function useTrybeAmazon(brands: Array<{ id: string; name: string }>, products: Array<{ brand: string; name: string }> = [], enabled = true) {
  const [tick, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const bKey = brands.map((b) => `${b.id}:${b.name}`).join('\n')
  const pKey = products.map((p) => productKey(p.brand, p.name)).join('\n')
  useEffect(() => {
    if (!enabled) return
    const wantB = brands.filter((b) => b.id && b.name && !(brandCache.get(b.id) && fresh(brandCache.get(b.id)!.at))).slice(0, 300)
    const wantP = products.filter((p) => p.brand && p.name && !(productCache.get(productKey(p.brand, p.name)) && fresh(productCache.get(productKey(p.brand, p.name))!.at))).slice(0, 300)
    if (!wantB.length && !wantP.length) return
    let gone = false
    fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'amazon_match', brands: wantB, products: wantP }), signal: AbortSignal.timeout(45_000) })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`); return d })
      .then((d) => {
        const at = Date.now()
        for (const [id, v] of Object.entries(d.brands || {})) brandCache.set(id, { at, v: v as LiveAmazon })
        for (const [k, v] of Object.entries(d.products || {})) productCache.set(k, { at, v: v as ProductAmazonMatch })
        if (!gone) { setNotes(Array.isArray(d.notes) ? d.notes : []); setError(null); setTick((t) => t + 1) }
      })
      .catch((e) => { if (!gone) setError(`The Amazon match could not be read: ${e instanceof Error ? e.message : 'no answer'}`) })
    return () => { gone = true }
  }, [bKey, pKey, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => ({
    brand: (id: string | null | undefined): LiveAmazon | null => (id ? brandCache.get(id)?.v ?? null : null),
    product: (brand: string, name: string): ProductAmazonMatch | null => productCache.get(productKey(brand, name))?.v ?? null,
    notes, error,
  }), [tick, notes, error]) // eslint-disable-line react-hooks/exhaustive-deps
}
