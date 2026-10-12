'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The brand a TRYBE chat is with, at the top of the chat (Seb, 2026-10-12:
// "find the actual page for those brands on trybe and also have their website
// link there too.. get into that main page to be able to request samples, see
// the brief, etc.. from the chat room"). Its own TRYBE page (Request Sample,
// Creative Brief, Commission Program are there), its website, its pay, and
// the brief when TRYBE sends it. Which brand, and how MVP knows, is in
// lib/trybe-brand-page. A chat MVP cannot tie to a brand says so, with a
// search on TRYBE, instead of showing nothing.

import { useEffect, useState } from 'react'
import { ExternalLink, Globe, Handshake, Loader2, FileText, ChevronDown, Search } from 'lucide-react'
import { requestTrybeApi } from '@/lib/extension-frame'
import { readBrandStats } from '@/lib/trybe-mybrands'
import { brandIdFromChat, brandPageUrl, matchBrand, readBrandCard, type BrandCard, type BrandRef } from '@/lib/trybe-brand-page'

const PURPLE = '#7C3AED'

// Read once per page visit: the brands joined on TRYBE, and each brand's details.
let joinedCache: Promise<Array<{ id: string; name: string }>> | null = null
const detailsCache = new Map<string, Promise<BrandCard | null>>()

function loadJoined(): Promise<Array<{ id: string; name: string }>> {
  if (!joinedCache) {
    joinedCache = requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all')
      .then((r) => (r.ok ? readBrandStats(r.json).map((b) => ({ id: b.id, name: b.name })) : []))
      .catch(() => [])
    // A failed read is tried again next time, not remembered as "no brands".
    void joinedCache.then((l) => { if (!l.length) joinedCache = null })
  }
  return joinedCache
}
function loadDetails(id: string): Promise<BrandCard | null> {
  let p = detailsCache.get(id)
  if (!p) {
    p = requestTrybeApi('GET', `/backend/api/creator/v2/brands/${encodeURIComponent(id)}/details`)
      .then((r) => (r.ok ? readBrandCard(r.json) : null))
      .catch(() => null)
    detailsCache.set(id, p)
    void p.then((c) => { if (!c) detailsCache.delete(id) })
  }
  return p
}

