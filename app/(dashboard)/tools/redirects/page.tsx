// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// /tools/redirects — the 404 → 301 fixer. Paste (or upload) a Search Console
// "Not found (404)" export; MVP matches each dead URL to the best live post and
// writes 301 redirects via the plugin (v1.0.65+). Recovers link equity Google
// found for URLs that no longer exist (deleted duplicates, re-slugged posts).
'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { gscPageIndexingUrl } from '@/lib/gsc-links'
import { Loader2, ExternalLink, ChevronLeft, ArrowRight, Upload, Signpost, CheckCircle2, Home } from 'lucide-react'

type Confidence = 'high' | 'medium' | 'low' | 'none'
interface Match {
  from: string
  fromUrl: string
  slug: string
  to: string | null
  toTitle: string | null
  type: string
  confidence: Confidence
  candidates: { url: string; title: string }[]
}

const HOME = '__home__'
const SKIP = '__skip__'

// Extract URLs from pasted text or a CSV (GSC exports are full https URLs).
function extractUrls(text: string): string[] {
  const full = text.match(/https?:\/\/[^\s,"'<>]+/gi) || []
  if (full.length) return Array.from(new Set(full.map(u => u.replace(/[),.]+$/, ''))))
  return Array.from(new Set(
    text.split(/[\r\n]+/).map(l => l.trim().split(/[,\t]/)[0].trim()).filter(l => l.startsWith('/')),
  ))
}

function confBadge(c: Confidence) {
  const map: Record<Confidence, { label: string; color: string; bg: string }> = {
    high:   { label: 'Strong match',  color: '#248a3d', bg: 'rgba(36,138,61,0.10)' },
    medium: { label: 'Likely match',  color: '#b25000', bg: 'rgba(255,149,0,0.12)' },
    low:    { label: 'Weak match',    color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
    none:   { label: 'No match',      color: '#9aa0a6', bg: 'rgba(154,160,166,0.10)' },
  }
  return map[c]
}

export default function RedirectsPage() {
  const [input, setInput] = useState('')
  const [matching, setMatching] = useState(false)
  const [applying, setApplying] = useState(false)
  const [matches, setMatches] = useState<Match[] | null>(null)
  const [siteUrl, setSiteUrl] = useState('')
  const [choice, setChoice] = useState<Record<string, string>>({})   // from → target url | HOME | SKIP
  const [appliedFroms, setAppliedFroms] = useState<Set<string>>(new Set())
  const [gscProperty, setGscProperty] = useState<string | null>(null)

  const parsedCount = useMemo(() => extractUrls(input).length, [input])

  // The whole job starts in Search Console, so send people straight to their
  // OWN Page indexing report rather than the console root, where they'd have to
  // find their property first.
  useEffect(() => {
    fetch('/api/seo/gsc-property')
      .then(r => r.json())
      .then(d => setGscProperty(d?.property || null))
      .catch(() => { /* link falls back to the console root */ })
  }, [])

  const gscUrl = gscPageIndexingUrl(gscProperty)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const text = await f.text()
    setInput(prev => (prev.trim() ? prev + '\n' : '') + text)
    e.target.value = ''
  }

  async function runMatch() {
    const urls = extractUrls(input)
    if (urls.length === 0) { toast.error('Paste your 404 URLs (or upload the CSV) first.'); return }
    setMatching(true)
    try {
      const res = await fetch('/api/tools/redirects/match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Match failed'); return }
      const ms = (data.matches as Match[]) ?? []
      setMatches(ms)
      setSiteUrl(data.siteUrl || '')
      setAppliedFroms(new Set())
      // Default target: the suggestion for strong/likely matches, else skip.
      const def: Record<string, string> = {}
      for (const m of ms) def[m.from] = (m.to && (m.confidence === 'high' || m.confidence === 'medium')) ? m.to : SKIP
      setChoice(def)
      const s = data.summary || {}
      toast.success(`Matched ${ms.length} URLs — ${s.high || 0} strong, ${s.medium || 0} likely, ${(s.low || 0) + (s.none || 0)} unsure.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Match failed')
    } finally {
      setMatching(false)
    }
  }

  const pending = useMemo(
    () => (matches || []).filter(m => !appliedFroms.has(m.from) && choice[m.from] && choice[m.from] !== SKIP),
    [matches, choice, appliedFroms],
  )

  // How many rows have no live-post match — these are the ones you'd typically
  // batch-send to the homepage in one click.
  const unmatchedCount = useMemo(
    () => (matches || []).filter(m => !appliedFroms.has(m.from) && (m.confidence === 'none' || !m.to)).length,
    [matches, appliedFroms],
  )

  // Bulk selectors — only touch rows that aren't already applied.
  function bulkSet(fn: (m: Match) => string | null) {
    setChoice(c => {
      const n = { ...c }
      for (const m of matches || []) {
        if (appliedFroms.has(m.from)) continue
        const v = fn(m)
        if (v != null) n[m.from] = v
      }
      return n
    })
  }
  const sendAllToHome = () => bulkSet(() => HOME)
  const sendUnmatchedToHome = () => bulkSet(m => (m.confidence === 'none' || !m.to) ? HOME : null)
  const skipAll = () => bulkSet(() => SKIP)
  const resetToBest = () => bulkSet(m => (m.to && (m.confidence === 'high' || m.confidence === 'medium')) ? m.to : SKIP)

  async function applyRedirects(rows: Match[]) {
    const redirects = rows
      .map(m => {
        const c = choice[m.from]
        if (!c || c === SKIP) return null
        const to = c === HOME ? `${siteUrl}/` : c
        return { from: m.from, to }
      })
      .filter(Boolean) as { from: string; to: string }[]
    if (redirects.length === 0) { toast.error('Nothing selected to redirect.'); return }
    setApplying(true)
    try {
      const res = await fetch('/api/tools/redirects/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirects }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Apply failed'); return }
      setAppliedFroms(prev => { const n = new Set(prev); for (const r of redirects) n.add(r.from); return n })
      toast.success(`${data.applied} redirect${data.applied === 1 ? '' : 's'} live. Those URLs now 301 to your posts.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setApplying(false)
    }
  }

  return (
    <>
      <PageHero
        title="Fix 404s (redirects)"
        subtitle="Paste your Search Console “Not found (404)” list — MVP matches each dead URL to the right live post and 301-redirects it, recovering the ranking history Google already found."
      />

      <div className="max-w-4xl">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/seo" className="inline-flex items-center gap-1 text-sm text-[#86868b] hover:text-[#7C3AED]"><ChevronLeft size={15} /> SEO</Link>
          <Link href="/tools/duplicates" className="text-sm text-[#86868b] hover:text-[#7C3AED]">Duplicates →</Link>
        </div>

        {/* Input */}
        <div className="card p-4 mb-4">
          {/* Step 1 — the list lives in Search Console, so make getting there
              one click instead of a set of directions people have to follow. */}
          <div
            className="flex items-center justify-between gap-3 flex-wrap rounded-lg px-3 py-2.5 mb-3"
            style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
                Step 1 — grab your 404 list from Search Console
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                {gscProperty
                  ? <>Opens <span className="font-medium">{gscProperty}</span> → Page indexing. Scroll to <span className="font-medium">Not found (404)</span> → open it → export icon (top-right) → Download CSV.</>
                  : <>Opens Search Console → pick your site → Page indexing → <span className="font-medium">Not found (404)</span> → open it → export icon (top-right) → Download CSV.</>}
              </p>
            </div>
            <a
              href={gscUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] flex-shrink-0"
            >
              Open Search Console <ExternalLink size={13} />
            </a>
          </div>

          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>Step 2 — paste or upload it here</label>
          <textarea value={input} onChange={e => setInput(e.target.value)} rows={5}
            placeholder={`Paste 404 URLs, one per line — or the exported CSV's contents:\nhttps://yoursite.com/old-review/\nhttps://yoursite.com/another-review-2/`}
            className="w-full rounded-lg px-3 py-2 text-[13px] font-mono outline-none"
            style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#7C3AED] cursor-pointer hover:underline">
                <Upload size={13} /> Upload CSV
                <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} className="hidden" />
              </label>
              {parsedCount > 0 && <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>{parsedCount} URL{parsedCount === 1 ? '' : 's'} detected</span>}
            </div>
            <button onClick={runMatch} disabled={matching || parsedCount === 0}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60">
              {matching ? <Loader2 size={15} className="animate-spin" /> : <Signpost size={15} />}
              {matching ? 'Matching to your posts…' : 'Match to live posts'}
            </button>
          </div>
          <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
            The CSV has extra columns — that&apos;s fine, MVP pulls the URLs out and ignores the rest.
          </p>
        </div>

        {/* Results */}
        {matches && matches.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
              <span className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
                {matches.length} URLs · {pending.length} selected to redirect · {appliedFroms.size} applied
              </span>
              <button onClick={() => applyRedirects(matches)} disabled={applying || pending.length === 0}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60">
                {applying ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                Apply {pending.length} redirect{pending.length === 1 ? '' : 's'}
              </button>
            </div>

            {/* Bulk actions — the fast path. Most 404s with no live match just
                want to point at the homepage; do it in one click. */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>Bulk:</span>
              {unmatchedCount > 0 && (
                <button onClick={sendUnmatchedToHome}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9]">
                  <Home size={12} /> {unmatchedCount} unmatched → Homepage
                </button>
              )}
              <button onClick={sendAllToHome}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium"
                style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                <Home size={12} /> All → Homepage
              </button>
              <button onClick={resetToBest}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium"
                style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                Reset to best match
              </button>
              <button onClick={skipAll}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium"
                style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                Skip all
              </button>
            </div>

            <div className="card divide-y divide-gray-100 dark:divide-white/10">
              {matches.map(m => {
                const done = appliedFroms.has(m.from)
                const b = confBadge(m.confidence)
                const options = [
                  ...(m.to ? [{ url: m.to, title: m.toTitle || m.to }] : []),
                  ...m.candidates,
                ]
                return (
                  <div key={m.from} className="flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-mono truncate max-w-[300px]" style={{ color: 'var(--text)' }}>{m.from}</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ color: b.color, background: b.bg }}>{b.label}</span>
                      </div>
                      {!done ? (
                        <div className="flex items-center gap-1.5 mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                          <ArrowRight size={11} />
                          <select value={choice[m.from] ?? SKIP} onChange={e => setChoice(c => ({ ...c, [m.from]: e.target.value }))}
                            className="rounded px-1.5 py-1 text-[11px] outline-none max-w-[360px]"
                            style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                            {options.map(o => <option key={o.url} value={o.url}>{o.title}</option>)}
                            <option value={HOME}>→ Homepage</option>
                            <option value={SKIP}>Skip (leave as 404)</option>
                          </select>
                          {choice[m.from] && choice[m.from] !== SKIP && choice[m.from] !== HOME && (
                            <a href={choice[m.from]} target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline inline-flex items-center gap-0.5">open <ExternalLink size={9} /></a>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 mt-1 text-[11px] text-[#248a3d]"><CheckCircle2 size={11} /> Redirected</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {matches && matches.length === 0 && (
          <div className="card p-8 text-center" style={{ color: 'var(--text-faint)' }}>No URLs found in what you pasted.</div>
        )}
      </div>
    </>
  )
}
