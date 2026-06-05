/**
 * GET /api/newsletter/domain/dns-check
 *
 * Server-side DNS diagnostic for the Sender Domain card. Resolves each
 * record Resend expects against the public DNS and reports back whether
 * we found it, didn't find it, or found a value that doesn't match.
 *
 * Why this exists: Resend's verification API tells the user "pending"
 * but never says WHICH record is the problem. Most stuck-on-pending
 * cases boil down to one of:
 *   1. Records were added at the wrong hostname (host auto-appended the
 *      root domain → user got "resend._domainkey.mail.mail.example.com"
 *      instead of "resend._domainkey.mail.example.com").
 *   2. SPF value was edited (extra spaces, wrong include, missing ~all).
 *   3. DKIM was pasted as multiple TXT chunks instead of one (Hostinger
 *      sometimes splits long values, which breaks DKIM verification).
 *   4. DNS hasn't propagated yet (most common; usually clears in 30 min).
 *
 * This endpoint surfaces which of those is happening without the user
 * needing to know dig/nslookup. Read-only — never mutates DB state.
 *
 * Auth: standard dashboard session. Only resolves records that ARE on
 * the user's own newsletter_settings row (RLS + the user_id scope).
 */

import { NextResponse } from 'next/server'
import { promises as dns } from 'node:dns'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DkimRecord {
  type: string
  name: string
  value: string
  priority?: number
  ttl?: string
  status?: string
}

interface CheckResult {
  type: string
  /** What we resolved against (e.g. "resend._domainkey.mail.example.com"). */
  hostname: string
  /** What Resend told us to look for. */
  expectedValue: string
  /** Everything we found at that hostname. Multiple values are fine for
   *  TXT (e.g. SPF + DKIM share the parent), but at most one MX. */
  foundValues: string[]
  /** 'match' = expected found verbatim. 'partial' = expected appears as
   *  a substring of a found value (covers SPF lines combined with
   *  others). 'wrong' = something was found but doesn't include the
   *  expected substring. 'not_found' = lookup returned no records of
   *  this type at this hostname. 'error' = DNS lookup errored. */
  result: 'match' | 'partial' | 'wrong' | 'not_found' | 'error'
  /** Human-readable hint for the most likely fix. */
  hint?: string
}

/**
 * Resolve the full DNS hostname for a Resend record. Resend returns the
 * name relative to the sender_domain root; we need to append the root if
 * it isn't already part of the name.
 *
 * Examples (sender_domain = "mail.example.com" → root "example.com"):
 *   "resend._domainkey.mail" → "resend._domainkey.mail.example.com"
 *   "send.mail"              → "send.mail.example.com"
 *   "resend._domainkey.mail.example.com" (already full) → unchanged
 */
function resolveFullHostname(name: string, senderDomain: string): string {
  const cleanName = name.replace(/\.$/, '')
  // Root domain = everything to the right of the leftmost label.
  // mail.gominreviews.com → gominreviews.com
  // gominreviews.com      → gominreviews.com (root sender domain)
  const senderParts = senderDomain.split('.')
  const root = senderParts.length >= 3 ? senderParts.slice(1).join('.') : senderDomain
  // If name already ends with the root, it's already fully qualified.
  if (cleanName.endsWith(`.${root}`) || cleanName === root) return cleanName
  return `${cleanName}.${root}`
}

/**
 * Score a single record by comparing the expected Resend value to what
 * DNS actually has. For TXT (DKIM/SPF), an exact match OR substring
 * match counts as found — DKIM is the giant base64 value, SPF is short.
 */
