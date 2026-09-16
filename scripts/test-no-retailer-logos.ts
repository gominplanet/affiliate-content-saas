// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// NO GENERATED IMAGE CARRIES A STORE'S LOGO.
//
// A creator on the free trial made a thumbnail, got an Amazon logo rendered into
// it, and pulled the video down. That is not a cosmetic problem: the Associates
// Operating Agreement governs where an associate may put Amazon's marks, and a
// thumbnail MVP generated is a place MVP put one on their behalf.
//
// The rule already existed. NO_BRAND_IMAGE_CLAUSE has been the non-negotiable
// instruction for generated images for months, and lib/image-guard's own header
// names Amazon first. It was wired into the blog, article, comparison, refresh
// and Instagram paths.
//
// It was never wired into the YouTube thumbnail, which is the single most
// visible image the product makes. That route imported `stripDesignBrands` and
// scrubbed "Amazon" out of the HEADLINE TEXT, which is why this looked covered:
// the word could not be baked into the copy. Nothing said anything to the image
// model about drawing the mark, and the prompt contained this line:
//
//   "BRAND: if the product's brand or logo is clear, include it as a clean
//    logo lockup."
//
// Which is an invitation. The product reference comes from a marketplace
// listing, "the brand" is ambiguous in front of one, and the model resolved it
// the way the picture in front of it suggested.
//
// So the clause goes in every prompt built from a marketplace product photo, and
// in the thumbnail prompt it goes in TWICE: that file's own documentation says an
// image model weights the last thing it read and an instruction placed only at
// the top loses to a paragraph of design direction. This is the rule where
// losing costs somebody their affiliate account.
import { readFileSync } from 'node:fs'
import { NO_BRAND_IMAGE_CLAUSE, stripDesignBrands } from '../lib/image-guard'
import { buildGraphicThumbnailPrompt, type ThumbnailPromptInput } from '../lib/thumbnail-prompt'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

// ── the clause says what it is supposed to say ─────────────────────────────
//
// Everything below asserts the clause is PRESENT. If the clause itself stopped
// naming the store that caused this, all of that would pass while meaning
// nothing.
{
  for (const term of ['Amazon', 'swoosh', 'Prime', 'Walmart', 'eBay', 'Target']) {
    check(`the clause names ${term}`, NO_BRAND_IMAGE_CLAUSE.includes(term))
  }
  check('and still protects the product\'s own branding',
    /KEEP the product's OWN branding|physically printed on the product/.test(NO_BRAND_IMAGE_CLAUSE),
    'a blanket "no logos" would erase the mark on the item being reviewed, which is the thing the viewer needs to recognise')
}

// ── the thumbnail prompt carries it, in every combination ─────────────────
{
  const base: ThumbnailPromptInput = {
    line1: 'THESE', line2: 'ARE GREAT',
    creatorRefLabel: 'Image 1 is the creator',
    identityInstruction: 'Keep their face exactly.',
    productLabel: 'the earbuds',
    productRefNum: 2,
  }
  const variants: ThumbnailPromptInput[] = [
    base,
    { ...base, wearLine: 'They are wearing it.', wearOn: 'worn on the torso' },
    { ...base, expressionLine: 'Mouth open in surprise.' },
    { ...base, productRefNum: null },
    { ...base, concept: 'Bold split-screen with a price callout', palette: 'teal and orange', badge: 'NEW' },
    {
      ...base,
      wearLine: 'They are wearing it.', wearOn: 'worn on the torso',
      expressionLine: 'Mouth open in surprise.', expressionInReference: true,
      refsAreHeadOnly: true, concept: 'Studio hero', callouts: ['40h battery'],
    },
  ]

  for (const [i, v] of variants.entries()) {
    const prompt = buildGraphicThumbnailPrompt(v)
    check(`variant ${i}: the prompt carries the no-retailer-logo clause`,
      prompt.includes(NO_BRAND_IMAGE_CLAUSE),
      'without it the image model was never told, whatever the copy scrubber did to the text')

    check(`variant ${i}: and a final check about logos`,
      /FINAL CHECK — LOGOS/.test(prompt))

    // Position is the point. This file's own doc comment says every instruction
    // placed only at the top lost.
    const early = prompt.indexOf(NO_BRAND_IMAGE_CLAUSE)
    const last = prompt.lastIndexOf('FINAL CHECK — LOGOS')
    const headline = prompt.indexOf('MAIN HEADLINE')
    check(`variant ${i}: the rule is stated before the design direction`, early >= 0 && early < headline)
    check(`variant ${i}: and again after it`, last > headline,
      'an image model weights the last thing it read; stated once at the top it loses')

    check(`variant ${i}: the final check names the store that caused this`,
      /Amazon/.test(prompt.slice(last)))

    // The sentence that produced the logo must be gone, not merely balanced by
    // a rule further down. Two instructions about the same subject is the
    // failure mode this whole prompt file was created to stop.
    check(`variant ${i}: nothing invites a bare logo lockup`,
      !/if the product's brand or logo is clear, include it as a clean logo lockup/i.test(prompt),
      'that line is what a model resolves against a marketplace product photo')
  }
}

