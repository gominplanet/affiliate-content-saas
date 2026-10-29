// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// FILTER AND SEARCH (Seb, 2026-10-29: "is there a way we can filter and do
// searches to check for pending submissions, rejected ones, the brands that
// have said yes or no to partnering?"). Pinned: Analytics' counts open the
// videos behind them, by status and search, for All or one brand, with the
// counts' own period rule; a brand TRYBE did not give and nothing matching
// are said; Sent has said yes, not answered and said no chips, and a search.
import { readFileSync } from 'node:fs'
import { listedOf, filterSubs, statusTally, subMatches } from '../lib/trybe-sub-list'
import { readSubmissions } from '../lib/trybe-mybrands'

const fails: string[] = []
const check = (name: string, ok: boolean | undefined, detail?: unknown) => { if (!ok) fails.push(`${name}${detail !== undefined ? `: ${JSON.stringify(detail)}` : ''}`) }
const read = (f: string) => readFileSync(f, 'utf8')

const now = Date.parse('2026-10-29T15:00:00Z')
const ago = (d: number) => new Date(now - d * 86_400_000).toISOString()
const subs = readSubmissions({ data: [
  { id: 's1', status: 'PENDING_APPROVAL', submittedAt: ago(1), product: { title: 'Fishing Hoodie with Neck Gaiter' } },
  { id: 's2', status: 'REJECTED', submittedAt: ago(3), reviewedAt: ago(2), rejectionReason: 'Logo not shown in the first 3 seconds', product: { title: 'Chest Wader' } },
  { id: 's3', status: 'APPROVED', submittedAt: ago(4), approvedAt: ago(3), feedback: 'Great hook', product: { title: 'Rain Jacket' } },
  { id: 's4', status: 'REVISION_REQUESTED', submittedAt: ago(2), review: { feedback: 'Please say the brand name' }, product: { title: 'Wading Boots' } },
  { id: 's5', status: 'PENDING_APPROVAL', submittedAt: ago(20), product: { title: 'Old Hoodie' } },
] })
check('the brand’s feedback is read on a video it did not approve', subs.find((s) => s.id === 's2')?.reason === 'Logo not shown in the first 3 seconds' && subs.find((s) => s.id === 's4')?.reason === 'Please say the brand name')
check('and never on an approved one', subs.find((s) => s.id === 's3')?.reason === null)

const bassdash = listedOf({ id: 'b1', name: 'Bassdash', logo: null }, subs, 7, now)
const other = listedOf({ id: 'b2', name: 'NOBL', logo: null }, readSubmissions({ data: [{ id: 'n1', status: 'PENDING_APPROVAL', submittedAt: ago(2), productName: 'Cooling Towel' }] }), 7, now)
const all = [...bassdash, ...other]
check('the period rule is the counts’ own: older videos are left out', bassdash.length === 4 && !bassdash.some((s) => s.id === 's5'))
check('revision is its own status, as in the counts', bassdash.find((s) => s.id === 's4')?.status === 'revision')
check('Pending lists the pending videos from every brand, newest first', filterSubs(all, 'pending', '').map((s) => s.id).join() === 's1,n1')
check('Rejected lists the rejected ones', filterSubs(all, 'rejected', '').map((s) => s.id).join() === 's2')
check('one brand picked keeps to that brand', filterSubs(all, 'pending', '', 'b2').map((s) => s.id).join() === 'n1')
check('search finds a product, a brand, a status, and what the brand wrote', filterSubs(all, 'all', 'wader').length === 1 && filterSubs(all, 'all', 'nobl').length === 1 && filterSubs(all, 'all', 'rejected').length === 1 && filterSubs(all, 'all', 'logo').length === 1)
check('every word has to match', subMatches(bassdash[0], 'hoodie gaiter') && !subMatches(bassdash[0], 'hoodie towel'))
const t = statusTally(all, '')
check('each chip counts what it would show', t.all === 5 && t.pending === 2 && t.rejected === 1 && t.approved === 1 && t.revision === 1)
check('the chips follow the search', statusTally(all, 'hoodie').all === 1 && statusTally(all, 'hoodie').pending === 1)

const H = read('components/labs/useTrybeSubmissions.ts'), L = read('components/labs/TrybeSubList.tsx'), A = read('components/labs/TrybeAds.tsx')
check('the list reads only once it is opened', /useEffect\(\(\) => \{ if \(open && read\) void load\(false\) \}/.test(H) && /useTrybeSubList\(subs\.read, listOpen\)/.test(A))
check('the counts and the list share one read of each brand’s videos', /async function listCounts\([^)]*\)[^{]*\{\s*\n\s*const subs = await listOf\(/.test(H) && /lists\.set\(key/.test(H))
check('only brands with a video in the period, or not read, are read, the busiest first, capped', /b\.counts\.total > 0 \|\| !b\.read/.test(H) && /slice\(0, MAX_LIST_BRANDS\)/.test(H))
check('a late answer never overwrites a newer read', /if \(mine !== run\.current\) return/.test(H))
check('each status count opens its videos', /onClick=\{\(\) => setSubFilter\(subFilter === r\.key \? null : r\.key\)\}/.test(A))
check('one search box, so typing never jumps to another box', (A.match(/type="search"/g) ?? []).length === 1 && !/type="search"/.test(L))
check('still reading, a brand not given, brands past the cap and nothing matching are each said',
  /Reading your videos from TRYBE: \{state\.done\} of \{state\.of\} brands/.test(L) && /TRYBE did not give the videos for/.test(L) && /more are not in this list/.test(L) && /No \$\{word\}videos/.test(L))
check('a status MVP cannot place shows TRYBE’s own word', /s\.status === 'other' \? \(s\.rawStatus \|\| 'Unknown'\)/.test(L))
check('what the brand wrote is shown as theirs', /\{s\.brand\} wrote: &ldquo;\{s\.reason\}&rdquo;/.test(L))

const O = read('components/labs/TrybeOutreach.tsx')
check('Sent has said yes, not answered and said no chips', /\['accepted', `Said yes \(/.test(O) && /\['pending', `Not answered on TRYBE \(/.test(O) && /\['declined', `Said no or expired \(/.test(O))
check('and a search that keeps to the chip', /placeholder="Search a brand you sent to"/.test(O) && /sentRows\.filter\(r => sentShows\(r, sentFilter, sentQuery\)\)\.map/.test(O) && /if \(filter === 'accepted' \|\| filter === 'pending' \|\| filter === 'declined'\) return r\.rq\?\.state === filter/.test(O))
check('a search with no match says so, not a blank list', /No brand you sent to matches/.test(O))

// Comments and the code inside ${...} are not copy.
const code = L.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\$\{[^}]*\}/g, '')
const copy = code.match(/"[^"\n]{12,}"|`[^`]{12,}`|>[^<>{}\n]{12,}</g)?.join(' ') ?? ''
check('no dashes in what a creator reads', !/[–—]| - /.test(copy) && !/[–—]/.test('Search your videos: product, brand, or what the brand wrote See all your videos'), (copy.match(/.{20}(?:[–—]| - ).{20}/g) ?? []).slice(0, 3))

if (fails.length) { console.error(`\n❌ trybe-sub-list: ${fails.length} failure(s)\n`); for (const f of fails) console.error(`   • ${f}`); process.exit(1) }
console.log('✅ trybe-sub-list: submissions filtered by status and searched, brands that said yes or no filtered and searched')