function classify(
  expected: string,
  found: string[],
  type: 'TXT' | 'MX',
): { result: CheckResult['result']; hint?: string } {
  if (found.length === 0) {
    return {
      result: 'not_found',
      hint: type === 'MX'
        ? 'No MX record at this hostname. Check that you added the row at the right Name (some hosts auto-append the root domain — if so, paste just the prefix shown).'
        : 'No TXT record at this hostname. Check the Name field — if your host appends the root domain automatically, paste just the prefix part (e.g. "send.mail" not "send.mail.yourdomain.com").',
    }
  }
  // Exact match — easiest path.
  for (const f of found) {
    const normF = f.replace(/^"|"$/g, '').trim()
    const normE = expected.trim()
    if (normF === normE) return { result: 'match' }
  }
  // Substring match — handles SPF "v=spf1 include:amazonses.com ~all"
  // appearing inside a larger combined SPF, or DKIM that was split into
  // chunks and re-joined incorrectly (rare but happens with Hostinger).
  for (const f of found) {
    const normF = f.replace(/^"|"$/g, '').trim()
    if (normF.includes(expected.trim()) || expected.trim().includes(normF)) {
      return {
        result: 'partial',
        hint: 'The expected value appears inside what DNS has, but isn\'t an exact match. This often clears once DNS caches refresh; if it persists, your host may have appended characters to the value.',
      }
    }
  }
  return {
    result: 'wrong',
    hint: `Something IS at this hostname but it doesn't match what Resend expects. Found: ${JSON.stringify(found[0]).slice(0, 120)}. Double-check the Value column on the Sender Domain card and re-paste.`,
  }
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await supabase
    .from('newsletter_settings')
    .select('sender_domain, dkim_records')
    .eq('user_id', user.id)
    .maybeSingle()
  const senderDomain = (row?.sender_domain as string | null) ?? null
  const records = (row?.dkim_records as DkimRecord[] | null) ?? null
  if (!senderDomain || !records || records.length === 0) {
    return NextResponse.json({
      error: 'No sender domain registered yet — add one first.',
    }, { status: 404 })
  }

  const results: CheckResult[] = []
  for (const rec of records) {
    const hostname = resolveFullHostname(rec.name, senderDomain)
    try {
      let foundValues: string[] = []
      if (rec.type === 'TXT') {
        // resolveTxt returns string[][] — one inner array per record,
        // joined here because DNS sometimes splits long values into
        // multiple chunks per record but they're semantically one string.
        const txt = await dns.resolveTxt(hostname)
        foundValues = txt.map(chunks => chunks.join(''))
      } else if (rec.type === 'MX') {
        const mx = await dns.resolveMx(hostname)
        foundValues = mx.map(m => m.exchange)
      } else {
        results.push({
          type: rec.type,
          hostname,
          expectedValue: rec.value,
          foundValues: [],
          result: 'error',
          hint: `Unknown record type "${rec.type}" — please contact support.`,
        })
        continue
      }
      const { result, hint } = classify(rec.value, foundValues, rec.type as 'TXT' | 'MX')
      results.push({
        type: rec.type,
        hostname,
        expectedValue: rec.value,
        foundValues,
        result,
        hint,
      })
    } catch (err) {
      // dns.resolveTxt throws ENODATA when the hostname exists but has
      // no records of the requested type, and ENOTFOUND when nothing
      // exists at all. Both mean "user hasn't added this record yet".
      const code = (err as { code?: string } | null)?.code
      const isMissing = code === 'ENODATA' || code === 'ENOTFOUND'
      results.push({
        type: rec.type,
        hostname,
        expectedValue: rec.value,
        foundValues: [],
        result: isMissing ? 'not_found' : 'error',
        hint: isMissing
          ? 'No record found at this hostname. Most common cause: your DNS host already appends the root domain to the Name field, so pasting the full "send.mail.yourdomain.com" produces "send.mail.yourdomain.com.yourdomain.com". Paste just the prefix (e.g. "send.mail").'
          : `DNS lookup error: ${err instanceof Error ? err.message : String(err)}. Could be a transient resolver issue — try the check again in 30 seconds.`,
      })
    }
  }

  // Summary booleans for the UI. Even one 'not_found' / 'wrong' blocks
  // verification; partial is a softer warning (DNS caching usually
  // settles).
  const allMatch = results.every(r => r.result === 'match' || r.result === 'partial')
  const anyMissing = results.some(r => r.result === 'not_found' || r.result === 'wrong' || r.result === 'error')

  return NextResponse.json({
    senderDomain,
    results,
    summary: {
      allMatch,
      anyMissing,
    },
  })
}
