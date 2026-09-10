// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Connected is not the same as chosen.
//
// The social fan-out posted to every CONNECTED network, and the button said
// "Generate & post to all connected", which was honest about doing the wrong
// thing. Connecting an account is a one-off setup act; posting to it is a
// per-post decision. Welding them together meant a creator with three accounts
// linked could not send to two of them without disconnecting the third.
//
// And the same page could not tell them a brand had replied. A creator messages
// a brand, the reply is the entire point of the outreach, and the screen showing
// that campaign said nothing about it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const POST = read('components/amazon/PostToAll.tsx')
const JOINED = read('app/(dashboard)/joined-campaigns/page.tsx')

// ── picking networks ────────────────────────────────────────────────────────
{
  check('there is a per-network selection separate from connectedness',
    /const \[picked, setPicked\] = useState<Record<NetKey, boolean>>/.test(POST))
  check('posting requires BOTH connected and chosen',
    /NETS\.filter\(n => nets\[n\.key\]\.connected && picked\[n\.key\]\)/.test(POST),
    'connected alone is what made the third account unavoidable')
  check('the tiles are buttons, not read-only status',
    /onClick=\{\(\) => toggle\(n\.key\)\}/.test(POST))
  check('a disconnected network cannot be selected',
    /if \(!nets\[k\]\.connected\) return/.test(POST))
  check('the choice is remembered',
    /localStorage\.setItem\(PICK_KEY/.test(POST))
  check('and a remembered YES for a since-disconnected account is dropped',
    /!!s\?\.pinterest\?\.connected && \(stored\?\.pinterest \?\? true\)/.test(POST),
    'otherwise a stored pick silently re-targets an account the creator unlinked')

  check('the button names the networks it will post to',
    /Generate & post to \$\{chosen\.map\(n => n\.label\)\.join\(' \+ '\)\}/.test(POST),
    '"post to all connected" described the account, not the click')
  check('and it is disabled when nothing is ticked',
    /disabled=\{busy \|\| !product\.trim\(\) \|\| chosen\.length === 0\}/.test(POST))
  check('with a line saying why, rather than a dead button',
    /would post nowhere/.test(POST))
  check('the old all-three promise is gone from the UI',
    !POST.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n').includes('all three at once'))
}

// ── brand replies ───────────────────────────────────────────────────────────
{
  check('Joined Campaigns asks SCOUT for the inbox',
    /requestBrandChats/.test(JOINED))
  check('on load, not behind a button',
    /useEffect\(\(\) => \{ void checkReplies\(\) \}, \[checkReplies\]\)/.test(JOINED))
  check('only UNREAD replies are flagged',
    /r\.chats\.filter\(c => c\.unread\)/.test(JOINED),
    'a reply the creator already read is not news')
  check('the badge is per campaign, matched on brand',
    /repliedBrands\.has\(r\.brand\.trim\(\)\.toLowerCase\(\)\)/.test(JOINED))
  check('and it links to the inbox rather than to a dead end',
    /p\/connect\/requests\?status=opportunity&type=affiliate-plus/.test(JOINED),
    'MVP cannot show the conversation yet, so send them to it')
  check('a creator without SCOUT sees the page unchanged',
    /no SCOUT, no session, no badge/.test(JOINED),
    'an error about a thing they never asked for is worse than no badge')
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
