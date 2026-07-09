// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /social-launch-kit — stand up a social presence in ~5 minutes. For each
// platform MVP generates the ready-to-paste copy (name, @handle, bios, category,
// keywords, first post, Pinterest boards) plus an on-brand banner + avatar, and
// walks the user through setup with deep links. v1: Facebook Page + Pinterest.
'use client'

import { useState, useRef, useEffect, type ReactNode } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Button } from '@/components/ui/button'
import {
  Rocket, Sparkles, Copy, Check, Download, ExternalLink, ListChecks, Image as ImageIcon, Lock, Upload, X,
} from 'lucide-react'
import { LAUNCH_PLATFORM_LIST, type LaunchPlatform, type PlatformSpec, type SocialKit } from '@/lib/social-launch-kit'

const EMOJI: Record<LaunchPlatform, string> = {
  facebook: '📘', pinterest: '📌', twitter: '🐦', threads: '🧵', bluesky: '🦋', linkedin: '💼',
}

export default function SocialLaunchKitPage() {
  const [kits, setKits] = useState<Partial<Record<LaunchPlatform, SocialKit>>>({})
  const [busyKit, setBusyKit] = useState<LaunchPlatform | null>(null)
  // images keyed by `${platform}:${kind}` → data URL (or remote URL fallback)
  const [images, setImages] = useState<Record<string, string>>({})
  const [busyImg, setBusyImg] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)   // set if the API 403s (non-Pro deep-link)
  // Optional per-image inspiration the user uploads, keyed by `${platform}:${kind}`.
  const [refImages, setRefImages] = useState<Record<string, string>>({})
  // Banner style per platform — how much goes on the cover.
  const [bannerStyle, setBannerStyle] = useState<Record<string, 'bold' | 'minimal'>>({})

  // Hydrate any previously-generated kits on load, so a user's saved copy +
  // images stay on the page across sessions (one saved slot per platform).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/social-launch-kit/saved')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled || !data?.saved) return
        const savedKits: Partial<Record<LaunchPlatform, SocialKit>> = {}
        const savedImages: Record<string, string> = {}
        for (const [p, v] of Object.entries(data.saved as Record<string, { kit?: SocialKit; bannerUrl?: string; avatarUrl?: string }>)) {
          if (v.kit) savedKits[p as LaunchPlatform] = v.kit
          if (v.bannerUrl) savedImages[`${p}:banner`] = v.bannerUrl
          if (v.avatarUrl) savedImages[`${p}:avatar`] = v.avatarUrl
        }
        // Don't stomp anything the user generated this session — saved is the base.
        setKits(prev => ({ ...savedKits, ...prev }))
        setImages(prev => ({ ...savedImages, ...prev }))
      } catch { /* ignore — page still works without saved data */ }
    })()
    return () => { cancelled = true }
  }, [])

  async function copy(text: string, key: string, label = 'Copied') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      toast.success(`${label} copied`)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1400)
    } catch { toast.error('Copy failed — select and copy manually.') }
  }

  function download(src: string, filename: string) {
    const a = document.createElement('a')
    a.href = src; a.download = filename; a.target = '_blank'; a.rel = 'noopener'
    document.body.appendChild(a); a.click(); a.remove()
  }

  async function generateKit(platform: LaunchPlatform) {
    setBusyKit(platform)
    try {
      const res = await fetch('/api/social-launch-kit/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      })
      const data = await res.json()
      if (!res.ok) { if (res.status === 403) setLocked(true); toast.error(data.error || 'Generation failed.'); return }
      setKits(prev => ({ ...prev, [platform]: data.kit as SocialKit }))
      toast.success(`${LAUNCH_PLATFORM_LIST.find(p => p.id === platform)?.label} kit ready`)
    } catch { toast.error('Network error — try again.') }
    finally { setBusyKit(null) }
  }

  async function generateImage(platform: LaunchPlatform, kind: 'banner' | 'avatar') {
    const key = `${platform}:${kind}`
    setBusyImg(key)
    try {
      // Feed the banner the generated copy so the designed layout reflects it.
      const kit = kits[platform]
      const res = await fetch('/api/social-launch-kit/image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform, kind, referenceImage: refImages[key],
          style: kind === 'banner' ? (bannerStyle[platform] || 'bold') : undefined,
          // Full brand brief so gpt-image-1 designs uniquely + accurately.
          headline: kit?.bioShort, about: kit?.bioLong, category: kit?.category,
          keywords: kit?.keywords, brandName: kit?.names?.[0],
        }),
      })
      const data = await res.json()
      if (!res.ok) { if (res.status === 403) setLocked(true); toast.error(data.error || 'Image generation failed.'); return }
      setImages(prev => ({ ...prev, [key]: data.image || data.imageUrl }))
    } catch { toast.error('Network error — try again.') }
    finally { setBusyImg(null) }
  }

  // Read a user-uploaded inspiration image into state (as a data URL) for a slot.
  async function pickRef(key: string, file: File | null) {
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file.'); return }
    if (file.size > 8 * 1024 * 1024) { toast.error('That image is too large (max 8MB).'); return }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file)
      })
      setRefImages(prev => ({ ...prev, [key]: dataUrl }))
      toast.success('Reference added — hit Generate to use it')
    } catch { toast.error('Could not read that image.') }
  }
  function clearRef(key: string) { setRefImages(prev => { const n = { ...prev }; delete n[key]; return n }) }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <PageHero
        title="Social Launch Kit"
        subtitle="No time to figure out Facebook, Pinterest, X, Threads, Bluesky or LinkedIn? Pick a platform and MVP hands you everything — name, bio, banner, avatar, and a step-by-step setup, ready to paste."
      />

      {locked && (
        <div className="flex items-start gap-2.5 rounded-xl px-3 py-3 mt-4" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <Lock size={16} style={{ color: '#b26a00' }} className="flex-shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
            The Social Launch Kit is available on any <b>paid plan</b>. <a href="/pricing" className="font-semibold hover:underline" style={{ color: '#7C3AED' }}>Upgrade</a> to unlock it.
          </p>
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 mt-4 mb-5"
        style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid var(--border)' }}>
        <Rocket size={16} className="text-[#7C3AED] flex-shrink-0 mt-0.5" />
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-soft)' }}>
          Everything is generated from your <a href="/brand" className="font-semibold hover:underline" style={{ color: '#7C3AED' }}>Brand Profile</a> and voice, so it sounds like you.
          You still click the final &quot;create&quot; on each platform — MVP can&apos;t make the account for you — but every field and image is done. Once it&apos;s live, connect it in <a href="/connect-socials" className="font-semibold hover:underline" style={{ color: '#7C3AED' }}>Connect Socials</a> to auto-post.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {LAUNCH_PLATFORM_LIST.map(spec => (
          <PlatformCard
            key={spec.id}
            spec={spec}
            kit={kits[spec.id]}
            busyKit={busyKit === spec.id}
            images={images}
            busyImg={busyImg}
            copied={copied}
            refImages={refImages}
            bannerStyle={bannerStyle[spec.id] || 'bold'}
            onBannerStyle={(s) => setBannerStyle(prev => ({ ...prev, [spec.id]: s }))}
            onGenerateKit={() => generateKit(spec.id)}
            onGenerateImage={(kind) => generateImage(spec.id, kind)}
            onPickRef={(kind, file) => pickRef(`${spec.id}:${kind}`, file)}
            onClearRef={(kind) => clearRef(`${spec.id}:${kind}`)}
            onCopy={copy}
            onDownload={download}
          />
        ))}
      </div>
    </div>
  )
}

