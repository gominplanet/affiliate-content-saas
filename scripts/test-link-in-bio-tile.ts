// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Both paths that put a product on the shop page obey the same four rules.
//
// A Pinterest post went out pointing at the Link in Bio page and the product
// was not on it. The pin path was fixed: read the write's error, put the tile at
// the top, mark it live in the story section, and revalidate the page so ISR
// does not serve a stale grid for a minute.
//
// The Instagram path does the same job in a different file and got none of it.
// It wrote the tile with an unread error inside a swallowing catch, placed it at
// max(position) + 1 which is the BOTTOM of the grid, and never revalidated. So
// the same bug was still live on Instagram after it was reported and fixed on
// Pinterest, because the fix was applied to one of the two callers.
//
// That is what this test is for. Not "does the tile code work", which a type
// check already covers, but "have the two callers drifted apart again". A rule
// that lives in one of two twins is a rule that is one commit from being half
// true, and the failure is invisible: the post publishes, the caption says link
// in bio, and the page it points at is missing the product.
//
// Facebook is deliberately not in scope. It puts the affiliate link straight in
// the caption because Facebook allows clickable links, so it never touches the
// shop page and has nothing to keep in step.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const PIN = readFileSync(join(root, 'lib/amazon-pin-publish.ts'), 'utf8')
const SOCIAL = readFileSync(join(root, 'lib/amazon-social-publish.ts'), 'utf8')

/** The tile-writing region of each file, so a rule matched somewhere unrelated
 *  in a 300-line module does not count as the rule being present. */
function tileRegion(src: string, startMarker: string): string {
  const start = src.indexOf(startMarker)
  if (start < 0) return ''
  return src.slice(start, start + 4000)
}

const paths: Array<{ name: string; src: string }> = [
  { name: 'pinterest', src: tileRegion(PIN, 'async function resolvePinDestinationFor') },
  { name: 'instagram', src: tileRegion(SOCIAL, 'async function syncLinkInBioTile') },
]

for (const { name, src } of paths) {
  check(`${name}: the tile-writing code is findable`, src.length > 0,
    'this file changed shape, so the rules below were not actually checked')

  // ── 1. the error is read ──────────────────────────────────────────────────
  // The supabase client returns { error } instead of throwing, so an unchecked
  // write fails in silence and the post still publishes.
  check(`${name}: reads the error on the tile write`,
    /const \{ error: \w+ \}|\{ error: tileErr \}/.test(src),
    'an unchecked write here means the post goes out pointing at a page without the product')

  // ── 2. newest first ───────────────────────────────────────────────────────
  // A post sends someone here FOR this product. Position ascending is the page's
  // sort order, so the tile must go below the current minimum, not above the max.
  check(`${name}: places the tile at the top`,
    /topPosition/.test(src) && /ascending: true/.test(src),
    'a tile at the bottom of forty others is the same as not adding it')
  check(`${name}: does not append to the end`,
    !/ascending: false \}\)[\s\S]{0,200}\+ 1/.test(src),
    'max(position) + 1 puts it last')

  // ── 3. it lands in the live section, ticked on ────────────────────────────
  check(`${name}: sets in_story`, /in_story:/.test(src),
    'the page renders these under "Current deals, live in your story" at the top')

  // ── 4. a picture, always ──────────────────────────────────────────────────
  // A tile with no image is a blank grey card at the top of the page the post
  // just advertised.
  check(`${name}: resolves a tile image`, /tileImageFor\(/.test(src),
    'the caller not having an image handy is not a good enough reason for a blank card')
}

// ── 5. the page is revalidated ──────────────────────────────────────────────
// Checked per FILE rather than per region, since the pin path revalidates after
// its helper returns. /shop/[handle] is served with revalidate = 60, so without
// this the tile can be a minute late for someone tapping straight through.
for (const [name, src] of [['pinterest', PIN], ['instagram', SOCIAL]] as const) {
  check(`${name}: revalidates the shop page`,
    /revalidatePath\(`\/shop\/\$\{/.test(src),
    'ISR will otherwise serve the grid without the product for up to 60 seconds')
}

// ── 6. the failure reaches the person who posted ────────────────────────────
// The whole point of the original bug: silence looked exactly like success.
{
  check('instagram: a tile failure returns a sentence rather than nothing',
    /Promise<string \| null>/.test(SOCIAL),
    'a void return is how this failed invisibly the first time')
  check('instagram: and the caller folds it into the post note',
    /tileNote/.test(SOCIAL) && /\[note, tileNote\]/.test(SOCIAL),
    'a note nobody prints is the same as no note')
  check('pinterest: keeps its own tile error surface',
    /tileError/.test(PIN))
}

// ── 7. no ASIN, no shop destination ─────────────────────────────────────────
// Pointing a post at a grid that cannot contain the product it advertises
// reproduces the bug rather than reporting it.
{
  check('pinterest: refuses the shop page without an ASIN',
    /no ASIN, so the product could not be added/.test(PIN))
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
