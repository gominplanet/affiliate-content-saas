// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE READ OF META'S AD LIBRARY through SCOUT for a list of TRYBE brands,
// eight at a time so each batch answers well inside SCOUT's time limit, each
// batch saved to MVP as it comes back. Find brands' "Check for Meta ads" and
// What's working's ads gallery both use it, so they say the same things. With
// `cards` (the MVP team, SCOUT 1.51.0) the words of each brand's ad cards go
// too, for the gallery every member sees (app/api/labs/trybe 'meta_ads').

import { requestMetaAdsCounts } from '@/lib/extension-frame'
import { readAdLibraryCount, metaOwnOf, metaTrustOf, sameAsBefore } from '@/lib/trybe-pick'

export interface MetaAdsRun {
  total: number
  read: number
  noCount: number
  couldNot: number
  late: number
  notEnglish: string
  stopped: string
  /** Cards asked for, and whether SCOUT sent any field for them (an older SCOUT does not). */
  cardsAsked: boolean
  cardsSent: boolean
  galleryAds: number
  cardsMissed: number
  /** Counts that are not the brand's: at Meta's most, or mostly other advertisers' ads. */
  capped: number
  mixed: number
  /** The same count as the brand read just before it: not saved, counted again later. */
  doubled: number
  /** Of those read: written to MVP, or kept as they were because another
   *  member counted them this week (a member never replaces a recent count). */
  saved: number
  kept: number
}

