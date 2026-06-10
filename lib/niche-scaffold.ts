// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-niche prompt scaffolds (blog writer Sprint 3, 2026-06-09).
//
// The blog generator used ONE prompt for every product: a kitchen gadget, a
// skincare serum, and a finance app all got the same scorecard dimensions
// (Value / Quality / Ease of Use / Durability), the same FAQ buckets, the
// same image-setting guidance, and the same spec-vs-experience weighting.
// That's a tell — a real reviewer weights skincare on "results + ingredients"
// and a power tool on "power + build", not on one fixed rubric.
//
// This module tailors four things per niche WITHOUT touching the core voice
// rules (those stay universal):
//   1. scorecard — the 4 subscore dimension labels + what each measures
//   2. faqEmphasis — which question angles to prioritize in the FAQ
//   3. imageSetting — where to stage the product in generated scenes
//   4. depthLean — 'specs' | 'experience' | 'balanced' (which body sections
//      get the deep-dive weight)
//
// Resolution is keyword-based + CONSTRAINED to the brand's declared niches —
// zero LLM cost, zero added latency. A kitchen blog never gets the automotive
// scaffold even if a product title says "car mat"; the worst case is a
// borderline product getting an adjacent (similar) scaffold, which is fine
// because the model still has the full transcript to ground everything.

export interface NicheScaffold {
  /** Canonical niche key (lowercase, matches MASTER_NICHES). */
  key: string
  /** The 4 scorecard subscore dimension labels for this niche, in order.
   *  Replaces the generic Value/Quality/Ease/Durability. The LAST one is
   *  conventionally "Value" across niches so the price dimension is always
   *  present, but it's not required. */
  scorecard: [string, string, string, string]
  /** One line per dimension: what it measures, fed into the score guide so
   *  the model grounds each number. Order matches `scorecard`. */
  scorecardGuide: [string, string, string, string]
  /** 2-4 niche-specific FAQ angles to prioritize. These supplement (don't
   *  replace) the universal FAQ buckets in the system prompt. */
  faqEmphasis: string[]
  /** Where to stage the product in generated image scenes (reinforces the
   *  existing clean-product-image rules; never overrides them). */
  imageSetting: string
  /** Which body sections get the deep-dive weight. 'specs' → lean into the
   *  measurable performance section; 'experience' → lean into the lived-use
   *  / results section; 'balanced' → neither dominates. */
  depthLean: 'specs' | 'experience' | 'balanced'
  /** Trigger words used for keyword classification of a product title. */
  keywords: string[]
}

