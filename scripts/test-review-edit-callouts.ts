// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE PRODUCT'S TITLES ON THE VIDEO (Seb, 2026-11-04: an ASIN or a link, ten
// titles from the product, the creator's top five burned on the video).
//
// What this proves:
//   - each title waits for the moment it is talked about (its rarest word),
//     never covers the opening title or another title, and one never
//     mentioned is spread through the video; one with no room is said;
//   - titles sit low on a review and high on a TRYBE ad, away from a title
//     kept on for the whole video;
//   - what MVP suggests never carries a price, a deal, a year, a rating or a
//     "best", and real specs like "2000 Lumens" are kept;
//   - an ASIN, an Amazon link, any other link and a plain name are all read;
//   - the pick reaches the video from One video and both batches, is never
//     part of the saved look, is drawn and reported on the card, and an older
//     video server that draws fewer pictures is reported, not trusted.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { calloutTimes, calloutKeys, calloutSpot, cleanCallouts, cleanSettings, DEFAULT_SETTINGS, CALLOUT_SECONDS, MAX_CALLOUTS, type Word } from '../lib/review-edit'
import { cleanIdeas, productInput } from '../lib/review-edit-callouts'
import { PRICING } from '../lib/ai-usage'

const ROOT = path.resolve(__dirname, '..')
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8')
const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }

// A creator talking about a projector, a word every 0.6 seconds, from 2 seconds in.
const talk = (text: string, from = 2, step = 0.6): Word[] => text.split(' ').map((t, i) => ({ start: from + i * step, end: from + i * step + 0.5, text: t }))
const whole = (n: number): [number, number][] => [[0, n]]
const placed = (c: ReturnType<typeof calloutTimes>[number]): c is Extract<typeof c, { from: number }> => 'from' in c

// ── The words a title waits for ──
check('a short word in capitals is kept, small words go, numbers split', JSON.stringify(calloutKeys('Full HD 1920x1080p')) === JSON.stringify(['full', 'hd', '1920', '1080p']) && JSON.stringify(calloutKeys('Wifi 6 Compatible')) === JSON.stringify(['wifi', '6']), [calloutKeys('Full HD 1920x1080p'), calloutKeys('Wifi 6 Compatible')])

// ── When each is on screen ──
const words = talk('okay so this projector is really nice the picture is full hd at 1080p which looks sharp on my wall and later on we have the stereo sound which fills the room pretty well and finally it connects over wifi 6 to my phone without any trouble at all so far')
const len = 70
const five = ['Full HD 1920x1080p', 'Stereo Sound', 'Wifi 6 Compatible', 'Projects on any flat surface', 'Comes with a 180-degree swivel stand']
const t = calloutTimes(five, words, whole(len), len, [{ from: 0, to: 4.3 }])
const at = (k: number) => t.find((c) => c.k === k)
check('each title is on screen from the moment its word is said', (() => { const a = at(0), b = at(1), c = at(2); return !!a && placed(a) && a.heard === '1080p' && !!b && placed(b) && b.heard === 'stereo' && !!c && placed(c) && c.heard === 'wifi' })(), t)
const w1080 = words.find((w) => w.text === '1080p')!.start
check('it starts just before the word, not long after', (() => { const a = at(0); return !!a && placed(a) && a.from <= w1080 && a.from >= w1080 - 0.5 })(), at(0))
check('a title never mentioned is spread through the video', (() => { const d = at(3), e = at(4); return !!d && placed(d) && d.heard === null && !!e && placed(e) && e.heard === null })(), [at(3), at(4)])
const on = t.filter(placed).sort((x, y) => x.from - y.from)
check('no two titles on screen together, with a breath between', on.every((c, i) => i === 0 || c.from >= on[i - 1].to + 0.5), on)
check('none over the opening title, and all inside the video', on.every((c) => c.from >= 4.3 && c.to <= len - 0.3), on)
check(`each stays up ${CALLOUT_SECONDS} seconds`, on.every((c) => Math.abs(c.to - c.from - CALLOUT_SECONDS) < 0.01))
// A title talked about while another is still up waits a moment.
const fast = calloutTimes(['Full HD', 'Stereo Sound'], talk('full hd and stereo sound'), whole(30), 30)
check('two features said back to back: the second waits for the first to go, still tied to its word', fast.every(placed) && (fast[1] as { from: number }).from >= (fast[0] as { to: number }).to + 0.5 && (fast[1] as { heard: string | null }).heard === 'stereo', fast)
// A short video: no room for five, and it says so.
const short = calloutTimes(five, [], whole(12), 12)
check('in a short video, titles with no room are said, not dropped', short.length === 5 && short.some((c) => 'missed' in c) && short.some(placed), short)
check('a video too short for any title says why', calloutTimes(['A'], [], whole(2.5), 2.5).every((c) => 'missed' in c && /too short/.test(c.missed)))
// Words cut from the finished video do not count as said.
const cut = calloutTimes(['Stereo Sound'], talk('stereo sound', 2), [[5, 40]], 35)
check('a word cut out of the video does not place its title', cut.every((c) => placed(c) && c.heard === null), cut)

