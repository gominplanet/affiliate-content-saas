/**
 * Public landing page shown after a one-click unsubscribe. The
 * /api/newsletter/unsubscribe route redirects here on success. Includes a
 * small "did this by mistake?" hint so a misclick is recoverable (the user
 * can re-sign-up through the original blog form).
 *
 * RSC by design — same reasoning as /newsletter-confirmed.
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle } from 'lucide-react'

export const metadata: Metadata = {
  title: "Unsubscribed — MVP Affiliate",
  robots: { index: false, follow: false },
}

export default function NewsletterUnsubscribedPage() {
  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#000] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-sm p-8 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-[#8e8e93]/10 flex items-center justify-center">
          <CheckCircle size={26} className="text-[#8e8e93]" />
        </div>
        <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">You&apos;re unsubscribed.</h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-6">
          You won&apos;t receive any more emails from this newsletter. Sorry to see you go!
        </p>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-6">
          Did this by mistake? Just sign up again on the original blog page — it&apos;ll work the same way.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#0071e3] hover:bg-[#0062c4] transition-colors"
        >
          Back to the site
        </Link>
      </div>
    </div>
  )
}
