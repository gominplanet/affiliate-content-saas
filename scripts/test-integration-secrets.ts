// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// If a secret column is encrypted at rest, every reader must decrypt it.
//
// The integrations row holds a creator's OAuth tokens, their Geniuslink API key
// and secret, and their Hostinger API key. Writes go through
// encryptIntegrationWrite, which encrypts anything named in
// INTEGRATION_SECRET_COLUMNS. Reads are supposed to come back through
// decryptIntegrationRow.
//
// Nothing enforced the read side. That is a dangerous asymmetry, because adding
// a column to the encrypted list is a one-line change with a platform-wide
// blast radius: every route still reading that column raw starts handing
// ciphertext to the API it belongs to, and the creator sees "my links stopped
// working" with no error anywhere near the cause. This codebase has already lost
// a day to one variant of that, when a column named in a select took Geniuslink
// down for everyone.
//
// So this test is the safety net for exactly that change. It reads every route
// that SELECTs a secret column and requires it to decrypt before use. It is not
// checking that encryption works, which is unit-testable and boring; it is
// checking that the two halves of the scheme cannot drift, which is the thing
// that actually breaks.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { INTEGRATION_SECRET_COLUMNS } from '../lib/integration-secrets'
import { encryptSecret, decryptSecret, isEncrypted } from '../lib/secrets'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname
const files: string[] = []
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    if (['node_modules', '.next', '.git'].includes(e)) continue
    const f = join(d, e)
    if (statSync(f).isDirectory()) walk(f)
    else if (/\.tsx?$/.test(e)) files.push(f)
  }
}
for (const d of ['app', 'lib', 'services']) walk(join(root, d))

// ── the round trip, and the legacy path that makes rollout safe ─────────────
// A row written before a column joined the encrypted list is plain text. If
// decrypt did not pass those through untouched, adding a column would break
// every existing account at once rather than migrating them on next write.
{
  process.env.SECRETS_KEY ||= Buffer.alloc(32, 7).toString('base64')
  const plain = 'gl_live_abc123'
  let ct = ''
  try { ct = encryptSecret(plain) } catch { /* no key configured in this env */ }
  if (ct) {
    check('an encrypted value round-trips', decryptSecret(ct) === plain)
    check('and is recognisable as encrypted', isEncrypted(ct))
  }
  check('a legacy plaintext value survives decrypt untouched',
    decryptSecret(plain) === plain,
    'without this, adding a column to the list breaks every row already stored')
  check('plaintext is not mistaken for ciphertext', !isEncrypted(plain))
  check('empty stays empty', decryptSecret('') === '' && decryptSecret(null) === '')
}

// ── the three that were plain text ──────────────────────────────────────────
{
  for (const col of ['geniuslink_api_key', 'geniuslink_api_secret', 'hostinger_api_key']) {
    check(`${col} is encrypted at rest`,
      (INTEGRATION_SECRET_COLUMNS as readonly string[]).includes(col),
      'it sat in plain text beside encrypted OAuth tokens in the same row')
  }
}

/** Files allowed to read a secret column without decrypting, with the reason. */
const EXEMPT = new Map<string, string>([
  ['lib/integration-secrets.ts', 'defines the encrypt and decrypt helpers'],
  ['lib/secrets.ts', 'the cipher itself'],
  ['lib/types/database.ts', 'generated types, no runtime reads'],
])

/** A read is safe when the file decrypts the row, decrypts the field, or only
 *  tests the column for presence (`!!row.x`) without using the value. */
