// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHY EVERY MVP CREATOR'S THUMBNAILS LOOK LIKE EVERY OTHER MVP CREATOR'S.
//
// A user asked whether the thumbnails could be customised. They look good, they
// said, but every account produces the same ones. They were right, and the cause
// was not a missing settings screen. It was this, hardcoded in the image prompt
// and handed to every account on the platform:
//
//   "Design a UNIQUE, scroll-stopping, VIRAL YouTube thumbnail ... (MrBeast-era
//    energy). It MUST look vibrant, modern and high-contrast ... bright coloured
//    CHECKMARKS or small circular ICON chips ... a vivid studio colour gradient"
//
// The word UNIQUE is in there twice. It never had a chance: everything around it
// specifies one aesthetic in detail, and detail beats adjectives every time.
//
// So a preset does not decorate that direction, it REPLACES it. A creator who
// picks Editorial gets magazine typography and whitespace, not magazine
// typography bolted onto MrBeast energy.
//
// ── What this is not ────────────────────────────────────────────────────────
//
// Not six dropdowns. Style, lighting, mood and palette as separate fields
// produce combinations that fight each other (retro plus luxury plus studio
// lighting is not a look, it is three looks), and almost nobody fills in six
// fields anyway. Each preset here is one coherent set of decisions that a
// designer would have made together.
//
// ── Consistency and variety are different problems ──────────────────────────
//
// Variety BETWEEN creators is the complaint. Consistency WITHIN one creator is
// what makes a brand recognisable, and picking a preset per post would destroy
// it. So the choice lives on the brand and every surface reads the same one:
// blog hero, YouTube thumbnail, Pinterest pin.

export interface VisualPreset {
  id: string
  /** What the creator sees in the picker. */
  name: string
  /** One line, in their terms, about who this suits. */
  blurb: string
  /** The art direction. Replaces the house style rather than adding to it. */
  direction: string
  /** How type is set in this look. */
  typography: string
  /** What the background is. */
  background: string
  /**
   * Whether checkmark chips, spec pills and hero badges belong here at all.
   *
   * False on every restrained look, and it is the single most important field in
   * this file. Badges are what makes a thumbnail read as an advert, and one
   * chip dropped onto an editorial layout collapses it straight back into the
   * house style the creator was trying to leave.
   */
  badges: boolean
  /** Palette used when the brand has set no colours of its own. */
  fallbackPalette: string
  /** Preview swatches for the picker: [background, ink, accent]. */
  swatch: [string, string, string]
  /** Roughly how the preview tile sets its type. */
  previewWeight: number
  previewSerif: boolean
}

