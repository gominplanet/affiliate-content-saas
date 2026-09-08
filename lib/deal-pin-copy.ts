// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The headline on a deals pin.
//
// A four-product Deal Radar roundup came back as a pin reading
// "COOL YOUR SPACE / RANKED & READY TO BUY". Both halves were wrong about the
// post. "Cool your space" is a benefit line for one product, on a pin showing
// four unrelated ones. "Ranked" claims an order that nothing produced: these
// are separate things that happened to drop in price at the same time, which is
// why the same change removed the numbered badges from the design.
//
// The cause was one prompt doing two jobs. The copy brief was written for a
// buying guide ("top picks", "COMPARED & RANKED") and a deals roundup was
// handed to it unchanged, so the pin described the post the prompt expected
// rather than the post it was given.
//
// This module is the part worth testing on its own: what a deals headline may
// not say, and what it says when the AI call fails or has to be rejected. That
// text is baked into a JPEG and posted to Pinterest, where nobody can edit it
// afterwards, so a prompt rule alone is not enough. A prompt rule is a request.

/** Ranking language. The products dropped in price simultaneously; nothing put
 *  them in an order, so a word that says otherwise is a claim the post cannot
 *  support. "BEST" is included because on a deals board it reads as a verdict
 *  nobody reached. */
export const DEAL_RANKING = /\b(ranked|ranking|rated|rating|best|top\s*\d|our\s+picks?|top\s+picks?|no\.?\s*1|countdown|winner|vs\.?)\b|#\s*\d/i

/** A figure the copy step was never given. It sees product titles, not prices,
 *  so any "40% OFF" or "$29" in a headline is invented, and it is invented on a
 *  price claim published under the creator's name. */
export const DEAL_INVENTED_FIGURE = /\d+\s*%|%\s*off|[$£€]\s*\d/i

/** True when this line must not be printed on a deals pin. */
export function badDealCopy(s: string): boolean {
  return DEAL_RANKING.test(s || '') || DEAL_INVENTED_FIGURE.test(s || '')
}

/** The headline a deals pin falls back to. It says the only two things that are
 *  certainly true of every deals roundup: how many, and that they are deals.
 *  Keeps the category when it fits the pin's headline band, drops it when it
 *  does not, rather than shipping a headline that gets truncated mid-word. */
export function dealFallbackHeadline(n: number, category: string): string {
  const cat = String(category || '').toUpperCase().replace(/\s+/g, ' ').trim()
  const withCat = `${n} ${cat} DEALS`
  return (cat && withCat.length <= 22 ? withCat : `${n} PRICE DROPS`).slice(0, 24)
}

/** The supporting line under it: the news is that the prices are down now. */
export const DEAL_FALLBACK_SUBHEAD = 'PRICES DROPPED NOW'
