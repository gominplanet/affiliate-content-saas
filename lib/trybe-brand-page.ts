// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE BRAND'S OWN TRYBE PAGE FROM A CHAT (Seb, 2026-10-12: "when clicking on
// brand page on trybe.. it rarely finds the page.. we need to find the actual
// page for those brands on trybe and also have their website link there too..
// it would also help if we could get into that main page to be able to request
// samples, see the brief, etc.. from the chat room").
//
// Two things went wrong. The inbox matched a chat to a brand only by its exact
// name against MVP's directory, so a chat named "Audien Creator Vault", or a
// brand that was never in the directory, found nothing. And the link went to
// TRYBE's Discover list, where SCOUT then searched for the brand's popup. A
// brand the creator has joined has its own page, jointrybe.com/creator/brands/
// <id>, with Request Sample, Creative Brief and Commission Program on it.
//
// So the brand is found, in order: an id in the chat's own data, the brands
// the creator has joined on TRYBE (brands/stats, keyed by brand id), then the
// directory; by whole name, then by the brand's name inside the chat's name.
// What TRYBE's brand details say (website, pay, about, brief) is read for the
// card in the chat. Pure, so it is tested (scripts/test-trybe-brand-page).

import { readDirectoryItem } from '@/lib/trybe-directory'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const ID = /^[A-Za-z0-9-]{6,80}$/

export const brandPageUrl = (id: string) => `https://jointrybe.com/creator/brands/${encodeURIComponent(id)}`

/** A brand id inside a chat's own data: brandId, brand.id, metadata.brandId,
 *  a brand participant. Three levels deep. Null when the chat does not say. */
export function brandIdFromChat(raw: unknown): string | null {
  const seen = new Set<unknown>()
  const walk = (v: unknown, depth: number): string | null => {
    if (depth > 3 || !v || typeof v !== 'object' || seen.has(v)) return null
    seen.add(v)
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 20)) {
        // A participant that is the brand.
        if (isObj(x) && /brand/i.test(str(x.type ?? x.role ?? x.kind ?? x.userType ?? x.user_type))) {
          const id = str(x.brandId ?? x.brand_id ?? x.id)
          if (ID.test(id)) return id
        }
        const got = walk(x, depth + 1)
        if (got) return got
      }
      return null
    }
    const o = v as Obj
    for (const [k, w] of Object.entries(o)) {
      if (/^brand_?id$/i.test(k)) { const id = str(w); if (ID.test(id)) return id }
    }
    for (const [k, w] of Object.entries(o)) {
      if (/^brand$/i.test(k) && isObj(w)) { const id = str(w.id ?? w.brandId ?? w._id); if (ID.test(id)) return id }
    }
    for (const w of Object.values(o)) { const got = walk(w, depth + 1); if (got) return got }
    return null
  }
  return walk(raw, 0)
}

