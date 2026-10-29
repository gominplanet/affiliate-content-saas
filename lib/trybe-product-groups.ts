// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A BRAND'S PRODUCTS, GROUPED (Seb, 2026-10-29: "can we categorize these
// products when selecting which products to tag for a video upload.. the list
// is too messy like this"). TRYBE sends a brand's products as one flat list
// with no category, so a brand with fifty items was fifty chips in one heap.
// The group comes from what the product IS, read from its name: the main
// noun before any "with ..." or "for ...", so "Fishing Hoodie with Neck
// Gaiter" is a top and "Chest Wader Boot Foot" is a wader, not a boot. Who
// it is for (Men's, Women's, Youth) is read the same way. Anything no rule
// knows goes in Other, so no product is ever hidden. Pure.

export const GROUP_ORDER = [
  'Shirts and hoodies', 'Jackets and rain gear', 'Pants and shorts', 'Waders', 'Boots and shoes',
  'Hats', 'Gloves', 'Bags', 'Kitchen', 'Beauty and care', 'Home', 'Tech', 'Toys and games', 'Pets', 'Outdoor gear', 'Other',
] as const
export type ProductGroup = (typeof GROUP_ORDER)[number]

// First match wins, so the more specific kinds come first.
const RULES: [ProductGroup, RegExp][] = [
  ['Waders', /\bwaders?\b/i],
  ['Jackets and rain gear', /\b(jacket|rain ?suit|raincoat|coat|parka|windbreaker|vest|anorak|poncho|ghillie suit|bibs?)\b/i],
  ['Shirts and hoodies', /\b(t-?shirts?|tees?|shirts?|hood(ie|y)s?|sweatshirts?|sweaters?|pullovers?|polos?|tank( top)?s?|tops?|jerseys?|fleece|crew ?necks?|long ?sleeves?)\b/i],
  ['Pants and shorts', /\b(pants|shorts|trousers|leggings|joggers|jeans|skirts?|tights)\b/i],
  ['Boots and shoes', /\b(boots?|shoes?|sneakers?|sandals?|slippers?|loafers?|clogs?|footwear)\b/i],
  ['Hats', /\b(hats?|caps?|beanies?|visors?|headbands?|balaclavas?)\b/i],
  ['Gloves', /\b(gloves?|mittens?)\b/i],
  ['Bags', /\b(bags?|backpacks?|packs?|totes?|wallets?|duffels?|pouch(es)?|cases?)\b/i],
  ['Kitchen', /\b(pans?|pots?|knife|knives|blender|cookware|mugs?|cups?|bottles?|tumblers?|kettle|skillet|air ?fryer|utensils?)\b/i],
  ['Beauty and care', /\b(serum|cream|lotion|shampoo|conditioner|moisturi[sz]er|cleanser|lipstick|mascara|perfume|cologne|deodorant|toothbrush|razor|hair ?dryer)\b/i],
  ['Home', /\b(pillows?|blankets?|sheets?|towels?|rugs?|lamps?|curtains?|mattress|candles?|vacuum|organi[sz]ers?)\b/i],
  ['Tech', /\b(headphones?|earbuds?|speakers?|chargers?|cables?|phone|tablet|camera|keyboard|mouse|monitor|smart ?watch)\b/i],
  ['Toys and games', /\b(toys?|puzzles?|games?|dolls?|lego|plush)\b/i],
  ['Pets', /\b(dog|cat|pet|leash|collar|litter)\b/i],
  ['Outdoor gear', /\b(netting|blinds?|tents?|tarps?|chairs?|coolers?|decoys?|stands?|rods?|reels?|lures?|flashlights?|headlamps?)\b/i],
]

/** The part of the name that says what the product is: before "with", "for",
 *  a dash or brackets. Pure. */
export function mainPart(name: string): string {
  return String(name || '').split(/\s+(?:with|for)\s+|\s+[-–—]\s+|\(/i)[0].trim()
}

/** Which group a product belongs in, from its name. Pure. */
export function productGroup(name: string): ProductGroup {
  const main = mainPart(name)
  for (const [g, re] of RULES) if (re.test(main)) return g
  // Nothing in the main part: the whole name ("Camo Netting for Hunting Blind").
  for (const [g, re] of RULES) if (re.test(name)) return g
  return 'Other'
}

export type Audience = "Men's" | "Women's" | 'Youth' | 'Unisex'
/** Who the product is for, when its name says. Pure. */
export function productAudience(name: string): Audience | null {
  const n = String(name || '')
  if (/\b(youth|kids?|boys?|girls?|children|toddler)\b/i.test(n)) return 'Youth'
  if (/\b(women[’']?s|ladies|female)\b/i.test(n)) return "Women's"
  if (/\bunisex\b/i.test(n)) return 'Unisex'
  if (/\b(men[’']?s|m[’']s|men)\b/i.test(n)) return "Men's"
  return null
}

/** The products in their groups, in a fixed order, each sorted by name.
 *  Groups with nothing in them are left out. Pure. */
export function groupProducts<T extends { name: string }>(products: T[]): { group: ProductGroup; items: T[] }[] {
  const by = new Map<ProductGroup, T[]>()
  for (const p of products) {
    const g = productGroup(p.name)
    if (!by.has(g)) by.set(g, [])
    by.get(g)!.push(p)
  }
  return GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({ group: g, items: [...by.get(g)!].sort((a, b) => a.name.localeCompare(b.name)) }))
}

/** Grouping helps once there are enough products and they fall in more than
 *  one group; a short or single-kind list stays one list. Pure. */
export function worthGrouping(products: { name: string }[]): boolean {
  return products.length >= 8 && groupProducts(products).length >= 2
}
