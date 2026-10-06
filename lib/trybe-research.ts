// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE outreach (Labs): what a brand's own website says about it, so the
// first message can name what they actually sell instead of a category.
//
// Done here on the server, not in SCOUT: it needs no access to the creator's
// browser, works for any site, and every hop goes through safeFetch so a brand
// link can never point MVP at an internal address.
//
// Two reads, both best-effort:
//   1. The home page: title, meta description, headings and the first stretch
//      of visible text.
//   2. Shopify's public /products.json, which most DTC brands on TRYBE run on:
//      real product names, the most useful thing a pitch can mention.
//
// A failure is returned as `error`, never thrown, and the queue shows it. A
// draft written without the website is labelled so, so it never passes for a
// researched one.

import { safeFetch } from '@/lib/ssrf-guard'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

export interface SiteResearch {
  summary: string
  products: string[]
  error: string | null
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' ' })
}

function clean(s: string): string {
  return decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** The readable parts of a page: title, description, headings, body text. */
export function pageSummary(html: string, max = 2500): string {
  const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
  const desc = decode(
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]
      || html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i)?.[1]
      || '',
  ).trim()
  const headings = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .map(m => clean(m[1])).filter(h => h && h.length < 140)
  const uniqHeadings = Array.from(new Set(headings)).slice(0, 15)
  const body = clean(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<(nav|footer|header|svg)[\s\S]*?<\/\1>/gi, ' '),
  )
  const parts = [
    title && `Title: ${title}`,
    desc && `Description: ${desc}`,
    uniqHeadings.length ? `Headings: ${uniqHeadings.join(' | ')}` : '',
    body && `Text: ${body.slice(0, 1500)}`,
  ].filter(Boolean)
  return parts.join('\n').slice(0, max)
}

/** A brand link as a plain https origin + path, or null when it is not one. */
export function normalizeSite(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim()
  if (!s) return null
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null
    // Tracking params say nothing about the brand and change the cache key.
    for (const k of Array.from(u.searchParams.keys())) if (/^(utm_|ref|fbclid|gclid)/i.test(k)) u.searchParams.delete(k)
    return u.toString()
  } catch { return null }
}

async function getText(url: string, accept: string): Promise<{ ok: boolean; status: number; text: string; finalType: string }> {
  const res = await safeFetch(url, { headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(12_000) })
  const text = res.ok ? (await res.text()).slice(0, 600_000) : ''
  return { ok: res.ok, status: res.status, text, finalType: res.headers.get('content-type') || '' }
}

export async function researchBrandSite(rawUrl: string | null | undefined): Promise<SiteResearch> {
  const url = normalizeSite(rawUrl)
  if (!url) return { summary: '', products: [], error: 'TRYBE listed no website for this brand.' }

  let summary = ''
  let error: string | null = null
  try {
    const home = await getText(url, 'text/html,application/xhtml+xml')
    if (home.ok) summary = pageSummary(home.text)
    else error = `The website answered ${home.status}.`
  } catch (e) {
    error = `The website could not be read (${e instanceof Error ? e.message : 'error'}).`
  }

  const products: string[] = []
  try {
    const origin = new URL(url).origin
    const res = await getText(`${origin}/products.json?limit=30`, 'application/json')
    if (res.ok && /json/i.test(res.finalType)) {
      const data = JSON.parse(res.text) as { products?: Array<{ title?: string; product_type?: string }> }
      for (const p of data.products || []) {
        const t = String(p.title || '').replace(/\s+/g, ' ').trim()
        if (t && t.length < 120 && !products.includes(t)) products.push(t)
        if (products.length >= 15) break
      }
    }
  } catch { /* not a Shopify store, or it hides the feed: the home page is enough */ }

  // A site that blocked the home page but listed products is still researched.
  if (!summary && products.length) error = null
  return { summary, products, error }
}