/** A name for matching: lower case, letters and digits, no company words. */
export function normName(s: string): string {
  return String(s || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(inc|llc|ltd|co|corp|company|official|brand|the|store|shop)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

export interface BrandRef { id: string; name: string; website?: string | null; source: 'chat' | 'joined' | 'directory' }

/** The brand a chat is with. Whole name first, then the longest brand name
 *  that appears as whole words inside the chat's name ("Audien Creator Vault"
 *  is Audien). Joined brands win over the directory. */
export function matchBrand(chatName: string, joined: Array<{ id: string; name: string }>, directory: Array<{ id: string; name: string; website?: string | null }>): BrandRef | null {
  const n = normName(chatName)
  if (!n) return null
  const lists: Array<[BrandRef['source'], Array<{ id: string; name: string; website?: string | null }>]> = [['joined', joined], ['directory', directory]]
  for (const [source, list] of lists) {
    const hit = list.find((b) => normName(b.name) === n)
    if (hit) return { id: hit.id, name: hit.name, website: hit.website ?? null, source }
  }
  for (const [source, list] of lists) {
    let best: { id: string; name: string; website?: string | null } | null = null
    for (const b of list) {
      const bn = normName(b.name)
      // Three letters at least, so "Go" does not match every chat with "go" in it.
      if (bn.length < 3) continue
      if (new RegExp(`(^| )${bn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(n) && (!best || bn.length > normName(best.name).length)) best = b
    }
    if (best) return { id: best.id, name: best.name, website: best.website ?? null, source }
  }
  return null
}

export interface BrandCard {
  name: string | null
  logo: string | null
  website: string | null
  about: string | null
  pay: string | null
  /** The creative brief's words, when TRYBE sends them. */
  brief: string | null
  /** A link to the brief (a document), when TRYBE sends one. */
  briefUrl: string | null
}

const BRIEF_KEYS = ['creativeBrief', 'creative_brief', 'brief', 'contentBrief', 'content_brief', 'briefText', 'brief_text', 'guidelines', 'contentGuidelines', 'content_guidelines', 'instructions']
const BRIEF_URL_KEYS = ['creativeBriefUrl', 'creative_brief_url', 'briefUrl', 'brief_url', 'briefLink', 'brief_link', 'briefDocUrl', 'briefPdf', 'brief_pdf']

/** What GET creator/v2/brands/{id}/details says about the brand. */
export function readBrandCard(json: unknown): BrandCard {
  const root = isObj(json) && isObj(json.data) ? json.data : json
  const o: Obj = isObj(root) ? (isObj(root.brand) ? { ...(root.brand as Obj), ...root } : root) : {}
  const d = readDirectoryItem({ id: str(o.id) || 'brand-details', name: str(o.name ?? o.brandName) || 'Brand', ...o })
  const find = (keys: string[]): unknown => {
    for (const k of keys) { const v = o[k]; if (v != null && v !== '') return v }
    for (const v of Object.values(o)) if (isObj(v)) for (const k of keys) { const w = v[k]; if (w != null && w !== '') return w }
    return undefined
  }
  const briefRaw = find(BRIEF_KEYS)
  const briefObj = isObj(briefRaw) ? briefRaw : null
  const briefText = typeof briefRaw === 'string' ? briefRaw
    : briefObj ? str(briefObj.text ?? briefObj.content ?? briefObj.description ?? briefObj.body) : Array.isArray(briefRaw) ? briefRaw.map((x) => (typeof x === 'string' ? x : isObj(x) ? str(x.text ?? x.content ?? x.title) : '')).filter(Boolean).join('\n') : ''
  const urlRaw = str(find(BRIEF_URL_KEYS) ?? (briefObj ? briefObj.url ?? briefObj.fileUrl ?? briefObj.link : undefined))
  const looksUrl = (s: string) => /^https:\/\/\S+$/i.test(s)
  const logo = str(find(['logo', 'logoUrl', 'logo_url', 'image', 'imageUrl', 'avatar', 'profileImage']))
  return {
    name: str(o.name ?? o.brandName ?? o.brand_name) || null,
    logo: looksUrl(logo) ? logo : null,
    website: d?.website ?? null,
    about: d?.about ?? null,
    pay: d?.payText ?? null,
    brief: briefText && !looksUrl(briefText.trim()) ? briefText.trim().slice(0, 4000) : null,
    briefUrl: looksUrl(urlRaw) ? urlRaw : looksUrl(briefText.trim()) ? briefText.trim() : null,
  }
}

// ── The products a brand asks creators to promote ────────────────────────────

/** One item from a brand's "Promote These" on TRYBE. */
export interface PromotedProduct { id: string | null; name: string; image: string | null; url: string | null; price: string | null }

const PRODUCT_LIST_KEYS = ['promoteThese', 'promote_these', 'promotedProducts', 'promoted_products', 'promoteProducts', 'products', 'campaignProducts', 'campaign_products', 'brandProducts', 'productList', 'skus', 'offers']

/** The products in GET creator/v2/brands/{id}/details (Seb, 2026-10-13: the
 *  creator picks the one they have on hand, MVP plans the videos for it).
 *  Found under any of the names it is likely to have, one level deep too.
 *  Pure. */
export function readPromotedProducts(json: unknown): PromotedProduct[] {
  const root = isObj(json) && isObj(json.data) ? json.data : json
  const o: Obj = isObj(root) ? (isObj(root.brand) ? { ...(root.brand as Obj), ...root } : root) : {}
  let list: unknown[] | null = null
  for (const k of PRODUCT_LIST_KEYS) if (Array.isArray(o[k]) && (o[k] as unknown[]).length) { list = o[k] as unknown[]; break }
  if (!list) {
    for (const v of Object.values(o)) {
      if (!isObj(v)) continue
      for (const k of PRODUCT_LIST_KEYS) if (Array.isArray(v[k]) && (v[k] as unknown[]).length) { list = v[k] as unknown[]; break }
      if (list) break
    }
  }
  const url = (v: unknown) => { const s = str(v); return /^https:\/\//i.test(s) ? s : null }
  const out: PromotedProduct[] = []
  const seen = new Set<string>()
  for (const raw of list || []) {
    if (typeof raw === 'string') { const n = raw.trim(); if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); out.push({ id: null, name: n.slice(0, 140), image: null, url: null, price: null }) } continue }
    if (!isObj(raw)) continue
    const p = isObj(raw.product) ? { ...(raw.product as Obj), ...raw } : raw
    const name = str(p.name ?? p.title ?? p.productName ?? p.product_name ?? p.displayName)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const images = Array.isArray(p.images) ? p.images : []
    const firstImage = images.length ? (isObj(images[0]) ? (images[0] as Obj).url ?? (images[0] as Obj).src : images[0]) : undefined
    const price = p.price ?? p.retailPrice ?? p.retail_price
    out.push({
      id: str(p.id ?? p.productId ?? p.product_id) || null,
      name: name.slice(0, 140),
      image: url(p.image ?? p.imageUrl ?? p.image_url ?? p.thumbnail ?? p.thumbnailUrl ?? p.photo ?? firstImage),
      url: url(p.url ?? p.productUrl ?? p.product_url ?? p.link ?? p.shopUrl),
      price: price == null || price === '' ? null : typeof price === 'number' ? `$${price}` : str(price).slice(0, 20),
    })
    if (out.length >= 24) break
  }
  return out
}

// ── Reading a brief TRYBE keeps as a document link ───────────────────────────

/** Where to read a brief's words from: a Google Doc as plain text, anything
 *  else as it is. Pure. */
export function briefFetchUrl(url: string): string {
  const doc = url.match(/^https:\/\/docs\.google\.com\/document\/d\/([\w-]{20,})/)
  if (doc) return `https://docs.google.com/document/d/${doc[1]}/export?format=txt`
  return url
}

/** A brief's words from what its link answered, or why there are none. Pure. */
export function briefFromBody(contentType: string, body: string): { text: string | null; why: string | null } {
  const ct = contentType.toLowerCase()
  if (/pdf/.test(ct)) return { text: null, why: 'The brief is a PDF. Open it to read it.' }
  if (/image\//.test(ct)) return { text: null, why: 'The brief is an image. Open it to read it.' }
  let t = body
  if (/html|xml/.test(ct) || /^\s*</.test(body)) {
    t = body
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|br|tr)>|<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’')
  } else if (/json/.test(ct)) {
    try {
      const parts: string[] = []
      const walk = (v: unknown) => { if (typeof v === 'string' && v.trim().length > 1) parts.push(v.trim()); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk) }
      walk(JSON.parse(body))
      t = parts.join('\n')
    } catch { /* read as text */ }
  }
  t = t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim()
  if (t.length < 40) return { text: null, why: 'The brief link answered, but with almost no words (it may need you signed in). Open it to read it.' }
  return { text: t.slice(0, 6000), why: null }
}
