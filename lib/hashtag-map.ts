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

// Grounded in Amazon's real department/sub-category tree (Electronics, Home &
// Kitchen, Tools, Beauty, Health, Sports & Outdoors, Toys & Games, Baby, Pets,
// Clothing, Automotive, Musical Instruments, Arts & Crafts, Garden, …) so a
// product lands in the RIGHT audience instead of the nearest keyword.
//
// ORDER MATTERS: on a score tie the EARLIER category wins (see scoreCategories),
// so specific/hobby categories are listed before generic ones — that's what
// keeps an "RC car" out of Automotive (rc-hobby matches 'rc' before 'car' can
// pull it to auto). `match` terms are word-boundary matched (see COMPILED), so
// 'car' no longer fires inside 'carbon' and single short words are safe.
const TAXONOMY: TagCategory[] = [
  // ── Content-creation gear (a distinct creator audience, before generic tech) ──
  { key: 'creator-gear',
    match: ['drone', 'gimbal', 'action camera', 'webcam', 'gopro', 'microphone', 'lav mic', 'shotgun mic', 'tripod', 'ring light', 'softbox', 'vlog', 'vlogging', 'teleprompter', 'capture card', 'follow me camera', 'streaming'],
    broad: ['contentcreator', 'tech'], mid: ['filmmaking', 'videography', 'creatorgear'], niche: ['vlogging', 'filmmakingtools', 'contentcreatortips', 'gearreview'] },
  { key: 'camera-photo',
    match: ['camera', 'mirrorless', 'dslr', 'camera lens', 'photography', 'sd card', 'memory card', 'camera bag', 'flash'],
    broad: ['photography', 'tech'], mid: ['photographer', 'cameragear'], niche: ['photographylovers', 'phototips', 'mirrorless'] },
  // ── Toys & Games (incl. RC/hobby — listed BEFORE auto so 'rc car' stays here) ──
  { key: 'rc-hobby',
    match: ['rc', 'rc car', 'rc truck', 'remote control', 'radio control', 'rc crawler', 'rc drift', 'rc boat', 'rc plane', 'hobby grade', 'brushless motor', 'quadcopter'],
    broad: ['rccars', 'hobby'], mid: ['rchobby', 'rccrawler'], niche: ['rccars', 'hobbygrade', 'rclife'] },
  { key: 'building-toys',
    match: ['building blocks', 'building set', 'brick set', 'lego', 'model kit', 'stem toy'],
    broad: ['toys', 'buildingtoys'], mid: ['legobuilds', 'brickart'], niche: ['legolover', 'toycollector', 'stemtoys'] },
  { key: 'board-games',
    match: ['board game', 'card game', 'jigsaw puzzle', 'tabletop', 'dice game', 'party game'],
    broad: ['boardgames', 'games'], mid: ['tabletopgames', 'gamenight'], niche: ['boardgamegeek', 'familygamenight', 'puzzles'] },
  { key: 'toys',
    match: ['toy', 'toys', 'action figure', 'doll', 'playset', 'plush', 'stuffed animal', 'kids toy'],
    broad: ['toys', 'kids'], mid: ['toysofinstagram', 'kidstoys'], niche: ['toycollector', 'toyreview', 'playtime'] },
  // ── Electronics ──
  { key: 'audio',
    match: ['headphone', 'headphones', 'earbud', 'earbuds', 'earphone', 'speaker', 'soundbar', 'noise cancelling', 'airpods', 'bluetooth speaker', 'turntable'],
    broad: ['audio', 'tech'], mid: ['headphones', 'musiclovers'], niche: ['audiophile', 'soundquality', 'wirelessearbuds'] },
  { key: 'phone-accessories',
    match: ['phone case', 'iphone', 'magsafe', 'phone mount', 'screen protector', 'phone grip', 'popsocket', 'phone holder', 'wireless charger', 'charging station'],
    broad: ['tech', 'gadgets'], mid: ['iphone', 'phoneaccessories'], niche: ['magsafe', 'techaccessories', 'everydaycarry'] },
  { key: 'computers',
    match: ['laptop', 'keyboard', 'mechanical keyboard', 'mouse', 'monitor', 'ssd', 'hard drive', 'usb hub', 'docking station', 'graphics card', 'router'],
    broad: ['tech', 'pcsetup'], mid: ['pcbuild', 'techsetup'], niche: ['desksetup', 'pcgaming', 'techtok'] },
  { key: 'wearables',
    match: ['smartwatch', 'smart watch', 'fitness tracker', 'fitness watch', 'smart ring', 'activity tracker'],
    broad: ['tech', 'wearabletech'], mid: ['smartwatch', 'fitnesstech'], niche: ['wearables', 'techwatch', 'quantifiedself'] },
  { key: 'smart-home',
    match: ['smart home', 'alexa', 'smart bulb', 'smart plug', 'thermostat', 'robot vacuum', 'security camera', 'video doorbell', 'smart light', 'smart lock'],
    broad: ['smarthome', 'home'], mid: ['homeautomation', 'smarthometech'], niche: ['smarthomegadgets', 'homeupgrade'] },
  { key: 'gaming',
    match: ['gaming', 'gamer', 'game console', 'controller', 'gaming keyboard', 'gaming mouse', 'gaming headset', 'pc build', 'rgb', 'twitch', 'nintendo', 'playstation', 'xbox'],
    broad: ['gaming', 'tech'], mid: ['gamer', 'gamingsetup'], niche: ['gaminggear', 'pcgaming', 'setupgoals'] },
  { key: 'tv-video',
    match: ['tv', 'television', 'projector', 'streaming stick', 'roku', 'fire tv', 'home theater', 'hdmi'],
    broad: ['tech', 'hometheater'], mid: ['homecinema', 'techtok'], niche: ['hometheater', 'moviesetup', 'techfinds'] },
  { key: 'tech-gadgets',
    match: ['gadget', 'gadgets', 'power bank', 'usb cable', 'adapter', 'portable charger', 'tablet', 'e-reader', 'label maker'],
    broad: ['tech', 'gadgets'], mid: ['techtok', 'coolgadgets'], niche: ['techfinds', 'techreview', 'gadgetgeek'] },
  // ── Kitchen & Home ──
  { key: 'coffee',
    match: ['coffee', 'espresso', 'cold brew', 'barista', 'latte', 'french press', 'coffee grinder', 'coffee maker'],
    broad: ['coffee'], mid: ['coffeelover', 'coffeetime'], niche: ['homebarista', 'coffeegear', 'coffeeaddict'] },
  { key: 'kitchen',
    match: ['kitchen', 'blender', 'air fryer', 'cookware', 'knife set', 'kettle', 'stand mixer', 'instant pot', 'utensil', 'cutting board', 'cast iron', 'food processor'],
    broad: ['kitchen', 'home'], mid: ['kitchengadgets', 'homecooking'], niche: ['kitchenessentials', 'cookingtools', 'foodie'] },
  { key: 'home-decor',
    match: ['decor', 'lamp', 'rug', 'throw pillow', 'wall art', 'curtain', 'vase', 'mirror', 'candle', 'string lights'],
    broad: ['home', 'decor'], mid: ['homedecor', 'interiordesign'], niche: ['homedecorideas', 'roomdecor', 'cozyhome'] },
  { key: 'furniture',
    match: ['sofa', 'couch', 'sectional', 'bed frame', 'mattress', 'dresser', 'bookshelf', 'nightstand', 'dining table'],
    broad: ['home', 'furniture'], mid: ['interiordesign', 'homestyle'], niche: ['furnituredesign', 'homemakeover', 'smallspaces'] },
  { key: 'bedding',
    match: ['bedding', 'comforter', 'duvet', 'bed sheets', 'pillow', 'weighted blanket', 'mattress topper'],
    broad: ['home', 'bedroom'], mid: ['bedroomdecor', 'cozyhome'], niche: ['bedroomgoals', 'sleepbetter', 'homecomfort'] },
  { key: 'organization',
    match: ['organizer', 'storage bin', 'closet organizer', 'shelving', 'drawer organizer', 'storage box', 'label maker'],
    broad: ['home', 'organization'], mid: ['homeorganization', 'declutter'], niche: ['organizedhome', 'storagesolutions', 'cleantok'] },
  { key: 'cleaning',
    match: ['vacuum', 'cordless vacuum', 'mop', 'steam cleaner', 'cleaning supplies', 'pressure washer', 'air purifier'],
    broad: ['home', 'cleaning'], mid: ['cleantok', 'cleaningmotivation'], niche: ['cleaninghacks', 'satisfyingcleaning', 'homecare'] },
  { key: 'office',
    match: ['desk', 'office chair', 'standing desk', 'monitor arm', 'laptop stand', 'ergonomic', 'planner', 'notebook', 'desk mat'],
    broad: ['office', 'productivity'], mid: ['desksetup', 'workfromhome'], niche: ['deskorganization', 'workspacegoals', 'productivitytools'] },
  // ── Tools, Garden & Home Improvement ──
  { key: 'tools-diy',
    match: ['power tool', 'drill', 'impact driver', 'saw', 'sander', 'hand tool', 'tool set', 'workshop', 'hardware', 'workbench', 'tool box'],
    broad: ['diy', 'tools'], mid: ['diyprojects', 'toolsofthetrade'], niche: ['diyhome', 'powertools', 'woodworking'] },
  { key: 'garden',
    match: ['garden', 'gardening', 'planter', 'raised bed', 'lawn', 'grill', 'bbq', 'smoker', 'patio', 'greenhouse', 'hose'],
    broad: ['garden', 'outdoorliving'], mid: ['gardening', 'backyard'], niche: ['gardeningtips', 'grilling', 'patiogoals'] },
  // ── Beauty & Personal Care ──
  { key: 'skincare',
    match: ['skincare', 'serum', 'moisturizer', 'face wash', 'cleanser', 'sunscreen', 'retinol', 'toner', 'face mask', 'eye cream'],
    broad: ['skincare', 'beauty'], mid: ['skincareroutine', 'skintok'], niche: ['skincarecommunity', 'glowup', 'skincaretips'] },
  { key: 'makeup',
    match: ['makeup', 'lipstick', 'foundation', 'mascara', 'eyeshadow', 'concealer', 'blush', 'lip gloss', 'setting spray'],
    broad: ['makeup', 'beauty'], mid: ['makeuptutorial', 'mua'], niche: ['makeuplover', 'beautyfinds', 'makeuptips'] },
  { key: 'haircare',
    match: ['hair', 'shampoo', 'conditioner', 'hair dryer', 'hair straightener', 'curling iron', 'hair mask', 'hair oil', 'wig'],
    broad: ['hair', 'beauty'], mid: ['hairtok', 'haircare'], niche: ['hairstyles', 'hairtutorial', 'haircaretips'] },
  { key: 'grooming',
    match: ['beard', 'beard trimmer', 'shaver', 'electric razor', 'grooming', 'aftershave', 'nose trimmer'],
    broad: ['grooming', 'mensstyle'], mid: ['mensgrooming', 'beardcare'], niche: ['beardgang', 'groomingtips', 'menscare'] },
  { key: 'fragrance',
    match: ['perfume', 'cologne', 'fragrance', 'eau de parfum', 'body mist'],
    broad: ['fragrance', 'perfume'], mid: ['perfumetok', 'fragrancecommunity'], niche: ['perfumelover', 'fragrancereview', 'scentoftheday'] },
  // ── Health & Household ──
  { key: 'supplements',
    match: ['supplement', 'vitamin', 'protein powder', 'collagen', 'probiotic', 'creatine', 'electrolyte', 'omega'],
    broad: ['health', 'wellness'], mid: ['supplements', 'healthylifestyle'], niche: ['wellnessjourney', 'nutrition', 'gymsupplements'] },
  { key: 'wellness',
    match: ['massage gun', 'sleep', 'meditation', 'posture corrector', 'aromatherapy', 'essential oil', 'red light therapy', 'recovery', 'sauna'],
    broad: ['wellness', 'selfcare'], mid: ['selfcaretips', 'healthylifestyle'], niche: ['wellnessjourney', 'sleepbetter', 'recovery'] },
  // ── Sports & Outdoors ──
  { key: 'fitness',
    match: ['fitness', 'workout', 'gym', 'dumbbell', 'kettlebell', 'yoga mat', 'resistance band', 'treadmill', 'exercise', 'weight bench', 'jump rope'],
    broad: ['fitness', 'health'], mid: ['workout', 'fitnessmotivation'], niche: ['homegym', 'fitnessgear', 'gymtok'] },
  { key: 'camping-outdoors',
    match: ['camping', 'hiking', 'tent', 'sleeping bag', 'backpacking', 'cooler', 'hammock', 'campfire', 'trekking', 'headlamp'],
    broad: ['outdoors', 'camping'], mid: ['campinggear', 'hiking'], niche: ['campvibes', 'outdooradventure', 'backpacking'] },
  { key: 'cycling',
    match: ['bike', 'bicycle', 'cycling', 'mountain bike', 'road bike', 'bike helmet', 'e-bike'],
    broad: ['cycling', 'bike'], mid: ['cyclinglife', 'biketok'], niche: ['mtb', 'roadcycling', 'bikelife'] },
  { key: 'fishing-hunting',
    match: ['fishing', 'fishing rod', 'tackle', 'fishing reel', 'lure', 'hunting', 'trail camera'],
    broad: ['fishing', 'outdoors'], mid: ['fishinglife', 'anglerlife'], niche: ['bassfishing', 'fishingtrip', 'huntinglife'] },
  { key: 'travel',
    match: ['luggage', 'suitcase', 'carry on', 'travel backpack', 'packing cubes', 'travel accessories', 'passport holder'],
    broad: ['travel', 'wanderlust'], mid: ['traveltips', 'travelgear'], niche: ['travelessentials', 'traveltok', 'packinghacks'] },
  // ── Baby & Pets ──
  { key: 'baby',
    match: ['baby', 'toddler', 'stroller', 'diaper', 'nursery', 'infant', 'baby carrier', 'high chair', 'car seat', 'baby monitor'],
    broad: ['parenting', 'baby'], mid: ['momlife', 'parentinghacks'], niche: ['babyessentials', 'newmom', 'toddlerlife'] },
  { key: 'pets-dogs',
    match: ['dog', 'puppy', 'dog bed', 'dog toy', 'leash', 'dog crate', 'dog food', 'dog harness'],
    broad: ['dogs', 'pets'], mid: ['doglife', 'dogsofinstagram'], niche: ['dogmom', 'dogproducts', 'puppylove'] },
  { key: 'pets-cats',
    match: ['cat', 'kitten', 'litter box', 'cat tree', 'cat toy', 'cat food', 'scratching post'],
    broad: ['cats', 'pets'], mid: ['catlife', 'catsofinstagram'], niche: ['catmom', 'catproducts', 'catlovers'] },
  { key: 'pets-other',
    match: ['aquarium', 'fish tank', 'reptile', 'terrarium', 'bird cage', 'hamster', 'rabbit hutch'],
    broad: ['pets', 'petsofinstagram'], mid: ['petlovers', 'petcare'], niche: ['aquariumlife', 'reptilesofinstagram', 'smallpets'] },
  // ── Clothing, Shoes & Accessories ──
  { key: 'shoes',
    match: ['shoes', 'sneakers', 'boots', 'running shoes', 'sandals', 'heels', 'loafers'],
    broad: ['shoes', 'style'], mid: ['sneakerhead', 'shoegame'], niche: ['sneakers', 'shoelover', 'ootd'] },
  { key: 'jewelry-watches',
    match: ['jewelry', 'necklace', 'bracelet', 'earrings', 'ring', 'watch', 'wristwatch', 'pendant'],
    broad: ['jewelry', 'style'], mid: ['jewelrylover', 'accessories'], niche: ['jewelrygram', 'watchesofinstagram', 'styleinspo'] },
  { key: 'bags-accessories',
    match: ['handbag', 'purse', 'backpack', 'wallet', 'tote bag', 'crossbody', 'sunglasses', 'belt'],
    broad: ['fashion', 'accessories'], mid: ['bagsofinstagram', 'styletips'], niche: ['fashionfinds', 'accessorize', 'ootd'] },
  { key: 'fashion',
    match: ['dress', 'shirt', 'jacket', 'jeans', 'hoodie', 'outfit', 'apparel', 'leggings', 'sweater', 'coat'],
    broad: ['fashion', 'style'], mid: ['ootd', 'styletips'], niche: ['fashionfinds', 'styleinspo', 'outfitinspo'] },
  // ── Automotive (AFTER rc-hobby so RC products don't land here) ──
  { key: 'auto',
    match: ['car accessory', 'car care', 'dash cam', 'car detailing', 'tire', 'car seat cover', 'car mount', 'motorcycle', 'jump starter', 'obd'],
    broad: ['cars', 'auto'], mid: ['caraccessories', 'cartok'], niche: ['caressentials', 'cargadgets', 'cardetailing'] },
  // ── Musical Instruments ──
  { key: 'music-instruments',
    match: ['guitar', 'electric guitar', 'bass guitar', 'keyboard piano', 'drum', 'ukulele', 'synthesizer', 'midi', 'amplifier', 'violin'],
    broad: ['music', 'musician'], mid: ['guitarist', 'musicgear'], niche: ['guitarsofinstagram', 'musicproducer', 'bedroommusician'] },
  // ── Arts & Crafts ──
  { key: 'crafts',
    match: ['sewing', 'sewing machine', 'knitting', 'crochet', 'embroidery', 'scrapbook', 'craft', 'diamond painting', 'cricut', 'paint by numbers'],
    broad: ['crafts', 'diy'], mid: ['crafting', 'handmade'], niche: ['craftsofinstagram', 'diycrafts', 'makersgonnamake'] },
]

// Precompiled WORD-BOUNDARY matcher per category. \b anchors on alphanumeric
// edges, so 'car' matches "car" but never "carbon"/"scar", and short terms like
// 'rc' or 'tv' are safe (they won't fire inside "search" or "start"). Multi-word
// phrases ("air fryer") match verbatim. Built once at module load.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const COMPILED = TAXONOMY.map(c => ({
  cat: c,
  re: new RegExp(`\\b(?:${c.match.map(escapeRe).join('|')})\\b`, 'gi'),
}))

/** How many category terms appear in `hay` (occurrence count). */
function scoreWith(hay: string, re: RegExp): number {
  const m = hay.match(re)
  return m ? m.length : 0
}

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
  // COMPILED preserves TAXONOMY order and we replace only on a STRICTLY higher
  // score, so ties go to the earlier (more specific) category — which is why
  // rc-hobby beats auto for an "RC car".
  for (const { cat, re } of COMPILED) {
    const score = scoreWith(hay, re)
    if (score > 0 && (!best || score > best.score)) best = { key: cat.key, score }
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

  const cats = COMPILED
    .map(x => ({ c: x.cat, score: scoreWith(hay, x.re) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)   // stable → ties keep taxonomy order
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
