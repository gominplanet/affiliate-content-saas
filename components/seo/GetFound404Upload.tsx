// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Drop-in for the "get found" hero: the user exports their Search Console
// "Not found (404)" list (a .csv, or the .zip Google hands back) and drops it
// here. We pull the URLs out, match each dead URL to the right live post, and
// 301-redirect it — no typing, no wp-admin. High/medium-confidence matches are
// applied automatically; anything uncertain is sent to Fix 404s for a look.
'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { UploadCloud, Loader2, CheckCircle2 } from 'lucide-react'

// GSC exports are full https URLs; pull them out of CSV/plain text.
function extractUrls(text: string): string[] {
  const set = new Set<string>()
  const re = /https?:\/\/[^\s,"'<>]+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) set.add(m[0].replace(/[.,);]+$/, ''))
  return Array.from(set)
}

interface Match { fromUrl: string; from: string; to: string | null; confidence: string }

export default function GetFound404Upload({ onDone }: { onDone?: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [result, setResult] = useState<{ fixed: number; total: number; leftover: number } | null>(null)

  const handleFile = async (file: File) => {
    setResult(null)
    setBusy('Reading your export…')
    try {
      let text = ''
      if (/\.zip$/i.test(file.name)) {
        const mod = await import('jszip')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const JSZip = (mod as any).default || mod
        const zip = await JSZip.loadAsync(file)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const csvs = Object.values(zip.files).filter((f: any) => !f.dir && /\.csv$/i.test(f.name))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const c of csvs as any[]) text += '\n' + await c.async('string')
      } else {
        text = await file.text()
      }
      const urls = extractUrls(text)
      if (urls.length === 0) {
        // The top-level Page-indexing export is COUNTS only (Chart / Critical
        // issues / Metadata) — no page URLs. Detect it and point the user at the
        // right export instead of a vague "no URLs".
        const isSummary = /reason,\s*source,\s*validation,\s*pages/i.test(text) || /not indexed,\s*indexed,\s*impressions/i.test(text)
        toast.error(isSummary
          ? "That's the summary export (just the counts). In Search Console, click the \"Not found (404)\" row to open the page list, THEN hit Export — that file has the URLs."
          : 'No page URLs found in that file. Make sure you exported from inside the "Not found (404)" report.')
        setBusy(null); return
      }
      setBusy(`Matching ${urls.length} dead URLs to your live posts…`)
      const mr = await fetch('/api/tools/redirects/match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls }),
      })
      const md = await mr.json().catch(() => ({}))
      if (!mr.ok) throw new Error(md.error || 'Could not match the URLs.')
      const matches = (md.matches || []) as Match[]
      const auto = matches.filter(m => m.to && (m.confidence === 'high' || m.confidence === 'medium'))
      const leftover = matches.length - auto.length
      if (auto.length === 0) {
        setResult({ fixed: 0, total: matches.length, leftover })
        setBusy(null); return
      }
      setBusy(`Redirecting ${auto.length} URLs…`)
      const ar = await fetch('/api/tools/redirects/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirects: auto.map(m => ({ from: m.from, to: m.to })) }),
      })
      const ad = await ar.json().catch(() => ({}))
      if (!ar.ok) throw new Error(ad.error || 'Could not save the redirects.')
      setResult({ fixed: auto.length, total: matches.length, leftover })
      onDone?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not process that file.')
    } finally {
      setBusy(null)
      if (ref.current) ref.current.value = ''
    }
  }

  return (
    <div>
      <input ref={ref} type="file" accept=".zip,.csv,text/csv,text/plain" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f) }} />
      <div
        role="button"
        tabIndex={0}
        onClick={() => { if (!busy) ref.current?.click() }}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !busy) ref.current?.click() }}
        onDragOver={e => { e.preventDefault(); if (!busy) setDragOver(true) }}
        onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
        onDrop={e => {
          e.preventDefault(); setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f && !busy) void handleFile(f)
        }}
        aria-disabled={!!busy}
        className={`w-full cursor-pointer inline-flex items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-3 text-[13px] font-semibold text-[#7C3AED] transition-colors ${busy ? 'opacity-60 cursor-default' : ''} ${dragOver ? 'border-[#7C3AED] bg-[#7C3AED]/15' : 'border-[#7C3AED]/40 bg-[#7C3AED]/5 hover:bg-[#7C3AED]/10'}`}
      >
        {busy ? <><Loader2 size={15} className="animate-spin" /> {busy}</> : <><UploadCloud size={15} /> {dragOver ? 'Drop to upload' : 'Drop your Search Console export here, or click to choose (.zip or .csv)'}</>}
      </div>
      {result && (
        <div className="mt-2 flex items-start gap-2 text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">
          <CheckCircle2 size={15} className="text-[#34c759] mt-0.5 flex-shrink-0" />
          <span>
            {result.fixed > 0
              ? `Fixed ${result.fixed} of ${result.total} dead URLs — each now 301-redirects to the right live post. `
              : `Read ${result.total} URLs but couldn't confidently match them. `}
            {result.leftover > 0 && (
              <Link href="/tools/redirects" className="font-semibold text-[#7C3AED] hover:underline">Review the remaining {result.leftover} in Fix 404s →</Link>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
