// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Server-side Meta Conversions API (CAPI). The browser pixel in
// app/layout.tsx covers what the browser can see; this covers what it can't:
// ad blockers, iOS tracking prevention, and in-place plan upgrades (which
// never redirect through a Checkout success page at all).
//
// Every event sent here carries an `event_id`. When the browser fires the
// same event with the SAME id, Meta deduplicates the pair and counts it once.
// That is the whole reason both halves exist: server for reliability, browser
// for the fbp/fbc cookies that give Meta a good identity match.
//
// FAILURE IS LOUD ON PURPOSE. A CAPI call that quietly 400s looks exactly
// like one that worked, and we'd be optimizing ad spend against events Meta
// never received. Misconfiguration (no token) logs once and no-ops; a real
// rejection from Meta logs the error body and pages ops.

import crypto from 'crypto'
import { alertOps } from '@/lib/ops-alert'

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Same pixel as the browser tag in app/layout.tsx. Env override for staging. */
const PIXEL_ID = process.env.META_PIXEL_ID || '301488807119194'
/** System-user token with ads_management. Absent in dev/preview → no-op. */
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || ''
/** Set while validating in Events Manager → Test Events, then unset. */
const TEST_EVENT_CODE = process.env.META_CAPI_TEST_EVENT_CODE || ''

/** Meta requires user identifiers to be SHA-256 of the normalized value. */
function hash(value: string | null | undefined): string | undefined {
  const v = (value || '').trim().toLowerCase()
  if (!v) return undefined
  return crypto.createHash('sha256').update(v).digest('hex')
}

export interface MetaCapiEvent {
  /** Standard event name, e.g. 'Purchase', 'Lead', 'InitiateCheckout'. */
  eventName: string
  /** Dedup key. MUST match the browser event's eventID for the same action. */
  eventId: string
  /** Purchase value in major units (dollars), not cents. */
  value?: number
  currency?: string
  email?: string | null
  /** Our own stable user id (Supabase user_id). Hashed like email. */
  externalId?: string | null
  /** Page the action happened on, when known. */
  eventSourceUrl?: string | null
  /** _fbp / _fbc browser cookies. Meaningfully improve match quality. */
  fbp?: string | null
  fbc?: string | null
  clientIpAddress?: string | null
  clientUserAgent?: string | null
  /** Extra custom_data, e.g. { tier: 'studio' }. */
  custom?: Record<string, unknown>
}

/**
 * Send one event to the Conversions API.
 *
 * Never throws: a tracking failure must not roll back a Stripe webhook or
 * break a checkout. Returns true only when Meta actually accepted the event,
 * so callers can log the real outcome rather than the attempt.
 */
export async function sendMetaEvent(e: MetaCapiEvent): Promise<boolean> {
  if (!ACCESS_TOKEN) {
    // Expected in dev/preview. Say which event was dropped so a missing token
    // in production is visible in logs rather than looking like silence.
    console.info(`[meta-capi] no META_CAPI_ACCESS_TOKEN — skipped ${e.eventName} (${e.eventId})`)
    return false
  }

  const userData: Record<string, unknown> = {}
  const em = hash(e.email)
  if (em) userData.em = [em]
  const extId = hash(e.externalId)
  if (extId) userData.external_id = [extId]
  if (e.fbp) userData.fbp = e.fbp
  if (e.fbc) userData.fbc = e.fbc
  if (e.clientIpAddress) userData.client_ip_address = e.clientIpAddress
  if (e.clientUserAgent) userData.client_user_agent = e.clientUserAgent

  const customData: Record<string, unknown> = { ...(e.custom || {}) }
  if (typeof e.value === 'number') {
    customData.value = e.value
    customData.currency = e.currency || 'USD'
  }

  const payload = {
    data: [{
      event_name: e.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: e.eventId,
      action_source: 'website',
      ...(e.eventSourceUrl ? { event_source_url: e.eventSourceUrl } : {}),
      user_data: userData,
      ...(Object.keys(customData).length ? { custom_data: customData } : {}),
    }],
    ...(TEST_EVENT_CODE ? { test_event_code: TEST_EVENT_CODE } : {}),
  }

  try {
    const res = await fetch(`${GRAPH}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Callers await this inside a Stripe webhook and inside checkout. Neither
      // can afford to hang on Meta being slow: a stalled webhook makes Stripe
      // retry, and a stalled checkout leaves the user staring at a dead button.
      // Losing one tracking event is strictly better than either.
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[meta-capi] ${e.eventName} rejected ${res.status}: ${body.slice(0, 400)}`)
      // Only page ops for a Purchase. A dropped Lead is noise; a dropped
      // Purchase means ad optimization is running on incomplete revenue data.
      if (e.eventName === 'Purchase') {
        void alertOps(
          'Meta Conversions API rejected a Purchase event',
          `event_id ${e.eventId}, HTTP ${res.status}. Ad optimization is now missing this sale. Response: ${body.slice(0, 500)}`,
        )
      }
      return false
    }
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[meta-capi] ${e.eventName} request failed: ${msg}`)
    if (e.eventName === 'Purchase') {
      void alertOps('Meta Conversions API request failed for a Purchase event', `event_id ${e.eventId}: ${msg}`)
    }
    return false
  }
}

/**
 * Dedup key for a subscription purchase.
 *
 * Keyed on the Stripe object id so the browser and the server independently
 * derive the SAME id without passing one to the other: Checkout puts the
 * session id in the success URL, and the webhook has it on the event.
 */
export function purchaseEventId(stripeObjectId: string): string {
  return `stripe_${stripeObjectId}`
}