export default function TrybeBrandCard({ chatName, chatRaw, directory, canStats, canDetails }: {
  chatName: string
  chatRaw: Record<string, unknown>
  /** MVP's TRYBE directory: brand id, name and website. */
  directory: Array<{ id: string; name: string; website?: string | null }>
  /** SCOUT reads the brands joined on TRYBE (1.46.0). */
  canStats: boolean
  /** SCOUT reads a brand's details on TRYBE (1.45.0). */
  canDetails: boolean
}) {
  const [brand, setBrand] = useState<BrandRef | null | undefined>(undefined)
  const [card, setCard] = useState<BrandCard | null>(null)
  const [cardRead, setCardRead] = useState<'reading' | 'read' | 'not-read'>('reading')
  const [briefOpen, setBriefOpen] = useState(false)

  // The chat's own brand id, as a string, so a list refresh (a new object
  // for the same chat) does not read everything again.
  const fromChat = brandIdFromChat(chatRaw)
  useEffect(() => {
    let live = true
    setBrand(undefined); setCard(null); setCardRead('reading'); setBriefOpen(false)
    ;(async () => {
      const joined = canStats ? await loadJoined() : []
      let ref: BrandRef | null = null
      if (fromChat) {
        const named = [...joined, ...directory].find((b) => b.id === fromChat)
        ref = { id: fromChat, name: named?.name || chatName, website: directory.find((b) => b.id === fromChat)?.website ?? null, source: 'chat' }
      } else ref = matchBrand(chatName, joined, directory)
      if (!live) return
      setBrand(ref)
      if (!ref || !canDetails) { setCardRead('not-read'); return }
      const c = await loadDetails(ref.id)
      if (!live) return
      setCard(c); setCardRead(c ? 'read' : 'not-read')
    })()
    return () => { live = false }
  }, [chatName, fromChat, directory, canStats, canDetails])

  if (brand === undefined) {
    return <span className="ml-auto inline-flex items-center gap-1 text-[12px]" style={{ color: 'var(--text-2)' }}><Loader2 size={11} className="animate-spin" /> Finding this brand on TRYBE</span>
  }
  if (!brand) {
    // Said, with the way to find it, rather than a missing link.
    return (
      <a href="https://jointrybe.com/creator/discover" target="_blank" rel="noopener noreferrer"
        className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: PURPLE }}
        title="MVP could not tell which TRYBE brand this chat is with (a group chat, or a brand not on your list). This opens TRYBE's brand list to find it.">
        <Search size={11} /> Not matched to a brand: find it on TRYBE <ExternalLink size={10} />
      </a>
    )
  }

  const website = card?.website || brand.website || null
  const page = brandPageUrl(brand.id)
  const link = 'inline-flex items-center gap-1 text-[12px] font-semibold'
  return (
    <div className="w-full mt-1 rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--border)', background: 'rgba(124,58,237,0.05)' }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {card?.logo && <img src={card.logo} alt="" className="w-7 h-7 rounded-full object-cover bg-white" />}
        <span className="text-[13px] font-semibold">{card?.name || brand.name}</span>
        {card?.pay && <span className="text-[11.5px] rounded-full px-2 py-0.5" style={{ background: 'rgba(22,163,74,0.12)', color: '#15803d' }}>{card.pay}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          <a href={page} target="_blank" rel="noopener noreferrer" className={link} style={{ color: PURPLE }}
            title="The brand's own page on TRYBE: Request Sample, Creative Brief, Commission Program, Create Content">
            <Handshake size={12} /> Brand page on TRYBE <ExternalLink size={10} />
          </a>
          {website
            ? <a href={website} target="_blank" rel="noopener noreferrer" className={link} style={{ color: PURPLE }}><Globe size={12} /> Website <ExternalLink size={10} /></a>
            : cardRead !== 'reading' && <span className="text-[11.5px]" style={{ color: 'var(--text-2)' }}>No website on TRYBE</span>}
        </span>
      </div>
      <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--text-2)' }}>
        Request a sample, read the creative brief and see the commission program on the brand page.
        {brand.source !== 'chat' && <> Matched by name{brand.source === 'joined' ? ' to a brand you joined' : ' to MVP’s brand list'}; if it is the wrong brand, use the search on TRYBE.</>}
      </p>
      {cardRead === 'reading' && <p className="text-[11.5px] mt-1 inline-flex items-center gap-1" style={{ color: 'var(--text-2)' }}><Loader2 size={11} className="animate-spin" /> Reading the brand&rsquo;s details on TRYBE</p>}
      {(card?.brief || card?.briefUrl) && (
        <div className="mt-2">
          {card.briefUrl && <a href={card.briefUrl} target="_blank" rel="noopener noreferrer" className={link} style={{ color: PURPLE }}><FileText size={12} /> Open the creative brief <ExternalLink size={10} /></a>}
          {card.brief && (<>
            <button onClick={() => setBriefOpen((v) => !v)} className={`${link} ${card.briefUrl ? 'ml-3' : ''}`} style={{ color: PURPLE }}>
              <FileText size={12} /> {briefOpen ? 'Hide the brief' : 'Read the brief here'} <ChevronDown size={12} className={briefOpen ? 'rotate-180' : ''} />
            </button>
            {briefOpen && <p className="mt-1.5 text-[12.5px] whitespace-pre-line max-h-60 overflow-y-auto">{card.brief}</p>}
          </>)}
        </div>
      )}
      {card && !card.brief && !card.briefUrl && card.about && <p className="text-[12px] mt-1.5 line-clamp-3" style={{ color: 'var(--text-2)' }}>{card.about}</p>}
    </div>
  )
}
