'use client'

/**
 * Compliance reminder for Amazon Associates / Influencers: every site or
 * app where you place affiliate links must be listed on your Amazon
 * account's approved list ("Edit Your Website, Mobile App, and Alexa
 * Skill List"). When MVP Affiliate spins up a new blog, the creator has
 * to add it there — and repeat it in every regional Associates account
 * (US, UK, CA, DE, …) they belong to. Dismissible per user.
 */

import { useEffect, useState } from 'react'
import { ShieldCheck, X, Copy, Check } from 'lucide-react'

const KEY = 'mvp_amazon_sites_reminder_dismissed'

export default function AmazonSitesReminder({ siteUrl }: { siteUrl?: string | null }) {
  const [dismissed, setDismissed] = useState(true) // assume dismissed until we read storage (no flash)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try { setDismissed(localStorage.getItem(KEY) === '1') } catch { setDismissed(false) }
  }, [])

  if (dismissed) return null

  function close() {
    try { localStorage.setItem(KEY, '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  function copyUrl() {
    if (!siteUrl) return
    navigator.clipboard.writeText(siteUrl).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  return (
    <div className="card mb-6 p-5 border border-[#ff9500]/30" style={{ background: 'linear-gradient(180deg, rgba(255,149,0,0.06) 0%, transparent 100%)' }}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-[#ff9500]/15 flex items-center justify-center flex-shrink-0">
          <ShieldCheck size={18} className="text-[#ff9500]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Amazon Associates: add your new blog to your approved sites</p>
            <button onClick={close} className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] flex-shrink-0" aria-label="Dismiss"><X size={15} /></button>
          </div>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-1 leading-relaxed">
            Amazon requires <strong>every</strong> website or app where you place affiliate links to be on your approved list. Your MVP Affiliate blog is new — add it so your links work and you get credited for sales. If you&apos;re in more than one region (US, UK, CA, DE, etc.), do this in <strong>each</strong> Associates account separately.
          </p>

          {siteUrl && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-[#86868b]">Your blog URL:</span>
              <code className="text-[11px] px-2 py-1 rounded bg-gray-100 dark:bg-white/10 text-[#1d1d1f] dark:text-[#f5f5f7]">{siteUrl}</code>
              <button onClick={copyUrl} className="inline-flex items-center gap-1 text-[11px] text-[#7C3AED] hover:underline">
                {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
            </div>
          )}

          <div className="mt-3 rounded-lg bg-white/60 dark:bg-white/5 border border-gray-100 dark:border-white/10 p-3">
            <p className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">How to add it (≈1 minute):</p>
            <ol className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed list-decimal pl-4 space-y-0.5">
              <li>Sign in to <a href="https://affiliate-program.amazon.com" target="_blank" rel="noopener noreferrer" className="text-[#7C3AED] hover:underline">Amazon Associates Central</a>.</li>
              <li>Top-right, open the menu under your email → <strong>Manage Your Account</strong>.</li>
              <li>Choose <strong>&ldquo;Edit Your Website, Mobile App, and Alexa Skill List&rdquo;</strong>.</li>
              <li>Paste your blog URL into the website list and <strong>Add</strong> / <strong>Save</strong>.</li>
              <li><strong>Repeat in every regional Associates account</strong> you&apos;re enrolled in (each region — US, UK, CA, DE, etc. — is a separate login and list).</li>
            </ol>
            <p className="text-[11px] text-[#86868b] mt-2">Skipping this can mean your links don&apos;t track — or, after the 180-day rule, account issues. Quick to do, easy to forget.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
