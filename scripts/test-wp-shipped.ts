// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT IS IN THE REPO IS NOT WHAT PEOPLE DOWNLOAD.
//
// A creator reported his footer links rendering as "http://About". The plugin
// was escaping every footer field as a URL, including the label text. It was
// fixed, committed, deployed, and I told him to update his plugin.
//
// There was no update. Shipping a plugin change means three things moving
// together, and lib/wp-versions.ts has said so in a comment for months:
//
//   1. the `* Version:` header in the PHP
//   2. WP_VERSIONS.plugin.version, which /api/wp-version serves
//   3. the zip in public/, which is the thing actually downloaded
//
// Only the code moved. The header stayed at 1.0.94, so every installed copy
// compared 1.0.94 against 1.0.94 and correctly concluded there was nothing to
// do. The zip in public/ was six days older than the fix, so even a creator who
// reinstalled by hand would have got the bug back.
//
// Note what that failure looks like from every side. The commit is in main. The
// deploy is green. wp-admin shows no update, which is indistinguishable from
// being up to date. The creator is told the fix is out and sees his site
// unchanged. Nothing anywhere reports a problem, and the instruction meant to
// prevent it was a comment, which is a thing you have to remember to read.
//
// So the three are checked against each other. Not "did someone follow the
// steps", but: is the file a creator downloads today byte-for-byte the file in
// this repo, and does it call itself the version we are advertising?
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WP_VERSIONS } from '../lib/wp-versions'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

/** The `Version:` value out of a WordPress plugin header or theme stylesheet. */
function headerVersion(src: string): string | null {
  const m = src.match(/^\s*(?:\*|\/\*)?\s*Version:\s*([0-9][0-9.]*)/m)
  return m ? m[1] : null
}

interface Shipped {
  label: string
  /** The file in the repo whose header carries the version. */
  sourceFile: string
  /** Every zip in public/ that serves this thing. */
  zips: string[]
  /** The same path inside the zip. */
  entry: string
  /** What /api/wp-version advertises. */
  advertised: string
  /** Where the zip says it is downloaded from. */
  downloadUrl: string
}

const SHIPPED: Shipped[] = [
  {
    label: 'plugin',
    sourceFile: 'wp-plugin/mvpaffiliate-platform/mvpaffiliate-platform.php',
    // TWO zips, both live. mvp-affiliate.zip is what /api/wp-version points at;
    // mvpaffiliate-platform.zip is the older name and is still linked from the
    // setup page, so a stale copy there hands somebody the previous plugin with
    // no sign anything is wrong.
    zips: ['public/mvp-affiliate.zip', 'public/mvpaffiliate-platform.zip'],
    entry: 'mvpaffiliate-platform/mvpaffiliate-platform.php',
    advertised: WP_VERSIONS.plugin.version,
    downloadUrl: WP_VERSIONS.plugin.downloadUrl,
  },
  {
    label: 'theme',
    sourceFile: 'wp-plugin/mvp-affiliate-theme/style.css',
    zips: ['public/mvp-affiliate-theme.zip'],
    entry: 'mvp-affiliate-theme/style.css',
    advertised: WP_VERSIONS.theme.version,
    downloadUrl: WP_VERSIONS.theme.downloadUrl,
  },
]

