'use client'

// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Link settings, as a window from the Library toolbar. The panel itself
// (components/social/SocialLinkSettings) also lives on Your setup → Socials;
// one panel, so the two can never show different choices.

import { X, Link2 } from 'lucide-react'
import SocialLinkSettings from '@/components/social/SocialLinkSettings'

export default function SocialLinkModeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="card w-full max-w-xl p-5 bg-white dark:bg-[#18181b] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div className="flex items-center gap-2" style={{ color: 'var(--accent)' }}>
            <Link2 size={18} />
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--text)' }}>Link settings</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md" style={{ color: 'var(--text-faint)' }} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="text-[12.5px] mb-4" style={{ color: 'var(--text-soft)' }}>
          For each platform, choose whether to add your <b>affiliate link</b> and which <b>content link</b> to add: your blog post, your YouTube review video, or none. Applies when you post and when posts go out on schedule. Also in Your setup, under Connections, Socials.
        </p>
        <SocialLinkSettings variant="modal" onDone={onClose} />
      </div>
    </div>
  )
}
