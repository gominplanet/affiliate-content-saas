'use client'

/**
 * /branding — White-label settings for Pro users.
 *
 *   - Upload a logo (PNG/JPEG/WebP/SVG ≤ 2MB)
 *   - Choose a brand name (replaces "MVP Affiliate" in the sidebar + tab title)
 *   - Pick an accent colour (replaces #7C3AED on primary buttons + links)
 *   - Live preview pane shows what the sidebar will look like
 *
 * Non-Pro users get the paywall card with an upgrade CTA — same pattern
 * as /developers.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { toast } from 'sonner'
import { Lock, Palette, Upload, Eye, Loader2, RotateCcw, Check } from 'lucide-react'
import type { WhitelabelConfig } from '@/lib/whitelabel'

export default function BrandingPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [tier, setTier] = useState<string | null>(null)
  const [config, setConfig] = useState<WhitelabelConfig | null>(null)

  // Local edit state — flushed to server on "Save changes". Lets the user
  // preview without committing each keystroke.
  const [brandName, setBrandName] = useState('')
  const [accentColor, setAccentColor] = useState('#7C3AED')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/whitelabel')
        if (!res.ok) return
        const data = await res.json()
        setTier(data.tier)
        setConfig(data.config)
        setBrandName(data.raw.brandName || '')
        setAccentColor(data.raw.accentColor || '#7C3AED')
        setLogoUrl(data.raw.logoUrl || null)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function handleLogoUpload(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/whitelabel/upload-logo', {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Upload failed')
        return
      }
      setLogoUrl(data.url)
      toast.success('Logo uploaded — click Save changes to apply')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/whitelabel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName: brandName.trim() || null,
          accentColor,
          logoUrl,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Save failed')
        return
      }
      setConfig(data.config)
      toast.success('Branding saved — refresh the page to see it in the sidebar')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (!confirm('Reset all branding to MVP Affiliate defaults? Your uploaded logo will stay in storage but be unlinked.')) return
    setBrandName('')
    setAccentColor('#7C3AED')
    setLogoUrl(null)
    setSaving(true)
    try {
      const res = await fetch('/api/whitelabel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName: null, accentColor: null, logoUrl: null }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Reset failed')
        return
      }
      setConfig(data.config)
      toast.success('Branding reset to defaults')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto p-8 text-sm text-gray-500">Loading…</div>
  }

  const isPro = tier === 'pro' || tier === 'admin'
  if (!isPro) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Palette size={22} /> White-label Branding
        </h1>
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center bg-gray-50">
          <Lock size={32} className="mx-auto text-gray-400 mb-3" />
          <h2 className="text-lg font-semibold mb-2">White-label is a Pro feature</h2>
          <p className="text-sm text-gray-600 max-w-md mx-auto mb-5">
            Replace the MVP Affiliate logo, name, and accent color throughout your dashboard with your
            own brand. Show your team and clients a workspace that looks like yours.
          </p>
          <Link
            href="/billing"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-semibold text-white"
            style={{ background: '#7C3AED' }}
          >
            Upgrade to Pro
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Palette size={22} /> White-label Branding
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Replace the MVP Affiliate logo, brand name, and accent color across your dashboard. Visible
          to you and any future agency seats on your account — not to your customers' end users.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Form */}
        <div className="space-y-5">
          {/* Brand name */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              Brand name
            </label>
            <input
              type="text"
              value={brandName}
              onChange={e => setBrandName(e.target.value)}
              maxLength={40}
              placeholder="MVP Affiliate"
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Shown next to your logo in the sidebar + in the browser tab title. Leave blank for "MVP Affiliate".
            </p>
          </div>

          {/* Accent color */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              Accent color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={accentColor}
                onChange={e => setAccentColor(e.target.value)}
                className="w-12 h-10 rounded border cursor-pointer"
              />
              <input
                type="text"
                value={accentColor}
                onChange={e => setAccentColor(e.target.value)}
                placeholder="#7C3AED"
                pattern="#[0-9a-fA-F]{6}"
                maxLength={7}
                className="flex-1 px-3 py-2 border rounded-lg text-sm font-mono"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Applied to primary buttons, active nav, and link colors. Use a 7-character hex (#RRGGBB).
            </p>
          </div>

          {/* Logo */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
              Logo
            </label>
            <div className="border rounded-lg p-4 bg-gray-50">
              {logoUrl ? (
                <div className="flex items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoUrl} alt="Logo preview" className="h-12 max-w-[160px] object-contain" />
                  <button
                    onClick={() => setLogoUrl(null)}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="text-sm text-gray-500 italic">No logo uploaded yet — the default MVP Affiliate wordmark will be shown.</div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) void handleLogoUpload(file)
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium hover:border-gray-400 disabled:opacity-50"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
              </button>
              <p className="text-xs text-gray-500 mt-2">
                PNG, JPEG, WebP, or SVG. Max 2 MB. Horizontal layout works best — render height is ~32px.
              </p>
            </div>
          </div>

          {/* Save / Reset */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 rounded-lg font-semibold text-white text-sm inline-flex items-center gap-2 disabled:opacity-50"
              style={{ background: accentColor }}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button
              onClick={handleReset}
              disabled={saving || !config?.isCustomised}
              className="px-4 py-2.5 rounded-lg border text-sm font-medium inline-flex items-center gap-1.5 hover:border-gray-400 disabled:opacity-50"
            >
              <RotateCcw size={14} /> Reset to defaults
            </button>
          </div>
        </div>

        {/* Preview */}
        <aside className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
            <Eye size={12} /> Sidebar preview
          </h3>
          <div className="border rounded-xl overflow-hidden">
            {/* Mock sidebar header */}
            <div className="p-4 border-b flex items-center gap-2">
              {logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={logoUrl} alt="" className="h-7 max-w-[120px] object-contain" />
              ) : (
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center text-white font-bold text-sm"
                  style={{ background: accentColor }}
                >
                  M
                </div>
              )}
              <span className="font-bold text-sm">
                {brandName.trim() || 'MVP Affiliate'}
              </span>
            </div>
            {/* Mock nav items */}
            <div className="p-2 space-y-1">
              <div
                className="px-3 py-2 rounded text-sm font-medium text-white"
                style={{ background: accentColor }}
              >
                Dashboard (active)
              </div>
              <div className="px-3 py-2 rounded text-sm text-gray-600 hover:bg-gray-100">Content</div>
              <div className="px-3 py-2 rounded text-sm text-gray-600 hover:bg-gray-100">YouTube Co-Pilot</div>
            </div>
            <div className="p-3 border-t">
              <button
                className="w-full py-2 rounded text-sm font-semibold text-white"
                style={{ background: accentColor }}
              >
                Sample Primary Button
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Real changes apply after clicking <b>Save changes</b> and reloading the dashboard.
          </p>
        </aside>
      </div>
    </div>
  )
}
