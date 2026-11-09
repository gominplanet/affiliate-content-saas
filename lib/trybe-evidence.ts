// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// HOW MVP KNOWS (Seb, 2026-11-09: "when it says like, are these brands paying
// creators? Are they spending on ads? How do we know for sure? What is the
// data backing it up from tribe?"). Every claim a brand card makes comes with
// the facts behind it, each naming where it came from and when it was read:
//
//   Pays creators:  TRYBE's own list (what it shows paid out, its payout
//                   range, videos approved), its pay terms on TRYBE, and what
//                   MVP members were paid (pooled, five at least).
//   Spends on ads:  Meta's Ad Library (its own ads, counted by SCOUT) and
//                   TRYBE's Top 100. TRYBE itself says nothing about ad spend,
//                   and the words say so rather than borrow TRYBE's name.
//
// A claim nothing backs is said as not confirmed, with why, so silence never
// reads as a yes (the CLAUDE.md rule: a failure must look different from a
// success on screen).
//
// RETAINERS (same message: "we should actually show users very visibly if a
// brand is also offering retainers"). Read from TRYBE's pay terms first
// ("Guaranteed $500 this period if you submit 10 videos"), then from the
// brand's own words on TRYBE or its website, but only where the word sits
// next to creators or monthly pay: "clear retainers for your smile" is a
// product, not an offer. The words themselves are kept to show, so a creator
// can read what MVP read. Pure, so it is tested (scripts/test-trybe-evidence).

import { readTerms } from './trybe-pay'

export type EvidenceSource = 'TRYBE' | 'TRYBE Top 100' | 'Meta Ad Library' | 'MVP members' | 'MVP log of TRYBE'
export interface EvidenceLine { text: string; source: EvidenceSource; at: string | null }
export interface ClaimProof {
  /** Something here proves it, not only suggests it. */
  confirmed: boolean
  lines: EvidenceLine[]
  /** Why it is not confirmed, in words; null when it is. */
  missing: string | null
}
export interface RetainerRead {
  /** Dollars, when TRYBE's terms give them. */
  amount: number | null
  /** Videos asked for, when the terms say. */
  videos: number | null
  /** TRYBE's terms, or the brand's own sentence. */
  text: string
  source: 'terms' | 'about' | 'website'
}
export interface BrandEvidence { pays: ClaimProof; ads: ClaimProof; retainer: RetainerRead | null }

