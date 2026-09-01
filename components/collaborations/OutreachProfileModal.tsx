'use client'

/**
 * OutreachProfileModal — edit the Brand Outreach Profile in place, from wherever
 * brand messaging happens (CC Campaigns, the bulk modal), instead of navigating
 * to Brand Deals. Wraps the self-contained OutreachProfileCard (which loads +
 * saves itself) in an overlay. This is the one place to change what every brand
 * message says.
 */

import { X } from 'lucide-react'
import OutreachProfileCard from '@/components/collaborations/OutreachProfileCard'

export default function OutreachProfileModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-start justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-lg my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[15px] font-bold text-white drop-shadow">Edit your brand message</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white"><X size={18} /></button>
        </div>
        <p className="text-[12px] text-white/80 mb-3 max-w-prose">
          This is the wording every brand message is built from — your greeting, credibility, offer, links and sample address. Save it once and it applies to every single and bulk message.
        </p>
        <OutreachProfileCard defaultOpen />
      </div>
    </div>
  )
}