// Each canonical niche → its scaffold. Keys are lowercase and match the
// MASTER_NICHES list in app/api/brand/add-category/route.ts exactly.
export const NICHE_SCAFFOLDS: Record<string, NicheScaffold> = {
  'home & kitchen': {
    key: 'home & kitchen',
    scorecard: ['Performance', 'Build Quality', 'Ease of Use', 'Value'],
    scorecardGuide: [
      'Performance = how well it does its core job (how evenly it cooks, how fast it blends, how clean it gets)',
      'Build Quality = materials, sturdiness, how it feels in the hand',
      'Ease of Use = setup, daily operation, cleaning, dishwasher-safe',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'Is it dishwasher-safe / how do you clean it?',
      'What size / capacity is it and will it fit a typical [counter / cabinet / household]?',
      'Are replacement parts (gaskets, blades, filters) available and easy to get?',
    ],
    imageSetting: 'on a clean kitchen counter, mid-use, natural light',
    depthLean: 'balanced',
    keywords: ['kitchen', 'cookware', 'blender', 'air fryer', 'mixer', 'knife', 'pan', 'pot', 'coffee', 'espresso', 'utensil', 'cutting board', 'storage', 'organizer', 'mat', 'vacuum', 'mop', 'cleaner', 'home', 'cookpot', 'toaster', 'kettle'],
  },
  'electronics & tech': {
    key: 'electronics & tech',
    scorecard: ['Performance', 'Build Quality', 'Setup & Software', 'Value'],
    scorecardGuide: [
      'Performance = speed, responsiveness, battery life, signal/connection strength the reviewer demonstrated',
      'Build Quality = materials, durability, port/button feel',
      'Setup & Software = how easy the app/pairing/firmware experience is',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What devices / platforms is it compatible with?',
      'Does it need an app, account, or subscription to work fully?',
      "What's the warranty and does it get firmware/software updates?",
    ],
    imageSetting: 'on a clean modern desk or living-room surface, soft tech-product lighting',
    depthLean: 'specs',
    keywords: ['headphone', 'earbud', 'speaker', 'charger', 'cable', 'battery', 'power bank', 'monitor', 'keyboard', 'mouse', 'webcam', 'router', 'smart', 'bluetooth', 'wifi', 'tablet', 'phone', 'watch', 'tracker', 'camera', 'drone', 'tv', 'projector', 'gaming', 'console', 'ssd', 'usb', 'hub', 'adapter'],
  },
  'outdoor & sports': {
    key: 'outdoor & sports',
    scorecard: ['Performance', 'Durability', 'Comfort', 'Value'],
    scorecardGuide: [
      'Performance = how well it performs in its activity (grip, speed, stability, weather handling)',
      'Durability = how it holds up to repeated outdoor / high-impact use',
      'Comfort = fit, weight, how it feels through extended use',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'Is it weather / water resistant and to what degree?',
      'How heavy / packable is it for travel or carry?',
      'What sizes does it come in and how does the sizing run?',
    ],
    imageSetting: 'outdoors in its natural use environment — trail, field, water, or campsite',
    depthLean: 'experience',
    keywords: ['tent', 'backpack', 'hiking', 'camping', 'cooler', 'bottle', 'kayak', 'bike', 'cycling', 'running', 'fitness', 'yoga', 'gym', 'weights', 'ball', 'golf', 'fishing', 'climbing', 'ski', 'snow', 'outdoor', 'sport', 'trail', 'jacket', 'boots'],
  },
  'beauty & personal care': {
    key: 'beauty & personal care',
    scorecard: ['Results', 'Feel & Texture', 'Ingredients', 'Value'],
    scorecardGuide: [
      'Results = the actual visible/felt outcome the reviewer reported (smoother skin, less frizz, closer shave)',
      'Feel & Texture = how it feels to apply/use — absorption, scent, residue, comfort',
      'Ingredients = quality + transparency of the formula / materials',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What skin / hair / body type is it best (and worst) for?',
      'Should you patch-test, and are there sensitivities or irritants to know about?',
      'How long until you see results, and how often do you use it?',
    ],
    imageSetting: 'on a clean bright bathroom vanity or minimalist surface, soft flattering light',
    depthLean: 'experience',
    keywords: ['serum', 'cream', 'lotion', 'moisturizer', 'cleanser', 'shampoo', 'conditioner', 'makeup', 'skincare', 'razor', 'shaver', 'trimmer', 'hair', 'nail', 'mask', 'sunscreen', 'perfume', 'cologne', 'beauty', 'cosmetic', 'lip', 'eye', 'face', 'brush', 'mirror'],
  },
  'health & wellness': {
    key: 'health & wellness',
    scorecard: ['Effectiveness', 'Ease of Use', 'Comfort', 'Value'],
    scorecardGuide: [
      'Effectiveness = the actual outcome the reviewer reported (better sleep, less pain, more energy)',
      'Ease of Use = how simple it is to fit into a daily routine',
      'Comfort = how it feels to use / wear / take',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'Who should avoid it or check with a doctor first?',
      'How long until you notice a difference, and how consistently do you use it?',
      'Are there side effects, interactions, or comfort issues to expect?',
    ],
    imageSetting: 'in a calm, clean home-wellness setting, soft natural light',
    depthLean: 'experience',
    keywords: ['supplement', 'vitamin', 'massage', 'massager', 'sleep', 'posture', 'brace', 'recovery', 'wellness', 'health', 'therapy', 'pain', 'relief', 'meditation', 'humidifier', 'diffuser', 'scale', 'monitor', 'blood pressure', 'thermometer', 'first aid'],
  },
  'pet supplies': {
    key: 'pet supplies',
    scorecard: ['Pet Approval', 'Durability', 'Safety', 'Value'],
    scorecardGuide: [
      'Pet Approval = how much the animal actually took to it (engagement, comfort, willingness)',
      'Durability = how it holds up to chewing, scratching, daily pet use',
      'Safety = materials, choke/ingestion risk, secure construction',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What pet size / breed / age is it best for?',
      'Is it safe for heavy chewers / how durable is it under rough use?',
      'How do you clean it / is it machine-washable?',
    ],
    imageSetting: 'in a cozy home setting that implies a pet (pet bed, food bowl, yard) — no live animal unless the product is worn/used on one',
    depthLean: 'experience',
    keywords: ['dog', 'cat', 'pet', 'leash', 'collar', 'harness', 'bed', 'crate', 'toy', 'treat', 'litter', 'aquarium', 'fish', 'bird', 'chew', 'grooming', 'feeder', 'fountain', 'kennel'],
  },
  'tools & home improvement': {
    key: 'tools & home improvement',
    scorecard: ['Power', 'Build Quality', 'Ergonomics', 'Value'],
    scorecardGuide: [
      'Power = how much work it gets done (torque, cutting speed, pressure, throughput)',
      'Build Quality = materials, sturdiness, how it survives a drop or a job site',
      'Ergonomics = grip, weight balance, how it feels through a long task',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What power source / battery platform does it use and is it cross-compatible?',
      'What materials / surfaces does it work on (and which it struggles with)?',
      'Are bits, blades, or replacement parts easy to find?',
    ],
    imageSetting: 'on a workbench, in a garage, or on a job site, in honest working light',
    depthLean: 'specs',
    keywords: ['drill', 'saw', 'sander', 'wrench', 'driver', 'tool', 'hammer', 'ladder', 'paint', 'caulk', 'level', 'tape measure', 'compressor', 'grinder', 'welder', 'workbench', 'clamp', 'screwdriver', 'pliers', 'hardware', 'lighting', 'fixture'],
  },
  'toys & games': {
    key: 'toys & games',
    scorecard: ['Fun Factor', 'Build Quality', 'Age Fit', 'Value'],
    scorecardGuide: [
      'Fun Factor = how engaging/replayable it actually is',
      'Build Quality = how well it survives real (rough) play',
      'Age Fit = how well it matches the stated age range in practice',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What age range is it really best for?',
      'Does it need batteries / extra pieces / a screen to work?',
      'How well does it hold up to rough play?',
    ],
    imageSetting: 'in a bright playroom or on a clean living-room floor',
    depthLean: 'experience',
    keywords: ['toy', 'game', 'puzzle', 'lego', 'block', 'doll', 'figure', 'board game', 'card', 'rc', 'remote control', 'plush', 'stuffed', 'kids toy', 'building', 'craft kit', 'play'],
  },
  'books & education': {
    key: 'books & education',
    scorecard: ['Content Quality', 'Clarity', 'Usefulness', 'Value'],
    scorecardGuide: [
      'Content Quality = depth, accuracy, and originality of the material',
      'Clarity = how clearly it explains / how readable it is',
      'Usefulness = how applicable it is to the reader’s actual goal',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What format / edition is it (print, ebook, audio) and does that matter?',
      'What skill or knowledge level is it pitched at?',
      'Does it include extras — workbook, online access, supplementary material?',
    ],
    imageSetting: 'on a tidy desk or in a cozy reading nook, warm natural light',
    depthLean: 'experience',
    keywords: ['book', 'journal', 'planner', 'notebook', 'workbook', 'course', 'guide', 'textbook', 'flashcard', 'learning', 'education', 'study', 'stationery'],
  },
  'fashion & apparel': {
    key: 'fashion & apparel',
    scorecard: ['Fit', 'Material Quality', 'Comfort', 'Value'],
    scorecardGuide: [
      'Fit = how true-to-size and flattering it runs',
      'Material Quality = fabric/construction quality, stitching, finish',
      'Comfort = how it feels worn through a full day',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'How does the sizing run and should you size up or down?',
      'How do you care for it (machine wash, dry clean, shrinkage)?',
      'What does the material actually feel like and how does it hold up?',
    ],
    imageSetting: 'styled cleanly — a flat-lay or on a simple backdrop, soft fashion lighting',
    depthLean: 'experience',
    keywords: ['shirt', 'dress', 'pants', 'jeans', 'jacket', 'coat', 'shoes', 'sneaker', 'boots', 'bag', 'purse', 'wallet', 'watch', 'sunglasses', 'hat', 'sock', 'underwear', 'apparel', 'clothing', 'fashion', 'belt', 'scarf', 'jewelry', 'necklace', 'ring', 'bracelet'],
  },
  'garden & outdoors': {
    key: 'garden & outdoors',
    scorecard: ['Performance', 'Durability', 'Ease of Use', 'Value'],
    scorecardGuide: [
      'Performance = how well it does its outdoor job (cutting, watering, growing, lighting)',
      'Durability = how it survives weather, sun, and seasons',
      'Ease of Use = setup, operation, storage',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What climate / hardiness zone or season is it suited for?',
      'How much maintenance does it need?',
      'Can it stay outside year-round or does it need to be stored?',
    ],
    imageSetting: 'in a garden, on a patio, or in a yard, in natural daylight',
    depthLean: 'balanced',
    keywords: ['garden', 'plant', 'soil', 'planter', 'hose', 'sprinkler', 'mower', 'trimmer', 'shears', 'grill', 'patio', 'outdoor furniture', 'fence', 'solar light', 'bird feeder', 'compost', 'seeds', 'pots', 'lawn'],
  },
  'automotive': {
    key: 'automotive',
    scorecard: ['Performance', 'Build Quality', 'Fitment', 'Value'],
    scorecardGuide: [
      'Performance = how well it does its job (cleaning power, charge speed, grip, output)',
      'Build Quality = materials, sturdiness, weather/heat resistance',
      'Fitment = how well it fits the intended vehicles / mounts',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What vehicles / makes / models is it compatible with?',
      'How hard is the installation — DIY or professional?',
      "What's the warranty and how long does it last in practice?",
    ],
    imageSetting: 'in a garage, on a driveway, or near/in a vehicle, realistic lighting',
    depthLean: 'specs',
    keywords: ['car', 'auto', 'vehicle', 'tire', 'wheel', 'dash', 'dashcam', 'jump starter', 'tire inflator', 'car charger', 'mount', 'seat cover', 'floor mat', 'cleaner', 'wax', 'motorcycle', 'truck', 'obd', 'wiper', 'battery'],
  },
  'baby & kids': {
    key: 'baby & kids',
    scorecard: ['Safety', 'Ease of Use', 'Durability', 'Value'],
    scorecardGuide: [
      'Safety = certifications, materials, secure construction, peace of mind',
      'Ease of Use = how simple it is for a tired parent to operate/clean',
      'Durability = how it survives daily kid use and washing',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What safety standards / certifications does it meet?',
      'What age or weight range is it for?',
      'How do you clean it / is it machine-washable or dishwasher-safe?',
    ],
    imageSetting: 'in a bright, clean nursery or family home setting',
    depthLean: 'experience',
    keywords: ['baby', 'infant', 'toddler', 'stroller', 'car seat', 'crib', 'diaper', 'bottle', 'monitor', 'high chair', 'carrier', 'nursing', 'pacifier', 'bib', 'kids', 'playpen', 'bassinet'],
  },
  'office & productivity': {
    key: 'office & productivity',
    scorecard: ['Performance', 'Build Quality', 'Ergonomics', 'Value'],
    scorecardGuide: [
      'Performance = how well it does its job (speed, capacity, reliability)',
      'Build Quality = materials, sturdiness, finish',
      'Ergonomics = how it feels through a full workday',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What devices / systems is it compatible with?',
      'How comfortable is it for all-day / long-session use?',
      "What's the warranty and support like?",
    ],
    imageSetting: 'on a tidy desk or in a home office, clean professional lighting',
    depthLean: 'specs',
    keywords: ['desk', 'chair', 'monitor stand', 'printer', 'laminator', 'shredder', 'planner', 'pen', 'whiteboard', 'lamp', 'office', 'standing desk', 'organizer', 'label maker', 'calculator', 'stapler', 'productivity'],
  },
  'food & grocery': {
    key: 'food & grocery',
    scorecard: ['Taste', 'Quality', 'Convenience', 'Value'],
    scorecardGuide: [
      'Taste = how it actually tastes per the reviewer (flavor, texture, aftertaste)',
      'Quality = ingredient quality, freshness, sourcing',
      'Convenience = how easy it is to prep, store, or use',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What are the ingredients and are there allergens or dietary flags (gluten, dairy, sugar)?',
      'How do you store it and what’s the shelf life?',
      'Does it fit common diets (keto, vegan, paleo) and serving needs?',
    ],
    imageSetting: 'on a clean kitchen counter or plated/served, appetizing natural light',
    depthLean: 'experience',
    keywords: ['snack', 'coffee', 'tea', 'protein', 'powder', 'sauce', 'spice', 'seasoning', 'chocolate', 'candy', 'drink', 'beverage', 'food', 'grocery', 'meal', 'bar', 'supplement powder', 'oil', 'honey', 'jerky'],
  },
  'travel & luggage': {
    key: 'travel & luggage',
    scorecard: ['Durability', 'Capacity', 'Convenience', 'Value'],
    scorecardGuide: [
      'Durability = how it survives airline handling and repeated trips',
      'Capacity = how much it actually holds vs its size',
      'Convenience = wheels, handles, organization, security features',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'Does it meet carry-on size limits for major airlines?',
      'How much does it actually hold and how is it organized?',
      "What's the warranty — and does it cover airline damage?",
    ],
    imageSetting: 'in an airport, hotel room, or packed and ready to go',
    depthLean: 'balanced',
    keywords: ['luggage', 'suitcase', 'carry-on', 'backpack', 'duffel', 'travel', 'packing cube', 'toiletry', 'neck pillow', 'passport', 'adapter', 'tote', 'garment bag'],
  },
  'arts & crafts': {
    key: 'arts & crafts',
    scorecard: ['Quality', 'Ease of Use', 'Versatility', 'Value'],
    scorecardGuide: [
      'Quality = the quality of the output / the materials themselves',
      'Ease of Use = how approachable it is, especially for a beginner',
      'Versatility = the range of projects / techniques it supports',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What skill level is it best for — beginner or advanced?',
      'What surfaces / materials does it work with?',
      'How do you clean up and store it?',
    ],
    imageSetting: 'on a craft table or creative workspace, bright even light',
    depthLean: 'experience',
    keywords: ['paint', 'brush', 'canvas', 'yarn', 'knitting', 'crochet', 'sewing', 'cricut', 'sticker', 'marker', 'pen', 'craft', 'diy', 'bead', 'embroidery', 'clay', 'glue gun', 'scrapbook', 'origami'],
  },
  'musical instruments': {
    key: 'musical instruments',
    scorecard: ['Sound', 'Build Quality', 'Playability', 'Value'],
    scorecardGuide: [
      'Sound = tone, output quality, the actual sound the reviewer demonstrated',
      'Build Quality = materials, construction, finish',
      'Playability = how it feels to play, action, comfort',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What skill level is it best for — beginner or experienced?',
      'What accessories do you need to get started (amp, cable, picks, reeds)?',
      'How much maintenance / tuning does it need?',
    ],
    imageSetting: 'in a home studio, practice space, or on a stage, warm stage-ish light',
    depthLean: 'specs',
    keywords: ['guitar', 'keyboard', 'piano', 'drum', 'microphone', 'amp', 'violin', 'ukulele', 'bass', 'synth', 'midi', 'audio interface', 'headphone', 'instrument', 'music', 'pedal', 'mixer'],
  },
  'software & apps': {
    key: 'software & apps',
    scorecard: ['Features', 'Ease of Use', 'Reliability', 'Value'],
    scorecardGuide: [
      'Features = depth and usefulness of what it actually does',
      'Ease of Use = learning curve, interface clarity',
      'Reliability = stability, uptime, how often it gets in your way',
      'Value = price-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What platforms / devices does it run on?',
      'How is it priced — one-time, subscription, free tier limits?',
      'How does it handle your data and privacy?',
    ],
    imageSetting: 'shown in a clean device/workspace context — do NOT recreate any copyrighted app UI; stage the device generically',
    depthLean: 'specs',
    keywords: ['software', 'app', 'subscription', 'saas', 'plugin', 'extension', 'vpn', 'antivirus', 'editor', 'tool online', 'license', 'cloud', 'platform'],
  },
  'finance & investing': {
    key: 'finance & investing',
    scorecard: ['Features', 'Ease of Use', 'Trust & Security', 'Value'],
    scorecardGuide: [
      'Features = the range and usefulness of what it offers',
      'Ease of Use = onboarding, interface, how approachable it is',
      'Trust & Security = security measures, transparency, track record',
      'Value = fees-for-what-you-get based on what the reviewer said about cost',
    ],
    faqEmphasis: [
      'What are the fees, and are there any hidden ones?',
      'How does it secure your money and data?',
      'What are the eligibility requirements or minimums?',
    ],
    imageSetting: 'on a clean professional desk with a laptop or phone, calm light',
    depthLean: 'specs',
    keywords: ['card', 'credit', 'bank', 'invest', 'broker', 'stock', 'crypto', 'wallet', 'budget', 'tax', 'insurance', 'loan', 'finance', 'savings', 'trading', 'portfolio'],
  },
}

