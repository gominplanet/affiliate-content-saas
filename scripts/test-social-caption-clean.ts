// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// One blog link and one disclosure per scheduled social post.
//
// Support, 2026-11-23: "Social Media Posts include two links to the blog and
// two or three disclosures." The stored text carried the blog link by an
// address that changed before publish (?p= to permalink to geni.us), so the
// composer added it again; and Facebook stacked the creator's line, Amazon's
// line and #ad #sponsored, LinkedIn and Telegram a two sentence default.

import { readFileSync } from 'node:fs'
import { stripBlogLinks, oneDisclosure, alreadyDiscloses, AMAZON_ASSOCIATE_LINE } from '../lib/social-caption-clean'
import { composeCaption } from '../lib/social-link-mode'

const failures: string[] = []
const check = (name: string, ok: boolean) => { if (!ok) failures.push(name) }
const read = (p: string) => readFileSync(p, 'utf8')

const STORED = 'https://moderndayreviews.com/?p=1156'
const PERMALINK = 'https://moderndayreviews.com/govee-vs-twinkly/'
const SHARE = 'https://geni.us/blogGovee'
const known = { urls: [STORED, PERMALINK, SHARE], siteUrls: [STORED, PERMALINK] }

// 1. The blog link in the stored text goes, whatever address it is by now
check('the stored ?p= link goes, the title stays', stripBlogLinks(`Govee vs Twinkly Christmas Tree Lights\n\n${STORED}`, known) === 'Govee vs Twinkly Christmas Tree Lights')
check('the permalink goes with or without www and the trailing slash', stripBlogLinks('Lights https://www.moderndayreviews.com/govee-vs-twinkly', known) === 'Lights')
check('any page on the blog\'s own site counts as the blog', stripBlogLinks('See https://moderndayreviews.com/another-review/ too', known) === 'See too')
check('a geni.us share link for the blog goes, with its label line', stripBlogLinks(`Title\n\n🔗 Read the full review: ${SHARE}\n\nMore words`, known) === 'Title\n\nMore words')
check('an inline label goes with its link', stripBlogLinks(`Great lights 🔗 Read the full post: ${PERMALINK} and more`, known) === 'Great lights and more')
check('links that are not the blog stay: Amazon, another geni.us, the video', (() => {
  const t = 'Buy https://amzn.to/xyz or https://geni.us/amazonThing and watch https://youtu.be/abc'
  return stripBlogLinks(t, known) === t
})())
check('a shortener is never taken for the blog\'s site', stripBlogLinks('Buy https://geni.us/amazonThing', { urls: [], siteUrls: [SHARE] }) === 'Buy https://geni.us/amazonThing')
check('nothing known changes nothing', stripBlogLinks(`Title ${STORED}`, { urls: [], siteUrls: [] }) === `Title ${STORED}`)

// 2. One disclosure sentence
check('the creator\'s own line when they wrote one', oneDisclosure('This post contains affiliate links.', false) === 'This post contains affiliate links.')
check('Amazon\'s sentence instead when the post carries an Amazon link and their line does not say it', oneDisclosure('This post contains affiliate links.', true) === AMAZON_ASSOCIATE_LINE)
check('their line kept when it already says Amazon Associate', oneDisclosure('As an Amazon Associate I earn. Thanks!', true) === 'As an Amazon Associate I earn. Thanks!')
check('no line of their own: Amazon\'s sentence', oneDisclosure(null, false) === AMAZON_ASSOCIATE_LINE && oneDisclosure('  ', true) === AMAZON_ASSOCIATE_LINE)
check('a caption that already discloses is seen', alreadyDiscloses('Lights #ad') && alreadyDiscloses('affiliate links here') && !alreadyDiscloses('#adventure lights'))

// 3. A Facebook caption, end to end: one link, one sentence
{
  const writeUp = stripBlogLinks(`Govee vs Twinkly Christmas Tree Lights\n\n${STORED}`, known)
  const caption = composeCaption({ product: false, content: 'blog', writeUp, blogUrl: SHARE, videoUrl: null, affiliateLink: null, disclosure: oneDisclosure('This post contains affiliate links.', false), blogLabel: 'Read the full post' })
  const links = caption.match(/https?:\/\/\S+/g) || []
  const sentences = (caption.match(/affiliate links|Amazon Associate/gi) || []).length
  check('Facebook: one blog link and one disclosure sentence', links.length === 1 && links[0] === SHARE && sentences === 1)
}

// 4. Wired into the scheduled publisher
const CRON = read('app/api/cron/process-scheduled/route.ts')
check('the stored text loses its blog links before any platform composes', /row\.body_text = stripBlogLinks\(row\.body_text, \{ urls: \[storedBlogUrl, blogPermalink, url, gp\.geniuslink_blog_url, \.\.\.channelUrls\]/.test(CRON) && CRON.indexOf('row.body_text = stripBlogLinks') < CRON.indexOf('switch (row.platform)'))
check('no platform stacks a second sentence any more', !/THREADS_DISCLAIMER|effectiveDisclosure|AFFILIATE_DISCLAIMER_DEFAULT/.test(CRON) && (CRON.match(/oneDisclosure\(brandLine/g) || []).length === 4)
check('Threads adds the sentence only when the text does not already disclose', /alreadyDiscloses\(row\.body_text\) \? '' :/.test(CRON))
check('"Also add my affiliate link to Facebook" is read at last', /const fbPref = fbIncludeAffiliate \? \{ \.\.\.fbPrefSaved, product: true \} : fbPrefSaved/.test(CRON))
check('the post is read with its owner, so a scheduled pin gets the creator\'s link style', /\.select\('id,user_id,title,wordpress_url/.test(CRON))
check('no dashes in what the posts say', !/[–—]/.test(AMAZON_ASSOCIATE_LINE))

if (failures.length) {
  console.error(`test-social-caption-clean: ${failures.length} failed`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('test-social-caption-clean: all checks passed')
