// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// "Work with brands" banner settings — the controls that used to live in
// Customize Blog, now co-located with the Brand Inquiries inbox (where a
// creator actually manages this feature).
//
// The banner config lives inside the shared integrations.blog_customizations
// JSONB, and POST /api/wordpress/customizations REPLACES that whole object
// (it doesn't merge on the Supabase side). So this component LOADS the full
// customizations first, edits only the brandCta slice, and saves the complete
// object back — otherwise it would wipe every other blog customization.
'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { ToggleRight, ToggleLeft, Loader2, Megaphone } from 'lucide-react'

interface BrandCtaData {
  enabled: boolean
  pillLabel: string
  headline: string
  intro: string
  mediaKitUrl: string
  mediaKitLabel: string
  inbox: boolean
  directLink: boolean
}

const DEFAULT_PILL_LABEL = 'Work with us'
const DEFAULT_HEADLINE = 'Are you a brand that wants to get featured here?'
const DEFAULT_MEDIA_KIT_LABEL = 'View my media kit'

const emptyBrandCta: BrandCtaData = {
  enabled: false,
  pillLabel: DEFAULT_PILL_LABEL,
  headline: DEFAULT_HEADLINE,
  intro: '',
  mediaKitUrl: '',
  mediaKitLabel: DEFAULT_MEDIA_KIT_LABEL,
  inbox: true,
  directLink: false,
}

// Normalize a raw brandCta blob (from the stored JSONB) into our typed shape.
function normalize(bc: Partial<BrandCtaData> | undefined | null): BrandCtaData {
  return {
    enabled: typeof bc?.enabled === 'boolean' ? bc.enabled : false,
    pillLabel: bc?.pillLabel ?? DEFAULT_PILL_LABEL,
    headline: bc?.headline ?? DEFAULT_HEADLINE,
    intro: bc?.intro ?? '',
    mediaKitUrl: bc?.mediaKitUrl ?? '',
    mediaKitLabel: bc?.mediaKitLabel ?? DEFAULT_MEDIA_KIT_LABEL,
    inbox: typeof bc?.inbox === 'boolean' ? bc.inbox : true,
    directLink: typeof bc?.directLink === 'boolean' ? bc.directLink : false,
  }
}