// ── One platform's card ──────────────────────────────────────────────────────
function PlatformCard({
  spec, kit, busyKit, images, busyImg, copied, refImages, bannerStyle, onBannerStyle, onGenerateKit, onGenerateImage, onPickRef, onClearRef, onCopy, onDownload,
}: {
  spec: PlatformSpec
  kit?: SocialKit
  busyKit: boolean
  images: Record<string, string>
  busyImg: string | null
  copied: string | null
  refImages: Record<string, string>
  bannerStyle: 'bold' | 'minimal'
  onBannerStyle: (s: 'bold' | 'minimal') => void
  onGenerateKit: () => void
  onGenerateImage: (kind: 'banner' | 'avatar') => void
  onPickRef: (kind: 'banner' | 'avatar', file: File | null) => void
  onClearRef: (kind: 'banner' | 'avatar') => void
  onCopy: (text: string, key: string, label?: string) => void
  onDownload: (src: string, filename: string) => void
}) {
  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3.5 flex items-start gap-3" style={{ borderBottom: kit ? '1px solid var(--border)' : undefined }}>
        <span className="grid place-items-center w-9 h-9 rounded-xl text-[18px] flex-shrink-0" style={{ background: 'rgba(124,58,237,0.10)' }}>
          {EMOJI[spec.id]}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>{spec.label}</p>
          <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>{spec.blurb}</p>
        </div>
        <Button variant={kit ? 'secondary' : 'primary'} size="sm" loading={busyKit}
          leftIcon={<Sparkles className="h-4 w-4" />} onClick={onGenerateKit}>
          {kit ? 'Regenerate' : 'Generate kit'}
        </Button>
      </div>

      {!kit ? (
        <div className="px-4 py-6 text-center text-[12px]" style={{ color: 'var(--text-faint)' }}>
          Click <b>Generate kit</b> to get your {spec.label} name, bio, banner, avatar and setup steps.
        </div>
      ) : (
        <div className="px-4 py-4 flex flex-col gap-4">
          {/* Names */}
          <Field label={`Name ideas (max ${spec.nameMax} chars)`}>
            <div className="flex flex-wrap gap-1.5">
              {kit.names.map((n, i) => (
                <CopyChip key={i} text={n} ck={`${spec.id}-name-${i}`} copied={copied} onCopy={onCopy} primary={i === 0} />
              ))}
            </div>
          </Field>

          {/* Handles */}
          {kit.handles.length > 0 && (
            <Field label="Username ideas">
              <div className="flex flex-wrap gap-1.5">
                {kit.handles.map((h, i) => (
                  <CopyChip key={i} text={`@${h}`} copyText={h} ck={`${spec.id}-handle-${i}`} copied={copied} onCopy={onCopy} />
                ))}
              </div>
            </Field>
          )}

          {/* Bios */}
          <Field label={`Short bio (${kit.bioShort.length}/${spec.bioShortMax})`}>
            <CopyBox text={kit.bioShort} ck={`${spec.id}-bioShort`} copied={copied} onCopy={onCopy} />
          </Field>
          <Field label={`About / description (${kit.bioLong.length}/${spec.bioLongMax})`}>
            <CopyBox text={kit.bioLong} ck={`${spec.id}-bioLong`} copied={copied} onCopy={onCopy} />
          </Field>

          {/* Category + keywords */}
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Best category">
              <CopyChip text={kit.category} ck={`${spec.id}-cat`} copied={copied} onCopy={onCopy} />
            </Field>
            {kit.keywords.length > 0 && (
              <Field label="Keywords / interests" action={
                <button onClick={() => onCopy(kit.keywords.join(', '), `${spec.id}-kwall`, 'All keywords')}
                  className="text-[11px] font-semibold hover:underline" style={{ color: '#7C3AED' }}>Copy all</button>
              }>
                <div className="flex flex-wrap gap-1.5">
                  {kit.keywords.map((k, i) => (
                    <CopyChip key={i} text={k} ck={`${spec.id}-kw-${i}`} copied={copied} onCopy={onCopy} muted />
                  ))}
                </div>
              </Field>
            )}
          </div>

          {/* First post */}
          <Field label="First post">
            <CopyBox text={kit.firstPost} ck={`${spec.id}-first`} copied={copied} onCopy={onCopy} />
          </Field>

          {/* Pinterest boards */}
          {kit.boards && kit.boards.length > 0 && (
            <Field label="Starter boards">
              <div className="flex flex-col gap-2">
                {kit.boards.map((bd, i) => (
                  <div key={i} className="rounded-lg p-2.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{bd.name}</span>
                      <CopyMini text={`${bd.name}\n${bd.description}`} ck={`${spec.id}-board-${i}`} copied={copied} onCopy={onCopy} />
                    </div>
                    <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-soft)' }}>{bd.description}</p>
                  </div>
                ))}
              </div>
            </Field>
          )}

          {/* Images */}
          <Field label="Brand images">
            <div className="grid sm:grid-cols-2 gap-3">
              {spec.banner && (
                <ImageSlot label={`${spec.banner.label} · ${spec.banner.w}×${spec.banner.h}`}
                  imgKey={`${spec.id}:banner`} images={images} busyImg={busyImg}
                  refDataUrl={refImages[`${spec.id}:banner`]}
                  styleValue={bannerStyle} onStyle={onBannerStyle}
                  onGenerate={() => onGenerateImage('banner')} onDownload={onDownload}
                  onPickRef={(f) => onPickRef('banner', f)} onClearRef={() => onClearRef('banner')}
                  filename={`${spec.id}-cover.png`} />
              )}
              <ImageSlot label={`${spec.avatar.label} · ${spec.avatar.w}×${spec.avatar.h}`}
                imgKey={`${spec.id}:avatar`} images={images} busyImg={busyImg} round
                refDataUrl={refImages[`${spec.id}:avatar`]}
                onGenerate={() => onGenerateImage('avatar')} onDownload={onDownload}
                onPickRef={(f) => onPickRef('avatar', f)} onClearRef={() => onClearRef('avatar')}
                filename={`${spec.id}-avatar.png`} />
            </div>
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
              These are built from your logo + banner in <a href="/brand" className="hover:underline" style={{ color: '#7C3AED' }}>Brand Profile</a> — add or update them there to change the look. Want your exact logo as the profile picture? Download it from Brand Profile and upload that instead.
            </p>
          </Field>

          {/* How to set it up */}
          <details className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <summary className="px-3 py-2.5 cursor-pointer flex items-center gap-2 text-[13px] font-semibold select-none" style={{ color: 'var(--text)' }}>
              <ListChecks size={15} className="text-[#7C3AED]" /> How to set up your {spec.label}
            </summary>
            <div className="px-3 pb-3 pt-1">
              <ol className="flex flex-col gap-2.5">
                {spec.steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="grid place-items-center w-5 h-5 rounded-full text-[11px] font-bold flex-shrink-0 text-white" style={{ background: '#7C3AED' }}>{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>{s.title}</p>
                      <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: 'var(--text-soft)' }}>{s.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <a href={spec.createUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-3 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-white" style={{ background: '#7C3AED' }}>
                {spec.createLabel} <ExternalLink size={13} />
              </a>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

// ── Small building blocks ────────────────────────────────────────────────────
function Field({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>{label}</p>
        {action}
      </div>
      {children}
    </div>
  )
}

function CopyChip({ text, copyText, ck, copied, onCopy, primary, muted }: {
  text: string; copyText?: string; ck: string; copied: string | null
  onCopy: (t: string, k: string, label?: string) => void; primary?: boolean; muted?: boolean
}) {
  const isCopied = copied === ck
  return (
    <button onClick={() => onCopy(copyText ?? text, ck)}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors"
      style={primary
        ? { background: 'rgba(124,58,237,0.10)', color: '#7C3AED', border: '1px solid rgba(124,58,237,0.35)' }
        : { background: muted ? 'var(--surface)' : 'var(--surface-2, rgba(0,0,0,0.03))', color: 'var(--text-soft)', border: '1px solid var(--border)' }}>
      {isCopied ? <Check size={11} className="text-[#34c759]" /> : <Copy size={11} />} {text}
    </button>
  )
}

function CopyMini({ text, ck, copied, onCopy }: { text: string; ck: string; copied: string | null; onCopy: (t: string, k: string, label?: string) => void }) {
  const isCopied = copied === ck
  return (
    <button onClick={() => onCopy(text, ck)} title="Copy" className="inline-flex items-center gap-1 text-[11px] font-semibold flex-shrink-0" style={{ color: isCopied ? '#34c759' : '#7C3AED' }}>
      {isCopied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function CopyBox({ text, ck, copied, onCopy }: { text: string; ck: string; copied: string | null; onCopy: (t: string, k: string, label?: string) => void }) {
  const isCopied = copied === ck
  return (
    <div className="relative rounded-lg p-2.5 pr-16 text-[12px] leading-relaxed whitespace-pre-wrap"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>
      {text || <span style={{ color: 'var(--text-faint)' }}>—</span>}
      <button onClick={() => onCopy(text, ck)}
        className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold"
        style={{ background: 'var(--surface-bright, rgba(0,0,0,0.04))', color: isCopied ? '#34c759' : '#7C3AED', border: '1px solid var(--border)' }}>
        {isCopied ? <Check size={11} /> : <Copy size={11} />} {isCopied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function ImageSlot({ label, imgKey, images, busyImg, refDataUrl, styleValue, onStyle, onGenerate, onDownload, onPickRef, onClearRef, filename, round }: {
  label: string; imgKey: string; images: Record<string, string>; busyImg: string | null
  refDataUrl?: string
  styleValue?: 'bold' | 'minimal'; onStyle?: (s: 'bold' | 'minimal') => void
  onGenerate: () => void; onDownload: (src: string, filename: string) => void
  onPickRef: (file: File | null) => void; onClearRef: () => void
  filename: string; round?: boolean
}) {
  const src = images[imgKey]
  const busy = busyImg === imgKey
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="rounded-lg p-2.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-medium" style={{ color: 'var(--text-soft)' }}>{label}</p>
        {onStyle && (
          <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg" style={{ background: 'var(--surface-bright, rgba(0,0,0,0.05))' }} title="How much goes on the cover">
            {(['bold', 'minimal'] as const).map(s => (
              <button key={s} onClick={() => onStyle(s)}
                className="px-2 py-0.5 rounded-md text-[10px] font-semibold capitalize transition-colors"
                style={styleValue === s ? { background: '#7C3AED', color: '#fff' } : { color: 'var(--text-faint)' }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      {round ? (
        <div className="w-full max-w-[96px] aspect-square rounded-full overflow-hidden grid place-items-center mx-auto mb-2"
          style={{ background: 'var(--surface-bright, rgba(0,0,0,0.04))' }}>
          {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : <ImageIcon size={20} style={{ color: 'var(--text-faint)' }} />}
        </div>
      ) : (
        // Show the full banner at its true aspect ratio (no crop) so the preview
        // matches exactly what downloads — otherwise a 16:9 box clips the wider cover.
        <div className="w-full rounded-md overflow-hidden mb-2" style={{ background: 'var(--surface-bright, rgba(0,0,0,0.04))' }}>
          {src
            ? <img src={src} alt="" className="block w-full h-auto" />
            : <div className="aspect-video grid place-items-center"><ImageIcon size={20} style={{ color: 'var(--text-faint)' }} /></div>}
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button variant="secondary" size="sm" loading={busy} onClick={onGenerate}
          leftIcon={busy ? undefined : <Sparkles className="h-3.5 w-3.5" />}>
          {src ? 'Regenerate' : 'Generate'}
        </Button>
        {src && (
          <button onClick={() => onDownload(src, filename)} title="Download"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
            <Download size={13} /> Download
          </button>
        )}
        {/* Optional inspiration image the user uploads to guide this generation. */}
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { onPickRef(e.target.files?.[0] ?? null); e.currentTarget.value = '' }} />
        {refDataUrl ? (
          <span className="inline-flex items-center gap-1 pl-1 pr-1.5 py-1 rounded-lg text-[11px] font-semibold border" style={{ borderColor: 'rgba(124,58,237,0.4)', color: '#7C3AED' }}>
            <img src={refDataUrl} alt="" className="w-4 h-4 rounded object-cover" /> Reference
            <button onClick={onClearRef} title="Remove reference" className="ml-0.5"><X size={11} /></button>
          </span>
        ) : (
          <button onClick={() => fileRef.current?.click()} title="Upload your own image as inspiration"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-soft)' }}>
            <Upload size={13} /> Reference
          </button>
        )}
      </div>
      <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
        {refDataUrl ? 'Your image will guide the look — hit Generate.' : 'Optional: upload an image (a look you love) to guide the design.'}
      </p>
    </div>
  )
}