export interface EvidenceInput {
  /** What TRYBE shows paid to its creators, in dollars. */
  paidOut: number | null
  /** TRYBE's payout range ("$50K+"). */
  earningsBucket: string | null
  videosApproved: number | null
  videos30d: number | null
  /** TRYBE's pay rules for it, in words (lib/trybe-pay payLines). */
  payLines: string[]
  /** What MVP members were paid per approved video, pooled. */
  membersPerVideo: number | null
  /** Its payout range went up lately (MVP's log of TRYBE), from what. */
  tierUpFrom: string | null
  /** When MVP last saw it on TRYBE's list. */
  listAt: string | null
  metaAds: number | null
  metaCheckedAt: string | null
  /** 'own' | 'unchecked' | 'capped' | 'mixed' (lib/trybe-pick metaTrustOf). */
  metaTrust: string | null
  /** The count is under four weeks old. */
  metaFresh: boolean
  top100Hits: number | null
  top100BestRank: number | null
  top100At: string | null
  about: string | null
  siteText: string | null
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** The proof behind "pays creators" and "spends on ads". Pure. */
export function evidenceOf(i: EvidenceInput): BrandEvidence {
  // ── PAYS CREATORS ──
  const pays: EvidenceLine[] = []
  const bucketPays = !!i.earningsBucket && /[1-9]/.test(i.earningsBucket)
  if (i.paidOut != null && i.paidOut > 0) pays.push({ text: `TRYBE shows ${money(i.paidOut)} paid to its creators`, source: 'TRYBE', at: i.listAt })
  else if (bucketPays) pays.push({ text: `TRYBE puts what its creators earned at ${i.earningsBucket}${i.tierUpFrom ? `, up from ${i.tierUpFrom} this month` : ''}`, source: 'TRYBE', at: i.listAt })
  if (i.tierUpFrom && i.paidOut != null && i.paidOut > 0 && bucketPays) pays.push({ text: `Its payout range went up from ${i.tierUpFrom} to ${i.earningsBucket} this month`, source: 'MVP log of TRYBE', at: null })
  if (i.videos30d != null && i.videos30d > 0) pays.push({ text: `${count(i.videos30d, 'video')} approved in the last 30 days`, source: 'TRYBE', at: i.listAt })
  else if (i.videosApproved != null && i.videosApproved > 0) pays.push({ text: `${count(i.videosApproved, 'video')} approved on TRYBE so far`, source: 'TRYBE', at: i.listAt })
  if (i.membersPerVideo != null && i.membersPerVideo > 0) pays.push({ text: `MVP members were paid about ${money(i.membersPerVideo)} per approved video`, source: 'MVP members', at: null })
  if (i.payLines.length) pays.push({ text: `Its pay on TRYBE: ${i.payLines.slice(0, 2).join('; ')}`, source: 'TRYBE', at: i.listAt })
  const paysConfirmed = (i.paidOut != null && i.paidOut > 0) || bucketPays || (i.membersPerVideo != null && i.membersPerVideo > 0)
  const paysMissing = paysConfirmed ? null
    : i.payLines.length ? 'Not confirmed yet: it lists pay on TRYBE, but TRYBE shows nothing paid out, and fewer than 5 MVP members have been paid by it.'
      : 'Not confirmed yet: TRYBE shows nothing paid out and no pay terms, and fewer than 5 MVP members have been paid by it.'

  // ── SPENDS ON ADS ── (TRYBE says nothing about ad spend: Meta and TRYBE's Top 100 do.)
  const ads: EvidenceLine[] = []
  const own = i.metaTrust === 'own' || i.metaTrust === 'unchecked' || i.metaTrust == null
  const metaCount = i.metaAds != null && i.metaFresh && own ? i.metaAds : null
  if (metaCount != null && metaCount > 0) ads.push({ text: `${count(metaCount, 'ad')} of its own running on Meta`, source: 'Meta Ad Library', at: i.metaCheckedAt })
  else if (metaCount === 0) ads.push({ text: 'No ads of its own running on Meta at the last count', source: 'Meta Ad Library', at: i.metaCheckedAt })
  else if (i.metaAds != null && i.metaFresh && !own) ads.push({ text: i.metaTrust === 'capped' ? 'Meta shows the most it counts for its name, so its own ads cannot be told apart' : 'Most ads Meta shows for its name are other advertisers’, so MVP does not count them', source: 'Meta Ad Library', at: i.metaCheckedAt })
  else if (i.metaAds != null && !i.metaFresh) ads.push({ text: 'Its Meta ads were last counted over four weeks ago', source: 'Meta Ad Library', at: i.metaCheckedAt })
  if (i.top100Hits != null && i.top100Hits > 0) ads.push({ text: `${count(i.top100Hits, 'video')} in TRYBE’s Top 100${i.top100BestRank ? `, best at #${i.top100BestRank}` : ''}`, source: 'TRYBE Top 100', at: i.top100At })
  const adsConfirmed = (metaCount != null && metaCount > 0) || (i.top100Hits != null && i.top100Hits > 0)
  const adsMissing = adsConfirmed ? null
    : metaCount === 0 ? `Not confirmed: no ads of its own on Meta at the last count${i.top100At ? ', and none of its videos in TRYBE’s Top 100' : ''}.`
      : i.metaAds == null ? 'Not confirmed yet: MVP has not counted its Meta ads.'
        : 'Not confirmed yet: its Meta count is not clear or not recent.'

  return {
    pays: { confirmed: paysConfirmed, lines: pays, missing: paysMissing },
    ads: { confirmed: adsConfirmed, lines: ads, missing: adsMissing },
    retainer: retainerOf({ payLines: i.payLines, about: i.about, siteText: i.siteText }),
  }
}

// A retainer word only counts next to creators or monthly pay; a product
// called a retainer (teeth, aligners) never does.
const NEAR = /\b(?:creators?|influencers?|ugc|content|ambassadors?|affiliates?|partners?|monthly|per month|a month|\/mo\b|paid|pay|top performers?|videos?)\b/i
const PRODUCT = /\b(?:teeth|tooth|orthodont\w*|aligners?|dental|dentist|smile|night ?guards?|mouth ?guards?|retainer cases?|clear retainers?|bite)\b/i
const OFFER = /\bretainers?\b|\bguaranteed (?:monthly )?pay\b|\bmonthly (?:creator )?(?:stipend|pay)\b|\bbase pay\b/gi

/** The sentence around an offer of a retainer in these words, or null. Pure. */
export function retainerWords(text: string | null | undefined): string | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  for (const m of t.matchAll(OFFER)) {
    const at = m.index ?? 0
    const from = Math.max(0, at - 70), to = Math.min(t.length, at + m[0].length + 70)
    const near = t.slice(from, to)
    if (!NEAR.test(near.replace(m[0], ' ')) || PRODUCT.test(near)) continue
    // Cut to whole words, with … where the sentence goes on.
    let s = near
    if (from > 0) s = s.replace(/^\S*\s/, '')
    if (to < t.length) s = s.replace(/\s\S*$/, '')
    return `${from > 0 ? '…' : ''}${s.trim()}${to < t.length ? '…' : ''}`
  }
  return null
}

/** Whether it offers a retainer: TRYBE's terms first, then its own words on
 *  TRYBE, then its website. Null when none of them says so, which is not
 *  "no": a brand can still offer one in chat. Pure. */
export function retainerOf(i: { payLines: string[]; about: string | null; siteText: string | null }): RetainerRead | null {
  const term = readTerms(i.payLines).terms.find((t) => t.kind === 'retainer')
  if (term) return { amount: term.amount ?? null, videos: term.videos ?? null, text: term.text, source: 'terms' }
  const about = retainerWords(i.about)
  if (about) return { amount: null, videos: null, text: about, source: 'about' }
  const site = retainerWords(i.siteText)
  if (site) return { amount: null, videos: null, text: site, source: 'website' }
  return null
}

/** A retainer in a few words, for a badge. Pure. */
export function retainerShort(r: RetainerRead): string {
  if (r.amount != null) return `Retainer ${money(r.amount)}${r.videos ? ` for ${count(r.videos, 'video')}` : ''}`
  return 'Offers retainers'
}

/** Where a retainer was read, for its hover and the proof box. Pure. */
export function retainerSource(r: RetainerRead): string {
  return r.source === 'terms' ? `TRYBE’s pay terms: “${r.text}”`
    : r.source === 'about' ? `Its own words on TRYBE: “${r.text}”`
      : `Its website: “${r.text}”`
}
