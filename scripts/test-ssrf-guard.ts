// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A USER-SUPPLIED URL CANNOT REACH INSIDE. Bracketed IPv6 hosts, localhost
// and redirects all got past the guard (lib/ssrf-guard).
import { readFileSync } from 'node:fs'
import { assertPublicHttpUrl, SsrfBlocked } from '../lib/ssrf-guard'

const failures: string[] = []
const check = (name: string, cond: boolean) => { if (!cond) failures.push(name) }
const blocked = (u: string) => { try { assertPublicHttpUrl(u); return false } catch (e) { return e instanceof SsrfBlocked } }

for (const u of [
  'https://[::1]/', 'https://[::ffff:7f00:1]/', 'https://[::ffff:127.0.0.1]/', 'https://[fd12:3456::1]/', 'https://[fc00::1]/',
  'https://[fe80::1]/', 'https://localhost/', 'https://api.localhost/', 'https://127.0.0.1/', 'https://2130706433/',
  'https://169.254.169.254/latest/meta-data', 'https://10.0.0.5/', 'https://[64:ff9b::a9fe:a9fe]/', 'file:///etc/passwd',
]) check(`blocks ${u}`, blocked(u))
for (const u of ['https://example.com/', 'https://[2606:4700:4700::1111]/', 'https://8.8.8.8/']) check(`allows ${u}`, !blocked(u))

const R = readFileSync('services/research/index.ts', 'utf8')
check('research pages never follow a redirect unchecked', !/redirect: 'follow'/.test(R) && (R.match(/safeFetch\(/g) ?? []).length >= 3)
check('product images are fetched through the checked path', /safeFetch\(raw,/.test(readFileSync('app/api/product-image/route.ts', 'utf8')))
const P = readFileSync('app/api/proxy-image/route.ts', 'utf8')
check('the image proxy serves images only, and so a browser will not run them',
  /Not an image/.test(P) && /'X-Content-Type-Options': 'nosniff'/.test(P) && /sandbox/.test(P))

if (failures.length) {
  console.error(`❌ ssrf guard: ${failures.length} failed`)
  for (const f of failures) console.error(`   - ${f}`)
  process.exit(1)
}
console.log('✅ ssrf guard: private, bracketed and redirected addresses are refused')
