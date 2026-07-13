'use client'

// Cloudflare Turnstile widget for the auth forms (signup / login / reset).
//
// Self-contained: loads the Turnstile script and renders via its explicit API,
// so there's no extra npm dependency to install. The widget renders ONLY when
// NEXT_PUBLIC_TURNSTILE_SITE_KEY is set — with it unset, `captchaRequired` is
// false and the forms behave exactly as before (safe rollout: set the env var
// + deploy FIRST so the widget mints tokens, THEN switch Supabase's captcha
// provider to Turnstile + paste the secret; the reverse order would make
// Supabase reject every token-less auth call).
//
// The token this produces is passed to supabase.auth.* as `captchaToken`,
// exactly like the old hCaptcha flow — Supabase verifies it against the secret
// configured under Auth → Attack Protection → Captcha (provider: Turnstile).

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''
/** True when a site key is configured — gates both the widget and the form's
 *  "complete the captcha first" guard. */
export const captchaRequired = !!TURNSTILE_SITE_KEY

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}
declare global {
  // eslint-disable-next-line no-var
  interface Window { turnstile?: TurnstileApi }
}

// Load the Turnstile script once per page, shared across widget instances.
let scriptPromise: Promise<void> | null = null
function loadTurnstile(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Turnstile failed to load'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

export interface TurnstileHandle { reset: () => void }

interface Props {
  onVerify: (token: string) => void
  onExpire?: () => void
}

const TurnstileField = forwardRef<TurnstileHandle, Props>(function TurnstileField({ onVerify, onExpire }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (window.turnstile && widgetIdRef.current) window.turnstile.reset(widgetIdRef.current)
    },
  }), [])

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let cancelled = false
    loadTurnstile()
      .then(() => {
        // Guard against double-render (React strict mode double-invokes effects).
        if (cancelled || !containerRef.current || !window.turnstile || widgetIdRef.current) return
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token: string) => onVerify(token),
          'expired-callback': () => onExpire?.(),
          'error-callback': () => onExpire?.(),
          // Auto-recover from the transient "Verification failed" flicker instead
          // of sitting there until the user retries: retry the challenge on
          // failure and silently refresh an expired token. The form also queues
          // the submit until a token lands, so this + that = no dead-ends.
          retry: 'auto',
          'retry-interval': 2000,
          'refresh-expired': 'auto',
          theme: 'auto',
        })
      })
      .catch(() => { /* script blocked — the form's captchaRequired guard still applies */ })
    return () => {
      cancelled = true
      if (window.turnstile && widgetIdRef.current) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* already gone */ }
        widgetIdRef.current = null
      }
    }
    // onVerify / onExpire are stable state setters — render the widget once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!TURNSTILE_SITE_KEY) return null
  return (
    <div className="flex justify-center">
      <div ref={containerRef} />
    </div>
  )
})

export default TurnstileField