/**
 * Resolve the best-fit niche key for a post, CONSTRAINED to the brand's
 * declared niches. Pure keyword scoring against the product title — no LLM
 * call, deterministic, instant.
 *
 * Logic:
 *   1. Normalize the brand's declared niches to canonical keys (the ones we
 *      have scaffolds for). If the brand declared exactly one, use it — no
 *      need to classify.
 *   2. Otherwise score the product title against each candidate niche's
 *      keyword set; pick the highest scorer.
 *   3. Fallback to the first declared niche, then to 'home & kitchen' (the
 *      most generic scaffold) if nothing matches at all.
 *
 * @param productTitle the scraped/declared product title (strongest signal)
 * @param brandNiches  the brand's declared niche list (constrains the result)
 */
export function resolveNicheScaffold(
  productTitle: string | null | undefined,
  brandNiches: string[] | null | undefined,
): NicheScaffold {
  const declared = (brandNiches || [])
    .map(n => n.trim().toLowerCase())
    .filter(n => NICHE_SCAFFOLDS[n])

  // No usable declared niche → classify against ALL scaffolds using the title.
  const candidates = declared.length > 0 ? declared : Object.keys(NICHE_SCAFFOLDS)

  // Single declared niche → no ambiguity, use it directly.
  if (declared.length === 1) return NICHE_SCAFFOLDS[declared[0]]

  const title = (productTitle || '').toLowerCase()
  if (title.trim()) {
    let best: { key: string; score: number } | null = null
    for (const key of candidates) {
      const scaffold = NICHE_SCAFFOLDS[key]
      if (!scaffold) continue
      let score = 0
      for (const kw of scaffold.keywords) {
        // Word-ish match: count a hit when the keyword appears in the title.
        if (title.includes(kw)) score += kw.includes(' ') ? 2 : 1 // multi-word keywords are stronger signals
      }
      if (score > 0 && (!best || score > best.score)) best = { key, score }
    }
    if (best) return NICHE_SCAFFOLDS[best.key]
  }

  // Fallbacks: first declared niche → generic home & kitchen.
  if (declared.length > 0) return NICHE_SCAFFOLDS[declared[0]]
  return NICHE_SCAFFOLDS['home & kitchen']
}

