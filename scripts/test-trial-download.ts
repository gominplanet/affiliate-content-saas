// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A trial account has to be able to take its design away.
//
// The free trial is one loop: paste an Amazon product link, get a finished
// design with your face on it, download it. Publishing is the paywall, on
// purpose, and the landing page says so in those words: "Download everything you
// make", "then $79 a month if you want to publish from here".
//
// The design composers had no download button. The only action was Publish,
// which is disabled on a free account because it has no connected social. So a
// trial user generated one of their five designs, found both buttons unusable,
// and the trial ended there, one step short of the thing the ad promised.
//
// The thumbnail page did have one, and it did not work either: an <a download>
// pointing at fal's CDN. The download attribute is ignored cross-origin, so the
// browser navigated to the image instead of saving it.
//
// Both are asserted here because both are the same failure: the free half of the
// loop has no exit.
import { readFileSync } from 'node:fs'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const DL = readFileSync('components/amazon/DownloadDesign.tsx', 'utf8')

// ── every surface that makes a design offers a way to keep it ───────────────
{
  const SURFACES = [
    ['components/amazon/PostComposer.tsx', 'Instagram and Facebook designs'],
    ['components/amazon/PinterestComposer.tsx', 'pins'],
    ['app/(dashboard)/amazon/thumbnails/page.tsx', 'thumbnails'],
  ] as const

  for (const [file, what] of SURFACES) {
    const src = readFileSync(file, 'utf8')
    check(`${what} can be downloaded`, /<DownloadDesign/.test(src),
      'a generated design with no way to save it is where the free trial dies')
  }

  // On the composers it must NOT be gated on a connection, because not having
  // one is the whole state a trial account is in.
  for (const file of ['components/amazon/PostComposer.tsx', 'components/amazon/PinterestComposer.tsx']) {
    const src = readFileSync(file, 'utf8')
    const tag = src.slice(src.indexOf('<DownloadDesign'), src.indexOf('/>', src.indexOf('<DownloadDesign')))
    check(`${file} does not gate the download on a connected account`,
      !/connected/.test(tag), tag)
    // And it sits BEFORE the publish button, so it is the first thing they see
    // rather than something below a disabled control.
    check(`${file} offers the download before the paywalled action`,
      src.indexOf('<DownloadDesign') < src.indexOf('onClick={publish}'),
      'below a greyed-out Publish is where a button goes unread')
  }
}

// ── it saves a file rather than opening a tab ───────────────────────────────
{
  check('the bytes are fetched before saving', /await fetch\(candidate\)/.test(DL),
    'an <a download> is ignored cross-origin, which is why the old one never saved anything')
  check('and saved from a blob', /createObjectURL\(blob\)/.test(DL) && /a\.download = filename/.test(DL))
  check('the proxy is tried first', /proxied\(url\), url/.test(DL),
    'same-origin removes the CORS question entirely for the CDNs it serves')

  // Safari has not finished reading the blob when click() returns, and revoking
  // immediately writes a zero-byte file.
  check('the object url is revoked on a delay', /setTimeout\(\(\) => URL\.revokeObjectURL/.test(DL),
    'revoking immediately saves an empty file in Safari')

  // The proxy allowlist in the component must not claim hosts the route will
  // refuse, or the first attempt 403s on every one of them and the fallback
  // carries the whole feature.
  const ROUTE = readFileSync('app/api/proxy-image/route.ts', 'utf8')
  const routeHosts = (ROUTE.match(/const allowed = \[([^\]]*)\]/)?.[1] ?? '')
    .split(',').map(h => h.trim().replace(/'/g, '')).filter(Boolean)
  const compHosts = (DL.match(/const ALLOWED = \[([^\]]*)\]/)?.[1] ?? '')
    .split(',').map(h => h.trim().replace(/'/g, '')).filter(Boolean)
  check('both host lists were found', routeHosts.length > 3 && compHosts.length > 3,
    `route ${routeHosts.length}, component ${compHosts.length}`)
  const overclaimed = compHosts.filter(h => !routeHosts.includes(h))
  check('the component never claims a host the proxy refuses',
    overclaimed.length === 0, overclaimed.join(','))
}

// ── a failure is visible, never silent ──────────────────────────────────────
{
  check('a failed download opens the image instead', /window\.open\(url/.test(DL))
  check('and tells the person what just happened', /toast\.info\(/.test(DL),
    'a button that silently does nothing, on the one action the trial exists for, is the worst version of this')
  check('the instruction is usable on a phone', /press and hold/i.test(DL), DL.slice(0, 0))
  check('the failure path runs for both a bad fetch and a throw',
    (DL.match(/window\.open\(url/g) || []).length >= 2,
    'the catch and the no-blob branch both have to land somewhere')
}

// ── the promise it is keeping ───────────────────────────────────────────────
{
  const JOIN = readFileSync('app/join/amazon/page.tsx', 'utf8')
  check('the ad landing still promises the download', /[Dd]ownload/.test(JOIN),
    'if that promise is ever removed, this whole file is describing the wrong product')
}

if (failures.length) {
  console.error(`\n❌ trial-download: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log('✅ trial-download: every design can be saved, from a blob rather than a link, and says so when it cannot')
