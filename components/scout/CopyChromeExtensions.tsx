'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

/**
 * Inline `chrome://extensions` chip with a one-tap copy button.
 *
 * Chrome deliberately blocks web pages from opening `chrome://` URLs — a link or
 * `window.open` simply won't navigate there. So the smoothest thing we can offer
 * for the SCOUT "Load unpacked" flow is to let the user COPY the URL and paste it
 * into their own address bar. Used in every SCOUT install/update card.
 *
 * (Once SCOUT is live on the Chrome Web Store this whole flow goes away — the
 * "Get SCOUT" button becomes a normal https store link with one-click install.)
 */
export default function CopyChromeExtensions() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText('chrome://extensions/')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked (rare) — the URL text is still visible to select by hand */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy — Chrome won't let a link open this, so paste it into your address bar"
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[0.95em] align-baseline bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors cursor-pointer"
    >
      chrome://extensions
      {copied
        ? <Check size={11} className="text-green-500" />
        : <Copy size={11} className="opacity-50" />}
      <span className="sr-only">{copied ? 'Copied' : 'Copy chrome://extensions'}</span>
    </button>
  )
}
