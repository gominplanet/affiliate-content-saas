'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "On TRYBE": the brand's own popup on TRYBE, where samples are requested
// (Seb, 2026-10-07). TRYBE's popup has no address of its own: the ?brand=
// link lands on the plain Discover list. So with SCOUT 1.41.8 the click asks
// SCOUT to open TRYBE and bring the brand's popup up (search, then click its
// row). Nothing is pressed. Without it, the plain link, and the title says
// it opens the list.

import { useState } from 'react'
import { toast } from 'sonner'
import { ExternalLink, Handshake, Loader2 } from 'lucide-react'
import { requestTrybeOpenBrand } from '@/lib/extension-frame'
import { sendUrl } from '@/lib/trybe-outreach'

const PURPLE = '#7C3AED'

const SAY: Record<string, string> = {
  'not-signed-in': 'TRYBE is signed out in this Chrome. Sign in, then try again.',
  'brand-not-found': 'TRYBE did not list that brand when SCOUT searched for it. The search is left in the TRYBE tab.',
  'popup-did-not-open': 'SCOUT clicked the brand but TRYBE did not open its page. It is on screen in the TRYBE tab.',
  'search-not-found': 'SCOUT could not find TRYBE’s Search Brand box.',
  'no-access': 'SCOUT is not allowed on TRYBE yet.',
}

export default function TrybeLink({ brandId, name, scout, label = 'On TRYBE' }: { brandId: string; name: string; scout: boolean; label?: string }) {
  const [opening, setOpening] = useState(false)
  const href = sendUrl(brandId, null)
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      title={scout ? 'SCOUT opens this brand on TRYBE, ready to request samples' : 'Opens TRYBE’s brand list. SCOUT 1.41.8 opens the brand itself.'}
      onClick={async (e) => {
        e.stopPropagation()
        if (!scout) return
        e.preventDefault()
        if (opening) return
        setOpening(true)
        try {
          const r = await requestTrybeOpenBrand(brandId, name)
          if (!r.ok) toast.message(SAY[r.error || ''] || `SCOUT could not open ${name} on TRYBE${r.error ? ` (${r.error})` : ''}.`)
        } finally { setOpening(false) }
      }}
      className="text-[12px] font-semibold inline-flex items-center gap-0.5" style={{ color: PURPLE }}>
      {opening ? <Loader2 size={11} className="animate-spin" /> : <Handshake size={11} />} {label} <ExternalLink size={10} />
    </a>
  )
}
