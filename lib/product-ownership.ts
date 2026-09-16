// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying,
// redistribution, reverse-engineering, or reuse. See LICENSE.
//
// DID THE CREATOR ACTUALLY USE THIS PRODUCT, AND HOW DID THEY GET IT?
//
// Two separate questions that a single "affiliate links" disclosure answers
// neither of, and a TikTok Shop post is where both of them bite.
//
// HANDS-ON. The blog writer's system prompt says "you are the creator writing a
// FIRST-PERSON affiliate review of ONE product — you personally recommend it",
// and the first post this feature published duly opened with "I was super
// excited when the Enya NOVA GO SP1…" and headed a section "A Feature I Have
// Never Seen Like This". For most TikTok Shop affiliates that is simply true:
// they have the product and have made videos about it. For one who has not, it
// is fabricated experience, and no disclosure repairs that. The FTC's position
// is that you cannot endorse a product you have not used, whatever the small
// print says. So the answer is not a disclaimer, it is a different voice, and
// lib/deal-scrub already writes it: first person kept, hands-on claims gone.
//
// GIFTED. TikTok Shop routinely sends affiliates free samples, and a free
// sample is a material connection that has to be stated. "This post contains
// affiliate links" does not cover it: it discloses the commission and says
// nothing about the product having been a gift.
//
// A DISCLOSURE CAN MAKE THINGS WORSE. The obvious move here is one fixed line
// on every post saying the review is based on the creator's own use. That is
// STRONGER than what the writer currently implies, not weaker: it turns an
// implied claim into an explicit one, so on any post by a creator who has not
// got the product it converts a bad post into a false statement. Which is why
// this is a per-product question with a real answer rather than a sentence.

/** How the creator came by the product they are writing about. */
export type ProductOwnership = 'bought' | 'gifted' | 'not-used'

/**
 * The default, and it is deliberate.
 *
 * Most TikTok Shop affiliates have the product. Defaulting to 'not-used' would
 * downgrade the voice on every product already saved until each one was
 * answered, which is a worse post for the common case in service of the rare
 * one. 'bought' keeps the current behaviour and adds no claim that might be
 * untrue: it asserts nothing beyond what the writer already implies.
 */
export const DEFAULT_OWNERSHIP: ProductOwnership = 'bought'

export function normalizeOwnership(raw: string | null | undefined): ProductOwnership {
  const s = String(raw ?? '').trim().toLowerCase()
  return s === 'gifted' || s === 'not-used' ? s : DEFAULT_OWNERSHIP
}

/** Whether the post may speak from hands-on experience. */
export function hasHandsOn(o: ProductOwnership): boolean {
  return o !== 'not-used'
}

/** What the creator picks, in their words. */
export const OWNERSHIP_CHOICES: Array<{ value: ProductOwnership; label: string; help: string }> = [
  { value: 'bought', label: 'I bought it', help: 'Posts speak from your own use of it.' },
  { value: 'gifted', label: 'The brand sent it', help: 'Same, plus the gifted disclosure the FTC requires.' },
  { value: 'not-used', label: 'I have not used it', help: 'Posts stay in your voice but stop claiming hands-on time.' },
]

/**
 * The extra sentence a post needs because of how the product was obtained.
 *
 * Returned SEPARATELY from the affiliate disclosure rather than replacing it:
 * they disclose different things (a commission, and a gift) and a reader is
 * entitled to both. Null when nothing extra is owed.
 */
export function ownershipDisclosure(o: ProductOwnership): string | null {
  switch (o) {
    case 'gifted':
      return 'The brand sent me this product to try. They did not pay for or approve this post, and nothing here is contingent on what I said about it.'
    case 'not-used':
      // Said plainly. A reader who assumes a review is hands-on and finds out
      // otherwise has been misled, and the sentence costs the post nothing that
      // the honest version of the post was not already missing.
      return 'I have not used this one myself. What follows is based on the product details and what owners report, not on hands-on time with it.'
    case 'bought':
    default:
      // Nothing extra. Buying it yourself is not a material connection, and a
      // line asserting hands-on use would be us making a claim on the
      // creator's behalf rather than disclosing one.
      return null
  }
}

/**
 * The voice instruction for the writer.
 *
 * Only 'not-used' changes anything. The other two get the writer's normal
 * first-person review voice, which is correct for a creator who has the thing.
 */
export function ownershipVoiceRule(o: ProductOwnership, dealVoiceRules: string): string | null {
  return o === 'not-used' ? dealVoiceRules : null
}

/** The saved-product shape both writers read. Loose on purpose: it is a DB row. */
export interface TikTokProductRow {
  title?: string | null
  price?: string | null
  currency_symbol?: string | null
  rating?: number | string | null
  review_count?: number | null
  sold_count?: number | null
  seller_name?: string | null
  ownership?: string | null
}

/**
 * The facts a post may state about a TikTok product, in one place.
 *
 * The blog and the social caption both need them, and if each built its own
 * list they would drift into saying different things about the same product on
 * the same day. Everything here was read off the product's own page; nothing is
 * inferred, and there is deliberately no price HISTORY, because a TikTok
 * product has one price and no past for it.
 */
export function tiktokProductFacts(tp: TikTokProductRow): string[] {
  return [
    tp.price ? `Price on TikTok Shop: ${tp.currency_symbol || '$'}${tp.price}` : '',
    tp.rating ? `Rated ${tp.rating} out of 5${tp.review_count ? ` from ${tp.review_count} reviews` : ''}` : '',
    tp.sold_count ? `${tp.sold_count} units sold` : '',
    tp.seller_name ? `Sold by ${tp.seller_name} on TikTok Shop` : '',
  ].filter(Boolean)
}
