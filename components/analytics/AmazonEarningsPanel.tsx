// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Amazon Associates earnings panel (revenue loop, epic #249 — aggregate-first).
// Upload the Associates "Earnings" CSV export → see total commissions + a
// per-product breakdown. Self-contained: fetches + posts to
// /api/analytics/amazon-earnings. Lives on /analytics next to the click data.

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { Upload, RefreshCw, DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Product {
  asin: string
  product_title: string | null
  earnings_usd: number
  items_shipped: number
  revenue_usd: number
}
interface EarningsData {
  hasData: boolean
  importedAt: string | null
  totalEarnings: number
  totalItems: number
  products: Product[]
}

const usd = (n: number) => `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function AmazonEarningsPanel() {
  const [data, setData] = useState<EarningsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/analytics/amazon-earnings')
      setData(await res.json())
    } catch {
      setData({ hasData: false, importedAt: null, totalEarnings: 0, totalItems: 0, products: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (e.target) e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setUploading(true)
    try {
      const csv = await file.text()
      const res = await fetch('/api/analytics/amazon-earnings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `Upload failed (${res.status})`)
      toast.success(`Imported ${json.products} products — ${usd(json.totalEarnings)} in commissions.`)
      if (json.warnings?.length) toast.message(json.warnings[0])
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [load])

  return (
    <div className="card p-5">
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />

      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h2 className="text-base font-semibold text-[var(--text)] inline-flex items-center gap-1.5">
            <DollarSign className="h-4 w-4 text-[#1a7a3c]" /> Amazon commissions
          </h2>
          <p className="text-xs text-[var(--text-2)] mt-0.5">
            Upload your Associates earnings export to see what each product actually earns.
            {data?.importedAt && <span className="opacity-70"> Last import {new Date(data.importedAt).toLocaleDateString()}.</span>}
          </p>
        </div>
        <Button
          variant={data?.hasData ? 'secondary' : 'primary'}
          size="sm"
          loading={uploading}
          onClick={() => fileRef.current?.click()}
          leftIcon={data?.hasData ? <RefreshCw className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
        >
          {data?.hasData ? 'Re-upload CSV' : 'Upload earnings CSV'}
        </Button>
      </div>

      {loading && !data ? (
        <div className="py-8 text-center text-sm text-[var(--text-2)]">Loading…</div>
      ) : !data?.hasData ? (
        <div className="py-6 px-4 rounded-lg bg-[#1a7a3c]/5 border border-[#1a7a3c]/20 text-sm text-[var(--text-2)] leading-relaxed">
          No earnings imported yet. In <strong className="text-[var(--text)]">Amazon Associates → Reports → Earnings</strong>,
          pick a date range, <strong className="text-[var(--text)]">Download CSV</strong>, then upload it here.
          We total your commissions and show which products earn the most. Amazon has no live API, so this is a manual export
          (re-upload whenever you want fresh numbers).
        </div>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 mb-4">
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-2)]">Total commissions</div>
              <div className="text-xl font-bold text-[#1a7a3c]">{usd(data.totalEarnings)}</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-2)]">Items shipped</div>
              <div className="text-xl font-bold text-[var(--text)]">{data.totalItems.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-2)]">Products</div>
              <div className="text-xl font-bold text-[var(--text)]">{data.products.length}</div>
            </div>
          </div>

          {/* Per-product table — top earners first */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[var(--text-2)] text-left border-b border-[var(--border)]">
                  <th className="py-2 pr-3 font-medium">Product</th>
                  <th className="py-2 px-3 font-medium text-right">Commission</th>
                  <th className="py-2 pl-3 font-medium text-right">Units</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map(p => (
                  <tr key={p.asin} className="border-b border-[var(--border)]/50">
                    <td className="py-2 pr-3 text-[var(--text)] truncate max-w-[42ch]">
                      {p.product_title || p.asin}
                      <a
                        href={`https://www.amazon.com/dp/${p.asin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1.5 text-[11px] text-[var(--text-2)] font-mono hover:underline"
                      >{p.asin}</a>
                    </td>
                    <td className="py-2 px-3 text-right font-semibold text-[#1a7a3c] whitespace-nowrap">{usd(p.earnings_usd)}</td>
                    <td className="py-2 pl-3 text-right text-[var(--text-2)]">{p.items_shipped.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