export const VISUAL_PRESETS: VisualPreset[] = [
  {
    id: 'bold',
    name: 'Bold and loud',
    blurb: 'High contrast, big type, badges. The look most product channels use.',
    direction: 'High-energy product-review thumbnail in the style of today\'s biggest review channels. Vibrant, high-contrast and layered, built to stop a scroll. Never flat or dull.',
    typography: 'Heavy modern display type, mixed weights and sizes so one key word dominates. A short punchy phrase inside a hand-painted brush stroke or torn banner.',
    background: 'A vivid studio colour gradient or a bold themed graphic scene, with real depth and soft focus behind the subject. Never a plain flat wall.',
    badges: true,
    fallbackPalette: 'saturated primaries against a deep contrasting ground',
    swatch: ['#1B1036', '#FFFFFF', '#FFC200'],
    previewWeight: 900,
    previewSerif: false,
  },
  {
    id: 'studio',
    name: 'Clean studio',
    blurb: 'The product on a plain, bright ground. Calm, premium, uncluttered.',
    direction: 'Clean studio product shot. The product is the entire subject, lit evenly on a plain seamless ground with a soft contact shadow. Restraint is the point: no graphic effects, no clutter, nothing competing with the object.',
    typography: 'One short line of type, set small and set well, in a clean geometric sans. Generous space around it. Never more than five words and never stacked or outlined.',
    background: 'A single flat or very softly graduated seamless colour. Light grey, bone, or one muted brand tone.',
    badges: false,
    fallbackPalette: 'warm neutrals with one restrained accent',
    swatch: ['#F2F0EC', '#1A1A1A', '#7A6A55'],
    previewWeight: 600,
    previewSerif: false,
  },
  {
    id: 'editorial',
    name: 'Editorial',
    blurb: 'Like a magazine feature. Serif type, whitespace, muted colour.',
    direction: 'Magazine feature photography. Composed and considered, with the product placed off centre and real negative space left empty on purpose. Reads as journalism rather than advertising.',
    typography: 'A serif headline set at a readable size, not a shouted one, with tight leading and plenty of room around it. A small uppercase kicker line above it in a letterspaced sans.',
    background: 'A real surface with texture: paper, linen, painted wood, stone. Natural light falling across it from one side.',
    badges: false,
    fallbackPalette: 'muted earth tones, ink black type, one desaturated accent',
    swatch: ['#E8E3D9', '#20201E', '#8C3B2E'],
    previewWeight: 500,
    previewSerif: true,
  },
  {
    id: 'lifestyle',
    name: 'Warm lifestyle',
    blurb: 'The product in a real home, in daylight. Human and unstaged.',
    direction: 'The product in use in a real domestic setting: a kitchen counter, a desk, a hallway, a garden. Natural daylight from a window, honest shadows, a lived-in room rather than a set. Slightly imperfect framing, as if someone picked up a camera.',
    typography: 'A friendly rounded sans, modest in size, sitting in an empty part of the frame rather than across the subject.',
    background: 'The room itself, softly out of focus behind the product. Warm daylight, never a studio.',
    badges: false,
    fallbackPalette: 'warm daylight, soft woods and linens, one gentle accent',
    swatch: ['#EDE0D1', '#3A2E24', '#C97B4A'],
    previewWeight: 600,
    previewSerif: false,
  },
  {
    id: 'premium',
    name: 'Dark and premium',
    blurb: 'Near-black, one accent, dramatic light. For higher-priced things.',
    direction: 'Low-key premium product photography. Near-black surroundings, a single directional light raking across the product to pick out its edges and materials, deep shadow everywhere else. Expensive, quiet and still.',
    typography: 'Small, letterspaced, uppercase type in a light weight, placed low or to one side. Type is an annotation here, not the subject.',
    background: 'Near-black. A dark reflective or matte surface, with light falling off fast.',
    badges: false,
    fallbackPalette: 'near-black with a single metallic or jewel accent',
    swatch: ['#0E0E10', '#EDEDED', '#B08D4F'],
    previewWeight: 300,
    previewSerif: false,
  },
  {
    id: 'retro',
    name: 'Retro print',
    blurb: 'Faded seventies colour, grain, condensed type. Distinctive and warm.',
    direction: 'Seventies print advertising. Slightly faded colour with a warm cast, visible film grain and a hint of off-register printing. Flat and graphic rather than glossy, as if scanned from an old catalogue.',
    typography: 'Bold condensed type, tightly packed, sitting flush to an edge. All caps, no outline, no drop shadow.',
    background: 'Flat blocks of muted period colour: mustard, rust, avocado, cream. Optional halftone dot texture.',
    badges: false,
    fallbackPalette: 'mustard, rust, avocado and cream',
    swatch: ['#D9B45B', '#2E2A20', '#A8442A'],
    previewWeight: 800,
    previewSerif: false,
  },
  {
    id: 'technical',
    name: 'Technical',
    blurb: 'Specs, grid lines, measured. Suits tools, tech and anything with numbers.',
    direction: 'Technical product breakdown. The product shot square on or in clean three quarter view against a measured grid, with thin leader lines pointing to parts of it. Engineered and precise rather than emotional.',
    typography: 'A tight grotesque or monospace, small, aligned to the grid. Numbers set in tabular figures.',
    background: 'A pale grid or blueprint field, or a flat cool neutral with fine rule lines.',
    badges: true,
    fallbackPalette: 'cool greys and off-white with one signal colour',
    swatch: ['#E4E7EA', '#13181D', '#0A66C2'],
    previewWeight: 500,
    previewSerif: false,
  },
  {
    id: 'handmade',
    name: 'Hand-made',
    blurb: 'Paper, texture, handwritten notes. Craft and personal feel.',
    direction: 'A hand-assembled look: the product photographed on paper or card, with torn edges, tape, and handwritten annotation as if someone was working things out on the page. Warm and personal rather than produced.',
    typography: 'A handwritten or marker face for the headline, casual and uneven, with a small neat sans for anything that must be read precisely.',
    background: 'Paper, card or a sketchbook page with real texture and a soft shadow at the edges.',
    badges: false,
    fallbackPalette: 'paper cream, graphite, one marker colour',
    swatch: ['#F4EFE2', '#33302B', '#D2603A'],
    previewWeight: 600,
    previewSerif: false,
  },
]

