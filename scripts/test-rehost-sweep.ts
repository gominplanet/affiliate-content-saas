// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A REPAIR THAT RUNS UNATTENDED ON OTHER PEOPLE'S PUBLISHED POSTS.
//
// 186 posts across 6 creators point at pictures on fal.media rather than on the
// sites publishing them. The repair existed behind a button and none of the six
// had ever pressed it, so it now runs as a cron. That earns a higher bar than
// most things here, because nobody is watching it and it edits live articles.
//
// The failure that matters is not a crash. It is a run that moves nothing and
// says it worked. One of these six has a site that refuses every upload, so
// that run WILL happen, on the first tick, against 8 of his posts, and the
// report has to make it obvious.
//
// THE THREE OUTCOMES, AND WHY EACH NEEDS ITS OWN NAME:
//
//   moved      on the creator's own site now. Done, permanently.
//   refused    the site said no. Their WordPress is the problem, the pictures
//              are still ours to lose, and a later retry may work.
//   gone       the source is deleted. No upload fixes it and no retry will.
//              Only regenerating does, which costs money and hands them a
//              picture they never chose, so it stays their decision.
//
// Folding `gone` into `refused` sends somebody to their host to fix an upload
// path that works fine, for a file that is not coming back. Folding either into
// a success is how 186 posts got here.
//
// All IO is injected, so every branch below is driven without a WordPress site.
import { rehostPosts, describeRun, makeOgImageFollower, type RehostTarget, type RehostIO } from '../lib/rehost-run'
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const SITE = 'https://jdtheot.com'
const FAL_A = 'https://v3b.fal.media/files/b/0aa0b696/aaaa.jpg'
const FAL_B = 'https://v3b.fal.media/files/b/0aa0b696/bbbb.jpg'

function post(over: Partial<RehostTarget> = {}): RehostTarget {
  return {
    id: 'post-1234abcd',
    title: 'Kolbs Bed Wedge Pillow Review',
    content: `<p>hi</p><img src="${FAL_A}" /><p>more</p><img src="${FAL_B}" />`,
    wordpress_post_id: 42,
    wordpress_url: `${SITE}/kolbs/`,
    ...over,
  }
}

function io(over: Partial<RehostIO> = {}): RehostIO & { saved: Array<[string, number, string]>; pushed: number[] } {
  const saved: Array<[string, number, string]> = []
  const pushed: number[] = []
  return {
    uploadFromUrl: async (_url, name) => `${SITE}/wp-content/uploads/${name}`,
    updatePost: async (id) => { pushed.push(id) },
    saveContent: async (postId, _c, hosted, status) => { saved.push([postId, hosted, status]) },
    saved,
    pushed,
    ...over,
  }
}