function readsSafely(src: string, col: string): boolean {
  if (/decryptIntegrationRow|decryptIntegrationsRow/.test(src)) return true
  const usesValue = new RegExp(`maybeDecrypt\\([^)]*${col}|decryptSecret\\([^)]*${col}`).test(src)
  if (usesValue) return true
  // Presence-only: every mention of the column is inside a truthiness test or a
  // boolean assignment, so the value itself never leaves the route.
  const mentions = [...src.matchAll(new RegExp(`[^\\n]*\\b${col}\\b[^\\n]*`, 'g'))].map(m => m[0])
  const nonSelect = mentions.filter(l => !/\.select\(|^\s*\*|^\s*\/\/|:\s*string \| null|\?:\s*string/.test(l))
  if (nonSelect.length === 0) return true
  return nonSelect.every(l => /!!|Boolean\(|connected|hasGeniuslink|geniuslinkSet|affiliateConnected|setHasGeniuslink|if \(!/.test(l))
}

/** The columns this test polices.
 *
 *  Deliberately NOT every encrypted column. The OAuth tokens have been
 *  encrypted for months and their readers evidently work, so scanning them
 *  produces only false positives: routes that select a token to test whether an
 *  account is connected, or to write it straight back, never touching the value.
 *  Flagging those would bury the signal.
 *
 *  These three are the ones that just changed from plain text to encrypted, so
 *  these are the reads that could break, and this list is what makes that change
 *  safe to make. Anything added to INTEGRATION_SECRET_COLUMNS later belongs here
 *  too, for the same one commit. */
const NEWLY_ENCRYPTED = ['geniuslink_api_key', 'geniuslink_api_secret', 'hostinger_api_key'] as const

// ── every reader of a newly encrypted column decrypts it ────────────────────
{
  const offenders: string[] = []
  for (const f of files) {
    const rel = f.replace(root, '')
    if (EXEMPT.has(rel)) continue
    const src = readFileSync(f, 'utf8')
    for (const col of NEWLY_ENCRYPTED) {
      // Only a NAMED select counts. select('*') hands the whole row on and is
      // covered by whether the file decrypts the row.
      if (!new RegExp(`\\.select\\([^)]*\\b${col}\\b`).test(src)) continue
      if (readsSafely(src, col)) continue
      offenders.push(`${rel} reads ${col} without decrypting it`)
    }
  }
  for (const o of offenders) {
    check(o, false, 'the value goes to the provider as-is, so ciphertext would read as a wrong key')
  }
}

// ── the write side stays routed through the encryptor ───────────────────────
{
  const callback = readFileSync(join(root, 'app/api/auth/twitter/callback/route.ts'), 'utf8')
  check('OAuth callbacks still write through encryptIntegrationWrite',
    /encryptIntegrationWrite/.test(callback))

  for (const [file, why] of [
    ['app/api/affiliate-links/save/route.ts', 'the Brand Profile link settings'],
    ['app/api/amazon/affiliate-setup/route.ts', 'the Amazon affiliate modal'],
    ['app/api/hostinger/subscriptions/route.ts', 'the Hostinger connect step'],
  ] as const) {
    const src = readFileSync(join(root, file), 'utf8')
    check(`${why} encrypts what it saves`, /encryptIntegrationWrite\(/.test(src))
  }
}

// ── no browser may write a secret column ────────────────────────────────────
// The encryption key lives on the server. A client component writing straight
// to the table stores plain text, which silently exempts everyone who used that
// screen from the encryption. Three screens did exactly that: the Setup page and
// two paths in the onboarding funnel.
{
  const clientFiles = files.filter(f => /\.tsx$/.test(f) && /^'use client'|^"use client"/.test(readFileSync(f, 'utf8').trimStart()))
  check('there are client components to check', clientFiles.length > 10)
  for (const f of clientFiles) {
    const src = readFileSync(f, 'utf8')
    if (!/\.from\(\s*['"]integrations['"]\s*\)/.test(src)) continue
    for (const col of INTEGRATION_SECRET_COLUMNS) {
      // A write is the column appearing as an object key, which is how it would
      // be passed to upsert/update/insert. Reading one is a separate concern.
      //
      // `col: null` is exempt on purpose. That is a disconnect clearing the
      // credential, and there is no secret in a null. The Setup page's reset
      // button does exactly this and is fine.
      //
      // The value is captured and inspected rather than excluded with a
      // lookahead: `col:\s*(?!null)` looks right and is not, because \s* can
      // backtrack to zero width and satisfy the lookahead against the space.
      const values = [...src.matchAll(new RegExp(`${col}\\s*:\\s*([^,\\n}]+)`, 'g'))].map(m => m[1].trim())
      const writes = values.some(v => v !== 'null')
      check(
        `${f.replace(root, '')} does not write ${col} from the browser`,
        !writes,
        'the browser cannot encrypt, so this would store the credential in plain text; POST it to a server route instead',
      )
    }
  }
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
