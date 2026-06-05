/**
 * Email service — thin wrapper around Resend.
 *
 * Use this for any *app-level* transactional email (post-publish digests,
 * generation-failure notifications, plan-change confirmations, etc.).
 *
 * Supabase Auth emails (signup confirm, password reset, magic link) do
 * NOT go through this — they're routed via Supabase's Custom SMTP setting,
 * which is configured to use Resend's SMTP endpoint with the same domain.
 * That means everything goes out as `noreply@mvpaffiliate.io` either way.
 *
 * Required env vars:
 *   RESEND_API_KEY   — server-only, from https://resend.com/api-keys
 *   EMAIL_FROM       — e.g. "MVP Affiliate <noreply@mvpaffiliate.io>"
 *                      (defaults to noreply@ if unset)
 *
 * Required DNS (in Hostinger DNS Zone Editor for mvpaffiliate.io):
 *   - SPF, DKIM and DMARC records provided by Resend during domain verify.
 *   - See EMAIL_SETUP.md in the repo root for the full step-by-step.
 */

import { Resend } from 'resend'

const DEFAULT_FROM = 'MVP Affiliate <noreply@mvpaffiliate.io>'

let _client: Resend | null = null

function getClient(): Resend {
  if (_client) return _client
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY is not set — see EMAIL_SETUP.md')
  _client = new Resend(key)
  return _client
}

export interface SendEmailArgs {
  to: string | string[]
  subject: string
  /** HTML body. Either `html` or `text` is required. */
  html?: string
  /** Plain-text fallback. Either `html` or `text` is required. */
  text?: string
  /** Defaults to EMAIL_FROM env var, then to "MVP Affiliate <noreply@mvpaffiliate.io>". */
  from?: string
  /** Set this when the email should be a reply-to address users can actually reach. */
  replyTo?: string
  /** Raw RFC 822 headers to attach. Used by the newsletter pipeline to set
   *  List-Unsubscribe + List-Unsubscribe-Post (RFC 8058 one-click). Resend
   *  passes them through to the recipient verbatim. */
  headers?: Record<string, string>
  /** Server-side tags on the email — surfaced back in Resend's webhook
   *  payloads so we can attribute a delivered/bounced/opened/clicked event
   *  to the broadcast that fired it. Each tag is { name, value }, max 50
   *  per email per Resend's docs. We always pass at least
   *    { name: 'kind', value: '…' } and
   *    { name: 'broadcast_id', value: '…' }
   *  for newsletter sends. */
  tags?: Array<{ name: string; value: string }>
}

/**
 * Send a single transactional email through Resend.
 *
 * Returns the Resend message id on success. Throws on failure — caller
 * decides whether to retry, log, or surface to the user.
 */
