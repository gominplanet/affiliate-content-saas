// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Brand page: where product pins go, the Pinterest tracking ID, and the
// Pinterest site claim code.
//
// Pinterest refuses short and redirect links, so every choice here is a real
// page. Each save says what actually happened: saved, not saved and why, or
// (for the claim code) whether WordPress took the tag.
'use client'

import { useEffect, useState } from 'react'
import { Loader2, Check, AlertTriangle } from 'lucide-react'
import { pinterestClaimCode, withClaimTag, type PinProductDest } from '@/lib/pinterest-destination'

const OPTIONS: Array<{ value: PinProductDest; label: string; hint: string }> = [
  { value: 'auto', label: 'Automatic', hint: 'Your blog post about the product if there is one, else its page on your Link in Bio, else Amazon directly.' },
  { value: 'blog_post', label: 'My blog post', hint: 'Best for your own site and search traffic. When there is no post about the product yet, the next choice in Automatic is used.' },
  { value: 'link_in_bio', label: 'The product’s page on my Link in Bio', hint: 'A page for that one product: its photo, the buy button with your link (country routing included), your review and video. MVP adds the product to the page before pinning.' },
  { value: 'amazon', label: 'Amazon directly', hint: 'The full amazon.com product link with your tag. Fewest clicks to a sale, but no country routing: everyone lands on amazon.com.' },
]

type Note = { ok: boolean; text: string } | null