export const DEFAULT_PRESET_ID = 'bold'

/** Resolve a stored id, falling back to the look every account had before this
 *  existed so nobody's thumbnails change underneath them without being asked. */
export function resolvePreset(id: string | null | undefined): VisualPreset {
  const found = VISUAL_PRESETS.find(p => p.id === String(id ?? '').trim())
  return found ?? VISUAL_PRESETS.find(p => p.id === DEFAULT_PRESET_ID)!
}

/**
 * The constraints the art director writes its briefs under.
 *
 * Steering the renderer alone was not enough, and the code said so plainly:
 * the concept path is the NORMAL one and the preset only reached the fallback,
 * which runs when the art director fails. So a creator could pick Editorial and
 * still receive a loud brief, because the art director's own system prompt is
 * hardcoded to one aesthetic: "vibrant, high-contrast, modern, impossible to
 * scroll past", starburst badges, "GAME CHANGER!" banners.
 *
 * A brief written loud cannot be rendered quiet. This is where the look has to
 * be applied first.
 */
export function presetToBriefRules(preset: VisualPreset): string {
  const lines = [
    `HOUSE LOOK (non-negotiable): ${preset.direction}`,
    `TYPOGRAPHY: ${preset.typography}`,
    `BACKGROUND: ${preset.background}`,
    `Default colour direction when the product suggests nothing better: ${preset.fallbackPalette}.`,
  ]
  if (!preset.badges) {
    lines.push(
      'THIS LOOK CARRIES NO BADGES. Return "" for banner and "" for badge, and return an empty array for callouts. Do not describe checkmark chips, spec pills, starbursts or stickers in the concept. One of them turns this look back into a generic advert, which is the thing the creator chose this look to avoid.',
      'The concept must not ask for anything "vibrant", "high-contrast", "scroll-stopping" or "impossible to miss". Those belong to a different look.',
    )
  } else {
    lines.push('Banners, starburst badges and callout chips all belong in this look. Use them where they fit.')
  }
  return lines.join('\n')
}

/**
 * The art direction block for an image prompt.
 *
 * `surface` changes the frame and nothing else. A look must survive being a
 * 16:9 thumbnail, a 2:3 Pinterest pin and a blog hero, or a creator ends up with
 * three different brands across three places they publish.
 */
export function presetToPrompt(
  preset: VisualPreset,
  opts: { surface: 'thumbnail' | 'pin' | 'hero'; palette?: string | null; productFacts?: string | null },
): string {
  const frame = opts.surface === 'pin'
    ? 'Vertical 2:3 pin (1024x1536).'
    : opts.surface === 'hero'
      ? 'Wide 16:9 article hero (1536x864).'
      : 'Landscape 16:9 thumbnail (1536x864).'

  const palette = (opts.palette || '').trim() || preset.fallbackPalette

  const lines = [
    `${frame} ${preset.direction}`,
    '',
    `TYPOGRAPHY: ${preset.typography}`,
    `BACKGROUND: ${preset.background}`,
    `COLOUR: ${palette}.`,
    preset.badges
      ? 'CALLOUTS: short benefit chips, spec pills or a single hero badge are welcome here, correctly spelled and only where they fit the composition.'
      : 'NO BADGES: this look has no checkmark chips, no spec pills, no hero badges, no starbursts and no stickers. One of those turns it back into an advert, which is the opposite of what was asked for.',
    opts.productFacts ? `Any text must come only from these real product details:\n${opts.productFacts}` : '',
    '',
    // Stated because the presets exist precisely because one house style had
    // been applied to every account regardless of what suited them.
    'Commit to the direction above. Do not blend it with a louder or more generic thumbnail style, and do not add energy it did not ask for.',
  ]
  return lines.filter(Boolean).join('\n')
}
