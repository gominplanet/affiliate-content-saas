'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT THE BRAND SENT, IN SHORT (Seb, 2026-11-10: a brand's creator coach sent
// a product deck and a creator deck on Canva, two Google Docs, a Calendly
// link and a Discord invite: "is MVP able to read that and take all of that
// data and information into consideration when it comes to creating video
// scripts, or at least giving the user maybe a TLDR?"). Above a chat whose
// brand messages hold links: what they are, and Read them for me. MVP reads
// each one it can (lib/trybe-message-links), writes a TLDR, and keeps both;
// Brand scripts for this brand then follow them. Each link that was not read
// says why, and a Canva deck can be added as its PDF.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, FileText, ExternalLink, Check, AlertTriangle, Upload, ChevronDown, ChevronUp } from 'lucide-react'
import { messageLinks, openWords, type LinksDigest, type MessageLink } from '@/lib/trybe-message-links'
import { addBrandPdf } from '@/lib/trybe-brand-pdf-client'

const soft = { color: 'var(--text-3)' }
const GREEN = '#15803D'
const AMBER = '#B45309'
const KIND_WORDS: Record<MessageLink['kind'], string> = {
  gdoc: 'Google Doc', gslides: 'Google Slides deck', gsheet: 'Google Sheet', gdrive: 'Google Drive file', canva: 'Canva deck',
  booking: 'booking page', invite: 'community invite', video: 'video', web: 'web page',
}

async function call(body: Record<string, unknown>): Promise<{ digest?: LinksDigest | null; error?: string }> {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return { error: j.error || `MVP answered ${r.status}` }
  return j
}

