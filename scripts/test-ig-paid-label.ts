// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// INSTAGRAM'S PAID PARTNERSHIP LABEL ON MVP'S POSTS (Seb, 2026-10-29,
// Alejandro). Pinned: team only while in Labs; a post goes through the
// linked Facebook Page with is_paid_partnership when it can; it falls back to
// the usual way only when nothing was published; a publish with no clear
// answer is never retried (no double post); every outcome is kept and said;
// the setting survives a reconnect; the card is on Connect Socials.
import { readFileSync } from 'node:fs'
import { paidLabelAllowed, withEntry, paidLabelWords, isPermissionError, publishWithPaidLabel, PaidLabelUncertainError, PAID_LABEL_FOR_MEMBERS, FB_INSTAGRAM_SCOPES, type PaidLabelWhy } from '../lib/ig-paid-label'
import { containerParams } from '../services/instagram'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined) => { if (!ok) fails.push(name) }
const read = (f: string) => readFileSync(f, 'utf8')

async function run() {
  check('team only while in Labs', paidLabelAllowed('admin') && (PAID_LABEL_FOR_MEMBERS || !paidLabelAllowed('pro')) && !paidLabelAllowed(null))
  check('posting through a Page asks Instagram\'s permissions', ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'].every((p) => (FB_INSTAGRAM_SCOPES as readonly string[]).includes(p)))
  const log = withEntry(Array.from({ length: 12 }, (_, i) => ({ at: `t${i}`, on: true })), { at: 'new', on: false, why: 'no-link' })
  check('the newest outcome first, ten kept', log.length === 10 && log[0].at === 'new' && log[1].at === 't0')
  const whys: PaidLabelWhy[] = ['off', 'not-yet', 'no-facebook', 'no-link', 'reconnect', 'refused', 'unknown-account']
  check('every reason is said in words, with no dashes', whys.every((w) => paidLabelWords(w).length > 10 && !/[–—]| - /.test(paidLabelWords(w, 'x'))))
  check('a missing permission is told from other refusals', isPermissionError({ error: { code: 10 } }) && isPermissionError({ error: { code: 200 } }) && !isPermissionError({ error: { code: 100 } }) && !isPermissionError(null))

  // The posting steps, against a fake Instagram.
  const params = containerParams({ mediaType: 'REELS', videoUrl: 'https://x.supabase.co/v.mp4', caption: 'Great find #ad' })
  const route = async () => ({ route: { igId: '17841400000000000', token: 'PAGE', pageName: 'Gomin Reviews' }, owner: { rowId: null, userId: 'u1', extra: {} } })
  const calls: { url: string; body: string }[] = []
  const realFetch = globalThis.fetch
  const fake = (answers: ((url: string) => Response | 'throw')) => {
    calls.length = 0
    globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
      const url = String(u)
      calls.push({ url, body: String(init?.body ?? '') })
      const a = answers(url)
      if (a === 'throw') throw new Error('socket hang up')
      return a
    }) as typeof fetch
  }
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
  try {
    fake((url) => url.endsWith('/media') ? json({ id: 'C1' }) : url.includes('/C1?') ? json({ status_code: 'FINISHED' }) : url.endsWith('/media_publish') ? json({ id: 'M1' }) : json({}, 404))
    const id = await publishWithPaidLabel({ userId: 'ig1', accessToken: 'IG', params, kind: 'REELS', find: route })
    const create = calls.find((c) => c.url.endsWith('/media'))
    check('the post goes through the Page with the label on, the same caption and video', id === 'M1' && !!create && create.url.startsWith('https://graph.facebook.com/') && create.url.includes('/17841400000000000/media')
      && new URLSearchParams(create.body).get('is_paid_partnership') === 'true' && new URLSearchParams(create.body).get('access_token') === 'PAGE' && new URLSearchParams(create.body).get('video_url') === 'https://x.supabase.co/v.mp4' && /#ad/.test(new URLSearchParams(create.body).get('caption') ?? ''))

    fake((url) => url.endsWith('/media') ? json({ error: { message: 'Unsupported parameter', code: 100 } }, 400) : json({}, 404))
    check('a refused label falls back to the usual way, with nothing published', (await publishWithPaidLabel({ userId: 'ig1', accessToken: 'IG', params, kind: 'REELS', find: route })) === null && !calls.some((c) => c.url.endsWith('/media_publish')))

    fake((url) => url.endsWith('/media') ? json({ id: 'C1' }) : url.includes('/C1?') ? json({ status_code: 'FINISHED' }) : url.endsWith('/media_publish') ? json({ error: { message: 'bad' } }, 400) : json({}, 404))
    check('a publish Instagram clearly refused falls back too', (await publishWithPaidLabel({ userId: 'ig1', accessToken: 'IG', params, kind: 'REELS', find: route })) === null)

    for (const [name, ans] of [['no answer', 'throw'], ['a server failure', json({}, 503)]] as const) {
      fake((url) => url.endsWith('/media') ? json({ id: 'C1' }) : url.includes('/C1?') ? json({ status_code: 'FINISHED' }) : url.endsWith('/media_publish') ? (ans === 'throw' ? 'throw' : (ans as Response)) : json({}, 404))
      let threw: unknown = null
      try { await publishWithPaidLabel({ userId: 'ig1', accessToken: 'IG', params, kind: 'REELS', find: route }) } catch (e) { threw = e }
      check(`a publish with ${name} is never posted again`, threw instanceof PaidLabelUncertainError && /may already be live/.test(String((threw as Error).message)))
    }

    fake(() => json({}, 404))
    const none = await publishWithPaidLabel({ userId: 'ig1', accessToken: 'IG', params, kind: 'REELS', find: async () => ({ why: 'no-link' as const, owner: null }) })
    check('an account with no linked Page posts the usual way without asking Facebook', none === null && calls.length === 0)
  } finally { globalThis.fetch = realFetch }

  const IG = read('services/instagram.ts')
  check('every Instagram post tries the label first, then the usual way', /const labelled = await publishWithPaidLabel\(\{ userId: opts\.userId, accessToken: opts\.accessToken, params: containerParams\(opts\), kind: opts\.mediaType \}\)\s*\n\s*if \(labelled\) return labelled\s*\n\s*const containerId = await createMediaContainer\(opts\)/.test(IG))
  check('a post that may be live keeps the account\'s posting hold', /if \(feed && !\(e instanceof Error && e\.name === 'PaidLabelUncertainError'\)\) feedSlots\.delete\(opts\.userId\)/.test(IG))
  check('the usual way builds the same post', /const body = containerParams\(opts\)\s*\n\s*body\.set\('access_token', opts\.accessToken\)/.test(IG))
  const FB = read('app/api/auth/facebook/route.ts')
  check('connecting Facebook asks Instagram\'s permissions of accounts the label is open to', /if \(paidLabelAllowed\(tierRow\?\.tier as string \| null\)\) labelScopes = \[\.\.\.FB_INSTAGRAM_SCOPES\]/.test(FB))
  check('the setting and log survive a reconnect', /kept = Object\.fromEntries\(Object\.entries\(e\)\.filter\(\(\[k\]\) => k\.startsWith\('paid_label_'\)\)\)/.test(read('lib/social-accounts.ts')) && /\.\.\.kept,/.test(read('lib/social-accounts.ts')))
  check('the card is on Connect Socials and says what happened to each post', /<InstagramPaidLabel \/>/.test(read('app/(dashboard)/connect-socials/page.tsx')) && /Posted with the label/.test(read('app/api/instagram/paid-label/route.ts')) && /Posted without the label/.test(read('app/api/instagram/paid-label/route.ts')))

  const T = read('app/api/facebook/paid-label-test/route.ts')
  check('the Facebook label test is team only, hidden, always deleted, and says Facebook\'s words', /if \(normalizeTier\(integ\?\.tier\) !== 'admin'\) return NextResponse\.json\(\{ error: 'Team only\.' \}, \{ status: 403 \}\)/.test(T)
    && /published: 'false'/.test(T) && /\} finally \{\s*\n\s*const del = await call\(`\$\{FB\}\/\$\{postId\}\?access_token=\$\{t\}`, \{ method: 'DELETE' \}\)/.test(T) && /NOT deleted, please remove it from your Page/.test(T) && /sponsor_id: partner/.test(T))
  check('a try it cannot read back is never called a pass', /no field says whether a label with no brand is on, so this does not show that it works/.test(T))
  check('the card has the test button', /Run the Facebook label test/.test(read('components/instagram/InstagramPaidLabel.tsx')))

  if (fails.length) { console.error('FAIL paid label:\n  ' + fails.join('\n  ')); process.exit(1) }
  console.log('✅ ig-paid-label: Instagram posts carry the Paid partnership label when they can, and say when they did not')
}
void run()