export default function PinterestPinSettings() {
  const [loaded, setLoaded] = useState(false)
  const [pref, setPref] = useState<PinProductDest>('auto')
  const [tag, setTag] = useState('')
  const [mainTag, setMainTag] = useState('')
  const [migrated, setMigrated] = useState(true)
  const [claim, setClaim] = useState('')
  const [currentClaim, setCurrentClaim] = useState<string | null>(null)
  const [metaTags, setMetaTags] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [note, setNote] = useState<Note>(null)
  const [claimNote, setClaimNote] = useState<Note>(null)

  useEffect(() => {
    fetch('/api/pinterest/settings').then((r) => r.json()).then((j) => {
      setPref(j.pref || 'auto'); setTag(j.pinterestTag || ''); setMainTag(j.mainTag || '')
      setMigrated(j.migrated !== false); setCurrentClaim(j.claimCode || null); setMetaTags(Array.isArray(j.headMetaTags) ? j.headMetaTags : [])
    }).catch(() => setNote({ ok: false, text: 'Could not load your Pinterest settings.' })).finally(() => setLoaded(true))
  }, [])

  async function save() {
    setSaving(true); setNote(null)
    try {
      const r = await fetch('/api/pinterest/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pref, pinterestTag: tag }) })
      const j = await r.json().catch(() => ({}))
      setNote(r.ok && j.ok ? { ok: true, text: 'Saved. New pins follow it.' } : { ok: false, text: j.error || `Not saved (HTTP ${r.status}).` })
    } catch { setNote({ ok: false, text: 'Could not reach the server. Nothing was saved.' }) }
    setSaving(false)
  }

  async function saveClaim(remove = false) {
    const code = remove ? null : pinterestClaimCode(claim)
    if (!remove && !code) { setClaimNote({ ok: false, text: 'That is not a Pinterest claim code. Paste the code, or the whole <meta name="p:domain_verify" ...> tag Pinterest shows you.' }); return }
    setClaiming(true); setClaimNote(null)
    try {
      const nextTags = withClaimTag(metaTags, code)
      const r = await fetch('/api/wordpress/customizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ headMetaTags: nextTags }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setClaimNote({ ok: false, text: j.error || `Not saved (HTTP ${r.status}).` }); return }
      setMetaTags(nextTags); setCurrentClaim(code); setClaim('')
      setClaimNote(j.wordpress === 'pushed'
        ? { ok: true, text: remove ? 'Removed from your site.' : 'On your site now. Go back to Pinterest and press Claim (or Verify).' }
        : j.wordpress === 'not_connected'
          ? { ok: false, text: 'Saved in MVP, but no WordPress site is connected, so it is not on your site yet.' }
          : { ok: false, text: `Saved in MVP, but WordPress did not take it: ${j.wordpressError || 'unknown error'}` })
    } catch { setClaimNote({ ok: false, text: 'Could not reach the server. Nothing was changed.' }) }
    setClaiming(false)
  }

  const Line = ({ n }: { n: Note }) => n && (
    <p className={`mt-1.5 text-[11px] flex items-start gap-1 ${n.ok ? 'text-[#248a3d]' : 'text-[#d70015]'}`}>
      {n.ok ? <Check size={12} className="shrink-0 mt-px" /> : <AlertTriangle size={12} className="shrink-0 mt-px" />}{n.text}
    </p>
  )

  if (!loaded) return <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4 mb-3 text-xs text-[#86868b] flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Loading Pinterest settings…</div>

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 p-4 mb-3 flex flex-col gap-4">
      <div>
        <span className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Product pins link to</span>
        <div className="flex flex-col gap-1.5">
          {OPTIONS.map((o) => (
            <label key={o.value} className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="pin-dest" checked={pref === o.value} onChange={() => setPref(o.value)} className="mt-0.5 accent-[#E60023]" />
              <span className="text-xs">
                <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{o.label}</span>
                <span className="block text-[11px] text-[#86868b] dark:text-[#8e8e93]">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-[#86868b] dark:text-[#8e8e93]">
          For Deal Radar, Amazon and blog pins. Pinterest blocks short and redirect links (it blocked mvpl.ink), so pins never use them. Each blog pin can still be changed in its preview.
        </p>
      </div>

      <div>
        <span className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Pinterest tracking ID <span className="font-normal text-[#86868b]">(optional)</span></span>
        <input value={tag} onChange={(e) => setTag(e.target.value.trim())} placeholder={mainTag ? `${mainTag.replace(/-20$/, '')}-pin-20` : 'yourtag-pin-20'} className="input-field text-xs w-full" />
        <p className="mt-1 text-[11px] text-[#86868b] dark:text-[#8e8e93]">
          Used on pins that go straight to Amazon, so Amazon&apos;s reports show what Pinterest earns. Make one in Amazon Associates under Tools, then Tracking ID Manager. Empty uses your main tag{mainTag ? ` (${mainTag})` : ''}.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={saving || !migrated} className="btn-primary text-xs disabled:opacity-40">
          {saving ? <Loader2 size={12} className="animate-spin" /> : null} Save Pinterest settings
        </button>
        {!migrated && <span className="text-[11px] text-[#ff9500]">Needs migration 382 before these can be saved.</span>}
      </div>
      <Line n={note} />

      <div className="border-t border-gray-200 dark:border-white/10 pt-3">
        <span className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Claim your blog on Pinterest</span>
        <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-1.5">
          In Pinterest, go to Settings, Claimed accounts, Claim your website, and choose the HTML tag. Paste the code (or the whole tag) here and MVP adds it to your site. Then press Claim in Pinterest. A claimed site shows your profile on its pins and gives you pin stats.
        </p>
        {currentClaim && <p className="text-[11px] text-[#248a3d] mb-1.5">On your site now: {currentClaim}</p>}
        <div className="flex flex-wrap gap-2">
          <input value={claim} onChange={(e) => setClaim(e.target.value)} placeholder='<meta name="p:domain_verify" content="..."/>' className="input-field text-xs flex-1 min-w-[220px]" />
          <button type="button" onClick={() => saveClaim(false)} disabled={claiming || !claim.trim()} className="btn-secondary text-xs disabled:opacity-40">
            {claiming ? <Loader2 size={12} className="animate-spin" /> : null} Add to my site
          </button>
          {currentClaim && <button type="button" onClick={() => saveClaim(true)} disabled={claiming} className="text-xs text-[#86868b] hover:text-[#ff3b30]">Remove</button>}
        </div>
        <Line n={claimNote} />
      </div>
    </div>
  )
}