// ── copy baked into an image still cannot say Amazon ──────────────────────
//
// The text scrubber was doing its job all along. Pinned so a fix to the image
// side never becomes a reason to relax the copy side.
{
  for (const [input, banned] of [
    ['SEE IT ON AMAZON', /amazon/i],
    ['BEST AMAZON DEAL', /amazon/i],
    ['PRIME DAY PICK', /prime/i],
    ["AMAZON'S CHOICE", /amazon/i],
  ] as const) {
    const out = stripDesignBrands(input)
    check(`"${input}" is scrubbed out of baked copy`, !banned.test(out), `became "${out}"`)
  }
  check('and ordinary copy survives the scrub',
    stripDesignBrands('THESE EARBUDS SLAP') === 'THESE EARBUDS SLAP')
}

// ── every prompt built from a marketplace product photo carries the clause ──
//
// The thumbnail was missing it for months and nothing noticed, because each of
// these files is individually plausible. Listing them makes the gap visible the
// next time one is added.
{
  const MUST_CARRY: Record<string, string> = {
    'lib/thumbnail-prompt.ts': 'the YouTube thumbnail, where this went wrong',
    'lib/product-thumbnail.ts': 'product thumbnails composed from the listing photo',
    'lib/weekly-digest.ts': 'the weekly deals roundup image',
    'app/api/deals/route.ts': 'deal thumbnails and body images, re-rendered from the listing photo',
    'app/api/blog/generate/route.ts': 'blog hero and body images',
    'app/api/blog/comparison/route.ts': 'comparison images',
    'app/api/blog/refresh-images/route.ts': 'image refresh',
    'app/api/articles/generate/route.ts': 'article images',
    'app/api/instagram/generate-ai-image/route.ts': 'Instagram images',
  }

  /**
   * Files that render a brand mark ON PURPOSE, and why.
   *
   * The rule is "never put a STORE's mark on a creator's work", not "never draw
   * a logo". A CTA sticker that says Subscribe with YouTube's icon is the thing
   * the creator asked for, and a brand emblem generated for their own brand is
   * their own mark. Applying the clause to these would contradict the feature.
   */
  const DELIBERATE: Record<string, string> = {
    'app/api/instagram/burn/generate-sticker/route.ts':
      'CTA stickers carry the platform icon by design, and the platform-neutral branch already bans Amazon by name',
    'app/api/social-launch-kit/image/route.ts':
      'generates an emblem for the creator\'s OWN brand, which is the feature',
  }

  for (const [file, why] of Object.entries(MUST_CARRY)) {
    let src = ''
    try { src = readFileSync(file, 'utf8') } catch { /* reported below */ }
    check(`${file} still exists`, src.length > 0, `listed here because: ${why}`)
    if (!src) continue
    // USED, not merely imported. The first version of this check accepted the
    // import line, so deleting the clause from the prompt while leaving
    // `import { NO_BRAND_IMAGE_CLAUSE }` at the top passed cleanly. That is the
    // same shape as the bug: a file that looks wired up and sends nothing.
    const uses = src
      .split('\n')
      .filter(l => !/^\s*import\b/.test(l) && !/from '@\/lib\/image-guard'/.test(l))
      .join('\n')
    check(`${file} sends the no-retailer-logo clause`,
      uses.includes('NO_BRAND_IMAGE_CLAUSE'),
      `${why} — a product photo from a marketplace listing goes into this prompt, and an import on its own sends nothing`)
  }

  for (const [file, why] of Object.entries(DELIBERATE)) {
    let ok = true
    try { readFileSync(file, 'utf8') } catch { ok = false }
    check(`the exemption for ${file} points at a real file`, ok, `exempt because: ${why}`)
  }

  // An exemption nobody can see is an exemption that widens. Anything that
  // talks to an image model and is in neither list is reported, so the next
  // surface has to be a decision rather than an oversight.
  const IMAGE_CALLERS = /composeWithNanoBanana|composeWithGptImage|generateWithIdeogram|composeWithNanoBananaPro/
  const known = new Set([...Object.keys(MUST_CARRY), ...Object.keys(DELIBERATE)])
  const searched = [
    'app/api/deals/route.ts', 'app/api/articles/generate/route.ts',
    'app/api/blog/refresh-images/route.ts', 'app/api/blog/comparison/route.ts',
    'app/api/blog/generate/route.ts', 'app/api/social-launch-kit/image/route.ts',
    'app/api/youtube/generate-thumbnail/route.ts',
    'app/api/instagram/burn/generate-sticker/route.ts',
    'app/api/instagram/generate-ai-image/route.ts',
    'lib/weekly-digest.ts', 'lib/photobooth-refs.ts', 'lib/product-thumbnail.ts',
  ]
  for (const file of searched) {
    let src = ''
    try { src = readFileSync(file, 'utf8') } catch { continue }
    if (!IMAGE_CALLERS.test(src)) continue
    if (known.has(file)) continue
    // The YouTube route builds its prompt through lib/thumbnail-prompt, which
    // carries the clause; anything else has to say which list it belongs in.
    if (file === 'app/api/youtube/generate-thumbnail/route.ts') {
      check('the YouTube route still builds its prompt through thumbnail-prompt',
        src.includes('buildGraphicThumbnailPrompt'),
        'if it stops, the clause stops arriving with it and this is where it went wrong before')
      continue
    }
    check(`${file} generates images and is in neither list`, false,
      'add it to MUST_CARRY, or to DELIBERATE with the reason it renders a mark on purpose')
  }
}

if (failures.length) {
  console.error(`\n❌ no-retailer-logos: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ no-retailer-logos: no generated image is told it may draw a store\'s mark')
