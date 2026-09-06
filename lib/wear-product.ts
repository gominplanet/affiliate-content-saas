// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Make me wear it."
//
// When the product is a jacket, a watch or a pair of trainers, a design showing
// the creator HOLDING it is the wrong picture. Nobody holds a jacket up to the
// camera to review it. The whole reason apparel converts is seeing it worn, and
// every design MVP made put the product beside the person instead of on them.
//
// Two things have to be right or the feature is worse than not having it.
//
// WHERE IT GOES. "Wearing" is not one instruction. A t-shirt goes on the torso,
// a watch on the wrist, trainers on the feet, a bag over the shoulder, a ring on
// a finger. Told to "wear" a handbag, an image model will cheerfully put it on
// someone's head. So the directive names the body part, and a product whose kind
// cannot be worked out does not get the treatment at all.
//
// WHICH GARMENT. The picture has to show THAT jacket: its colour, its print, its
// logo in the same place, its cut and sleeve length. An image model handed "a
// person wearing a jacket" will produce a jacket, and a brand paying for a
// campaign will not accept a different one. The directive spends most of its
// words on holding the model to the reference photo, and MVP still tells the
// creator to check it, because for a complex print or a brand logo this is a
// recreation and not a photograph. Saying that plainly is the difference between
// a useful tool and a liability.

export type ApparelKind =
  | 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'hat' | 'bag'
  | 'watch' | 'jewelry' | 'eyewear' | 'socks' | 'gloves' | 'scarf' | 'swimwear'

/** Where each kind actually goes, and what has to survive the recreation. The
 *  body part is the half that stops nonsense; the detail list is the half that
 *  stops a different product. */
const KINDS: { kind: ApparelKind; on: string; keep: string; match: RegExp }[] = [
  { kind: 'outerwear', on: 'worn on the upper body, over their other clothes',
    keep: 'colour, cut, length, collar, zip or buttons, pockets and any logo or patch, in the same place',
    match: /\b(jacket|coat|parka|blazer|windbreaker|raincoat|puffer|gilet|vest|cardigan|overcoat|trench)\b/i },
  { kind: 'dress', on: 'worn as a full outfit',
    keep: 'colour, print, neckline, sleeve length, hem length and silhouette',
    match: /\b(dress|gown|jumpsuit|romper|playsuit|kaftan|sundress)\b/i },
  { kind: 'swimwear', on: 'worn as swimwear',
    keep: 'colour, print, cut and straps',
    match: /\b(swimsuit|bikini|swim\s*trunks|swimwear|bathing\s*suit|board\s*shorts)\b/i },
  { kind: 'top', on: 'worn on the torso',
    keep: 'colour, print or graphic, neckline, sleeve length and fit',
    match: /\b(t-?shirt|tee|shirt|blouse|hoodie|sweater|sweatshirt|jumper|pullover|tank\s*top|polo|crop\s*top|bodysuit|thermal|base\s*layer)\b/i },
  { kind: 'bottom', on: 'worn on the lower body',
    keep: 'colour, wash, cut, length and any visible branding',
    match: /\b(jeans|trousers|pants|leggings|shorts|skirt|joggers|sweatpants|chinos|cargo\s*pants|tights)\b/i },
  { kind: 'shoes', on: 'worn on their feet',
    keep: 'colour, sole, laces, logo placement and silhouette',
    match: /\b(shoes?|sneakers?|trainers?|boots?|sandals?|heels?|loafers?|slippers?|flip[-\s]?flops?|cleats?|runners?)\b/i },
  { kind: 'hat', on: 'worn on their head',
    keep: 'colour, shape, brim and any front logo',
    match: /\b(hat|cap|beanie|snapback|bucket\s*hat|visor|headband|balaclava)\b/i },
  { kind: 'bag', on: 'carried, on their shoulder or in their hand as it is designed to be carried',
    keep: 'colour, shape, hardware, strap and any logo',
    match: /\b(backpack|handbag|tote|purse|satchel|duffel|crossbody|messenger\s*bag|shoulder\s*bag|fanny\s*pack|belt\s*bag)\b/i },
  { kind: 'watch', on: 'worn on their wrist',
    keep: 'case shape, dial, hands, colour and strap',
    match: /\b(watch|smartwatch|wristwatch|fitness\s*tracker|watch\s*band)\b/i },
  { kind: 'jewelry', on: 'worn where that piece is worn: a necklace at the neck, a ring on a finger, earrings at the ears, a bracelet on the wrist',
    keep: 'metal colour, stones, shape and scale',
    match: /\b(necklace|bracelet|ring|earrings?|pendant|anklet|chain|jewell?ery|brooch)\b/i },
  { kind: 'eyewear', on: 'worn on their face',
    keep: 'frame shape, frame colour and lens tint',
    match: /\b(sunglasses|eyeglasses|glasses|goggles|spectacles|readers)\b/i },
  { kind: 'scarf', on: 'worn around their neck',
    keep: 'colour, pattern and drape',
    match: /\b(scarf|shawl|snood|bandana|neck\s*gaiter)\b/i },
  { kind: 'gloves', on: 'worn on their hands',
    keep: 'colour, cuff and any grip detail',
    match: /\b(gloves?|mittens?)\b/i },
  { kind: 'socks', on: 'worn on their feet',
    keep: 'colour, pattern and height',
    match: /\b(socks?|stockings)\b/i },
]