/**
 * Render the niche scaffold as a prompt block injected near the top of the
 * system prompt. Tells the model the depth lean, the FAQ angles to prioritize,
 * and the image setting. The scorecard dimension override is applied
 * separately (it edits the scorecard template literals directly).
 */
export function nicheScaffoldToPrompt(scaffold: NicheScaffold): string {
  const depthLine =
    scaffold.depthLean === 'specs'
      ? 'This is a SPECS-LED niche. Weight the deep-dive toward measurable performance — numbers, throughput, power, compatibility, how it performs under load. The lived-experience section still appears, but the spec/performance section earns the most depth.'
      : scaffold.depthLean === 'experience'
      ? 'This is an EXPERIENCE-LED niche. Weight the deep-dive toward lived results and how it feels in real use — the outcome, the routine, the sensory detail. The spec section still appears, but the experience section earns the most depth.'
      : 'This is a BALANCED niche. Give the spec/performance section and the lived-experience section roughly equal depth — neither should dominate.'

  return `
═══════════════════════════════════════
NICHE SCAFFOLD — ${scaffold.key.toUpperCase()}
═══════════════════════════════════════
This product sits in the "${scaffold.key}" niche. Tailor the post to how a real reviewer in THIS niche weights things — don't write it on the same generic rubric as a product from a different category.

SCORECARD DIMENSIONS (already wired into the scorecard template below): ${scaffold.scorecard.join(' · ')}. Score and discuss the product against THESE dimensions, not generic ones.

DEPTH LEAN: ${depthLine}

FAQ ANGLES TO PRIORITIZE for this niche (in addition to the universal buckets) — a buyer in this category specifically wants to know:
${scaffold.faqEmphasis.map(q => `  • ${q}`).join('\n')}

IMAGE SETTING for any generated scenes: stage the product ${scaffold.imageSetting}. (This refines — never overrides — the clean-product-image rules elsewhere in this prompt.)
═══════════════════════════════════════
`
}
