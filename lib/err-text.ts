// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// errText — normalize an unknown thrown value into a readable string.
// Prevents the "[object Object]" UI bug when a route serializes a
// non-string error. Used everywhere we catch + surface to toast/UI.
//
// Lifted out of app/(dashboard)/content/page.tsx 2026-06-07 so extracted
// components (GenerateButton, VideoCard) can share it without
// re-importing the page they came from.
export function errText(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const m = e as { message?: unknown; error?: unknown }
    if (typeof m.message === 'string') return m.message
    if (typeof m.error === 'string') return m.error
    try { return JSON.stringify(e) } catch { /* ignore */ }
  }
  return ''
}
