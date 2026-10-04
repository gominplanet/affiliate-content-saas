// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// SCOUT fills a post into the creator's Facebook Group. It never posts it.
//
// WHY A GUARD. Meta lets no app post into a Group, so MVP cannot, and SCOUT
// does the next best thing: it opens the Group in the creator's own browser
// and puts the post in the box. The creator presses Post. That last step is
// the whole difference between a helper and an automated poster, and an
// automated poster is what gets a Facebook account restricted, so the first
// thing this checks is that nothing in the fill ever clicks a Post button.
//
// The rest keeps the failure honest: the post is on the clipboard before
// SCOUT is asked, "filled" is only claimed when the text was seen in the box,
// and an old or missing SCOUT says so instead of looking like nothing happened.
import { readFileSync } from 'node:fs'
import { isFacebookGroupLink, isFacebookGroupPostLink } from '../lib/facebook-group-link'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(detail ? `${name}: ${detail}` : name) }
const read = (p: string) => readFileSync(p, 'utf8')

const BG = read('extension/background.js')
const fillStart = BG.indexOf('async function fillGroupComposerInPage(')
const FILL = fillStart >= 0 ? BG.slice(fillStart) : ''
check('the page script exists', fillStart >= 0)
check('it never clicks a Post button',
  !/aria-label=?\\?["']?Post|innerText\s*===?\s*['"]Post|\btext\(\)\s*===?\s*['"]Post/i.test(FILL)
  && (FILL.match(/\.click\(\)/g) || []).length === 2
  && /trigger\.click\(\)/.test(FILL)
  // The second: Facebook's own Photo/video button, found only by that label,
  // so a clip can be attached. Never anything that could post.
  && /if \(mediaBtn\) \{ mediaBtn\.click\(\)/.test(FILL)
  && /const mediaBtn = [^\n]*\^\(photo\\\/video\|photo or video/.test(FILL),
  'the only clicks allowed open "Write something" and Photo/video')
check('filled is only claimed after the text is seen in the box',
  FILL.indexOf("if (!how) return fail(") > 0 && FILL.indexOf("if (!how) return fail(") < FILL.indexOf('return { ok: true, filled: true'))
check('what happened to the hero is said, attached or not',
  /mediaNote = attached \? 'The thumbnail is attached\.' : 'The thumbnail did not attach/.test(FILL)
  && /'video card: ' \+ \(hasYouTubeCard\(\) \? 'kept' : 'replaced'\)/.test(FILL)
  && /could not download the thumbnail/.test(FILL))
check('the tab is left open for the creator to press Post', !/prefillFacebookGroup[\s\S]{0,2500}chrome\.tabs\.remove/.test(BG.slice(BG.indexOf('async function prefillFacebookGroup('), fillStart)))
check('MVP can ask for it', /msg\.type === 'MVP_FB_GROUP_PREFILL'/.test(BG))
check('only facebook.com/groups links are opened', /\/\^\\\/groups\\\/\[\^\/\]\+\//.test(BG) || /pathname\)\) return null/.test(BG))

const M = JSON.parse(read('extension/manifest.json'))
check('Facebook access is optional, asked on first use',
  (M.optional_host_permissions || []).includes('https://*.facebook.com/*')
  && !(M.host_permissions || []).some((h: string) => /facebook/.test(h)),
  'a required host permission would disable SCOUT for every store user until they accept it')
const V = read('lib/scout-version.ts')
check('the manifest and the app agree on the version', V.includes(`SCOUT_LATEST_VERSION = '${M.version}'`))

const EF = read('lib/extension-frame.ts')
check('an old or missing SCOUT says so', /SCOUT_FB_GROUP_MIN_VERSION/.test(EF) && /SCOUT is not installed/.test(EF))

const UI = read('components/content/SocialPreviewModal.tsx')
check('the post is copied before SCOUT is asked',
  UI.indexOf('navigator.clipboard.writeText(groupCopy) } catch') >= 0
  && UI.indexOf('navigator.clipboard.writeText(groupCopy) } catch') < UI.indexOf('requestFacebookGroupPrefill(g.url'))
check('success and failure look different', /st\.filled \? 'text-emerald/.test(UI))
check('the Group gets the same composed post as the Page', /const composed = finalText && generatedText/.test(UI) && /finalText\.replace\(generatedText\.trim\(\), text\.trim\(\)\)/.test(UI))
check('an older SCOUT that cannot attach the hero says so', /SCOUT_FB_GROUP_MEDIA_MIN_VERSION/.test(EF) && /can't attach the/.test(EF))

// THEN SHARE IT ON THE PAGE. SCOUT watches for the post the creator put up
// and MVP offers a Page post linking to it. The Page post may only ever link
// to the creator's Facebook Group: that is what keeps it off Meta's outside
// link ration, and a route that posted any link would be a loophole.
const WATCH = BG.slice(BG.indexOf('function watchGroupPost('))
check('the watcher exists and MVP can ask it', /function watchGroupPost\(/.test(BG) && /msg\.type === 'MVP_FB_GROUP_POST_STATUS'/.test(BG))
check('the watcher never clicks anything', !/\.click\(\)/.test(BG.slice(BG.indexOf('function installGroupPostHook('))))
check('the listener goes in before the fill', BG.indexOf("func: installGroupPostHook, args: [true]") > 0 && BG.indexOf("func: installGroupPostHook, args: [true]") < BG.indexOf('func: fillGroupComposerInPage'))
check('a restarted SCOUT says lost, not watching forever', /if \(st\.state === 'watching'\) return \{ state: 'lost' \}/.test(BG))
check('every way of not finding the post is its own state', ['closed', 'posted_no_link', 'not_seen', 'timeout'].every((k) => WATCH.includes(`state: '${k}'`)))
const TR = read('app/api/blog/facebook-group-teaser/route.ts')
check('the Page post route refuses any link that is not a Facebook Group', /if \(!isFacebookGroupLink\(link\)\) return NextResponse\.json/.test(TR))
check('the Group post link goes in the Page post text, never as a share Facebook refuses', /postText\(\{ message: text \}\)/.test(TR) && !/postLink\(/.test(TR) && /`\$\{message\}\\n\\n\$\{link\}`/.test(TR))

check('Group links pass', isFacebookGroupLink('https://www.facebook.com/groups/mydeals/') && isFacebookGroupPostLink('https://www.facebook.com/groups/mydeals/posts/1234567890/'))
check('outside links do not', !isFacebookGroupLink('https://amzn.to/abc') && !isFacebookGroupLink('https://www.facebook.com.evil.com/groups/x/') && !isFacebookGroupLink('http://www.facebook.com/groups/x/') && !isFacebookGroupLink('https://www.facebook.com/somepage'))
check('a Group link is not mistaken for one post', !isFacebookGroupPostLink('https://www.facebook.com/groups/mydeals/'))
check('the Page post is offered after a fill, and says whether it links to the post or the Group',
  /if \(res\.filled\) void watchGroupPost\(/.test(UI) && /'the Group post itself' : isFacebookGroupLink/.test(UI))
check('an old SCOUT asks for the link instead of waiting forever', /SCOUT_FB_GROUP_WATCH_MIN_VERSION/.test(EF) && /too old to spot the post/.test(UI))

// THE LAUNCH KIT MAKES THE GROUP THAT SCOUT FILLS. Its last step is what
// connects the two: the Group link goes into Brand Profile, where Fill with
// SCOUT reads it, and onto the Associates website list before any link.
const LK = read('lib/social-launch-kit.ts')
check('the Launch Kit offers a Facebook Group', /facebook_group: \{/.test(LK) && /LAUNCH_PLATFORMS\.facebook_group/.test(LK))
check('and its last step connects it to SCOUT and Amazon', /Brand Profile under Facebook Groups so Fill with SCOUT/.test(LK) && /Associates website list/.test(LK))
const GEN = read('app/api/social-launch-kit/generate/route.ts')
check('the kit writes group rules and membership questions', /"rules": exactly/.test(GEN) && /"questions": exactly/.test(GEN))
const PG = read('app/(dashboard)/social-launch-kit/page.tsx')
check('a platform with no profile picture shows no avatar slot', /\{spec\.avatar && \(/.test(PG))

if (failures.length) {
  console.error(`\n❌ fb-group-fill: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ fb-group-fill: SCOUT fills the Group post and leaves Post to the creator; every failure says so and leaves the post on the clipboard')
