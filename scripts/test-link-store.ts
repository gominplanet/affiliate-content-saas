// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The store is named right before every link MVP posts in a YouTube comment,
// and only a store MVP confirmed (Seb, 2026-10-10: "check out this XXXX on
// Amazon: (link)"; "it's not always Amazon, MVP needs to confirm").

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameStoreBeforeLinks, storeLead } from '../lib/link-store-words'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ok  ${name}`)
  else { failed++; console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`) }
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const P = 'https://www.mvpl.ink/utsvk5v'
const amazon = { [P]: 'amazon' }

// The comment from Seb's screenshot.
const seb = `This pedal changes everything. Check out this pro-grade setup here and see why so many session musicians are ditching their rigs: ${P}  #ad #sponsored`
const out = nameStoreBeforeLinks(seb, amazon, 'Boss Katana 50 MkII')
check('the screenshot comment names Amazon right before the link', out.includes(`Check out the Boss Katana 50 MkII on Amazon: ${P}`), out)
check('and its long sentence is not turned into "rigs on Amazon"', !/rigs on Amazon/.test(out), out)
check('the rest of the comment is kept', out.includes('ditching their rigs.') && out.includes('#ad #sponsored'), out)
check('running it again changes nothing', nameStoreBeforeLinks(out, amazon, 'Boss Katana 50 MkII') === out)
check('without a product name the plain store label is used', nameStoreBeforeLinks(seb, amazon).includes(`Check it out here on Amazon: ${P}`))

// Short lead-ins take the store inside them.
check('"Grab it here:" becomes "Grab it here on Amazon:"', nameStoreBeforeLinks(`Grab it here: ${P}`, amazon) === `Grab it here on Amazon: ${P}`)
check('"Here is the one from this video:" takes the store', nameStoreBeforeLinks(`Here is the one from this video: ${P} (paid link)`, amazon) === `Here is the one from this video on Amazon: ${P} (paid link)`)
check('a lead-in with no colon gets "here on Amazon:"', nameStoreBeforeLinks(`Grab yours ${P}`, amazon) === `Grab yours here on Amazon: ${P}`)
check('a link on its own line under a short label', nameStoreBeforeLinks(`Full review:\n${P}`, amazon) === `Full review on Amazon:\n${P}`)
check('a bare link on its own line gets its own label', nameStoreBeforeLinks(`Great mic.\n\n${P}`, amazon, 'Shure MV7') === `Great mic.\n\nCheck out the Shure MV7 on Amazon: ${P}`)

// Already named: left alone.
const said = `Check the latest price on Amazon here: ${P}`
check('a link whose lead-in already says Amazon is left alone', nameStoreBeforeLinks(said, amazon) === said)
check('"Amazon" in an EARLIER sentence does not count', nameStoreBeforeLinks(`I buy everything on Amazon. Grab it here: ${P}`, amazon) === `I buy everything on Amazon. Grab it here on Amazon: ${P}`)

// Not always Amazon.
const W = 'https://geni.us/abc123'
check('a Walmart link names Walmart', nameStoreBeforeLinks(`Grab it here: ${W}`, { [W]: 'https://www.walmart.com/ip/123' }) === `Grab it here on Walmart: ${W}`)
check('a plain amazon.com link needs no lookup', nameStoreBeforeLinks('Grab it here: https://www.amazon.com/dp/B0ABCDEFGH', {}) === 'Grab it here on Amazon: https://www.amazon.com/dp/B0ABCDEFGH')
const unknown = `Grab it here: ${P}`
check('a link MVP could not confirm is left exactly as it was', nameStoreBeforeLinks(unknown, {}) === unknown)
check('an unknown shop never becomes Amazon', !/Amazon/.test(nameStoreBeforeLinks('Get it: https://brandshop.com/p/1', {})))
check('a Walmart lead uses the product name too', storeLead('walmart', 'Ninja Creami') === 'Check out the Ninja Creami on Walmart:')

// Two products, each named.
const A = 'https://mvpl.ink/aaaa1'
const B = 'https://mvpl.ink/bbbb2'
const two = nameStoreBeforeLinks(`Sony XM5: ${A}\nBose QC Ultra: ${B}`, { [A]: 'amazon', [B]: 'https://www.walmart.com/ip/9' })
check('a comparison names each link\'s own store', two === `Sony XM5 on Amazon: ${A}\nBose QC Ultra on Walmart: ${B}`, two)

// Wired in everywhere a YouTube comment is written or posted.
const lib = read('lib/link-store.ts')
check('a Passport code is looked up by its stored target', /passportTargetForCode\(/.test(lib))
check('short links are followed with a time limit', /resolveTrueDestination\(/.test(lib) && /FOLLOW_MS/.test(lib))
check('an unconfirmed link is reported in words', /could not confirm which store/.test(lib))
const meta = read('app/api/youtube/generate-metadata/route.ts')
check('Co-Pilot\'s pinned comment names the store', /nameLinkStores\(user\.id, engagementResult\.pinnedComment/.test(meta) && /pinnedCommentStoreNote/.test(meta))
check('the description names a confirmed store for a non-Amazon link', /confirmLinkStores\(user\.id, affiliateUrl\)/.test(meta) && /shop: linkShop/.test(meta) && /shopLabel = linkShop/.test(meta))
check('comparison description lines name each store', /nameLinkStores\(user\.id, comparisonLinkLines/.test(meta))
check('Co-Pilot shows when a store could not be confirmed', /pinnedCommentStoreNote &&/.test(read('app/(dashboard)/co-pilot/page.tsx')))
check('a first comment queued by Co-Pilot names the store', /nameLinkStores\(g\.user\.id, text\)/.test(read('app/api/youtube/first-comment/route.ts')))
check('a first comment queued by Liftoff or in bulk names the store', /nameLinkStores\(a\.userId, text\)/.test(read('lib/first-comment-queue.ts')))
const poster = read('lib/first-comments.ts')
check('an older queued comment gets its store when MVP posts it', /nameLinkStores\(row\.user_id, row\.text\)/.test(poster) && /postComment\(row\.youtube_video_id, text\)/.test(poster))
check('and the row keeps the words that went out', /state: 'posted', comment_id: id, text,/.test(poster))
check('a comment SCOUT posts gets its store too', /nameLinkStores\(user\.id/.test(read('app/api/youtube/first-comment/scout/route.ts')))

if (failed) { console.error(`\n${failed} link store check(s) failed`); process.exit(1) }
console.log('\nALL PASS')
