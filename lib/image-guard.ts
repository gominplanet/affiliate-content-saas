/**
 * Shared negative-prompt clause for ALL AI image generation (thumbnails, pins,
 * Instagram, blog body images).
 *
 * Goal: never bake retailer/marketplace branding (especially "Amazon"), real
 * company logos, watermarks, copyright/trademark symbols, or invented signage
 * into a generated image — both for a clean look and to avoid trademark /
 * platform-policy issues. The product's OWN physical branding on a real
 * product photo is acceptable (it's the item being reviewed); what we forbid
 * is the model ADDING or INVENTING marketplace names, store logos, price tags,
 * watermarks, or any extraneous text.
 */
import { scrubHealthClaims } from '@/lib/scrub'

export const NO_BRAND_IMAGE_CLAUSE =
  'NO RETAILER LOGOS, NO INVENTED BRANDS, NO MARKETING COPY: Do NOT render, add, invent or overlay any retailer / marketplace names or logos (especially "Amazon", the Amazon smile / swoosh arrow, "Amazon Prime", "Prime", "Walmart", "eBay", "Best Buy", "Target", "AliExpress"), any store/app icons, any watermarks, any copyright (©) / trademark (™ ®) symbols, any price tags or badges, or any extraneous signage or text in the background or on surfaces. Do NOT reproduce retail PACKAGING or marketing-infographic copy — no printed feature lists, claims, percentages, ratings, warranty/award badges, or size charts. KEEP the product\'s OWN branding intact: its real brand mark, product name, and any label/text physically printed on the product itself (the bottle, the box face, the device, the cap) ARE the item being reviewed — render them faithfully so the product is recognisable. The simple rule: keep what\'s physically on the real product; add nothing else.'

/**
 * Hard rule (Seb, non-negotiable): NO design MVP produces may contain the word
 * "Amazon" or the Amazon logo/smile-arrow. LLM instructions alone aren't
 * reliable, so any copy destined to be BAKED into an image (headline lines,
 * emphasis word, callouts, banner, CTA) is scrubbed through here first. This
 * removes the Amazon brand family (and its obvious smile/swoosh phrasings) as
 * whole words, then tidies the leftover spacing so the headline still reads.
 *
 * This is design-copy only. Social captions and descriptions can still say
 * "Amazon" — the ban is about what gets RENDERED into a graphic.
 */
const DESIGN_BRAND_WORDS =
  /\b(?:amazon(?:['’]s|\.com)?|amzn|amazon\s+prime|prime\s+day|prime|the\s+smile\s+logo|smile\s+arrow)\b/gi

/**
 * Copy destined to be BAKED into an image gets the health-claim scrub too.
 *
 * A thumbnail is the worst place for a claim: it is blunt by design, it is read
 * in a feed with no context, and once it is baked into a PNG it cannot be edited
 * out of the videos and posts it has already been published to.
 */
export function stripDesignBrands(input: string | null | undefined): string {
  if (!input) return ''
  let s = scrubHealthClaims(input).replace(DESIGN_BRAND_WORDS, ' ')
  s = s
    .replace(/[^\S\r\n]{2,}/g, ' ')          // collapse doubled spaces
    .replace(/[^\S\r\n]+([,.!?;:])/g, '$1')  // space before punctuation
    .replace(/^[\s,;:.!?-]+/, '')            // leading junk after a removal
    .trim()
  // Tidy a dangling connector the removal can leave at the end (e.g. a CTA that
  // was "SEE IT ON AMAZON" → "SEE IT ON").
  s = s.replace(/\s+(?:on|at|from|the|a|an|this|your|to|of|with|in)$/i, '').trim()
  return s
}
