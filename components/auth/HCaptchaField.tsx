'use client'

// hCaptcha widget for the auth forms (signup / login / password reset).
//
// SAFE-ROLLOUT: the widget renders ONLY when NEXT_PUBLIC_HCAPTCHA_SITE_KEY is
// set. With it unset, `captchaRequired` is false and the forms behave exactly as
// before — so deploying this code does NOT break auth even if the env var or the
// Supabase "Enable Captcha protection" toggle aren't configured yet. The correct
// launch order is: set the env var + deploy (widget appears, sends a token) →
// THEN flip the Supabase toggle on (it starts requiring the token). Reverse that
// order and Supabase would reject every token-less auth call.

import HCaptcha from '@hcaptcha/react-hcaptcha'
import { forwardRef } from 'react'

export const HCAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY || ''
/** True when a site key is configured — gates both the widget and the form's
 *  "complete the captcha first" guard. */
export const captchaRequired = !!HCAPTCHA_SITE_KEY

interface Props {
  onVerify: (token: string) => void
  onExpire?: () => void
}

/** Renders the hCaptcha challenge. Forward the ref so the parent can call
 *  `ref.current?.resetCaptcha()` after a submit (tokens are single-use). */
const HCaptchaField = forwardRef<HCaptcha, Props>(function HCaptchaField({ onVerify, onExpire }, ref) {
  if (!HCAPTCHA_SITE_KEY) return null
  return (
    <div className="flex justify-center">
      <HCaptcha
        ref={ref}
        sitekey={HCAPTCHA_SITE_KEY}
        onVerify={onVerify}
        onExpire={onExpire}
        onChalExpired={onExpire}
      />
    </div>
  )
})

export default HCaptchaField