export async function sendEmail(args: SendEmailArgs): Promise<{ id: string }> {
  if (!args.html && !args.text) {
    throw new Error('sendEmail: either `html` or `text` must be provided')
  }

  const client = getClient()
  const from = args.from ?? process.env.EMAIL_FROM ?? DEFAULT_FROM

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await client.emails.send({
    from,
    to: Array.isArray(args.to) ? args.to : [args.to],
    subject: args.subject,
    html: args.html,
    text: args.text,
    replyTo: args.replyTo,
    ...(args.headers ? { headers: args.headers } : {}),
    ...(args.tags ? { tags: args.tags } : {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  if (result.error) {
    throw new Error(`Resend send failed: ${result.error.message ?? JSON.stringify(result.error)}`)
  }
  return { id: result.data?.id ?? '' }
}

/**
 * Whether the email service is configured. Use this to gracefully degrade
 * in dev environments where RESEND_API_KEY isn't set, instead of throwing.
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

// ── Resend Domains API (Newsletter Milestone 2) ────────────────────────────
// Wraps the four endpoints we actually use: create, get, verify, delete.
// Lets each creator register their OWN sender subdomain
// (e.g. mail.gominreviews.com) and send from newsletter@<that>. Best
// deliverability — the creator's domain rep stays with them, not the shared
// mvpaffiliate.io pool that one bad sender could poison.

/** Single DNS record Resend hands back after creating a domain. The shape
 *  comes straight from their API — we keep their field names so it's
 *  obvious what's-from-Resend vs what's-ours. Stored as JSONB in
 *  newsletter_settings.dkim_records and surfaced in the dashboard. */
export interface ResendDnsRecord {
  /** What this record proves — 'SPF' | 'DKIM' | 'DMARC'. Shown as a header
   *  in the dashboard card so users know what each block is for. */
  record: string
  /** DNS record type — 'MX' | 'TXT'. The user pastes this into the
   *  matching "type" column of their DNS host's panel. */
  type: string
  /** Record name — e.g. 'send' or 'resend._domainkey'. Many DNS hosts want
   *  the bare subdomain (without the root domain) in the Name column;
   *  others want the FQDN. We surface a copy button for the value AS-IS
   *  and tell the user to drop the root-domain suffix if their host
   *  appends it automatically. */
  name: string
  /** TTL Resend recommends — usually "Auto" / null. */
  ttl?: string
  /** The actual record content. SPF/DMARC = a TXT string;
   *  DKIM = a long base64 public-key. */
  value: string
  /** MX priority (10 is what Resend always returns for the SPF MX). */
  priority?: number
  /** Resend's per-record verification state. We don't use this directly
   *  (we use the parent domain.status), but kept for debugging. */
  status?: string
}

/** Resend domain object — same shape they return on create/get. */
export interface ResendDomain {
  id: string
  name: string
  /** 'not_started' | 'pending' | 'verified' | 'failure' | 'temporary_failure'
   *  We normalise this into newsletter_settings.domain_status as one of
   *  'pending' | 'verified' | 'failed'. */
  status: string
  records: ResendDnsRecord[]
  region?: string
  created_at?: string
}

/** Normalise Resend's nuanced status into the three buckets the dashboard
 *  badge renders. 'failure'/'temporary_failure' → 'failed'; anything that
 *  isn't 'verified' or a failure stays 'pending'. */
export function normaliseDomainStatus(raw: string | null | undefined): 'pending' | 'verified' | 'failed' {
  if (raw === 'verified') return 'verified'
  if (raw === 'failure' || raw === 'failed' || raw === 'temporary_failure') return 'failed'
  return 'pending'
}

/** List every domain in our Resend account. Used by the /domain/resync
 *  endpoint to recover from drift: if the user's saved resend_domain_id
 *  no longer matches what's in Resend (deleted/recreated/migrated), we
 *  can find their domain by NAME and patch the ID. Returns the raw
 *  array — caller filters/maps as needed. */
export async function listResendDomains(): Promise<ResendDomain[]> {
  const client = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client as any).domains.list()
  if (result.error) {
    throw new Error(`Resend domains.list failed: ${result.error.message ?? JSON.stringify(result.error)}`)
  }
  // Resend's SDK returns { data: { data: [...] } } or { data: [...] }
  // depending on version. Normalize both shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (result.data as any)?.data ?? result.data
  return Array.isArray(raw) ? (raw as ResendDomain[]) : []
}

/** Create a domain in our Resend account. Returns the full domain object
 *  including the DNS records the user needs to add. Throws on failure so
 *  the caller can surface the specific Resend error (e.g. "domain already
 *  exists"). */
export async function createResendDomain(name: string): Promise<ResendDomain> {
  const client = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client as any).domains.create({ name })
  if (result.error) {
    throw new Error(`Resend domains.create failed: ${result.error.message ?? JSON.stringify(result.error)}`)
  }
  return result.data as ResendDomain
}

/** Fetch a domain's current state — usually called right after the user
 *  hits "Verify" so we get the latest record statuses + parent status. */
export async function getResendDomain(domainId: string): Promise<ResendDomain> {
  const client = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client as any).domains.get(domainId)
  if (result.error) {
    throw new Error(`Resend domains.get failed: ${result.error.message ?? JSON.stringify(result.error)}`)
  }
  return result.data as ResendDomain
}

/** Ask Resend to re-check our DNS records and update the domain status.
 *  Returns the post-verify domain. Idempotent — running it twice in a row
 *  is safe; the second call just refreshes the status. */
export async function verifyResendDomain(domainId: string): Promise<ResendDomain> {
  const client = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client as any).domains.verify(domainId)
  if (result.error) {
    throw new Error(`Resend domains.verify failed: ${result.error.message ?? JSON.stringify(result.error)}`)
  }
  // verify() sometimes returns only { object: 'domain', id } without the
  // full record set — fetch the full domain object so callers get records
  // and status regardless.
  return getResendDomain(domainId)
}

/** Remove a domain from our Resend account. Used when a creator changes
 *  their sender subdomain or turns the feature off entirely. */
export async function deleteResendDomain(domainId: string): Promise<void> {
  const client = getClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (client as any).domains.remove(domainId)
  if (result.error) {
    throw new Error(`Resend domains.remove failed: ${result.error.message ?? JSON.stringify(result.error)}`)
  }
}
