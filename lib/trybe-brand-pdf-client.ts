// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BRAND'S PDF, ADDED BY THE CREATOR (Seb, 2026-11-11: "if the brand on
// trybe shares a pdf with extra instructions for video creation, we should be
// able to upload that pdf and have mvp read it and take into consideration
// everything in it before scripting"). The browser puts the file straight in
// MVP storage (a brand guide is often over the 4.5 MB a request to MVP's
// server may carry), then MVP reads every page, pictures included, writes the
// TLDR, and keeps it for this creator and brand, where Brand scripts read it.
// The file itself is deleted from storage once read.

import type { LinksDigest } from '@/lib/trybe-message-links'

export const BRAND_PDF_MAX_BYTES = 22 * 1024 * 1024

type Answer = { digest?: LinksDigest | null; error?: string }

async function call(body: Record<string, unknown>, ms = 60_000): Promise<Answer & Record<string, unknown>> {
  try {
    const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { error: j.error || `MVP answered ${r.status}` }
    return j
  } catch (e) {
    return { error: e instanceof Error && e.name === 'TimeoutError' ? 'MVP took too long to answer. Try again.' : 'MVP did not answer. Check your connection and try again.' }
  }
}

/** What MVP keeps of what this brand sent, for this creator. */
export function brandDocs(brandId: string): Promise<Answer> {
  return call({ action: 'message_links_get', brandId })
}

/** Add a PDF the brand sent: checked, uploaded, read. `onStage` says where it is. */
export async function addBrandPdf(brandId: string, brandName: string, f: File, onStage?: (s: 'uploading' | 'reading') => void): Promise<Answer> {
  if (!/pdf$/i.test(f.type) && !/\.pdf$/i.test(f.name)) return { error: 'That is not a PDF. Pick the PDF the brand sent.' }
  if (!f.size) return { error: 'That file is empty.' }
  if (f.size > BRAND_PDF_MAX_BYTES) return { error: `That PDF is ${Math.round(f.size / 1048576)} MB. MVP reads PDFs up to ${Math.round(BRAND_PDF_MAX_BYTES / 1048576)} MB; ask the brand for a smaller one, or print the pages that matter to a new PDF.` }
  onStage?.('uploading')
  const u = await call({ action: 'message_links_pdf_url', brandId, name: f.name, bytes: f.size })
  if (u.error || typeof u.uploadUrl !== 'string' || typeof u.path !== 'string') return { error: u.error || 'MVP could not open an upload for it.' }
  try {
    // A 22 MB file on a slow connection: up to five minutes.
    const put = await fetch(u.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: f, signal: AbortSignal.timeout(300_000) })
    if (!put.ok) return { error: `The PDF did not upload (storage answered ${put.status}). Nothing was read.` }
  } catch (e) { return { error: e instanceof Error && e.name === 'TimeoutError' ? 'The PDF took over five minutes to upload, so MVP stopped. Nothing was read.' : 'The PDF did not upload: the connection dropped. Nothing was read.' } }
  onStage?.('reading')
  // Every page is read, so a long guide takes a while.
  return call({ action: 'message_links_pdf', brandId, brandName, name: f.name, path: u.path }, 290_000)
}

/** Take a document off (a wrong PDF); the TLDR is written again without it. */
export function dropBrandDoc(brandId: string, brandName: string, url: string): Promise<Answer> {
  return call({ action: 'message_links_drop', brandId, brandName, url }, 120_000)
}