export default function TrybeBrandLinks({ brandId, brandName, messages }: {
  brandId: string | null
  brandName: string
  messages: Array<{ mine: boolean | null; text: string }> | null
}) {
  // The links in the brand's own messages, newest message first.
  const found = useMemo(() => {
    const brandText = (messages || []).filter((m) => m.mine !== true).map((m) => m.text).reverse().join('\n')
    return messageLinks(brandText, 10)
  }, [messages])
  const [digest, setDigest] = useState<LinksDigest | null>(null)
  const [busy, setBusy] = useState<'reading' | 'pdf' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDigest(null); setErr(null)
    if (!brandId) return
    let live = true
    void call({ action: 'message_links_get', brandId }).then((r) => { if (live && r.digest) setDigest(r.digest) })
    return () => { live = false }
  }, [brandId])

  const addPdf = async (f: File) => {
    if (!brandId) return
    setBusy('pdf'); setErr(null)
    // Straight to MVP storage, then every page read (lib/trybe-brand-pdf-client).
    const r = await addBrandPdf(brandId, brandName, f)
    setBusy(null)
    if (r.error) setErr(r.error); else if (r.digest) { setDigest(r.digest); setOpen(true) }
  }

  // A brand chat with no links still takes the brand's PDF (2026-11-11).
  if (!found.length && !digest) {
    if (!brandId) return null
    return (
      <div className="mx-4 mt-3 rounded-xl border px-3 py-2 text-[12.5px] flex flex-wrap items-center gap-x-3 gap-y-1" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2, rgba(0,0,0,0.03))' }}>
        <FileText size={14} style={{ color: 'var(--accent)' }} />
        <span style={soft}>Did {brandName} send a PDF with instructions for its videos? Add it and Brand scripts follow it.</span>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy} className="inline-flex items-center gap-1 font-semibold disabled:opacity-60" style={{ color: 'var(--accent)' }}>
          {busy === 'pdf' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {busy === 'pdf' ? 'Reading every page...' : `Add ${brandName}\u2019s PDF`}
        </button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addPdf(f) }} />
        {err && <span className="basis-full inline-flex items-start gap-1" style={{ color: AMBER }}><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {err}</span>}
      </div>
    )
  }
  const counts = Object.entries(found.reduce<Record<string, number>>((a, l) => { a[l.kind] = (a[l.kind] || 0) + 1; return a }, {}))
    .map(([k, n]) => `${n} ${KIND_WORDS[k as MessageLink['kind']]}${n === 1 ? '' : 's'}`).join(', ')
  const unread = found.filter((l) => !digest?.links.some((d) => d.url === l.url))

  const read = async () => {
    if (!brandId) return
    setBusy('reading'); setErr(null)
    const text = (messages || []).filter((m) => m.mine !== true).map((m) => m.text).reverse().join('\n')
    const r = await call({ action: 'message_links', brandId, brandName, text })
    setBusy(null)
    if (r.error) setErr(r.error); else if (r.digest) { setDigest(r.digest); setOpen(true) }
  }


  const readCount = digest ? digest.links.filter((l) => l.ok).length : 0
  return (
    <div className="mx-4 mt-3 rounded-xl border px-3 py-2.5 text-[12.5px]" style={{ borderColor: 'var(--border-2)', background: 'var(--surface-2, rgba(0,0,0,0.03))' }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <FileText size={14} style={{ color: 'var(--accent)' }} />
        <span className="font-semibold">{brandName} sent {found.length} link{found.length === 1 ? '' : 's'}{counts ? `: ${counts}` : ''}.</span>
        {!brandId
          ? <span style={soft}>MVP could not tell which TRYBE brand this chat is with, so it cannot keep what it reads.</span>
          : (
            <button type="button" onClick={() => void read()} disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-semibold disabled:opacity-60" style={{ background: 'var(--accent)', color: '#fff' }}>
              {busy === 'reading' ? <><Loader2 size={12} className="animate-spin" /> Reading the links...</> : digest ? (unread.length ? `Read the ${unread.length} new link${unread.length === 1 ? '' : 's'}` : 'Read them again') : 'Read them for me'}
            </button>
          )}
        {brandId && (
          <button type="button" onClick={() => fileRef.current?.click()} disabled={!!busy} className="inline-flex items-center gap-1 font-semibold disabled:opacity-60" style={{ color: 'var(--accent)' }}
            title="A PDF the brand sent, or a Canva deck downloaded as a PDF: MVP reads every page and Brand scripts follow it.">
            {busy === 'pdf' ? <><Loader2 size={12} className="animate-spin" /> Reading every page...</> : <><Upload size={12} /> Add a PDF the brand sent</>}
          </button>
        )}
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addPdf(f) }} />
        {digest && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="ml-auto inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--accent)' }} aria-expanded={open}>
            {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {open ? 'Hide' : 'Show'} what they say
          </button>
        )}
      </div>
      {err && <p className="mt-1.5 inline-flex items-start gap-1" style={{ color: AMBER }}><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {err}</p>}
      {digest && open && (
        <div className="mt-2.5 space-y-2.5">
          {digest.tldr ? (
            <div>
              <p className="font-semibold text-[13px]">In short</p>
              <ul className="mt-1 space-y-0.5 list-disc pl-5">{digest.tldr.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
              {digest.tldr.say.length > 0 && <><p className="font-semibold mt-2" style={{ color: GREEN }}>Say or show</p><ul className="mt-0.5 space-y-0.5 list-disc pl-5">{digest.tldr.say.map((p, i) => <li key={i}>{p}</li>)}</ul></>}
              {digest.tldr.avoid.length > 0 && <><p className="font-semibold mt-2" style={{ color: AMBER }}>Avoid</p><ul className="mt-0.5 space-y-0.5 list-disc pl-5">{digest.tldr.avoid.map((p, i) => <li key={i}>{p}</li>)}</ul></>}
            </div>
          ) : digest.why ? <p style={{ color: AMBER }}>{digest.why}</p> : null}
          <ul className="space-y-1">
            {digest.links.map((l) => (
              <li key={l.url} className="flex items-start gap-1.5">
                {l.ok ? <Check size={13} className="mt-0.5 shrink-0" style={{ color: GREEN }} /> : <AlertTriangle size={12} className="mt-0.5 shrink-0" style={{ color: AMBER }} />}
                <span className="min-w-0 break-words">
                  <b>{l.title || KIND_WORDS[l.kind]}</b>{l.ok ? `: read (${l.text.length.toLocaleString()} characters).` : `: ${l.why}`}{' '}
                  {/^https?:/.test(l.url) && <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-semibold underline whitespace-nowrap" style={{ color: 'var(--accent)' }}>{openWords({ url: l.url, kind: l.kind })} <ExternalLink size={10} /></a>}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
            <span style={soft}>{readCount ? `Brand scripts for ${digest.brandName} now follow ${readCount === 1 ? 'this' : 'these'} too.` : 'Nothing read yet, so Brand scripts do not use these.'} Read {new Date(digest.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</span>
          </div>
        </div>
      )}
    </div>
  )
}