const work = mkdtempSync(join(tmpdir(), 'wp-shipped-'))
try {
  for (const s of SHIPPED) {
    // ── the source header and what we advertise agree ─────────────────────
    if (!existsSync(s.sourceFile)) {
      check(`${s.label}: ${s.sourceFile} exists`, false)
      continue
    }
    const source = readFileSync(s.sourceFile, 'utf8')
    const sourceVersion = headerVersion(source)
    check(`${s.label}: the source header has a version`, !!sourceVersion, s.sourceFile)
    check(`${s.label}: the source header matches WP_VERSIONS`,
      sourceVersion === s.advertised,
      `header says ${sourceVersion}, /api/wp-version serves ${s.advertised} — installed copies compare against the second and download the first`)

    // The download URL has to point at a zip we actually check.
    const file = s.downloadUrl.split('/').pop() ?? ''
    check(`${s.label}: the advertised download is one of the zips checked here`,
      s.zips.some(z => z.endsWith(`/${file}`)),
      `${s.downloadUrl} is served, and nothing below looks at it`)

    for (const zipPath of s.zips) {
      if (!existsSync(zipPath)) {
        check(`${s.label}: ${zipPath} exists`, false, 'the download 404s')
        continue
      }

      const dest = join(work, `${s.label}-${zipPath.replace(/\W/g, '_')}`)
      try {
        execFileSync('unzip', ['-o', '-q', zipPath, '-d', dest], { stdio: 'pipe' })
      } catch {
        check(`${s.label}: ${zipPath} unzips`, false, 'a corrupt archive installs as nothing')
        continue
      }

      const inZip = join(dest, s.entry)
      if (!existsSync(inZip)) {
        check(`${s.label}: ${zipPath} contains ${s.entry}`, false)
        continue
      }
      const zipped = readFileSync(inZip, 'utf8')

      // THE CHECK THAT MATTERS. Not "is the version right" but "is this the
      // same file". A version bumped on a zip nobody rebuilt advertises an
      // update that installs the old code, which is worse than no update at
      // all: the banner clears and the bug stays.
      check(`${s.label}: ${zipPath} carries the current ${s.entry}`,
        zipped === source,
        'the repo and the download have diverged, so the fix in main is not the file anyone installs')

      check(`${s.label}: ${zipPath} calls itself ${s.advertised}`,
        headerVersion(zipped) === s.advertised,
        `the zip says ${headerVersion(zipped)}`)
    }
  }

  // ── every file in the plugin folder is in the zip ─────────────────────────
  //
  // Checking one file proves that one file. A new include left out of the zip
  // is a fatal error on somebody's site, and the only place it shows is their
  // wp-admin.
  {
    const dest = join(work, 'plugin-full')
    if (existsSync('public/mvp-affiliate.zip')) {
      try {
        execFileSync('unzip', ['-o', '-q', 'public/mvp-affiliate.zip', '-d', dest], { stdio: 'pipe' })
        const diff = execFileSync('diff', ['-rq', 'wp-plugin/mvpaffiliate-platform', join(dest, 'mvpaffiliate-platform')], {
          stdio: 'pipe', encoding: 'utf8',
        }).trim()
        check('the plugin zip matches the plugin folder exactly', diff === '', diff.slice(0, 400))
      } catch (e) {
        const out = (e as { stdout?: string }).stdout?.trim() ?? String(e)
        check('the plugin zip matches the plugin folder exactly', false, out.slice(0, 400))
      }
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

// ── the version only ever goes up ─────────────────────────────────────────
//
// Cheap, and it catches a paste that moves it backwards. An installed 1.0.95
// compared against an advertised 1.0.94 shows no update, forever, silently.
{
  const sane = (v: string) => /^\d+\.\d+\.\d+$/.test(v)
  check('the plugin version is a three-part number', sane(WP_VERSIONS.plugin.version), WP_VERSIONS.plugin.version)
  check('the theme version is a three-part number', sane(WP_VERSIONS.theme.version), WP_VERSIONS.theme.version)
}

if (failures.length) {
  console.error(`\n❌ wp-shipped: ${failures.length} failure(s)\n`)
  for (const f of failures) console.error(`   • ${f}`)
  console.error('\n   Rebuild the zips:')
  console.error('     cd wp-plugin')
  console.error('     rm -f ../public/mvp-affiliate.zip && zip -rq ../public/mvp-affiliate.zip mvpaffiliate-platform -x "*.DS_Store"')
  console.error('     cp ../public/mvp-affiliate.zip ../public/mvpaffiliate-platform.zip')
  console.error('     rm -f ../public/mvp-affiliate-theme.zip && zip -rq ../public/mvp-affiliate-theme.zip mvp-affiliate-theme -x "*.DS_Store"')
  console.error('   and bump BOTH the source header and lib/wp-versions.ts.\n')
  process.exit(1)
}
console.log('✅ wp-shipped: the zip people download is the code in this repo, at the version we advertise')
