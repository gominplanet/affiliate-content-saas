/**
 * Public landing page subscribers see right after clicking the
 * double-opt-in confirmation link in their email.
 *
 * RSC by design (no state, no effects, no handlers) — keeps the page fast
 * and indexable. The /api/newsletter/confirm route redirects here on success.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle } from 'lucide-react'

export const metadata: Metadata = {
  title: "You're subscribed — MVP Affiliate",
  // Don't index these — they're per-user landing pages, no SEO value.
  robots: { index: false, follow: false },
}

export default function NewsletterConfirmedPage() {
  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#000] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm p-8 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-[#34c759]/10 flex items-center justify-center">
          <CheckCircle size={26} className="text-[#34c759]" />
        </div>
        <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">You&apos;re in.</h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-6">
          Your subscription is confirmed. You&apos;ll get the next issue in your inbox the moment
          it goes out — no spam, just the good stuff.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] transition-colors"
        >
          Back to the site
        </Link>
      </div>
    </div>
  )
}
