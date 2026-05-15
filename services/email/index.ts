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

  const result = await client.emails.send({
    from,
    to: Array.isArray(args.to) ? args.to : [args.to],
    subject: args.subject,
    html: args.html,
    text: args.text,
    replyTo: args.replyTo,
  })

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
