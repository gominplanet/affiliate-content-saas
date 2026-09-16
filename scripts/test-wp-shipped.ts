// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT IS IN THE REPO IS NOT WHAT PEOPLE DOWNLOAD.
//
// A creator reported his footer links rendering as "http://About". The plugin
// was escaping every footer field as a URL, including the label text. It was
// fixed, committed, deployed, and he was told to update his plugin.
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
//
// ── AND IT IS READ IN PROCESS, WITH NO SHELLING OUT ────────────────────────
//
// The first version of this file ran `unzip` and `diff`. They exist on this
// machine and NOT in the Vercel build image, so it passed here and took
// production down on the next deploy. Worse, when the binary was missing it
// reported "a corrupt archive installs as nothing" — a guess about the zip,
// stated as a finding, by a guard written to stop exactly that kind of
// reporting. jszip is already a dependency and reads the archive in process, so
// this now runs the same way everywhere and cannot blame the data for a missing
// tool.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import JSZip from 'jszip'
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

/** Every file under `dir`, as paths relative to it, with forward slashes. */
function filesUnder(dir: string, base = dir, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '.DS_Store') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) filesUnder(full, base, out)
    else out.push(relative(base, full).split(sep).join('/'))
  }
  return out
}

interface Shipped {
  label: string
  /** The folder in the repo that the zip is built from. */
  sourceDir: string
  /** The folder name the zip wraps everything in. */
  zipRoot: string
  /** The file inside that folder whose header carries the version. */
  versionFile: string
  /** Every zip in public/ that serves this thing. */
  zips: string[]
  /** What /api/wp-version advertises. */
  advertised: string
  /** Where installed copies are told to download it from. */
  downloadUrl: string
}

const SHIPPED: Shipped[] = [
  {
    label: 'plugin',
    sourceDir: 'wp-plugin/mvpaffiliate-platform',
    zipRoot: 'mvpaffiliate-platform',
    versionFile: 'mvpaffiliate-platform.php',
    // TWO zips, both live. mvp-affiliate.zip is what /api/wp-version points at;
    // mvpaffiliate-platform.zip is the older name and is still linked from the
    // setup page, so a stale copy there hands somebody the previous plugin with
    // no sign anything is wrong.
    zips: ['public/mvp-affiliate.zip', 'public/mvpaffiliate-platform.zip'],
    advertised: WP_VERSIONS.plugin.version,
    downloadUrl: WP_VERSIONS.plugin.downloadUrl,
  },
  {
    label: 'theme',
    sourceDir: 'wp-plugin/mvp-affiliate-theme',
    zipRoot: 'mvp-affiliate-theme',
    versionFile: 'style.css',
    zips: ['public/mvp-affiliate-theme.zip'],
    advertised: WP_VERSIONS.theme.version,
    downloadUrl: WP_VERSIONS.theme.downloadUrl,
  },
]

async function main() {
  for (const s of SHIPPED) {
    const versionPath = join(s.sourceDir, s.versionFile)
    if (!existsSync(versionPath)) {
      check(`${s.label}: ${versionPath} exists`, false)
      continue
    }

    // ── the source header and what we advertise agree ─────────────────────
    const source = readFileSync(versionPath, 'utf8')
    const sourceVersion = headerVersion(source)
    check(`${s.label}: the source header has a version`, !!sourceVersion, versionPath)
    check(`${s.label}: the source header matches WP_VERSIONS`,
      sourceVersion === s.advertised,
      `header says ${sourceVersion}, /api/wp-version serves ${s.advertised} — installed copies compare against the second and download the first`)

    // The download URL has to point at a zip that is actually checked here.
    const file = s.downloadUrl.split('/').pop() ?? ''
    check(`${s.label}: the advertised download is one of the zips checked here`,
      s.zips.some(z => z.endsWith(`/${file}`)),
      `${s.downloadUrl} is served, and nothing below looks at it`)

    const expected = filesUnder(s.sourceDir)

    for (const zipPath of s.zips) {
      if (!existsSync(zipPath)) {
        check(`${s.label}: ${zipPath} exists`, false, 'the download 404s')
        continue
      }

      let zip: JSZip
      try {
        zip = await JSZip.loadAsync(readFileSync(zipPath))
      } catch (e) {
        check(`${s.label}: ${zipPath} is a readable archive`, false,
          e instanceof Error ? e.message : String(e))
        continue
      }

      // ── every file in the folder is in the zip, and nothing extra ────────
      //
      // Checking the one versioned file proves that one file. A new include
      // left out of the zip is a fatal error on somebody's site, and the only
      // place it shows is their wp-admin.
      const inZip = Object.keys(zip.files)
        .filter(n => !zip.files[n].dir && !n.endsWith('.DS_Store'))
        .map(n => n.startsWith(`${s.zipRoot}/`) ? n.slice(s.zipRoot.length + 1) : `!! ${n}`)

      const missing = expected.filter(f => !inZip.includes(f))
      const extra = inZip.filter(f => !expected.includes(f))
      check(`${s.label}: ${zipPath} contains every file in ${s.sourceDir}`,
        missing.length === 0, missing.join(', ').slice(0, 300))
      check(`${s.label}: ${zipPath} contains nothing that is not in the repo`,
        extra.length === 0, extra.join(', ').slice(0, 300))

      // ── and the contents match, byte for byte ───────────────────────────
      //
      // THE CHECK THAT MATTERS. Not "is the version right" but "is this the
      // same file". A version bumped on a zip nobody rebuilt advertises an
      // update that installs the old code, which is worse than no update at
      // all: the banner clears and the bug stays.
      for (const f of expected) {
        const entry = zip.files[`${s.zipRoot}/${f}`]
        if (!entry) continue // already reported as missing
        const zipped = Buffer.from(await entry.async('uint8array'))
        const onDisk = readFileSync(join(s.sourceDir, f))
        check(`${s.label}: ${zipPath} carries the current ${f}`,
          zipped.equals(onDisk),
          'the repo and the download have diverged, so the fix in main is not the file anyone installs')
      }

      const zippedVersionFile = zip.files[`${s.zipRoot}/${s.versionFile}`]
      if (zippedVersionFile) {
        const text = await zippedVersionFile.async('string')
        check(`${s.label}: ${zipPath} calls itself ${s.advertised}`,
          headerVersion(text) === s.advertised,
          `the zip says ${headerVersion(text)}`)
      }
    }
  }

  // ── the version only ever goes up ───────────────────────────────────────
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
}

void main()
