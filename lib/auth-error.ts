// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Human-friendly auth error messages for the login / signup / reset forms.
// Supabase surfaces raw provider errors (e.g. hCaptcha's "captcha protection:
// request disallowed (sitekey-secret-mismatch)") straight through — meaningless
// to a user, and often a server-side config issue they can do nothing about.
// Map the ones we know to a clear message + a real next step (email support).

export const SUPPORT_EMAIL = 'support@mvpaffiliate.io'

export function friendlyAuthError(message: string | null | undefined): string {
  const m = (message || '').toLowerCase()
  // hCaptcha / Supabase captcha failures — usually a sitekey↔secret mismatch or
  // an expired token. The user can't fix it, so point them at support.
  if (m.includes('captcha')) {
    return `We couldn't complete the security check — this is on our end, not yours. Email ${SUPPORT_EMAIL} and we'll get you signed in right away.`
  }
  if (m.includes('invalid login credentials')) {
    return "That email or password doesn't match. Double-check them, or use “Forgot password?” to reset."
  }
  if (m.includes('email not confirmed')) {
    return 'Please confirm your email first — check your inbox (and spam) for the confirmation link.'
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many attempts — please wait a minute and try again.'
  }
  return message || 'Something went wrong. Please try again.'
}