// ── Where they sit ──
const title = DEFAULT_SETTINGS.title
check('low on a review, high on a TRYBE ad (its captions are low)', calloutSpot({ kind: 'review', title }) === 'bottom' && calloutSpot({ kind: 'trybe', title }) === 'top')
check('a title kept on for the whole video at the bottom sends them to the top', calloutSpot({ kind: 'review', title: { ...title, on: true, text: '#ad', seconds: 0, position: 'lower-left' } }) === 'top')

// ── What can be picked, and what MVP suggests ──
check('five at most, trimmed, no repeats', JSON.stringify(cleanCallouts(['  Full  HD ', 'full hd', 3, 'a', 'b', 'c', 'd', 'e'])) === JSON.stringify(['Full HD', 'a', 'b', 'c', 'd']) && MAX_CALLOUTS === 5)
const ideas = cleanIdeas(['Full HD 1920x1080p', 'Only $79 today', '40% off right now', 'Best projector of 2026', 'New for 2026', '4.5 stars on Amazon', '10,000+ reviews', '2000 Lumens brightness', 'IP67 rated', 'Wifi 6 Compatible!', '• Stereo Sound.', 'Stereo sound', '🔥 Hot item', 'A complete cinema solution in a compact and versatile projector that goes anywhere you need it'])
check('no price, deal, year, rating, review count or "best" in a suggestion', !ideas.some((i) => /\$|% off|2026|stars|reviews|best/i.test(i)), ideas)
check('real specs stay, punctuation and repeats go, nothing too long', ideas.includes('2000 Lumens brightness') && ideas.includes('IP67 rated') && ideas.includes('Wifi 6 Compatible') && ideas.includes('Stereo Sound') && !ideas.includes('Stereo sound') && ideas.every((i) => i.length <= 70), ideas)
check('an ASIN, an Amazon link, any link, or a name', productInput('B0FR4RHHXF')?.kind === 'asin' && productInput('https://www.amazon.com/dp/B0FR4RHHXF?th=1')?.kind === 'asin'
  && productInput('https://www.walmart.com/ip/12345')?.kind === 'url' && productInput('brand.com/products/projector')?.kind === 'url' && productInput('Bassdash UPF 50 hoodie')?.kind === 'name' && productInput('  ') === null)

// ── From the page to the video ──
const S = read('lib/review-edit-server.ts')
const R = read('app/api/review-edit/route.ts')
const E = read('components/review-editor/ReviewEditor.tsx')
const C = read('lib/review-edit-callouts.ts')
check('the picked titles are kept with the video, never with the saved look', JSON.stringify(cleanSettings({ callouts: ['Full HD', 'Full HD', 'Stereo'] }).callouts) === JSON.stringify(['Full HD', 'Stereo']) && /callouts: \[\] \}/.test(R.slice(R.indexOf("action === 'save_look'"), R.indexOf("action === 'save_look'") + 300)))
check('One video and both batches send each video’s pick', /cleanSettings\(\{ \.\.\.settings, kind, callouts \}, settings\)/.test(E) && /callouts: v\.callouts \?\? \[\]/.test(read('components/review-editor/DriveBatch.tsx')) && /callouts: v\.callouts \?\? \[\]/.test(read('components/review-editor/ComputerBatch.tsx')))
check('the picker is under the product box when adding, and on the card after', (E.match(/<CalloutPicker /g) || []).length === 2 && /<CalloutPicker product=\{v\.product\}/.test(read('components/review-editor/BatchCheck.tsx')))
check('suggestions come from the product’s listing, and say where from', /action === 'product_titles'/.test(R) && /fetchAmazonProduct\(asin\)/.test(C) && /researchProductFromUrl\(url/.test(C) && /researchProductByWebSearch\(/.test(C) && /from: facts\.from/.test(C) && /written from \{FROM\[about\.from\]/.test(read('components/review-editor/CalloutPicker.tsx')))
check('the model that writes them has a price, so its cost counts', !!PRICING['claude-opus-5-5'] && PRICING['claude-opus-5-5'].in > 0 && /feature: 'review_edit_titles'/.test(C))
check('each title is drawn in the creator’s title look and sent with its moment', /calloutImage\(db, row, c\.text, c\.k, settings\.title, spec\.calloutSpot\)/.test(S) && /\.concat\(calloutPics\)/.test(S) && /startSec: c\.from, endSec: c\.to/.test(S))
check('a title that could not be drawn is said on the card', /It could not be drawn, so it is not on this video/.test(S) && /\{c\.missed\}/.test(E) && /when you said/.test(E))
check('an older video server that draws fewer pictures is reported, not trusted', /sent\.data\.pictures === 'number' \? sent\.data\.pictures : 4/.test(S) && /drew fewer titles/.test(S))
check('the video server draws nine timed pictures and says so', /const MAX_PICTURES = 9/.test(read('ingest-service/edit-filters.js')) && /accepted: true, pictures: EDIT_MAX_PICTURES/.test(read('ingest-service/server.js')))
check('a removed video takes its drawn titles with it', /edit-callout-\$\{row\.id\}-\$\{k\}\.png/.test(R))

if (fails.length) { console.error(`\n❌ review-edit-callouts: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
console.log('✅ review-edit-callouts: titles from the product, the top five picked first, each on screen when it is talked about, reported as made')
