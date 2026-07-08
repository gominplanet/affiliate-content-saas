// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /social-launch-kit — stand up a social presence in ~5 minutes. For each
// platform MVP generates the ready-to-paste copy (name, @handle, bios, category,
// keywords, first post, Pinterest boards) plus an on-brand banner + avatar, and
// walks the user through setup with deep links. v1: Facebook Page + Pinterest.
'use client'

import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import PageHero from '@/components/layout/PageHero'
import { Button } from '@/components/ui/button'
import {
  Rocket, Sparkles, Copy, Check, Download, ExternalLink, ListChecks, Image as ImageIcon,
} from 'lucide-react'
import { LAUNCH_PLATFORM_LIST, type LaunchPlatform, type PlatformSpec, type SocialKit } from '@/lib/social-launch-kit'

const EMOJI: Record<LaunchPlatform, string> = { facebook: '📘', pinterest: '📌' }

export default function SocialLaunchKitPage() {
  const [kits, setKits] = useState<Partial<Record<LaunchPlatform, SocialKit>>>({})
  const [busyKit, setBusyKit] = useState<LaunchPlatform | null>(null)
  // images keyed by `${platform}:${kind}` → data URL (or remote URL fallback)
  const [images, setImages] = useState<Record<string, string>>({})
  const [busyImg, setBusyImg] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

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
      if (!res.ok) { toast.error(data.error || 'Generation failed.'); return }
      setKits(prev => ({ ...prev, [platform]: data.kit as SocialKit }))
      toast.success(`${LAUNCH_PLATFORM_LIST.find(p => p.id === platform)?.label} kit ready`)
    } catch { toast.error('Network error — try again.') }
    finally { setBusyKit(null) }
  }

  async function generateImage(platform: LaunchPlatform, kind: 'banner' | 'avatar') {
    const key = `${platform}:${kind}`
    setBusyImg(key)
    try {
      const res = await fetch('/api/social-launch-kit/image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, kind }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Image generation failed.'); return }
      setImages(prev => ({ ...prev, [key]: data.image || data.imageUrl }))
    } catch { toast.error('Network error — try again.') }
    finally { setBusyImg(null) }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <PageHero
        title="Social Launch Kit"
        subtitle="No time to figure out Facebook Pages or Pinterest? Pick a platform and MVP hands you everything — name, bio, banner, avatar, and a step-by-step setup — ready to paste."
      />

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
            onGenerateKit={() => generateKit(spec.id)}
            onGenerateImage={(kind) => generateImage(spec.id, kind)}
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
  spec, kit, busyKit, images, busyImg, copied, onGenerateKit, onGenerateImage, onCopy, onDownload,
}: {
  spec: PlatformSpec
  kit?: SocialKit
  busyKit: boolean
  images: Record<string, string>
  busyImg: string | null
  copied: string | null
  onGenerateKit: () => void
  onGenerateImage: (kind: 'banner' | 'avatar') => void
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
                  onGenerate={() => onGenerateImage('banner')} onDownload={onDownload}
                  filename={`${spec.id}-cover.png`} />
              )}
              <ImageSlot label={`${spec.avatar.label} · ${spec.avatar.w}×${spec.avatar.h}`}
                imgKey={`${spec.id}:avatar`} images={images} busyImg={busyImg} round
                onGenerate={() => onGenerateImage('avatar')} onDownload={onDownload}
                filename={`${spec.id}-avatar.png`} />
            </div>
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
              Prefer your own logo? Set it in <a href="/brand" className="hover:underline" style={{ color: '#7C3AED' }}>Brand Profile</a> and use it as your profile picture instead.
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

function ImageSlot({ label, imgKey, images, busyImg, onGenerate, onDownload, filename, round }: {
  label: string; imgKey: string; images: Record<string, string>; busyImg: string | null
  onGenerate: () => void; onDownload: (src: string, filename: string) => void; filename: string; round?: boolean
}) {
  const src = images[imgKey]
  const busy = busyImg === imgKey
  return (
    <div className="rounded-lg p-2.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <p className="text-[11px] font-medium mb-2" style={{ color: 'var(--text-soft)' }}>{label}</p>
      <div className={`w-full overflow-hidden grid place-items-center mb-2 ${round ? 'rounded-full max-w-[96px] aspect-square mx-auto' : 'aspect-video rounded-md'}`}
        style={{ background: 'var(--surface-bright, rgba(0,0,0,0.04))' }}>
        {src
          ? <img src={src} alt="" className="w-full h-full object-cover" />
          : <ImageIcon size={20} style={{ color: 'var(--text-faint)' }} />}
      </div>
      <div className="flex items-center gap-1.5">
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
      </div>
    </div>
  )
}
