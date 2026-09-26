// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// mvpl.ink as a domain a reviewer can trust (lib/link-trust.ts).
//
// Pinterest blocked an mvpl.ink pin as possible spam. The case for having the
// domain reviewed rests on four things being true, not just written down: a
// visitor can see where a link goes first (CODE+), there is a published policy,
// anyone can report a link, and a report can actually switch a link off. The
// policy page makes claims about the redirect too (no page in between, no
// cookie, no IP kept), so those are checked against the code that does it.
import { readFileSync } from 'node:fs'
import { previewCode, isLinkDomainPage, codeFromReportedLink, readLinkReport, describeLinkTarget } from '../lib/link-trust'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => { if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`) }
const read = (p: string) => readFileSync(p, 'utf8')
const inOrder = (src: string, a: string, b: string) => { const i = src.indexOf(a); const j = src.indexOf(b, i + 1); return i >= 0 && j > i }

// ── the preview address ─────────────────────────────────────────────────────
check('CODE+ is a preview, in both spellings', previewCode('x7kQ2+') === 'x7kQ2' && previewCode('x7kQ2%2B') === 'x7kQ2')
check('a plain code, a page and junk are not previews',
  previewCode('x7kQ2') === null && previewCode('link-policy') === null && previewCode('ab+') === null && previewCode('+') === null)
check('the domain pages are recognised, and a link code is not one of them',
  isLinkDomainPage('/link-policy') && isLinkDomainPage('/report-a-link/') && isLinkDomainPage('/api/link-report')
  && !isLinkDomainPage('/x7kQ2') && !isLinkDomainPage('/'))

// ── reading a report ────────────────────────────────────────────────────────
check('a reported link is read however it was pasted',
  codeFromReportedLink('https://www.mvpl.ink/x7kQ2') === 'x7kQ2' && codeFromReportedLink('mvpl.ink/x7kQ2+') === 'x7kQ2'
  && codeFromReportedLink('x7kQ2') === 'x7kQ2' && codeFromReportedLink('https://www.mvpaffiliate.io/go/x7kQ2') === 'x7kQ2')
check('a link that is not ours gives no code', codeFromReportedLink('https://bit.ly/x7kQ2') === null && codeFromReportedLink('') === null)
const good = readLinkReport({ link: 'mvpl.ink/x7kQ2', reason: 'spam', details: '  ', email: 'not an email' })
check('a valid report keeps the code and reason, and drops an empty note and a bad email',
  good.ok && good.code === 'x7kQ2' && good.reason === 'spam' && good.details === null && good.email === null)
check('a report with no link or an unknown reason is refused',
  !readLinkReport({ link: 'https://example.com/x', reason: 'spam' }).ok && !readLinkReport({ link: 'x7kQ2', reason: 'whatever' }).ok)

// ── what the preview says ───────────────────────────────────────────────────
const amz = describeLinkTarget({ asin: 'b0dkpk28kw', label: 'EZbomb spice' })
check('an Amazon link is described as Amazon, with the product and a readable address',
  amz.kind === 'amazon' && amz.store === 'Amazon' && amz.address === 'amazon.com/dp/B0DKPK28KW' && amz.product === 'EZbomb spice')
const store = describeLinkTarget({ destination_url: 'https://www.brand.com/p/widget?utm=x' })
check('a store link is described by its host, without the tracking query', store.kind === 'store' && store.store === 'brand.com' && store.address === 'brand.com/p/widget')

// ── the routing on mvpl.ink ─────────────────────────────────────────────────
const MW = read('middleware.ts')
check('on mvpl.ink the pages are served before a path is read as a link code',
  inOrder(MW, 'if (isLinkDomainPage(request.nextUrl.pathname)) return NextResponse.next()', "url.pathname = `/go/${seg}`"))
check('and CODE+ goes to the preview, before it could be read as a code',
  inOrder(MW, 'url.pathname = `/link-preview/${preview}`', "url.pathname = `/go/${seg}`"))
check('every page is public, so a logged out reviewer can read it',
  ["'/link-policy'", "'/report-a-link'", "'/link-preview'", "'/api/link-report'"].every((p) => MW.includes(p)))

// ── the report is saved before it is called sent ────────────────────────────
const API = read('app/api/link-report/route.ts')
check('a report says sent only after it was saved, and says so when it was not',
  inOrder(API, "from('link_reports').insert(", "if (error) {") && inOrder(API, "if (error) {", "return back(req, { sent: '1' })\n  } catch")
  && /error: 'save'/.test(API) && /could not be saved\. Nothing was sent/.test(read('app/report-a-link/page.tsx')))
check('the operator hears about every saved report', inOrder(API, 'if (error) {', 'alertOps('))
check('the form works with no script', /<form method="post" action=\{LINK_REPORT_API\}/.test(read('app/report-a-link/page.tsx')))

// ── a report can actually switch a link off ─────────────────────────────────
const ADMIN = read('app/api/admin/link-reports/route.ts')
check('switching a link off writes the disabled flag and says when no row changed',
  /from\('passport_links'\)\.update\(\{ disabled: off \}\)\.eq\('code', code\)\.select/.test(ADMIN) && /nothing was switched/.test(ADMIN))
check('the admin routes are admin only', /tier !== 'admin'/.test(ADMIN))
const GO = read('app/go/[code]/route.ts')
check('and the redirect honours the switch', /if \(!linkIsLive\(link\)\)/.test(GO))

// ── what the policy says about the redirect is what the redirect does ───────
const POLICY = read('app/link-policy/page.tsx')
check('the policy says there is no cookie, and the redirect sets none', /It sets no cookie/.test(POLICY) && !/cookies\(|\.cookies\.set|Set-Cookie/i.test(GO))
check('the policy says no IP is kept, and the click log keeps none',
  /does\s+not record your IP address/.test(POLICY) && !/\bip\b\s*:|ip_address|x-forwarded-for/i.test(GO))
check('the policy says it is one step, and the redirect is a server 302', /straight to the store in one step/.test(POLICY) && /NextResponse\.redirect\(finalUrl, 302\)/.test(GO))
check('the preview is not indexed, the policy is', /index: false/.test(read('app/link-preview/[code]/page.tsx')) && /index: true/.test(POLICY))

console.log(failures.length ? `FAIL (${failures.length})` : '✅ link-trust: preview, policy, report form and the switch all hold')
for (const f of failures) console.log(`   • ${f}`)
process.exit(failures.length ? 1 : 0)
