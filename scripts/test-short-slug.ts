// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
// A post's address is cut at a whole word, never mid-word (a member's blog had
// "...litter-box-wit" and "...review-doe" live).
import { readFileSync } from 'node:fs'
import { shortSlug } from '../lib/short-slug'
const fails: string[] = []
const check = (n: string, ok: boolean) => { if (!ok) fails.push(n) }
check('a long title ends on a whole word', shortSlug('self-cleaning-litter-box-review-70l-automatic-litter-box-with-app-control', 60) === 'self-cleaning-litter-box-review-70l-automatic-litter-box')
check('a filler word is not left at the end', !/-(with|and|for|the)$/.test(shortSlug('best air fryer for small kitchens and apartments with two people', 40)))
check('a short slug is unchanged', shortSlug('govee-floor-lamp-3-review') === 'govee-floor-lamp-3-review')
check('never longer than the limit', shortSlug('x'.repeat(90), 60).length === 60 && shortSlug('a b c d e f g h i j k l m n o p q r s t u v w x y z aa bb cc dd ee ff gg hh', 30).length <= 30)
for (const f of ['app/api/blog/generate/route.ts', 'app/api/articles/generate/route.ts', 'app/api/idea-list/generate/route.ts']) check(`${f} uses shortSlug`, /shortSlug\(/.test(readFileSync(f, 'utf8')))
if (fails.length) { console.error('short-slug failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ short-slug: post addresses end on a whole word')
