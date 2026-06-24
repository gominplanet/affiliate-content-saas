'use client'

/**
 * Segment-level error boundary for the dashboard. Without this, a single
 * client-side render error in ANY dashboard page bubbled to Next's root and
 * replaced the WHOLE document with a bare "Application error" string (no nav,
 * no way back). This catches it, keeps the user in the app, logs it, and offers
 * a retry + escape hatch.
 */
import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface to the console (and any error-tracking) so we can diagnose.
    console.error('[dashboard] page error:', error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-12 h-12 rounded-xl bg-[#ff9500]/10 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-[#ff9500]" />
        </div>
        <h2 className="text-lg font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Something went wrong on this page</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-5">
          The rest of the app is fine. Try again, or head back to your dashboard.
          {error?.digest ? <span className="block mt-1 text-[11px] text-[#86868b]">Ref: {error.digest}</span> : null}
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => reset()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9]"
          >
            <RefreshCw size={14} /> Try again
          </button>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]"
          >
            <Home size={14} /> Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