/** Words that mean the listing is ABOUT apparel without naming a garment, used
 *  only as a hint. On their own they never turn the feature on, because
 *  "men's watch cleaning kit" is not something anyone wears. */
const CATEGORY_HINT = /\b(clothing|apparel|fashion|menswear|womenswear|activewear|sportswear|outerwear|footwear|shoes|accessories|jewell?ery|watches)\b/i

export interface WearableProduct {
  /** True when this is something a person puts on. */
  wearable: boolean
  kind: ApparelKind | null
  /** Where it goes, in the words the image model is given. */
  on: string | null
  /** What has to survive the recreation for it to still be THIS product. */
  keep: string | null
}

/**
 * Is this something the creator could be shown wearing?
 *
 * The product's own name decides it. A category alone is not enough: Amazon
 * files phone cases under accessories and watch straps under watches, and
 * neither is worn by a person in any useful sense. The name is where the garment
 * actually appears, so a kind must be matched there or the answer is no.
 */
export function detectWearable(input: { title?: string | null; category?: string | null }): WearableProduct {
  const title = String(input.title || '')
  const hay = `${title} ${String(input.category || '')}`
  // A kit, a cleaner, a case, a stand or a replacement part is about the garment
  // rather than being one. Checked first so "shoe cleaning kit" is not a shoe.
  if (/\b(kit|cleaner|cleaning|polish|protector|case|stand|hanger|rack|organizer|organiser|storage|repair|replacement|refill|detergent|spray|wipes?)\b/i.test(title)) {
    return { wearable: false, kind: null, on: null, keep: null }
  }
  for (const k of KINDS) {
    if (k.match.test(title)) return { wearable: true, kind: k.kind, on: k.on, keep: k.keep }
  }
  // A category hint with no garment named is not enough to act on, but it is
  // enough to be worth offering, which the caller decides with `mightBe`.
  return { wearable: false, kind: null, on: null, keep: null }
}

/** True when the listing sits in an apparel category, so the toggle is worth
 *  OFFERING even though nothing in the name is specific enough to act on. */
export function mightBeWearable(input: { title?: string | null; category?: string | null }): boolean {
  if (detectWearable(input).wearable) return true
  return CATEGORY_HINT.test(String(input.category || ''))
}

/**
 * The instruction handed to the image model.
 *
 * Most of it is about fidelity rather than about wearing, because the wearing
 * part is one sentence and the "which garment" part is the whole risk. An image
 * model told to draw a person in a jacket will draw a jacket; the job here is to
 * keep it drawing THE jacket in the reference photo.
 */
export function wearDirective(w: WearableProduct): string | null {
  if (!w.wearable || !w.on || !w.keep) return null
  return [
    `WORN, NOT HELD — READ THIS BEFORE ANYTHING ELSE ABOUT THE PRODUCT.`,
    `The product is ${w.on}. The person is wearing it, using it, living in it.`,
    `Do NOT show them holding it up, presenting it in a hand, or standing next to it, and do NOT add a second copy of it anywhere in the frame.`,
    `IT MUST BE THE SAME ITEM as the product reference image: match its ${w.keep}.`,
    `Do not restyle it, do not change its colour, do not clean up or redesign its graphic, do not move or reinvent a logo, and do not swap it for a similar item.`,
    `If part of it is not visible in the reference photo, frame the shot so that part is not shown rather than inventing it.`,
    `Everything else about the person stays as the reference photos show: the same face, the same identity.`,
  ].join(' ')
}

/** What the creator is told before they publish it. A recreated garment is a
 *  recreation, and a brand paying for the campaign is the one who will notice a
 *  logo in the wrong place. */
export const WEAR_CAVEAT =
  'The garment is recreated from the product photo, so a detailed print or a brand logo may not come out exact. Look at it before it goes on a brand campaign.'
