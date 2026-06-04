// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// DealsCsvImporter — drag-and-drop / pick a CSV (Amazon Creator
// Connections deals export), shows a sortable + searchable table, lets
// the user generate-now OR schedule-for-deal-start per row.
//
// The actual generation hits the existing /api/deals POST (single-product
// path) — we just iterate the picked rows, looping at most one in flight
// at a time so we don't burn the user's monthly quota on a parallel
// hammer. Each picked row maps to a single API call.

'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  UploadCloud, FileSpreadsheet, X, Search, ChevronUp, ChevronDown,
  Sparkles, Clock, Loader2, ExternalLink, AlertCircle, CheckCircle2,
} from 'lucide-react'

interface AmazonDealRow {
  asin: string
  asinName: string | null
  parentAsin: string | null
  isCreatorFavorite: boolean
  asinUrl: string | null
  starRating: number | null
  dealStartDatetime: string | null
  dealEndDatetime: string | null
  categoryDescription: string | null
  subcategoryDescription: string | null
  promoGlProductGroup: string | null
  dealId: string | null
  dealTitle: string | null
  isPrimeOnly: boolean
  promotionType: string | null
  brand: string | null
  dealPriceBand: string | null
  dealPrice: number | null
  vrp: number | null
  lowestPriceYtd: number | null
  lowestT30dPrice: number | null
  discountPct: number | null
  rowNumber: number
}

type SortKey = 'startAsc' | 'startDesc' | 'priceAsc' | 'priceDesc' | 'discountDesc'
type RowState = 'idle' | 'queued' | 'running' | 'done' | 'failed'

interface RowRunStatus {
  state: RowState
  message?: string
  url?: string
}

interface DealsCsvImporterProps {
  /** Called after one or more rows successfully publish so the parent
   *  page can refresh its Recent Deals list. */
  onDealsChanged: () => void
}

const SORT_LABELS: Record<SortKey, string> = {
  startAsc: 'Start time · earliest first',
  startDesc: 'Start time · latest first',
  priceAsc: 'Price · low to high',
  priceDesc: 'Price · high to low',
  discountDesc: 'Discount · high to low',
}

