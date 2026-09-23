// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// How long an agency invite stays good for, in one place both sides can read.
//
// WHY ITS OWN FILE. The number is enforced in lib/agency.ts, which imports
// node:crypto and the admin Supabase client, so it cannot be pulled into a
// client component without dragging the service-role key into the browser
// bundle. The screen that tells an invitee their link expired is a client
// component, so it typed "14 days" by hand instead, and a typed number beside
// an enforced one is the drift this codebase keeps paying for: the page would
// have gone on promising 14 days however long the invite actually lived.

/** Pending invites expire after this many days. Enforced in the app layer
 *  (the accept route checks `now - created_at`); the DB just stores the row
 *  indefinitely so the audit trail survives. */
export const INVITE_TTL_DAYS = 14