async function save(results: Array<{ brandId: string; name: string; count: number; cards?: unknown; own?: number; sample?: number }>): Promise<{ galleryAds: number; cardsMissed: number; saved: number; kept: number }> {
  const r = await fetch('/api/labs/trybe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'meta_ads', results }), signal: AbortSignal.timeout(60_000) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `Saving the Meta ad counts failed (${r.status})`)
  // An older server says nothing of saved: every count it took is saved.
  return { galleryAds: Number(d.galleryAds) || 0, cardsMissed: Number(d.cardsMissed) || 0, saved: typeof d.saved === 'number' ? d.saved : results.length, kept: Number(d.kept) || 0 }
}

export async function readMetaAds(brands: Array<{ brandId: string; name: string }>, opts: { cards?: boolean; onProgress?: (done: number, total: number) => void; gone?: () => boolean; stop?: () => boolean } = {}): Promise<MetaAdsRun> {
  const run: MetaAdsRun = { total: brands.length, read: 0, noCount: 0, couldNot: 0, late: 0, notEnglish: '', stopped: '', cardsAsked: !!opts.cards, cardsSent: false, galleryAds: 0, cardsMissed: 0, capped: 0, mixed: 0, doubled: 0, saved: 0, kept: 0 }
  for (let i = 0; i < brands.length; i += 8) {
    if (opts.gone?.()) { run.stopped = 'You left the page.'; break }
    if (opts.stop?.()) { run.stopped = 'Stopped. Press again to carry on where it stopped.'; break }
    const batch = brands.slice(i, i + 8)
    // The ads on the page are always read (SCOUT 1.51.0), so every count is
    // checked as the brand's own (lib/trybe-pick metaOwnOf). Only the MVP
    // team's go to the server whole, for What's working's gallery.
    const r = await requestMetaAdsCounts(batch, true)
    if (!r.ok) {
      run.stopped = r.error === 'no-access' ? 'SCOUT is not allowed on Facebook, so it could not open Meta’s Ad Library. Press the button again and allow it when Chrome asks.'
        : r.error === 'already-running' ? 'SCOUT is already reading Meta’s Ad Library in another tab. Wait for it to finish.'
          : `SCOUT could not read Meta's Ad Library: ${r.error || 'no answer'}.`
      break
    }
    const ok: Array<{ brandId: string; name: string; count: number; cards?: unknown; own?: number; sample?: number }> = []
    let prevText: string | null = null
    for (const x of r.results || []) {
      if (Array.isArray(x.cards)) run.cardsSent = true
      const count = x.text ? readAdLibraryCount(x.text) : null
      const check = Array.isArray(x.cards) ? metaOwnOf(x.cards as Array<{ text?: unknown }>, x.name) : null
      const doubled = sameAsBefore(prevText, x.text, count)
      prevText = x.text ?? null
      if (doubled) run.doubled++
      else if (count != null) {
        const t = metaTrustOf({ count, own: check?.own, sample: check?.sample })
        if (t === 'capped') run.capped++
        else if (t === 'mixed') run.mixed++
        // A check of 0 cards goes too: it marks the brand tried, so it is not
        // offered again on every press.
        ok.push({ brandId: x.brandId, name: x.name, count, ...(check ? { own: check.own, sample: check.sample } : {}), ...(opts.cards && Array.isArray(x.cards) ? { cards: x.cards } : {}) })
      }
      else if (/^not-english/.test(x.error || '')) run.notEnglish = (x.error || '').replace(/^not-english\s*/, '')
      else if (/^could-not-open/.test(x.error || '')) run.couldNot++
      else run.noCount++
    }
    if (ok.length) { const s = await save(ok); run.galleryAds += s.galleryAds; run.cardsMissed += s.cardsMissed; run.saved += s.saved; run.kept += s.kept }
    run.read += ok.length
    run.late += (r.notReached || []).length
    opts.onProgress?.(Math.min(brands.length, i + 8), brands.length)
    if (run.notEnglish) break
  }
  return run
}

/** COUNT ALL (Seb, 2026-10-21: "can we get through all of the brands"): the
 *  whole list, forty at a time, each forty saved as it comes back and
 *  `onChunk` told, so the page can rank what is counted while the rest is
 *  read. A stop, a page left or a SCOUT that cannot go on ends it; what was
 *  counted is kept. */
export async function readMetaAdsAll(brands: Array<{ brandId: string; name: string }>, opts: { cards?: boolean; onProgress?: (done: number, total: number) => void; gone?: () => boolean; stop?: () => boolean; onChunk?: () => Promise<void> | void } = {}): Promise<MetaAdsRun> {
  const all: MetaAdsRun = { total: brands.length, read: 0, noCount: 0, couldNot: 0, late: 0, notEnglish: '', stopped: '', cardsAsked: !!opts.cards, cardsSent: false, galleryAds: 0, cardsMissed: 0, capped: 0, mixed: 0, doubled: 0, saved: 0, kept: 0 }
  const CHUNK = 40
  for (let i = 0; i < brands.length; i += CHUNK) {
    const r = await readMetaAds(brands.slice(i, i + CHUNK), { cards: opts.cards, gone: opts.gone, stop: opts.stop, onProgress: (done) => opts.onProgress?.(Math.min(brands.length, i + done), brands.length) })
    for (const k of ['read', 'noCount', 'couldNot', 'late', 'galleryAds', 'cardsMissed', 'capped', 'mixed', 'doubled', 'saved', 'kept'] as const) all[k] += r[k]
    all.cardsSent = all.cardsSent || r.cardsSent
    all.notEnglish = all.notEnglish || r.notEnglish
    if (r.stopped || r.notEnglish) { all.stopped = r.stopped; break }
    await opts.onChunk?.()
  }
  return all
}

/** What the run did, in words, and how it went. */
export function metaAdsWords(run: MetaAdsRun, scoutVersion?: string | null): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  const parts = [`Meta ads read for ${run.read} of ${run.total} brand${run.total === 1 ? '' : 's'}${run.kept ? `: ${run.saved} saved, ${run.kept} kept as they were because another member counted ${run.kept === 1 ? 'it' : 'them'} this week` : ''}.`]
  if (run.noCount) parts.push(`${run.noCount} showed no result count on Meta's page, so ${run.noCount === 1 ? 'it stays' : 'they stay'} not read.`)
  if (run.couldNot) parts.push(`SCOUT could not open Meta's page for ${run.couldNot}.`)
  if (run.late) parts.push(`SCOUT ran out of time before ${run.late}; press again to read ${run.late === 1 ? 'it' : 'them'}.`)
  if (run.notEnglish) parts.push(`Facebook is not in English in this Chrome (${run.notEnglish}), so the counts cannot be read. Switch Facebook to English and press again.`)
  if (run.doubled) parts.push(`${run.doubled} came back with exactly the count of the brand read just before ${run.doubled === 1 ? 'it' : 'them'}, which may be that brand\u2019s page, so ${run.doubled === 1 ? 'it was' : 'they were'} not saved and ${run.doubled === 1 ? 'is' : 'are'} counted again next time.`)
  if (run.capped || run.mixed) parts.push(`${run.capped + run.mixed} of them ${run.capped + run.mixed === 1 ? 'has' : 'have'} a common-word name, so Meta counts other advertisers\u2019 ads too: ${run.capped + run.mixed === 1 ? 'it is' : 'they are'} marked and listed after the rest.`)
  if (run.cardsAsked && run.read) {
    if (!run.cardsSent) parts.push(`Your SCOUT${scoutVersion ? ` (${scoutVersion})` : ''} only reads the counts: SCOUT 1.51.0 also copies the ads themselves into What's working.`)
    else parts.push(run.galleryAds ? `${run.galleryAds} ad${run.galleryAds === 1 ? '' : 's'} copied into What's working's ads gallery.` : 'No ad cards to copy into the gallery.')
    if (run.cardsMissed) parts.push(`For ${run.cardsMissed}, Meta showed ads but SCOUT could not read their cards, so ${run.cardsMissed === 1 ? 'its' : 'their'} earlier ads stay.`)
  }
  if (run.stopped) parts.push(run.stopped)
  return { tone: run.stopped || run.notEnglish ? 'bad' : run.read < run.total || (run.cardsAsked && run.read > 0 && !run.cardsSent) ? 'warn' : 'ok', text: parts.join(' ') }
}
