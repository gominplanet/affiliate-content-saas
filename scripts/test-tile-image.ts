// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A shop tile always has a picture.
//
// A blank grey card sat at the top of a Link in Bio page, which is the page a
// Pinterest pin had just sent someone to for that exact product. Right title,
// right affiliate link, top of the list, ticked. No image, because the deal
// path renders an art-directed pin and passes it as base64, so the plain
// product photo never reached the tile write.
//
// The rule: for a valid ASIN this never returns nothing. Every failure falls
// through to the next source, and the last source is built from the ASIN with
// no network call, so there is no path where a caller ends up with null and
// writes a grey card.
import { tileImageFor, amazonAsinImage } from '../lib/tile-image'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

async function main() {
  const ASIN = 'B0H298X69Z'

  /** A stand-in for the supabase client: `rows` says what each table returns. */
  function db(rows: Record<string, { image_url?: string | null } | null>, throwOn: string[] = []) {
    return {
      from(table: string) {
        return {
          select() { return this },
          eq() { return this },
          limit() { return this },
          async maybeSingle() {
            if (throwOn.includes(table)) throw new Error(`relation "${table}" does not exist`)
            return { data: rows[table] ?? null }
          },
        }
      },
    }
  }

  // ── what the caller has always wins ─────────────────────────────────────────
  {
    const d = db({ deal_radar_cache: { image_url: 'https://cache.example/x.jpg' } })
    check('a real URL from the caller is used as-is',
      await tileImageFor(d, ASIN, 'https://mine.example/photo.jpg') === 'https://mine.example/photo.jpg')
    check('and it is not overridden by a cache hit',
      await tileImageFor(d, ASIN, 'https://mine.example/photo.jpg') !== 'https://cache.example/x.jpg')
    check('whitespace around it does not matter',
      await tileImageFor(d, ASIN, '  https://mine.example/p.jpg  ') === 'https://mine.example/p.jpg')
  }

  // ── the deal path's case: no image passed at all ────────────────────────────
  {
    const d = db({ deal_radar_cache: { image_url: 'https://cache.example/deal.jpg' } })
    check('a cache supplies the picture', await tileImageFor(d, ASIN, null) === 'https://cache.example/deal.jpg')
    check('undefined is the same as null', await tileImageFor(d, ASIN, undefined) === 'https://cache.example/deal.jpg')
    check('an empty string is not a URL', await tileImageFor(d, ASIN, '') === 'https://cache.example/deal.jpg')
    check('and neither is a non-URL', await tileImageFor(d, ASIN, 'not a url') === 'https://cache.example/deal.jpg')
  }

  // ── each cache is tried, in order, and a miss is not the end ────────────────
  {
    const second = db({ deal_radar_cache: null, amz_product_cache: { image_url: 'https://cache.example/two.jpg' } })
    check('an empty first cache falls through', await tileImageFor(second, ASIN, null) === 'https://cache.example/two.jpg')

    const third = db({ deal_radar_cache: null, amz_product_cache: { image_url: '' }, storefront_catalog: { image_url: 'https://cache.example/three.jpg' } })
    check('a blank value in a cache is a miss, not an answer',
      await tileImageFor(third, ASIN, null) === 'https://cache.example/three.jpg')

    const broken = db({ storefront_catalog: { image_url: 'https://cache.example/three.jpg' } }, ['deal_radar_cache', 'amz_product_cache'])
    check('a cache table that does not exist is skipped, not fatal',
      await tileImageFor(broken, ASIN, null) === 'https://cache.example/three.jpg')
  }

  // ── the last resort, which is why this never returns nothing ────────────────
  {
    const empty = db({})
    const url = await tileImageFor(empty, ASIN, null)
    check('every cache missing still produces a picture', !!url, String(url))
    check('and it is Amazon\'s own image endpoint for that ASIN',
      url === amazonAsinImage(ASIN) && (url || '').includes(ASIN), String(url))

    const allBroken = db({}, ['deal_radar_cache', 'amz_product_cache', 'storefront_catalog'])
    check('even with every cache throwing', await tileImageFor(allBroken, ASIN, null) === amazonAsinImage(ASIN))
  }

  // ── without an ASIN there is nothing to look up, and that is honest ─────────
  // A manual tile with no product behind it genuinely has no picture to find, and
  // inventing one would be worse than the caller deciding what to show.
  {
    const d = db({ deal_radar_cache: { image_url: 'https://cache.example/x.jpg' } })
    check('no ASIN and no image is null', await tileImageFor(d, null, null) === null)
    check('a malformed ASIN is null', await tileImageFor(d, 'NOPE', null) === null)
    check('an empty ASIN is null', await tileImageFor(d, '', null) === null)
    check('but a caller-supplied image still wins with no ASIN',
      await tileImageFor(d, null, 'https://mine.example/p.jpg') === 'https://mine.example/p.jpg')
    check('a lowercase ASIN is still an ASIN',
      (await tileImageFor(db({}), 'b0h298x69z', null)) === amazonAsinImage('B0H298X69Z'))
  }

  // ── the invariant ───────────────────────────────────────────────────────────
  // Stated once, because the failure mode is a future edit adding a source that
  // can return empty and letting that become the answer.
  {
    for (const preferred of [null, undefined, '', '   ', 'not a url']) {
      const url = await tileImageFor(db({}), ASIN, preferred)
      check(`a valid ASIN never yields a blank card (${JSON.stringify(preferred)})`,
        typeof url === 'string' && url.startsWith('https://'), String(url))
    }
  }
}

main()
  .catch((e) => { failures.push(`threw: ${e instanceof Error ? e.message : String(e)}`) })
  .then(() => {
    console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
    for (const f of failures) console.log(`  ✗ ${f}`)
    process.exit(failures.length ? 1 : 0)
  })
