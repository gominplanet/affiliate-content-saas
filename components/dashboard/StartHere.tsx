// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT DO YOU WANT TO DO? (Seb, 2026-10-19: "under the welcome back ... we
// should have really clear what people want to do. Is it promoting
// something? Is it creating video or uploading? ... I think drop should be
// right there to start everything.")
//
// Three ways in, at the top of the dashboard: upload finished videos (Drop,
// the one that starts everything, so it leads and stands out), make a video,
// promote a product. Each shows only the tools this plan can open; a creator
// without Drop is sent to the upload tool their plan has instead. Server
// rendered, no data of its own.

import Link from 'next/link'
import { UploadCloud, Clapperboard, Megaphone, ArrowRight } from 'lucide-react'

type Tool = { href: string; label: string }

export interface StartHereProps {
  canDrop: boolean
  videoTools: boolean
  deals: boolean
  encore: boolean
}

export default function StartHere({ canDrop, videoTools, deals, encore }: StartHereProps) {
  const upload: Tool = canDrop ? { href: '/drop', label: 'Start with Drop' }
    : videoTools ? { href: '/liftoff', label: 'Bulk Amazon upload' }
    : { href: '/co-pilot', label: 'YouTube Co-Pilot' }
  const make: Tool[] = [
    { href: '/script', label: 'Scriptwriter' },
    ...(videoTools ? [{ href: '/clip-factory', label: 'Clip Factory' }, { href: '/amazon/thumbnails', label: 'Thumbnails' }] : []),
  ]
  const promote: Tool[] = [
    ...(deals ? [{ href: '/deals', label: 'Deals Hub' }] : []),
    { href: '/content?tab=posts', label: 'Social Push' },
    ...(encore ? [{ href: '/encore', label: 'On sale (Encore)' }] : []),
  ]

  return (
    <div className="mt-8">
      <p className="text-[11px] uppercase tracking-[0.14em] font-semibold mb-3" style={{ color: 'var(--text-subtle)' }}>What do you want to do?</p>
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr] gap-3">
        {/* Upload leads: Drop starts everything after the video is made. */}
        <Link href={upload.href}
          className="group rounded-2xl p-5 flex flex-col gap-3 transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ background: 'linear-gradient(135deg, #7C3AED, #DB2777)', color: '#fff', boxShadow: '0 10px 30px rgba(124,58,237,0.28)', outlineColor: '#7C3AED' }}>
          <span className="flex items-center gap-2.5">
            <span className="grid place-items-center w-10 h-10 rounded-xl" style={{ background: 'rgba(255,255,255,0.18)' }}><UploadCloud size={20} /></span>
            <span className="text-[18px] font-semibold leading-tight">Upload finished videos</span>
          </span>
          <span className="text-[13px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.88)' }}>
            {canDrop
              ? 'Drop them in, say once where each one goes, and press Launch. YouTube, Amazon, your blog and TRYBE, from one place.'
              : 'Send your finished videos out from one place, with the details and links filled in for you.'}
          </span>
          <span className="mt-auto inline-flex items-center gap-1.5 self-start rounded-lg px-3 py-1.5 text-[13px] font-semibold" style={{ background: '#fff', color: '#7C3AED' }}>
            {upload.label} <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>

        <Choice icon={<Clapperboard size={18} />} accent="#F43F5E" title="Make a video" desc="Plan it, write the script, cut clips from a long one and make the thumbnail." tools={make} />
        <Choice icon={<Megaphone size={18} />} accent="#0EA5E9" title="Promote a product" desc="Post a deal, push your posts to your socials, or tell viewers when a product you reviewed goes on sale." tools={promote} />
      </div>
    </div>
  )
}

function Choice({ icon, accent, title, desc, tools }: { icon: React.ReactNode; accent: string; title: string; desc: string; tools: Tool[] }) {
  return (
    <div className="rounded-2xl border p-5 flex flex-col gap-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)', boxShadow: 'var(--card-shadow)' }}>
      <Link href={tools[0].href} className="group flex items-center gap-2.5">
        <span className="grid place-items-center w-10 h-10 rounded-xl" style={{ background: `${accent}1f`, color: accent }}>{icon}</span>
        <span className="text-[16px] font-semibold leading-tight group-hover:underline" style={{ color: 'var(--text)' }}>{title}</span>
      </Link>
      <span className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>{desc}</span>
      <span className="mt-auto flex flex-wrap gap-1.5">
        {tools.map((t) => (
          <Link key={t.href} href={t.href} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-semibold hover:underline"
            style={{ borderColor: `${accent}55`, color: accent, background: `${accent}0d` }}>
            {t.label}
          </Link>
        ))}
      </span>
    </div>
  )
}
