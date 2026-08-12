// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Curated hashtag engine.
 *
 * The AI is a good writer but has no real data on which hashtags actually reach
 * people, so on its own it invents plausible-but-random tags. This module gives
 * caption composers a deliberate, vetted MIX instead:
 *
 *   • a BRAND tag when the product has a real brand (HOVERAir X1 → #hoverair)
 *   • one or two NICHE tags specific to the product/topic
 *   • two or three BROAD category/audience tags so the post reaches past the
 *     niche (#contentcreator, #tech, #filmmaking)
 *   • never generic spam (#amazonfinds, #musthave, #viral, #fyp)
 *
 * The category taxonomy is keyword-matched in code (deterministic, free, no
 * external call). A composer can still fold in a couple of AI-written specific
 * tags via `mergeHashtags`, and a future live-trend source (e.g. VidIQ rising
 * keywords) can inject fresh tags through the `trending` option without any
 * other change — see selectHashtags(). Nothing here is user-facing.
 */

interface TagCategory {
  key: string
  /** Lowercase substrings that, if present in the product text, select this category. */
  match: string[]
  /** Huge-reach tags (use sparingly — 1 per category). */
  broad: string[]
  /** Mid-size community tags. */
  mid: string[]
  /** Specific, on-topic tags. */
  niche: string[]
}

// Ordered roughly by how common these are in affiliate catalogs. Detection is
// substring-based, so keep `match` terms distinctive.
const TAXONOMY: TagCategory[] = [
  { key: 'creator-gear',
    match: ['drone', 'gimbal', 'camera', 'webcam', 'gopro', 'microphone', ' mic ', 'tripod', 'ring light', 'lighting', 'vlog', 'teleprompter', 'lens', 'capture card', 'follow me'],
    broad: ['contentcreator', 'tech'], mid: ['filmmaking', 'videography', 'creatorgear'], niche: ['vlogging', 'filmmakingtools', 'contentcreatortips', 'gearreview'] },
  { key: 'audio',
    match: ['headphone', 'earbud', 'earphone', 'speaker', 'soundbar', 'noise cancel', 'airpods', 'audio'],
    broad: ['audio', 'tech'], mid: ['headphones', 'musiclovers'], niche: ['audiophile', 'soundquality', 'wirelessearbuds'] },
  { key: 'phone-accessories',
    match: ['phone case', 'iphone', 'magsafe', 'phone mount', 'screen protector', 'phone grip', 'popsocket', 'charging station', 'wireless charg'],
    broad: ['tech', 'gadgets'], mid: ['iphone', 'phoneaccessories'], niche: ['magsafe', 'techaccessories', 'everydaycarry'] },
  { key: 'smart-home',
    match: ['smart home', 'alexa', 'echo', 'smart bulb', 'smart plug', 'thermostat', 'robot vacuum', 'security camera', 'doorbell', 'smart light'],
    broad: ['smarthome', 'home'], mid: ['homeautomation', 'smarthometech'], niche: ['smarthomegadgets', 'homeupgrade'] },
  { key: 'gaming',
    match: ['gaming', 'gamer', 'console', 'controller', 'gaming keyboard', 'gaming mouse', 'headset', 'pc build', 'rgb', 'twitch'],
    broad: ['gaming', 'tech'], mid: ['gamer', 'gamingsetup'], niche: ['gaminggear', 'pcgaming', 'setupgoals'] },
  { key: 'tech-gadgets',
    match: ['gadget', 'charger', 'power bank', 'cable', 'usb', 'bluetooth', 'adapter', 'electronic', ' hub ', 'projector', 'tablet', 'laptop'],
    broad: ['tech', 'gadgets'], mid: ['techtok', 'coolgadgets'], niche: ['techfinds', 'techreview', 'gadgetgeek'] },
  { key: 'coffee',
    match: ['coffee', 'espresso', 'cold brew', 'barista', 'latte', 'french press', 'grinder'],
    broad: ['coffee'], mid: ['coffeelover', 'coffeetime'], niche: ['homebarista', 'coffeegear', 'coffeeaddict'] },
  { key: 'kitchen',
    match: ['kitchen', 'blender', 'air fryer', 'cookware', 'knife', 'kettle', 'mixer', 'instant pot', 'mug', 'utensil', 'cutting board'],
    broad: ['kitchen', 'home'], mid: ['kitchengadgets', 'homecooking'], niche: ['kitchenessentials', 'cookingtools', 'foodie'] },
  { key: 'beauty',
    match: ['skincare', 'makeup', 'serum', 'moisturizer', 'beauty', 'cosmetic', 'lipstick', 'foundation', 'facial', 'hair '],
    broad: ['beauty', 'skincare'], mid: ['beautytips', 'skincareroutine'], niche: ['skincarecommunity', 'beautyfinds', 'glowup'] },
  { key: 'fitness',
    match: ['fitness', 'workout', ' gym', 'dumbbell', 'yoga', 'resistance', 'protein', 'treadmill', 'exercise', 'running'],
    broad: ['fitness', 'health'], mid: ['workout', 'fitnessmotivation'], niche: ['homegym', 'fitnessgear', 'gymtok'] },
  { key: 'wellness',
    match: ['wellness', 'sleep', 'massage', 'supplement', 'vitamin', 'meditation', 'posture', 'hydration', 'aromatherapy'],
    broad: ['wellness', 'selfcare'], mid: ['healthylifestyle', 'selfcaretips'], niche: ['wellnessjourney', 'sleepbetter'] },
  { key: 'home-decor',
    match: ['decor', ' lamp', ' rug', 'cushion', 'wall art', 'furniture', 'organizer', 'storage', 'candle', 'curtain'],
    broad: ['home', 'decor'], mid: ['homedecor', 'interiordesign'], niche: ['homedecorideas', 'roomdecor', 'homeorganization'] },
  { key: 'office',
    match: [' desk', 'office', 'chair', 'monitor', 'laptop stand', 'ergonomic', 'planner', 'workspace', 'standing desk'],
    broad: ['office', 'productivity'], mid: ['desksetup', 'workfromhome'], niche: ['deskorganization', 'workspacegoals', 'productivitytools'] },
  { key: 'pets',
    match: [' dog', ' cat', ' pet', 'puppy', 'kitten', 'leash', 'aquarium', 'litter'],
    broad: ['pets', 'dogs'], mid: ['petlovers', 'doglife'], niche: ['petproducts', 'dogsofinstagram', 'catsofinstagram'] },
  { key: 'baby-parenting',
    match: ['baby', 'toddler', 'stroller', 'diaper', 'nursery', 'infant', 'parenting'],
    broad: ['parenting', 'baby'], mid: ['momlife', 'parentinghacks'], niche: ['babyessentials', 'newmom', 'toddlerlife'] },
  { key: 'outdoors-travel',
    match: ['travel', 'camping', 'hiking', 'backpack', ' tent', 'outdoor', 'luggage', 'adventure', 'cooler'],
    broad: ['travel', 'outdoors'], mid: ['traveltips', 'travelgear'], niche: ['travelessentials', 'campinggear', 'adventuretravel'] },
  { key: 'auto',
    match: [' car ', 'auto ', 'vehicle', 'dash cam', ' tire', 'motorcycle', 'driving'],
    broad: ['cars', 'auto'], mid: ['caraccessories', 'cartok'], niche: ['caressentials', 'cargadgets', 'carlife'] },
  { key: 'tools-diy',
    match: [' tool', 'drill', ' diy', 'workshop', 'garage', 'hardware', 'repair', 'measuring', 'power tool'],
    broad: ['diy', 'tools'], mid: ['diyprojects', 'toolsofthetrade'], niche: ['diyhome', 'powertools', 'workshopgadgets'] },
  { key: 'fashion',
    match: ['dress', ' shirt', 'jacket', 'shoes', 'sneaker', ' watch', ' bag', 'jewelry', 'sunglasses', 'wallet', 'outfit', 'apparel'],
    broad: ['fashion', 'style'], mid: ['ootd', 'styletips'], niche: ['fashionfinds', 'accessories', 'styleinspo'] },
]

// Never emit these — low-value spam that hurts reach and looks desperate.
const SPAM = new Set<string>([
  'amazonfinds', 'amazonmusthaves', 'amazonmusthave', 'musthave', 'musthaves',
  'viral', 'viralvideo', 'viralreels', 'fyp', 'foryou', 'foryoupage', 'trending',
  'tiktokmademebuyit', 'reels', 'reel', 'reelsinstagram', 'explore', 'explorepage',
  'likeforlike', 'follow', 'followme', 'followforfollow', 'instagood', 'instadaily',
  'love', 'like', 'photooftheday', 'ad',
])

// Words that, appearing first in a title, are NOT the brand.
const NOT_BRAND = new Set<string>([
  'the', 'best', 'new', 'premium', 'pro', 'max', 'ultra', 'plus', 'original',
  'official', 'portable', 'wireless', 'smart', 'mini', 'set', 'pack', 'for', 'with',
  'and', 'cinematic', 'foldable', 'magnetic', 'fast', 'upgraded', 'professional',
  'heavy', 'adjustable', 'rechargeable', 'waterproof', 'digital', 'electric',
  'automatic', 'universal', 'multi', 'super', 'large', 'small', 'mens', 'womens',
  'generic', 'classic', 'standard', 'deluxe', 'compact', 'lightweight', 'heavy',
])

// Generic words that make weak fallback tags.
const WEAK_WORD = new Set<string>([
  'with', 'this', 'that', 'from', 'your', 'have', 'will', 'when', 'what', 'them',
  'they', 'here', 'more', 'than', 'also', 'just', 'like', 'made', 'into', 'over',
  'best', 'free', 'shipping', 'compatible', 'includes', 'features', 'perfect',
])

/** The single best-matching product category key for a piece of text (title +
 *  description + niches), or null if nothing matches. Used to tag a captured
 *  post's niche so tag performance can be ranked per-category. Same keyword
 *  matching selectHashtags() uses. */
export function detectNiche(text: string): string | null {
  const hay = ` ${String(text || '')} `.toLowerCase()
  let best: { key: string; score: number } | null = null
  for (const c of TAXONOMY) {
    const score = c.match.reduce((s, k) => s + (hay.includes(k) ? 1 : 0), 0)
    if (score > 0 && (!best || score > best.score)) best = { key: c.key, score }
  }
  return best?.key ?? null
}

/** Normalize any string into a clean `#lowercasetag`, or '' if nothing usable. */
export function hashify(raw: string): string {
  const clean = String(raw || '').replace(/^#/, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  return clean ? `#${clean}` : ''
}

/** Best-effort brand tag from a product title/name. Amazon titles usually lead
 *  with the brand ("HOVERAir X1…", "Anker Soundcore…"). Conservative: skips
 *  digits-only leads, common adjectives, and anything too short/long. Returns
 *  null when we can't be reasonably confident. */
export function deriveBrandTag(source?: string | null): string | null {
  const first = String(source || '').trim().split(/[\s,/|–—-]+/)[0] || ''
  const token = first.replace(/[^A-Za-z0-9]/g, '')
  if (token.length < 3 || token.length > 20) return null
  if (!/[A-Za-z]/.test(token)) return null            // pure numbers ("2026", "3")
  if (NOT_BRAND.has(token.toLowerCase())) return null
  return `#${token.toLowerCase()}`
}

function keywordsFrom(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of (String(text || '').toLowerCase().match(/[a-z]{4,}/g) || [])) {
    if (WEAK_WORD.has(w) || seen.has(w)) continue
    seen.add(w); out.push(w)
    if (out.length >= 3) break
  }
  return out
}

export interface SelectHashtagsOpts {
  /** Product title + any description/bullets — the keyword surface for matching. */
  text?: string
  /** Brand name or title to derive a brand tag from. */
  brand?: string | null
  /** Explicit niches (e.g. the creator's configured niches), folded in as tags. */
  niches?: string[]
  /** Live trending tags for this topic (e.g. from VidIQ rising keywords). These
   *  are prioritized right after the brand tag when supplied. Optional — the map
   *  works fully without them. */
  trending?: string[]
  /** Max tags to return (excludes any #ad the caller adds). */
  max?: number
}

/**
 * Build a deliberate, vetted hashtag mix for a product. Deterministic and free.
 * Order: brand → trending (if any) → per-category niche/broad/mid interleave →
 * explicit niches → keyword fallback. Deduped, spam-filtered, capped at `max`.
 */
export function selectHashtags(opts: SelectHashtagsOpts): string[] {
  const { text = '', brand = '', niches = [], trending = [], max = 7 } = opts
  const hay = ` ${String(text)} ${niches.join(' ')} `.toLowerCase()
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw?: string | null): boolean => {
    const tag = hashify(raw || '')
    if (!tag || tag.length < 3) return false
    if (seen.has(tag) || SPAM.has(tag.slice(1))) return false
    seen.add(tag); out.push(tag)
    return out.length >= max
  }

  if (push(deriveBrandTag(brand))) return out
  for (const t of trending) if (push(t)) return out

  const cats = TAXONOMY
    .map(c => ({ c, score: c.match.reduce((s, k) => s + (hay.includes(k) ? 1 : 0), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.c)

  // Interleave tiers across the top 2 categories to guarantee a size mix
  // (specific + huge-reach + community) rather than all-niche or all-broad.
  for (const c of cats.slice(0, 2)) {
    if (push(c.niche[0])) return out
    if (push(c.broad[0])) return out
    if (push(c.mid[0])) return out
    if (push(c.niche[1])) return out
    if (push(c.mid[1])) return out
  }

  for (const n of niches) if (push(n)) return out
  if (out.length < 2) for (const w of keywordsFrom(text)) if (push(w)) return out

  return out
}

/**
 * Merge curated tags with extra (e.g. AI-written) tags, curated first so the
 * reliable mix always survives and the extras only fill remaining slots. Deduped,
 * spam-filtered, capped.
 */
export function mergeHashtags(primary: string[], extra: string[], max: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [...primary, ...extra]) {
    const tag = hashify(raw)
    if (!tag || tag.length < 3 || seen.has(tag) || SPAM.has(tag.slice(1))) continue
    seen.add(tag); out.push(tag)
    if (out.length >= max) break
  }
  return out
}

/** All hashtags found anywhere in a block of text, lowercased. */
export function extractHashtags(text: string): string[] {
  return (String(text || '').match(/#[A-Za-z0-9_]+/g) || []).map(t => t.toLowerCase())
}

/** Strip every hashtag out of a caption body and tidy the whitespace, so a
 *  caller can rebuild its own tag line. */
export function stripHashtags(text: string): string {
  return String(text || '')
    .replace(/#[A-Za-z0-9_]+/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
