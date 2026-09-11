// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The email field on the ad landing.
//
// It does not create the account. Signup needs a password and a captcha, and
// putting all of that on a cold ad landing is how a short page stops being
// short. What this does is take the one thing they will give a stranger, carry
// it to /signup so they never type it twice, and turn the click into a
// commitment before the longer form appears.
//
// Everything else on that page is static, so this is the only piece that ships
// JavaScript.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { trackMeta } from '@/lib/meta-pixel'

const ACCENT = '#C2410C'

export default function AmazonJoinForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [going, setGoing] = useState(false)

  function go(e: React.FormEvent) {
    e.preventDefault()
    const v = email.trim()
    setGoing(true)
    // A Lead here would double-count against the one the signup form fires, so
    // this is its own step: they started the funnel, they have not signed up.
    trackMeta('InitiateCheckout', { content_name: 'Amazon ad landing', content_category: 'amazon' })
    // An unparseable address still goes through: the signup form is where
    // validation belongs, and stopping someone on a landing page over a typo
    // they can fix on the next screen loses them for nothing.
    router.push(v ? `/signup?for=amazon&email=${encodeURIComponent(v)}` : '/signup?for=amazon')
  }

  return (
    <form onSubmit={go} className="mt-7 flex flex-col sm:flex-row gap-3 max-w-xl">
      <label htmlFor="join-email" className="sr-only">Email address</label>
      <input
        id="join-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="you@email.com"
        className="input-field flex-1 min-w-0"
      />
      <button
        type="submit"
        disabled={going}
        className="inline-flex items-center justify-center gap-1.5 h-11 px-6 rounded-xl font-bold text-sm text-white whitespace-nowrap disabled:opacity-60"
        style={{ backgroundColor: ACCENT }}
      >
        {going ? 'One moment…' : <>Start free <ArrowRight size={15} /></>}
      </button>
    </form>
  )
}