async function main() {
  // ── the happy path, and it must actually rewrite the body ─────────────────
  {
    const h = io()
    const r = await rehostPosts([post()], SITE, h)
    check('both pictures moved', r.moved === 2, String(r.moved))
    check('nothing was refused', r.refused === 0)
    check('the live post was updated', h.pushed.length === 1 && h.pushed[0] === 42)
    check('and our copy recorded ready', h.saved[0]?.[2] === 'ready', String(h.saved[0]?.[2]))
    check('with the hosted count', h.saved[0]?.[1] === 2, String(h.saved[0]?.[1]))
    check('the summary says what happened', /Moved 2 pictures onto the site/.test(describeRun(r, 1)), describeRun(r, 1))
  }

  // ── THE ONE THAT WILL HAPPEN FIRST: a site that refuses everything ────────
  {
    const h = io({ uploadFromUrl: async () => { throw new Error('rest_cannot_create') } })
    const r = await rehostPosts([post()], SITE, h)

    check('nothing moved', r.moved === 0, String(r.moved))
    check('and it is recorded as refused, not as gone', r.refused === 2 && r.gone === 0)
    check('THE LIVE POST WAS NOT TOUCHED', h.pushed.length === 0,
      'pushing an unchanged body would burn a revision and prove nothing')
    check('and our copy was not relabelled', h.saved.length === 0,
      'writing ready here is the exact bug this whole repair exists to undo')
    check('the run knows the site refused everything', r.siteRefusedEverything)

    const said = describeRun(r, 1)
    check('the summary leads with nothing moved', /Nothing moved/.test(said), said)
    check('and says the site refused them', /refused all 2 uploads/.test(said), said)
    check('and does NOT read as a success', !/^Moved/.test(said), said)
    check('and sends them somewhere useful', /Test pictures/.test(said), said)
    check('the reason survives', /rest_cannot_create/.test(r.failures[0]?.reason ?? ''), r.failures[0]?.reason)
  }

  // ── a source that is gone is NOT a refusal ────────────────────────────────
  {
    const h = io({ sourceAlive: async (u) => u !== FAL_A })
    const r = await rehostPosts([post()], SITE, h)

    check('the live one still moved', r.moved === 1, String(r.moved))
    check('the dead one is counted as gone', r.gone === 1, String(r.gone))
    check('and NOT as refused', r.refused === 0,
      'a refusal sends them to their host to fix an upload path that is working')
    check('it was never even attempted', r.attempted === 1,
      'uploading from a URL we know is dead wastes the run and muddies the reason')
    check('the reason says it has to be remade',
      /has to be made again/.test(r.failures.find(f => f.url === FAL_A)?.reason ?? ''),
      r.failures[0]?.reason)
    check('the post is still hot-linked afterwards', h.saved[0]?.[2] === 'hotlinked', String(h.saved[0]?.[2]))

    const said = describeRun(r, 1)
    check('the summary keeps the two apart',
      /Moved 1 picture/.test(said) && /gone for good/.test(said), said)
  }

  // ── a probe that throws proves nothing ────────────────────────────────────
  {
    const h = io({ sourceAlive: async () => { throw new Error('network wobble') } })
    const r = await rehostPosts([post()], SITE, h)
    check('a failed probe does not declare a picture lost', r.gone === 0, String(r.gone))
    check('the upload is attempted anyway', r.moved === 2, String(r.moved))
  }

  // ── the live post fails to update AFTER the uploads succeeded ─────────────
  //
  // The uploads worked and the article still points at fal, so from a reader's
  // side nothing was repaired. Counting these as moved would report a repair
  // nobody can see, which is the same class of lie as the original bug.
  {
    const h = io({ updatePost: async () => { throw new Error('502 from WordPress') } })
    const r = await rehostPosts([post()], SITE, h)
    check('nothing counts as moved', r.moved === 0, String(r.moved))
    check('the pictures are counted as still ours', r.refused === 2, String(r.refused))
    check('our copy was NOT written', h.saved.length === 0,
      'saving the rewritten body while the live post still points at fal is the worst of both')
    check('and the reason names what happened',
      /could not be updated/.test(r.failures.find(f => /502|could not be updated/.test(f.reason))?.reason ?? ''))
  }

  // ── a partial move leaves the post honestly hot-linked ────────────────────
  {
    const h = io({ uploadFromUrl: async (u, n) => u === FAL_A ? `${SITE}/wp-content/uploads/${n}` : null })
    const r = await rehostPosts([post()], SITE, h)
    check('one moved', r.moved === 1, String(r.moved))
    check('one refused', r.refused === 1, String(r.refused))
    check('the live post WAS updated, because something really changed', h.pushed.length === 1)
    check('and the row says hot-linked, not ready',
      h.saved[0]?.[2] === 'hotlinked', String(h.saved[0]?.[2]))
    check('which is not a site-refused-everything run', !r.siteRefusedEverything)
  }

    // ── THE SOCIAL CARD FOLLOWS THE PICTURE ─────────────────────────────────
  //
  // mvp_og_image holds the URL the plugin renders as og:image AND
  // twitter:image, and it is written separately from the article body. In the
  // Garvee post, four fal references were og:image, twitter:image and two body
  // pictures, the first of which the meta names. Repair the body alone and the
  // article survives while its social card points at a file due for deletion.
  {
    const metaReads: Array<[number, string]> = []
    const metaWrites: Array<[number, unknown]> = []
    const wp = {
      getPostMetaValue: async (id: number, key: string) => { metaReads.push([id, key]); return FAL_A },
      updatePost: async (id: number, patch: { meta?: Record<string, unknown> }) => { metaWrites.push([id, patch.meta]); },
    }
    const follower = makeOgImageFollower(wp)
    const h = io({ afterMoved: follower })
    await rehostPosts([post()], SITE, h)

    check('the meta is read for the repaired post', metaReads.length === 1 && metaReads[0][1] === 'mvp_og_image',
      JSON.stringify(metaReads))
    check('and repointed at the moved copy', metaWrites.length === 1, String(metaWrites.length))
    const written = (metaWrites[0]?.[1] as Record<string, string> | undefined)?.mvp_og_image
    check('to the NEW url', !!written && !written.includes('fal.media') && written.includes(SITE), String(written))

    // Not "the first thing we moved". Often the deliberate social image is the
    // YouTube thumbnail, and replacing it with a random in-body picture is a
    // change nobody asked for.
    const other = { ...wp, getPostMetaValue: async () => 'https://img.youtube.com/vi/abc/maxresdefault.jpg' }
    const writes2: Array<unknown> = []
    other.updatePost = async (_id: number, patch: { meta?: Record<string, unknown> }) => { writes2.push(patch); }
    await rehostPosts([post()], SITE, io({ afterMoved: makeOgImageFollower(other) }))
    check('a social image we did NOT move is left alone', writes2.length === 0,
      'overwriting a deliberate og:image with an in-body picture is a change nobody asked for')

    const none = { ...wp, getPostMetaValue: async () => null }
    const writes3: Array<unknown> = []
    none.updatePost = async (_id: number, patch: unknown) => { writes3.push(patch); }
    await rehostPosts([post()], SITE, io({ afterMoved: makeOgImageFollower(none) }))
    check('a post with no social image gains none', writes3.length === 0)

    // And it must never cost the repair.
    const boom = io({ afterMoved: async () => { throw new Error('meta write refused') } })
    const r = await rehostPosts([post()], SITE, boom)
    check('a failed meta update does not undo the repair', r.moved === 2, String(r.moved))
    check('and our copy is still written', boom.saved.length === 1, String(boom.saved.length))
  }

  // ── A POST ON ANOTHER BLOG IS NEVER WRITTEN TO ──────────────────────────
  //
  // A creator can have up to ten sites, and a WordPress post id only means
  // anything inside one of them. Repairing post 42 with the wrong site's
  // credentials would overwrite a completely unrelated published article with
  // this one's body. That is the only irreversible thing this sweep could
  // possibly do, so it is checked on the recorded URL, which does not depend on
  // our own site ids being right.
  {
    const elsewhere = post({ wordpress_url: 'https://his-other-blog.com/kolbs/' })
    const h = io()
    const r = await rehostPosts([elsewhere], SITE, h)

    check('a post on another blog is not touched', h.pushed.length === 0,
      'this would overwrite a different article on a different site')
    check('nothing was uploaded for it either', r.attempted === 0)
    check('and our copy was not rewritten', h.saved.length === 0)
    check('it is reported as skipped, with the reason',
      /different site/.test(r.posts[0]?.skipped ?? ''), r.posts[0]?.skipped)
    check('and it is not counted as repaired', r.moved === 0)

    // www is not a different blog.
    const wwwd = post({ wordpress_url: 'https://www.jdtheot.com/kolbs/' })
    const r2 = await rehostPosts([wwwd], SITE, io())
    check('www is the same blog', r2.moved === 2, String(r2.moved))

    // A post with no recorded URL cannot be checked this way. It still belongs
    // to the site its batch was resolved for, so it is repaired.
    const noUrl = post({ wordpress_url: null })
    const r3 = await rehostPosts([noUrl], SITE, io())
    check('a post with no recorded URL is still repaired', r3.moved === 2, String(r3.moved))
  }

// ── posts it must decline to touch, and say why ───────────────────────────
  {
    const noId = await rehostPosts([post({ wordpress_post_id: null })], SITE, io())
    check('a post with no WordPress id is skipped', noId.posts[0]?.skipped !== undefined)
    check('and the reason is in plain words',
      /live post cannot be updated/.test(noId.posts[0]?.skipped ?? ''), noId.posts[0]?.skipped)
    check('and it is not counted as repaired', noId.moved === 0)

    const clean = await rehostPosts([post({ content: '<p>no pictures here</p>' })], SITE, io())
    check('a post with nothing to move says so', /nothing to move/.test(clean.posts[0]?.skipped ?? ''))
    check('and an empty run does not claim success',
      /found nothing to move/.test(describeRun(clean, 1)), describeRun(clean, 1))

    const none = describeRun(await rehostPosts([], SITE, io()), 0)
    check('no posts at all is its own sentence', /No posts needed repairing/.test(none), none)
  }

  // ── already on their own site: never touched ──────────────────────────────
  {
    const own = post({ content: `<img src="${SITE}/wp-content/uploads/x.jpg" />` })
    const r = await rehostPosts([own], SITE, io())
    check('a picture already on their site is left alone', r.attempted === 0 && r.moved === 0)
  }

  // ── THE SWEEP IS ACTUALLY WIRED, AND SHARES THE BUTTON'S LOOP ─────────────
  {
    const strip = (src: string) => src
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

    const cron = strip(readFileSync('app/api/cron/rehost-hotlinked/route.ts', 'utf8'))
      + '\n' + strip(readFileSync('lib/rehost-sweep.ts', 'utf8'))
    const button = strip(readFileSync('app/api/blog/rehost-images/route.ts', 'utf8'))
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: Array<{ path: string; schedule: string }> }

    check('the cron is registered with Vercel',
      vercel.crons.some(c => c.path === '/api/cron/rehost-hotlinked'),
      'an unregistered cron route is a file nothing ever calls')
    check('and it is not running every minute',
      !/^\* /.test(vercel.crons.find(c => c.path === '/api/cron/rehost-hotlinked')?.schedule ?? '* * * * *'),
      'this edits published posts; it does not need to run sixty times an hour')

    check('the cron requires the shared secret', /Bearer \$\{secret\}/.test(cron),
      'an open endpoint that rewrites customers\' posts is not an endpoint')
    check('and refuses when the secret is unset', /CRON_SECRET not set on server/.test(cron),
      'falling through to unauthenticated when the env var is missing is the worst default')

    // The whole reason lib/rehost-run exists.
    for (const [name, src] of [['cron', cron], ['button', button]] as Array<[string, string]>) {
      check(`the ${name} calls the shared repair loop`, /rehostPosts\(/.test(src),
        'two copies of this loop is how refresh-images came to disagree with generate')
      check(`the ${name} uses the shared liveness probe`, /sourceAlive: defaultSourceAlive/.test(src),
        'a private copy of the probe drifts, and then one caller calls a live picture dead')
    }
    check('the button route no longer runs its own loop',
      !/for \(const c of candidates\)/.test(button),
      'leaving the old loop behind means the button and the sweep slowly disagree')

    check('the sweep is bounded per run', /MAX_USERS_PER_RUN = \d/.test(cron) && /MAX_POSTS_PER_USER = \d/.test(cron),
      'an unbounded first run against 186 published posts is not a thing to do unattended')
    check('and it takes the oldest first', /ascending: true/.test(cron),
      'the oldest pictures are the closest to being collected')
    check('it never regenerates', !/generateImage|fal\.subscribe|fal\.run\(/.test(cron),
      'a regenerated picture is one the creator never chose and did not pay for')

    check('a run that did nothing says so', /Nothing was moved and nothing was refused/.test(cron),
      'ok:true with no numbers beside it is the silence this replaces')
    check('and the per-creator line carries the refusal flag', /siteRefusedEverything: result\.siteRefusedEverything/.test(cron))
  }

  // ── AND SOMEBODY CAN SEE WHETHER IT IS WORKING ──────────────────────────
  //
  // The sweep reports into a Vercel log nobody reads. A repair whose only
  // evidence is a log line is as invisible as the bug it fixes, working or not.
  // A feature shipped with no way to reach it is a mistake already made once
  // today, with the logo scan, so this clause is the one that catches it.
  {
    const stripPage = (src: string) => src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ' '))
      .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
      .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')

    let api = ''
    let page = ''
    let nav = ''
    try { api = stripPage(readFileSync('app/api/admin/hotlinked-posts/route.ts', 'utf8')) } catch { /* reported below */ }
    try { page = stripPage(readFileSync('app/(dashboard)/admin/hotlinked/page.tsx', 'utf8')) } catch { /* reported below */ }
    try { nav = stripPage(readFileSync('components/layout/DashboardShellV2.tsx', 'utf8')) } catch { /* reported below */ }

    check('the count has an endpoint', api.length > 0)
    check('and it is admin only', /tier !== 'admin'/.test(api) && /Admin only/.test(api),
      'this lists other customers by email; it is not a page for everyone')
    check('the page exists', page.length > 0, 'the sweep would drain with nothing to show for it')
    check('and it calls the endpoint', /\/api\/admin\/hotlinked-posts/.test(page))
    check('and it is reachable from the admin menu', /\/admin\/hotlinked/.test(nav),
      'a page with no link is a page nobody opens, which happened to the logo scan today')

    check('the page separates the backlog from the leak',
      /still arriving/i.test(page) && /leakNote/.test(page),
      'a falling total with new ones arriving daily is two different states, and only one of them is progress')
    check('a failed count says it proved nothing',
      /says nothing about how many are left/i.test(page),
      'an empty table after a failed lookup reads exactly like success')

    // ── you can ask it what it just did ─────────────────────────────────
    //
    // After the first scheduled run I checked the one affected site reachable
    // from outside and found every post unchanged, and could not tell whether
    // the run had failed or had worked on three creators whose sites I cannot
    // see. Both of the clauses below exist because of that hour.
    let runApi = ''
    try { runApi = stripPage(readFileSync('app/api/admin/rehost-run/route.ts', 'utf8')) } catch { /* reported below */ }

    check('the sweep can be run on demand', runApi.length > 0,
      'a scheduled repair nobody can interrogate is one you have to take on faith')
    check('and it is the SAME code path as the cron', /runHotlinkedSweep\(\)/.test(runApi),
      'a Run now that took its own route would report on itself, not on the thing on the schedule')
    check('and it is admin only', /tier !== 'admin'/.test(runApi))
    check('the page can trigger it', /\/api\/admin\/rehost-run/.test(page))
    check('and shows what came back', /Last run/.test(page) && /run\.summary/.test(page))
    check('a sweep that could not start is not shown as a sweep that did nothing',
      /could not run, so nothing was attempted/.test(page),
      'those are different facts and they must not share a sentence')

    // Determinism, so "nothing changed" becomes checkable instead of ambiguous.
    const sweepSrc = stripPage(readFileSync('lib/rehost-sweep.ts', 'utf8'))
    check('the run picks its creators deterministically',
      /\.sort\(\(a, b\) => b\[1\] - a\[1\] \|\| a\[0\]\.localeCompare\(b\[0\]\)\)/.test(sweepSrc),
      'taking whatever three the query returned makes a run impossible to verify from outside')
    check('and takes the biggest backlog first',
      /b\[1\] - a\[1\]/.test(sweepSrc),
      'draining the smallest first leaves the worst case untouched the longest')

    // The runner refuses a post on another host, so without this grouping a
    // multi-site creator's second blog would be skipped forever rather than
    // repaired: safe, and permanently stuck.
    check('the sweep resolves credentials per site, not per creator',
      /getWordPressCredentials\(admin, ownerId, siteKey \|\| undefined/.test(sweepSrc),
      'one set of credentials per owner cannot repair a creator with more than one blog')
    check('and it reads which site each post went to',
      /wordpress_site_id/.test(sweepSrc),
      'without it there is nothing to group by')
    check('posts the runner declined are counted separately from failures',
      /skippedPosts: result\.posts\.filter\(x => x\.skipped\)\.length/.test(sweepSrc),
      'a declined post is not an attempted one, and folding them together hides both')

    // The per-site grouping means one entry per (creator, blog) pair. Reporting
    // that count as "owners" would tell you three people were repaired when it
    // was one person with three blogs.
    check('creators and blogs are counted separately',
      /owners: ownerIds\.length/.test(sweepSrc) && /sites: perOwner\.length/.test(sweepSrc),
      'a creator with two blogs would otherwise be reported as two creators')
  }

  // ── house style ───────────────────────────────────────────────────────────
  {
    const lines = [
      describeRun({ moved: 2, refused: 0, gone: 0, attempted: 2, failures: [], posts: [], siteRefusedEverything: false }, 1),
      describeRun({ moved: 0, refused: 3, gone: 0, attempted: 3, failures: [], posts: [], siteRefusedEverything: true }, 1),
      describeRun({ moved: 1, refused: 0, gone: 2, attempted: 1, failures: [], posts: [], siteRefusedEverything: false }, 1),
      describeRun({ moved: 0, refused: 0, gone: 0, attempted: 0, failures: [], posts: [], siteRefusedEverything: false }, 3),
      describeRun({ moved: 0, refused: 0, gone: 0, attempted: 0, failures: [], posts: [], siteRefusedEverything: false }, 0),
    ]
    for (const l of lines) {
      check(`no dash punctuation in "${l.slice(0, 44)}…"`, !/[—–]|\s-\s/.test(l))
      check(`no year in "${l.slice(0, 44)}…"`, !/\b20\d{2}\b/.test(l))
    }
  }
}

main().then(() => {
  if (failures.length) {
    console.error(`\n❌ rehost-sweep: ${failures.length} failure(s)\n`)
    for (const f of failures) console.error(`   • ${f}`)
    process.exit(1)
  }
  console.log('✅ rehost-sweep: moved, refused and gone stay three different answers, and a run that moved nothing says so')
}).catch((e) => {
  // A crash here is not a pass. Without this the process exits 0 on a throw
  // and the build ships a repair loop nobody checked.
  console.error('\n❌ rehost-sweep: the suite itself threw\n', e)
  process.exit(1)
})