export default function DealsCsvImporter({ onDealsChanged }: DealsCsvImporterProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parsing, setParsing] = useState(false)
  const [rows, setRows] = useState<AmazonDealRow[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('startAsc')
  const [rowStatus, setRowStatus] = useState<Record<string, RowRunStatus>>({})

  // Filter + sort derived view. The original rows array is the source of
  // truth — we never mutate it.
  const view = useMemo(() => {
    const q = query.trim().toLowerCase()
    let filtered = q
      ? rows.filter((r) => {
          // Search by brand OR asin name OR ASIN (covers every realistic
          // free-text need without a separate filter UI).
          const hay = `${r.brand ?? ''} ${r.asinName ?? ''} ${r.asin}`.toLowerCase()
          return hay.includes(q)
        })
      : rows.slice()

    const cmp = (a: AmazonDealRow, b: AmazonDealRow): number => {
      switch (sort) {
        case 'startAsc':
          return safeDate(a.dealStartDatetime) - safeDate(b.dealStartDatetime)
        case 'startDesc':
          return safeDate(b.dealStartDatetime) - safeDate(a.dealStartDatetime)
        case 'priceAsc':
          return (a.dealPrice ?? Infinity) - (b.dealPrice ?? Infinity)
        case 'priceDesc':
          return (b.dealPrice ?? -Infinity) - (a.dealPrice ?? -Infinity)
        case 'discountDesc':
          return (b.discountPct ?? -Infinity) - (a.discountPct ?? -Infinity)
      }
    }
    filtered.sort(cmp)
    return filtered
  }, [rows, query, sort])

  async function handleFile(file: File) {
    setParsing(true)
    setWarnings([])
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/deals/parse-csv', { method: 'POST', body: form })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(j.error || 'Couldn\'t parse the CSV.')
        return
      }
      setRows(j.rows || [])
      setFileName(j.fileName || file.name)
      if (Array.isArray(j.warnings) && j.warnings.length > 0) {
        setWarnings(j.warnings)
      }
      toast.success(`Parsed ${j.rows.length} deal${j.rows.length === 1 ? '' : 's'} from ${j.fileName || file.name}.`)
      // Reset row statuses on a fresh upload.
      setRowStatus({})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setParsing(false)
    }
  }

  async function runRow(row: AmazonDealRow, scheduled: boolean) {
    const key = `${row.rowNumber}:${row.asin}`
    setRowStatus((prev) => ({ ...prev, [key]: { state: 'running' } }))

    // Pick the right occasion from Amazon's promotion_type (e.g.
    // LIGHTNING_DEAL → lightning_deal). Falls back to 'auto' (date-window
    // detection) when Amazon's value is generic.
    const occasion = mapPromotion(row.promotionType, row.dealPrice, row.lowestPriceYtd)

    // For scheduled mode, use the deal's actual start time. WP will
    // publish the post at exactly that moment.
    const scheduledAt = scheduled && row.dealStartDatetime ? row.dealStartDatetime : undefined
    const manualDealEnd = row.dealEndDatetime || undefined

    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asin: row.asin,
          occasion,
          manualDealEnd,
          ...(scheduledAt ? { scheduledAt } : {}),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRowStatus((prev) => ({ ...prev, [key]: { state: 'failed', message: j.error || 'Failed' } }))
        toast.error(`${row.asinName || row.asin}: ${j.error || 'Generation failed'}`)
        return
      }
      setRowStatus((prev) => ({
        ...prev,
        [key]: { state: 'done', url: j.url, message: scheduled ? 'Scheduled' : 'Published' },
      }))
      onDealsChanged()
    } catch (err) {
      setRowStatus((prev) => ({
        ...prev,
        [key]: { state: 'failed', message: err instanceof Error ? err.message : 'Network error' },
      }))
    }
  }

  function clearCsv() {
    setRows([])
    setFileName(null)
    setWarnings([])
    setRowStatus({})
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="rounded-2xl border p-6" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h2 className="text-[14px] font-semibold flex items-center gap-2" style={{ color: 'var(--text)' }}>
            <FileSpreadsheet size={15} className="text-[#7C3AED]" /> Bulk import from Amazon CSV
          </h2>
          <p className="text-[12px] mt-1" style={{ color: 'var(--text-soft)' }}>
            Drop the deals CSV exported from your Amazon Associates dashboard. Sort by start time, price, or discount, then schedule each post to publish the moment its deal goes live.
          </p>
        </div>
        {fileName && (
          <button
            type="button"
            onClick={clearCsv}
            className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-faint)' }}
          >
            <X size={11} /> Clear
          </button>
        )}
      </div>

      {/* Where to find the CSV — primer shown until a file is parsed.
          Lots of new users miss the Promotions tab or assume the CSV
          is something they have to build by hand. Step-by-step kills
          both confusions. */}
      {rows.length === 0 && (
        <div
          className="rounded-xl p-4 mb-4 border"
          style={{ backgroundColor: 'rgba(124,58,237,0.08)', borderColor: 'rgba(124,58,237,0.25)' }}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(124,58,237,0.18)' }}
            >
              <FileSpreadsheet size={14} style={{ color: '#C4B5FD' }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold mb-1" style={{ color: 'var(--text)' }}>
                Where to find this CSV
              </p>
              <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
                This bulk import is for Amazon Associates and Amazon Influencers who have access to the <strong style={{ color: 'var(--text)' }}>Promotions</strong> tab on their Amazon affiliate dashboard. To get the file:
              </p>
              <ol className="list-decimal list-inside text-[11.5px] mt-2 space-y-1 marker:text-[#C4B5FD]" style={{ color: 'var(--text-soft)' }}>
                <li>Open Amazon Associates, then <strong style={{ color: 'var(--text)' }}>Promotions</strong> &rsaquo; <strong style={{ color: 'var(--text)' }}>Deals Hub</strong>.</li>
                <li>Click the yellow <strong style={{ color: 'var(--text)' }}>Export deals</strong> button (top right of the table).</li>
                <li>Upload the downloaded .csv below.</li>
              </ol>
              <a
                href="https://affiliate-program.amazon.com/home/promotionhub"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-3 text-[11px] font-semibold hover:underline"
                style={{ color: '#C4B5FD' }}
              >
                Open Amazon Deals Hub <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Upload zone */}
      {rows.length === 0 && (
        <label
          className="block rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors"
          style={{ borderColor: 'var(--border-bright)' }}
          onDragOver={(e) => {
            e.preventDefault()
            e.currentTarget.style.borderColor = '#7C3AED'
          }}
          onDragLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-bright)'
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.currentTarget.style.borderColor = 'var(--border-bright)'
            const file = e.dataTransfer.files?.[0]
            if (file) handleFile(file)
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
          {parsing ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-soft)' }} />
              <p className="text-[12px]" style={{ color: 'var(--text-soft)' }}>Parsing CSV…</p>
            </div>
          ) : (
            <>
              <UploadCloud size={24} className="mx-auto mb-2" style={{ color: 'var(--text-soft)' }} />
              <p className="text-[13px] font-medium" style={{ color: 'var(--text)' }}>
                Drag a CSV here or click to pick a file
              </p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
                Expects the Amazon Creator Connections deals export. Max 5MB, 2000 rows.
              </p>
            </>
          )}
        </label>
      )}

      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg p-3 text-[11px] border" style={{ backgroundColor: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.30)', color: 'var(--text-soft)' }}>
          <div className="flex items-center gap-1.5 font-semibold mb-1" style={{ color: '#F59E0B' }}>
            <AlertCircle size={12} /> Heads up
          </div>
          <ul className="list-disc list-inside space-y-0.5">
            {warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
            {warnings.length > 5 && <li>... and {warnings.length - 5} more.</li>}
          </ul>
        </div>
      )}

      {/* Search + sort + table */}
      {rows.length > 0 && (
        <>
          <div className="flex items-center gap-3 flex-wrap mt-2 mb-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
              <input
                type="text"
                placeholder="Search by brand, product, or ASIN"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg border text-[13px] focus:outline-none"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-bright)', color: 'var(--text)' }}
              />
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border text-[12px] px-3 py-2"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-bright)', color: 'var(--text)' }}
            >
              {Object.entries(SORT_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
              {view.length} of {rows.length}
            </span>
          </div>

          {/* Table */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    <Th>Product</Th>
                    <Th className="w-28">Brand</Th>
                    <Th className="w-24">Price</Th>
                    <Th className="w-16">Off</Th>
                    <Th className="w-40">Starts</Th>
                    <Th className="w-40">Ends</Th>
                    <Th className="w-44 text-right">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {view.map((row) => {
                    const key = `${row.rowNumber}:${row.asin}`
                    const status = rowStatus[key]
                    return (
                      <CsvRow
                        key={key}
                        row={row}
                        status={status}
                        onGenerateNow={() => runRow(row, false)}
                        onSchedule={() => runRow(row, true)}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────

function safeDate(s: string | null): number {
  if (!s) return Number.POSITIVE_INFINITY
  const t = Date.parse(s)
  return isNaN(t) ? Number.POSITIVE_INFINITY : t
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return s
  }
}

function fmtPrice(n: number | null): string {
  if (n == null) return '—'
  return `$${n.toFixed(2).replace(/\.00$/, '')}`
}

function mapPromotion(promotionType: string | null, dealPrice: number | null, lowestPriceYtd: number | null): string {
  const t = (promotionType ?? '').toUpperCase()
  if (t.includes('LIGHTNING')) return 'lightning_deal'
  if (t.includes('PRIME_DAY') || t.includes('PRIME DAY')) return 'prime_day'
  if (t.includes('PRIME_BIG_DEAL') || t.includes('BIG_DEAL_DAYS')) return 'prime_big_deal_days'
  if (t.includes('BLACK_FRIDAY') || t.includes('BLACK FRIDAY')) return 'black_friday'
  if (t.includes('CYBER_MONDAY') || t.includes('CYBER MONDAY')) return 'cyber_monday'
  if (t.includes('HOLIDAY')) return 'holiday'
  // Year-low detector — Amazon's lowest_price_ytd matches the deal price.
  if (dealPrice != null && lowestPriceYtd != null && dealPrice <= lowestPriceYtd + 0.01) {
    return 'lowest_price_ytd'
  }
  return 'auto'
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${className}`}
      style={{ color: 'var(--text-faint)' }}
    >
      {children}
    </th>
  )
}

function CsvRow({
  row,
  status,
  onGenerateNow,
  onSchedule,
}: {
  row: AmazonDealRow
  status: RowRunStatus | undefined
  onGenerateNow: () => void
  onSchedule: () => void
}) {
  const isDone = status?.state === 'done'
  const isRunning = status?.state === 'running'
  const isFailed = status?.state === 'failed'
  const canSchedule = !!row.dealStartDatetime && Date.parse(row.dealStartDatetime) - Date.now() > 60_000

  return (
    <tr className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
      <td className="px-3 py-3 max-w-md">
        <a
          href={row.asinUrl ?? `https://www.amazon.com/dp/${row.asin}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] line-clamp-2"
          style={{ color: 'var(--text)' }}
          title={row.asinName ?? row.asin}
        >
          {row.asinName ?? row.asin}
        </a>
        <p className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-faint)' }}>{row.asin}</p>
      </td>
      <td className="px-3 py-3 text-[12px]" style={{ color: 'var(--text-soft)' }}>
        {row.brand ?? '—'}
      </td>
      <td className="px-3 py-3 text-[12px] tabular-nums" style={{ color: 'var(--text)' }}>
        {fmtPrice(row.dealPrice)}
        {row.vrp != null && row.dealPrice != null && row.vrp > row.dealPrice && (
          <span className="block text-[10px] line-through" style={{ color: 'var(--text-faint)' }}>{fmtPrice(row.vrp)}</span>
        )}
      </td>
      <td className="px-3 py-3 text-[12px] tabular-nums font-semibold" style={{ color: row.discountPct && row.discountPct >= 30 ? '#10B981' : 'var(--text-soft)' }}>
        {row.discountPct != null ? `${Math.round(row.discountPct)}%` : '—'}
      </td>
      <td className="px-3 py-3 text-[11px] tabular-nums" style={{ color: 'var(--text-soft)' }}>{fmtDate(row.dealStartDatetime)}</td>
      <td className="px-3 py-3 text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{fmtDate(row.dealEndDatetime)}</td>
      <td className="px-3 py-3 text-right">
        {isRunning ? (
          <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-soft)' }}>
            <Loader2 size={11} className="animate-spin" /> Running…
          </span>
        ) : isDone ? (
          <a
            href={status.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#10B981]"
          >
            <CheckCircle2 size={11} /> {status.message} <ExternalLink size={10} />
          </a>
        ) : isFailed ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-[#F43F5E]" title={status.message}>
            <AlertCircle size={11} /> Failed
          </span>
        ) : (
          <div className="flex items-center gap-1 justify-end">
            <button
              type="button"
              onClick={onGenerateNow}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-colors"
              style={{ backgroundColor: 'rgba(124,58,237,0.16)', color: '#C4B5FD' }}
              title="Generate + publish immediately"
            >
              <Sparkles size={10} /> Now
            </button>
            <button
              type="button"
              onClick={onSchedule}
              disabled={!canSchedule}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'var(--surface-bright)', color: 'var(--text-soft)' }}
              title={canSchedule ? `Generate now, WordPress publishes on ${fmtDate(row.dealStartDatetime)}` : 'Deal start time is missing or in the past — use Now'}
            >
              <Clock size={10} /> Schedule
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

// Re-suppress unused-import warning for icons we may bring back when the
// CSV importer adds bulk-select.
void ChevronUp
void ChevronDown
