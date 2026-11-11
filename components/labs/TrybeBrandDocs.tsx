'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT THE BRAND SENT, WHERE THE SCRIPTS ARE WRITTEN (Seb, 2026-11-11: "if
// the brand on trybe shares a pdf with extra instructions for video creation,
// we should be able to upload that pdf and have mvp read it and take into
// consideration everything in it before scripting"). In Brand scripts, before
// writing: the PDFs and documents MVP has read for this brand, each with how
// much was read or why not, the TLDR, Add the brand's PDF, and Remove for a
// wrong one. Brand scripts then follow them and say which they followed.

import { useEffect, useRef, useState } from 'react'
import { Loader2, FileText, Check, AlertTriangle, Upload, X, ChevronDown, ChevronUp } from 'lucide-react'
import { addBrandPdf, brandDocs, dropBrandDoc } from '@/lib/trybe-brand-pdf-client'
import { isAddedFile, type LinksDigest } from '@/lib/trybe-message-links'

const soft = { color: 'var(--text-3)' }
const GREEN = '#15803D'
const AMBER = '#B45309'

export default function TrybeBrandDocs({ brandId, brandName, accent }: { brandId: string; brandName: string; accent: string }) {
  const [digest, setDigest] = useState<LinksDigest | null>(null)
  const [stage, setStage] = useState<'uploading' | 'reading' | 'removing' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDigest(null); setErr(null)
    let live = true
    void brandDocs(brandId).then((r) => { if (live && r.digest) setDigest(r.digest) })
    return () => { live = false }
  }, [brandId])

  const add = async (f: File) => {
    setErr(null)
    const r = await addBrandPdf(brandId, brandName, f, setStage)
    setStage(null)
    if (r.error) setErr(r.error); else if (r.digest) { setDigest(r.digest); setOpen(true) }
  }
  const drop = async (url: string) => {
    setErr(null); setStage('removing')
    const r = await dropBrandDoc(brandId, brandName, url)
    setStage(null)
    if (r.error) setErr(r.error); else setDigest(r.digest ?? null)
  }

  const docs = digest?.links ?? []
  const readCount = docs.filter((l) => l.ok).length
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1" style={soft}><FileText size={11} /> What {brandName} sent you</p>
      {docs.length === 0 ? (
        <p className="mt-1 text-[12.5px]" style={soft}>If {brandName} sent a PDF with instructions for its videos, add it here. MVP reads every page, pictures included, and the scripts follow it.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-[12.5px]">
          {docs.map((l) => (
            <li key={l.url} className="flex items-start gap-1.5">
              {l.ok ? <Check size={13} className="mt-0.5 shrink-0" style={{ color: l.cut ? AMBER : GREEN }} /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" style={{ color: AMBER }} />}
              <span className="min-w-0 break-words flex-1">
                <b>{l.title || (isAddedFile(l) ? l.url.slice(5) : l.url)}</b>
                {l.ok
                  ? l.cut ? `: read, but it is longer than MVP can copy out, so only its first ${l.text.length.toLocaleString()} characters are used.` : `: read in full (${l.text.length.toLocaleString()} characters).`
                  : `: ${l.why || 'not read.'}`}
              </span>
              <button type="button" onClick={() => void drop(l.url)} disabled={!!stage} className="shrink-0 inline-flex items-center gap-0.5 text-[11.5px] font-semibold disabled:opacity-50" style={soft} aria-label={`Remove ${l.title || 'this document'}`}>
                <X size={11} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {digest?.tldr && (
        <div className="mt-1.5">
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: accent }} aria-expanded={open}>
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {open ? 'Hide' : 'Show'} what they ask for, in short
          </button>
          {open && (
            <div className="mt-1 text-[12.5px] space-y-1.5">
              <ul className="list-disc pl-5 space-y-0.5">{digest.tldr.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
              {digest.tldr.say.length > 0 && <><p className="font-semibold" style={{ color: GREEN }}>Say or show</p><ul className="list-disc pl-5 space-y-0.5">{digest.tldr.say.map((p, i) => <li key={i}>{p}</li>)}</ul></>}
              {digest.tldr.avoid.length > 0 && <><p className="font-semibold" style={{ color: AMBER }}>Avoid</p><ul className="list-disc pl-5 space-y-0.5">{digest.tldr.avoid.map((p, i) => <li key={i}>{p}</li>)}</ul></>}
            </div>
          )}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={!!stage} className="inline-flex items-center gap-1 font-semibold disabled:opacity-60" style={{ color: accent }}>
          {stage ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {docs.some(isAddedFile) ? 'Add another PDF' : `Add ${brandName}’s PDF`}
        </button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void add(f) }} />
        {stage === 'uploading' && <span style={soft}>Uploading the PDF...</span>}
        {stage === 'reading' && <span style={soft}>MVP is reading every page. A long guide takes up to two minutes; keep this page open.</span>}
        {stage === 'removing' && <span style={soft}>Taking it off and writing the summary again...</span>}
        {!stage && readCount > 0 && <span style={{ color: GREEN }}>The scripts follow {readCount === 1 ? 'this' : `these ${readCount}`}.</span>}
      </div>
      {err && <p className="mt-1 text-[12.5px] inline-flex items-start gap-1" style={{ color: AMBER }}><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {err}</p>}
    </div>
  )
}
