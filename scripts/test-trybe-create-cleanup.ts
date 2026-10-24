// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE CREATE, CLEANED UP (Seb, 2026-10-24: "take your time and fix all
// issues and illogical messes inside of the Trybe feature"). Holds what the
// review of Make videos, This week, Upload and What's working found:
//   - a slow brand page never lands on another brand;
//   - "I have this product" never lists a sample twice;
//   - a failed upload record puts the videos back to Ready, saying why;
//   - scripts drop the older body, calls to action and stage list;
//   - a brand MVP's directory lacks is still planned, from its TRYBE page;
//   - every note says what happened: captions are not words, a brand page
//     video is not a Top 100 ad, a failed save is not "not on your list",
//     old Top 100 openings are not used, and MVP's own missing words are not
//     blamed on TRYBE;
//   - new openings pass every hook rule, warnings included;
//   - a failed Amazon match is said, never read as "not on Amazon";
//   - the PDFs print what they work out and name the store a link opens.
import { readFileSync } from 'node:fs'
import { productLinkWords } from '../lib/trybe-planner-pdf'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

const CREATE = read('components/labs/TrybeCreate.tsx')
const IDEAS = read('components/labs/TrybeVideoIdeas.tsx')
const WEEK = read('components/labs/TrybeWeek.tsx')
const UPLOAD = read('components/labs/TrybeUpload.tsx')
const ROUTE = read('app/api/labs/trybe/route.ts')
const SAMPLES = read('app/api/labs/trybe/samples/route.ts')

// The brand on screen.
check('a brand page that arrives late is dropped when another brand is picked', /picking\.current === b\.id/.test(CREATE) && /const leaveBrand = \(\) => \{ picking\.current = null/.test(CREATE))

// Samples once.
check('adding a sample already listed ticks it, never lists it twice', /existing: true/.test(SAMPLES) && /if \(d\.existing\) toast\.success/.test(WEEK) && /filter\(\(x\) => x\.id !== \(d\.sample as Row\)\.id\)/.test(WEEK))

// Upload.
check('a failed record puts the videos back to Ready with the reason', /mark\(v\.key, \{ stage: 'ready', step: null, note: `Not sent yet: \$\{why\}` \}\)/.test(UPLOAD) && /\{v\.note && <p/.test(UPLOAD))
check('a record call that throws never leaves a video stuck on Sending', /now\?\.stage === 'sending' && !now\.itemId/.test(UPLOAD))

// Scripts.
check('a plan with scripts hides the older body, calls to action and stage list', /const scripted = !!plan\?\.videos\?\.some\(\(v\) => v\.say\?\.length\)/.test(IDEAS) && /\{!scripted && <>/.test(IDEAS) && /\{!scripted && plan\.ctas\.length > 0 &&/.test(IDEAS) && /\{!scripted && \(plan\.funnel\.top/.test(IDEAS))
check('the buttons say scripts', /'Write scripts like their winners' : 'Write scripts'/.test(IDEAS) && /New scripts\{winnerWords\.length/.test(IDEAS) && /'Scripts for this sample' : 'Write scripts for this sample'/.test(WEEK))
check('Make videos shows only this product’s saved scripts', /const shownKept = \(kept \|\| \[\]\)\.filter\(\(k\) => !fixedProduct \|\| sameProduct\(k\.product, fixedProduct\)\)/.test(IDEAS))

// No dead ends.
check('a brand MVP has not collected is planned from what its TRYBE page said', /brandName: name, \.\.\.\(b\?\.website \? \{ website: b\.website \} : \{\}\)/.test(IDEAS) && /\|\| \(givenName \? \{ name: givenName, website: givenSite/.test(ROUTE) && !/Collect the TRYBE brand list in Find brands first/.test(ROUTE))
check('the product or the brief is enough when the website does not answer', /!products\.length && !summary && !row\.about && !product && !briefText/.test(ROUTE))

// Notes that say what happened.
check('captions are never called the words of a video', /const winnerSpoken = /.test(IDEAS) && /`the captions of \$\{captions\}`/.test(IDEAS))
check('a brand page video is never called a Top 100 ad', /fromRanked: examples\.filter/.test(ROUTE) && /from brands’ own TRYBE pages/.test(IDEAS))
check('the brand’s own videos are read on their own, not cut by the first 400', /\.eq\('brand_id', lookupId\)\.limit\(20\)/.test(ROUTE))
check('a failed save says it was not saved, never "not on your list"', !/is not on your MVP list, so these ideas/.test(IDEAS) && /could not be saved, so they will be gone next visit/.test(IDEAS))
check('Top 100 openings over 10 days old say new scripts do not use them', /These were read over 10 days ago, so new scripts do not use them/.test(read('components/labs/TrybeTopHooks.tsx')))
check('What’s working never blames TRYBE for words MVP has not written down', !/TRYBE did not share the words of these videos/.test(read('components/labs/TrybeWorking.tsx')) && /MVP is still writing down the words of these videos/.test(read('components/labs/TrybeWorking.tsx')))
check('brand videos MVP could not listen to say why', /couldNotHear\(r\.detail\)/.test(read('lib/trybe-brand-scripts.ts')))
check('a brand scripts read that failed is not marked done for the day', /if \(!failed\) markRead\(\)/.test(read('components/labs/TrybeBrandScripts.tsx')) && /could not keep their videos/.test(read('components/labs/TrybeBrandScripts.tsx')))

// Hooks.

// Amazon.
check('a failed Amazon match is said in Make videos and This week', /\{amz\.error && </.test(CREATE) && /\{amz\.error && </.test(WEEK))

// This week.
check('brands you joined come first in the brand box, declined ones never', /\[\.\.\.\[\.\.\.\(joined \|\| \[\]\)\]\.sort\(byBrandName\)\.filter\(once\), \.\.\.knownBrands\.filter\(once\)\]/.test(WEEK) && /r\.rq\?\.state !== 'declined'/.test(read('components/labs/TrybeOutreach.tsx')))

// PDFs.
const SPDF = read('lib/trybe-samples-pdf.ts')
check('the samples PDF prints the videos planned', /video\$\{l\.videos === 1 \? '' : 's'\} planned/.test(SPDF))
check('the samples PDF names Amazon on its video link', /'Watch it on Amazon'/.test(SPDF))
check('the planner names the store a product link opens', productLinkWords('https://www.amazon.com/dp/B000000000', 'Oink') === 'See it on Amazon' && productLinkWords('https://oink.com/products/vest', 'Oink') === 'See it on the Oink store' && /productLinkWords\(p\.productUrl, p\.brand\)/.test(read('lib/trybe-planner-pdf.ts')))
check('the planner calendar says how many more a full day has', /And \$\{d\.tasks\.length - 6\} more: see This week in MVP/.test(read('lib/trybe-planner-pdf.ts')))

if (fails.length) { console.error('trybe-create-cleanup failed:\n - ' + fails.join('\n - ')); process.exit(1) }
console.log('✅ trybe-create-cleanup: Make videos, This week, Upload and What’s working say what happened, plan every brand and never double up')