export default function BrandCtaSettings() {
  // The FULL customizations object, kept verbatim so save can merge brandCta
  // back into it without dropping any other blog customization.
  const [full, setFull] = useState<Record<string, unknown> | null>(null)
  const [bc, setBc] = useState<BrandCtaData>(emptyBrandCta)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/wordpress/customizations')
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>
      setFull(d && typeof d === 'object' ? d : {})
      setBc(normalize((d?.brandCta as Partial<BrandCtaData>) ?? null))
    } catch {
      setFull({})
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  function update(patch: Partial<BrandCtaData>) {
    setBc(prev => ({ ...prev, ...patch }))
  }

  async function save() {
    setSaving(true)
    try {
      // Auto-prepend https:// when they pasted a bare host ("www.example.com")
      // so the button link actually works — and reflect it back in the field.
      const url = bc.mediaKitUrl.trim()
      const normalizedUrl = url && !/^https?:\/\//i.test(url) && !/^javascript:/i.test(url)
        ? 'https://' + url.replace(/^\/+/, '')
        : url
      const bcToSave = { ...bc, mediaKitUrl: normalizedUrl }
      if (normalizedUrl !== bc.mediaKitUrl) setBc(bcToSave)
      // Merge brandCta into the full loaded object (never send brandCta alone —
      // the endpoint replaces the whole blog_customizations).
      const body = { ...(full ?? {}), brandCta: bcToSave }
      const res = await fetch('/api/wordpress/customizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) {
        toast.error(json.error || `Save failed (${res.status})`)
        return
      }
      if (json.wordpress === 'failed') {
        toast.error(json.wordpressError || 'Saved, but the push to your blog failed — check your WordPress connection.')
      } else {
        // Purge cache so the banner change appears immediately on the live blog.
        fetch('/api/wordpress/purge-cache', { method: 'POST' }).catch(() => {})
        toast.success('Saved — your blog banner is updated.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const noDestination = !bc.inbox && bc.mediaKitUrl.trim() === ''

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
            <Megaphone size={16} className="text-[#7C3AED]" /> Blog banner
          </h2>
          <p className="text-xs text-[var(--text-3)] mt-1">
            Show a discreet &quot;Work with brands&quot; banner on your blog. Brands who click it see your pitch and can reach you — via your media-kit link and/or a form that delivers straight to this inbox (no public email needed).
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[var(--text-3)] text-sm py-2">
          <Loader2 size={16} className="animate-spin" /> Loading settings…
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border-2)]">
            <div>
              <p className="text-sm font-medium text-[var(--text)]">Show the banner on my blog</p>
              <p className="text-xs text-[var(--text-3)]">A small pill near the top of every blog page.</p>
            </div>
            <button onClick={() => update({ enabled: !bc.enabled })} className="text-[var(--text-3)]" aria-label="Toggle work-with-brands banner">
              {bc.enabled ? <ToggleRight size={28} className="text-[#7C3AED]" /> : <ToggleLeft size={28} />}
            </button>
          </div>

          {bc.enabled && (
            <>
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Button on your blog</label>
                <input type="text" value={bc.pillLabel} onChange={e => update({ pillLabel: e.target.value })} maxLength={40} className="input-field w-full" placeholder={DEFAULT_PILL_LABEL} />
                <p className="text-[11px] text-[var(--text-3)] mt-1">The small pill visitors see on your blog — e.g. &quot;Work with us&quot;, &quot;For brands&quot;, &quot;Feature your brand&quot;.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Pop-up headline</label>
                <input type="text" value={bc.headline} onChange={e => update({ headline: e.target.value })} maxLength={160} className="input-field w-full" placeholder={DEFAULT_HEADLINE} />
                <p className="text-[11px] text-[var(--text-3)] mt-1">The bold line at the top of the pop-up after a brand clicks the button.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Your pitch to brands <span className="text-[var(--text-3)] font-normal">(shown in the pop-up)</span></label>
                <textarea value={bc.intro} onChange={e => update({ intro: e.target.value })} maxLength={1000} rows={3} className="input-field w-full resize-y" placeholder="A couple of lines on who you are, your audience, and what you offer brands (reviews, unboxings, dedicated videos…)." />
                <p className="text-[11px] text-[var(--text-3)] mt-1">Leave blank to skip the pop-up text.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Link URL <span className="text-[var(--text-3)] font-normal">(optional)</span></label>
                <input type="url" value={bc.mediaKitUrl} onChange={e => update({ mediaKitUrl: e.target.value })} maxLength={500} className="input-field w-full" placeholder="https://your-media-kit.com" />
                <p className="text-[11px] text-[var(--text-3)] mt-1">Where the button sends brands — a media kit, portfolio, press page, booking form, anywhere. Paste any URL.</p>
              </div>

              {bc.mediaKitUrl.trim() !== '' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">Button label</label>
                    <input type="text" value={bc.mediaKitLabel} onChange={e => update({ mediaKitLabel: e.target.value })} maxLength={60} className="input-field w-full" placeholder={DEFAULT_MEDIA_KIT_LABEL} />
                    <p className="text-[11px] text-[var(--text-3)] mt-1">The text on the button that opens your link — e.g. &quot;View my media kit&quot;, &quot;See my portfolio&quot;, &quot;Book a collab&quot;.</p>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border-2)]">
                    <div>
                      <p className="text-sm font-medium text-[var(--text)]">Link straight to it</p>
                      <p className="text-xs text-[var(--text-3)]">Skip the pop-up — the banner opens your link directly.</p>
                    </div>
                    <button onClick={() => update({ directLink: !bc.directLink })} className="text-[var(--text-3)]" aria-label="Toggle direct link">
                      {bc.directLink ? <ToggleRight size={28} className="text-[#7C3AED]" /> : <ToggleLeft size={28} />}
                    </button>
                  </div>
                </>
              )}

              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border-2)]">
                <div>
                  <p className="text-sm font-medium text-[var(--text)]">In-app contact form</p>
                  <p className="text-xs text-[var(--text-3)]">Let brands message you directly — replies land right here in Brand Inquiries. No email exposed.</p>
                </div>
                <button onClick={() => update({ inbox: !bc.inbox })} className="text-[var(--text-3)]" aria-label="Toggle in-app contact form">
                  {bc.inbox ? <ToggleRight size={28} className="text-[#7C3AED]" /> : <ToggleLeft size={28} />}
                </button>
              </div>

              {noDestination && (
                <p className="text-[11px] text-[#ff9500]">Add a media-kit link or turn on the in-app form — otherwise the banner has nowhere to send brands.</p>
              )}
            </>
          )}

          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6D28D9] disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {saving ? 'Saving…' : 'Save banner settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
