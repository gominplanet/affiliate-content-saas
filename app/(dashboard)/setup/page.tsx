'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ExternalLink, CheckCircle, ChevronRight, Loader2,
  Globe, Wrench, Sparkles, Link2, Rocket, Eye, EyeOff,
  Download, Upload, X, ArrowLeft, Building2, Wand2,
  Facebook, Pin, MessageCircle, Wifi, Check, LogOut, Save, Linkedin,
} from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { Suspense } from 'react'

type Mode = 'existing' | 'new' | null
type Step = 1 | 2 | 3 | 4 | 5

const steps = [
  { n: 1, label: 'Hosting', icon: Globe },
  { n: 2, label: 'WordPress', icon: Wrench },
  { n: 3, label: 'Your brand', icon: Sparkles },
  { n: 4, label: 'Launch', icon: Link2 },
  { n: 5, label: 'Done', icon: Rocket },
]

const PRESET_COLORS = [
  { hex: '#f5a623', label: 'Amber' },
  { hex: '#0071e3', label: 'Blue' },
  { hex: '#34c759', label: 'Green' },
  { hex: '#ff3b30', label: 'Red' },
  { hex: '#af52de', label: 'Purple' },
  { hex: '#ff9f0a', label: 'Orange' },
  { hex: '#5856d6', label: 'Indigo' },
  { hex: '#ff2d55', label: 'Pink' },
]

const STORAGE_KEY = 'affiliateos_setup_v3'

interface ImageData {
  base64: string
  mime: string
  filename: string
  preview: string
}

interface BrandData {
  logo: ImageData | null
  headshot: ImageData | null
  aboutText: string
  contactEmail: string
  youtubeUrl: string
  instagramUrl: string
  tiktokUrl: string
  twitterUrl: string
  pinterestUrl: string
  facebookUrl: string
}

const defaultBrand: BrandData = {
  logo: null, headshot: null, aboutText: '', contactEmail: '',
  youtubeUrl: '', instagramUrl: '', tiktokUrl: '', twitterUrl: '', pinterestUrl: '', facebookUrl: '',
}

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center mb-10 overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const done = current > s.n
        const active = current === s.n
        const Icon = s.icon
        return (
          <div key={s.n} className="flex items-center flex-shrink-0">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                done ? 'bg-[#34c759] text-white' :
                active ? 'bg-[#0071e3] text-white' :
                'bg-gray-100 text-[#86868b] dark:text-[#8e8e93]'
              }`}>
                {done ? <CheckCircle size={18} /> : <Icon size={16} />}
              </div>
              <span className={`text-xs font-medium whitespace-nowrap ${active ? 'text-[#1d1d1f] dark:text-[#f5f5f7]' : 'text-[#86868b] dark:text-[#8e8e93]'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-12 h-px mx-2 mb-5 flex-shrink-0 ${current > s.n ? 'bg-[#34c759]' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Image upload ─────────────────────────────────────────────────────────────
function ImageUpload({
  label, hint, shape = 'square', value, onChange,
}: {
  label: string
  hint?: string
  shape?: 'circle' | 'square'
  value: ImageData | null
  onChange: (img: ImageData | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) return
    const resized = await resizeImage(file, 800)
    onChange(resized)
  }

  return (
    <div>
      <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">{label}</label>
      {hint && <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mb-2">{hint}</p>}
      <div className="flex items-center gap-4">
        {value ? (
          <div className="relative">
            <img
              src={value.preview}
              alt=""
              className={`w-20 h-20 object-cover border border-gray-200 dark:border-white/10 ${shape === 'circle' ? 'rounded-full' : 'rounded-xl'}`}
            />
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#ff3b30] text-white rounded-full flex items-center justify-center"
            >
              <X size={10} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => ref.current?.click()}
            className={`w-20 h-20 border-2 border-dashed border-gray-300 hover:border-[#0071e3] bg-[#f5f5f7] dark:bg-[#000] flex flex-col items-center justify-center gap-1 transition-colors ${shape === 'circle' ? 'rounded-full' : 'rounded-xl'}`}
          >
            <Upload size={16} className="text-[#86868b] dark:text-[#8e8e93]" />
            <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">Upload</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="btn-secondary text-xs"
        >
          {value ? 'Change image' : 'Choose file'}
        </button>
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
    </div>
  )
}

async function resizeImage(file: File, maxSize: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      let w = img.width, h = img.height
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize }
        else { w = Math.round(w * maxSize / h); h = maxSize }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      const mime = file.type || 'image/jpeg'
      const dataUrl = canvas.toDataURL(mime, 0.88)
      URL.revokeObjectURL(url)
      resolve({
        base64: dataUrl.split(',')[1],
        mime,
        filename: file.name,
        preview: dataUrl,
      })
    }
    img.onerror = reject
    img.src = url
  })
}

// ─── Mode picker ──────────────────────────────────────────────────────────────
function ModePicker({ onSelect }: { onSelect: (m: 'existing' | 'new') => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">How would you like to get started?</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Pick the path that matches your situation — they work very differently.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Path A — existing site */}
        <button
          onClick={() => onSelect('existing')}
          className="group flex flex-col items-start gap-4 p-6 rounded-2xl border-2 border-gray-200 dark:border-white/10 hover:border-[#0071e3] bg-white dark:bg-[#1c1c1e] text-left transition-all hover:shadow-md"
        >
          <div className="w-12 h-12 rounded-xl bg-[#0071e3]/10 flex items-center justify-center group-hover:bg-[#0071e3]/20 transition-colors">
            <Building2 size={22} className="text-[#0071e3]" />
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">I already have a WordPress blog</p>
            <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-3">
              Connect your site and start publishing AI-generated posts directly to your existing blog.
            </p>
            <div className="flex flex-col gap-1.5 mb-3">
              {[
                'Only publishes new posts you approve',
                'Never touches your theme or design',
                'Never modifies existing content',
                'Never installs plugins or changes settings',
              ].map(item => (
                <div key={item} className="flex items-start gap-2">
                  <Check size={13} className="text-[#34c759] flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{item}</span>
                </div>
              ))}
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0071e3] group-hover:gap-2.5 transition-all">
            Connect my existing site <ChevronRight size={15} />
          </span>
        </button>

        {/* Path B — new site from scratch */}
        <button
          onClick={() => onSelect('new')}
          className="group flex flex-col items-start gap-4 p-6 rounded-2xl border-2 border-gray-200 dark:border-white/10 hover:border-[#34c759] bg-white dark:bg-[#1c1c1e] text-left transition-all hover:shadow-md"
        >
          <div className="w-12 h-12 rounded-xl bg-[#34c759]/10 flex items-center justify-center group-hover:bg-[#34c759]/20 transition-colors">
            <Wand2 size={22} className="text-[#34c759]" />
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Build me a new blog from scratch</p>
            <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed mb-3">
              Start with a blank slate on Hostinger. We configure everything automatically.
            </p>
            <div className="flex flex-col gap-1.5 mb-1">
              {[
                'Installs & configures WordPress + theme',
                'Creates your Home, About & Privacy pages',
                'Sets up navigation, logo, and branding',
                'Configures your affiliate sidebar & footer',
              ].map(item => (
                <div key={item} className="flex items-start gap-2">
                  <Wand2 size={13} className="text-[#34c759] flex-shrink-0 mt-0.5" />
                  <span className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{item}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-[#ff9500] mt-2.5 flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Only use this on a brand-new empty WordPress install.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#34c759] group-hover:gap-2.5 transition-all">
            Start the setup wizard <ChevronRight size={15} />
          </span>
        </button>

      </div>

      {/* Bottom clarification */}
      <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--border-1)] px-4 py-3 text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
        <strong className="text-[#1d1d1f] dark:text-[#f5f5f7]">Not sure which to pick?</strong> If you already have posts, subscribers, or a design you care about — choose <strong>existing site</strong>. The setup wizard is only for blank new installs and will overwrite default WordPress content.
      </div>
    </div>
  )
}

// ─── Existing site connect ────────────────────────────────────────────────────
function ExistingConnect({ onBack, onDone }: { onBack: () => void; onDone: (url: string) => void }) {
  const [siteUrl, setSiteUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = siteUrl.trim() && username.trim() && password.trim() && !loading

  async function handleConnect() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/wordpress/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: siteUrl.trim(), username: username.trim(), password: password.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Connection failed')
      onDone(data.siteUrl)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-[#0071e3] hover:opacity-75 mb-4">
          <ArrowLeft size={14} /> Back
        </button>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Connect your existing WordPress site</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Enter the same username and password you use to log in to wp-admin.
        </p>
        {/* Safety guarantee */}
        <div className="rounded-xl border border-[#34c759]/30 bg-[#34c759]/5 px-4 py-3 flex gap-3 mb-2">
          <Check size={15} className="text-[#34c759] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Your existing site is safe</p>
            <ul className="flex flex-col gap-1">
              {[
                'We only ever create new posts — nothing else is touched',
                'Your theme, design, and existing content stay exactly as they are',
                'No plugins are installed, no settings are changed',
                'You review and approve every post before it goes live',
              ].map(line => (
                <li key={line} className="text-xs text-[#6e6e73] dark:text-[#ebebf0] flex items-start gap-1.5">
                  <span className="text-[#34c759] mt-0.5">·</span> {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress site URL</label>
          <input type="text" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="yourdomain.com" className="input-field" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress username</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" className="input-field" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Your wp-admin password"
              className="input-field pr-10"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">The same password you use to log in to yourdomain.com/wp-admin.</p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">{error}</p>
      )}

      <button onClick={handleConnect} disabled={!canSubmit} className="btn-primary self-start">
        {loading ? <><Loader2 size={15} className="animate-spin" /> Verifying…</> : <><Link2 size={15} /> Connect site</>}
      </button>
    </div>
  )
}

// ─── Step 1 ───────────────────────────────────────────────────────────────────
function Step1({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-[#0071e3] hover:opacity-75 self-start">
        <ArrowLeft size={14} /> Back
      </button>
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Create your Hostinger account</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Hostinger is where your affiliate blog will live. You&apos;ll get a domain and fast hosting for under $3/month.
        </p>
      </div>
      <div className="card p-5 border border-[#0071e3]/20 bg-[#0071e3]/3">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#0071e3]/10 flex items-center justify-center flex-shrink-0">
            <Globe size={20} className="text-[#0071e3]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">Hostinger Web Hosting</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
              Includes a free domain name, 1-click WordPress installer, fast SSD hosting, and free SSL.
              The <strong>Premium</strong> plan is the sweet spot.
            </p>
            <a href="https://geni.us/ANaArQ" target="_blank" rel="noopener noreferrer" className="btn-primary text-sm">
              Get Hostinger → <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </div>
      <div className="bg-[#f5f5f7] dark:bg-[#000] rounded-xl p-5">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">What to do on Hostinger:</p>
        <ol className="flex flex-col gap-3">
          {[
            'Click the link above and choose a hosting plan — Premium or Business recommended.',
            'During checkout, register a new domain name (included free for the first year).',
            'Complete payment and set up your account.',
            'Come back here — the next step will walk you through installing WordPress.',
          ].map((text, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{text}</p>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={onNext} className="btn-primary">I have a Hostinger account <ChevronRight size={15} /></button>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Already signed up? Skip ahead.</p>
      </div>
    </div>
  )
}

// ─── Step 2 ───────────────────────────────────────────────────────────────────
function Step2({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Install WordPress, theme &amp; plugins</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Complete all three sections below before moving on. Each one takes about 2 minutes.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Part 1 — Install WordPress</p>
        {[
          { title: 'Log in to hPanel', desc: 'Go to hpanel.hostinger.com and sign in to your Hostinger account.', action: { label: 'Open hPanel', href: 'https://hpanel.hostinger.com' } },
          { title: 'Click "WordPress" in the sidebar', desc: 'In the left menu find the WordPress section and click it.' },
          { title: 'Click "Install"', desc: 'Hit Install and select your domain name from the dropdown.' },
          { title: 'Set your admin credentials', desc: 'Enter a username, your email, and a strong password. Write these down — you\'ll need them in the Launch step.' },
          { title: 'Click "Install" and wait ~2 minutes', desc: 'WordPress will install automatically. You\'ll see a success screen when done.' },
        ].map(({ title, desc, action }, i) => (
          <div key={i} className="flex items-start gap-4 p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#000]">
            <span className="w-6 h-6 rounded-full bg-[#1d1d1f] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-0.5">{title}</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{desc}</p>
            </div>
            {action && (
              <a href={action.href} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs px-3 py-1.5 flex-shrink-0">
                {action.label} <ExternalLink size={11} />
              </a>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Part 2 — Install the Kadence theme</p>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
          This is the theme that powers your blog layout. Download the ZIP below, then upload it to WordPress.
        </p>
        <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#000] flex flex-col gap-3">
          <a href="/api/wordpress/theme" download="kadence-affiliate-child.zip" className="btn-primary text-sm self-start inline-flex">
            <Download size={14} /> Download theme ZIP
          </a>
          <ol className="flex flex-col gap-2">
            {[
              'In your WordPress admin, go to Appearance → Themes.',
              'Click "Add New Theme" → "Upload Theme".',
              'Choose the ZIP file you just downloaded and click Install Now.',
              'Click "Activate" once it finishes.',
            ].map((text, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="w-4 h-4 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{text}</p>
              </li>
            ))}
          </ol>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
            To get to wp-admin: visit <span className="font-mono">yourdomain.com/wp-admin</span> and log in with the credentials you set in Part 1.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Part 3 — Install the Code Snippets plugin</p>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
          Code Snippets is a free WordPress plugin that lets the tool install custom features on your blog automatically — things like your social links in the footer and your customization settings. Without it, the Launch step can&apos;t fully configure your site.
        </p>
        <div className="p-4 rounded-xl bg-[#f5f5f7] dark:bg-[#000] flex flex-col gap-3">
          <a href="https://wordpress.org/plugins/code-snippets/" target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm self-start inline-flex">
            View on WordPress.org <ExternalLink size={13} />
          </a>
          <ol className="flex flex-col gap-2">
            {[
              'In wp-admin, go to Plugins → Add New Plugin.',
              'Search for "Code Snippets" (by Code Snippets Pro).',
              'Click "Install Now", then "Activate".',
              'You\'ll see a new "Snippets" menu in the sidebar — that\'s it, nothing else to configure.',
            ].map((text, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="w-4 h-4 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <button onClick={onNext} className="btn-primary self-start">Theme &amp; plugins installed <ChevronRight size={15} /></button>
    </div>
  )
}

// ─── Step 3 ───────────────────────────────────────────────────────────────────
function Step3({ data, onChange, onNext }: { data: BrandData; onChange: (d: BrandData) => void; onNext: () => void }) {
  function set<K extends keyof BrandData>(key: K, val: BrandData[K]) {
    onChange({ ...data, [key]: val })
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Customize your site</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          This is what makes your blog feel like <em>yours</em>. All fields are optional — skip what you don&apos;t have yet.
        </p>
      </div>

      <div className="flex flex-col gap-5 p-5 bg-[#f5f5f7] dark:bg-[#000] rounded-xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Visuals</p>
        <ImageUpload label="Brand logo" hint="Square or circle — shown as your site favicon and in the footer." shape="square" value={data.logo} onChange={v => set('logo', v)} />
        <ImageUpload label="Your photo / headshot" hint="Used on your About page to put a face to the brand." shape="circle" value={data.headshot} onChange={v => set('headshot', v)} />
      </div>

      <div className="flex flex-col gap-4 p-5 bg-[#f5f5f7] dark:bg-[#000] rounded-xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">About you</p>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">About us / bio</label>
          <textarea value={data.aboutText} onChange={e => set('aboutText', e.target.value)} placeholder="Tell your story. What do you review, why should people trust you, what makes your take different?" rows={5} className="input-field resize-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Contact email</label>
          <input type="email" value={data.contactEmail} onChange={e => set('contactEmail', e.target.value)} placeholder="hello@yourdomain.com" className="input-field" />
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">Shown on your About page and Privacy Policy.</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5 bg-[#f5f5f7] dark:bg-[#000] rounded-xl">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] uppercase tracking-wider">Social links</p>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] -mt-2">Added to your site footer and About page.</p>
        {[
          { label: 'YouTube channel URL', key: 'youtubeUrl' as const, placeholder: 'https://youtube.com/@yourchannel' },
          { label: 'Instagram URL', key: 'instagramUrl' as const, placeholder: 'https://instagram.com/yourhandle' },
          { label: 'TikTok URL', key: 'tiktokUrl' as const, placeholder: 'https://tiktok.com/@yourhandle' },
          { label: 'Twitter / X URL', key: 'twitterUrl' as const, placeholder: 'https://x.com/yourhandle' },
          { label: 'Pinterest URL', key: 'pinterestUrl' as const, placeholder: 'https://pinterest.com/yourhandle' },
          { label: 'Facebook URL', key: 'facebookUrl' as const, placeholder: 'https://facebook.com/yourpage' },
        ].map(({ label, key, placeholder }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">{label}</label>
            <input type="url" value={data[key] as string} onChange={e => set(key, e.target.value)} placeholder={placeholder} className="input-field" />
          </div>
        ))}
      </div>

      <button onClick={onNext} className="btn-primary self-start">Continue <ChevronRight size={15} /></button>
    </div>
  )
}

// ─── Step 4 ───────────────────────────────────────────────────────────────────
function Step4({
  brandData, siteUrl, setSiteUrl, username, setUsername, accentColor, setAccentColor, onNext,
}: {
  brandData: BrandData
  siteUrl: string; setSiteUrl: (v: string) => void
  username: string; setUsername: (v: string) => void
  accentColor: string; setAccentColor: (v: string) => void
  onNext: (url: string) => void
}) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [customHex, setCustomHex] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState('')
  const [error, setError] = useState<string | null>(null)

  const activeColor = customHex.match(/^#[0-9a-fA-F]{6}$/) ? customHex : accentColor
  const canSubmit = siteUrl.trim() && username.trim() && password.trim() && !loading

  async function handleLaunch() {
    let url = siteUrl.trim()
    if (!url.startsWith('http')) url = `https://${url}`
    url = url.replace(/\/wp-admin\/?.*$/, '').replace(/\/$/, '')
    setLoading(true); setError(null); setLoadingStep('Connecting to WordPress…')
    try {
      const res = await fetch('/api/wordpress/connect-and-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteUrl: url, username: username.trim(), password: password.trim(), accentColor: activeColor,
          logoBase64: brandData.logo?.base64, logoMime: brandData.logo?.mime, logoFilename: brandData.logo?.filename,
          headshotBase64: brandData.headshot?.base64, headshotMime: brandData.headshot?.mime, headshotFilename: brandData.headshot?.filename,
          aboutText: brandData.aboutText || undefined, contactEmail: brandData.contactEmail || undefined,
          youtubeUrl: brandData.youtubeUrl || undefined, instagramUrl: brandData.instagramUrl || undefined,
          tiktokUrl: brandData.tiktokUrl || undefined, twitterUrl: brandData.twitterUrl || undefined,
          pinterestUrl: brandData.pinterestUrl || undefined, facebookUrl: brandData.facebookUrl || undefined,
        }),
      })
      setLoadingStep('Setting up your site…')
      const raw = await res.text()
      let data: Record<string, string> = {}
      try { data = JSON.parse(raw) } catch { throw new Error(`Server returned unexpected response: ${raw.slice(0, 300)}`) }
      if (!res.ok) throw new Error(data.error || 'Setup failed')
      onNext(url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Setup failed. Check your credentials.')
    } finally {
      setLoading(false); setLoadingStep('')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Connect &amp; launch your site</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">Enter your WordPress credentials and pick your brand color. We&apos;ll build your site automatically.</p>
      </div>

      <div className="bg-[#f5f5f7] dark:bg-[#000] rounded-xl p-5">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Before you launch — quick check:</p>
        <ul className="flex flex-col gap-2">
          {[
            'WordPress is installed and you can log in to wp-admin',
            'The Kadence theme is installed and activated (from Step 2)',
            'The Code Snippets plugin is installed and activated (from Step 2)',
            'Your domain is live — not just "DNS propagating" (can take up to 24h after signup)',
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-[#34c759] mt-0.5 flex-shrink-0">✓</span>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{item}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress site URL</label>
          <input type="text" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} placeholder="yourdomain.com" className="input-field" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress username</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" className="input-field" />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress password</label>
          <div className="relative">
            <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Your wp-admin login password" className="input-field pr-10" />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:text-[#f5f5f7]">
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">The password you set during WordPress installation. Not an application password.</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">Accent color</label>
        <div className="flex flex-wrap gap-2.5 mb-3">
          {PRESET_COLORS.map(c => (
            <button key={c.hex} title={c.label} onClick={() => { setAccentColor(c.hex); setCustomHex('') }}
              className="w-8 h-8 rounded-full border-2 transition-all"
              style={{ backgroundColor: c.hex, borderColor: accentColor === c.hex && !customHex.match(/^#[0-9a-fA-F]{6}$/) ? '#1d1d1f' : 'transparent', boxShadow: accentColor === c.hex && !customHex.match(/^#[0-9a-fA-F]{6}$/) ? `0 0 0 2px white, 0 0 0 4px ${c.hex}` : 'none' }} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full border border-gray-200 dark:border-white/10 flex-shrink-0" style={{ backgroundColor: activeColor }} />
          <input type="text" value={customHex} onChange={e => setCustomHex(e.target.value)} placeholder="Custom hex e.g. #e63946" className="input-field max-w-[190px] font-mono text-sm" />
          <span className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full text-white flex-shrink-0" style={{ backgroundColor: activeColor }}>Preview</span>
        </div>
      </div>

      {error && <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={handleLaunch} disabled={!canSubmit} className="btn-primary">
          {loading ? <><Loader2 size={15} className="animate-spin" /> {loadingStep}</> : <><Sparkles size={15} /> Launch my site</>}
        </button>
        {!loading && <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">~20 seconds</p>}
      </div>
    </div>
  )
}

// ─── Step 5 ───────────────────────────────────────────────────────────────────
function Step5({ wordpressUrl, accentColor }: { wordpressUrl: string; accentColor: string }) {
  const router = useRouter()
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accentColor}25` }}>
        <CheckCircle size={32} style={{ color: accentColor }} />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Your site is live!</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          Home page, About page, Privacy Policy, and navigation are all set up at{' '}
          <a href={wordpressUrl} target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline font-medium">{wordpressUrl}</a>
        </p>
      </div>
      <div className="bg-[#f5f5f7] dark:bg-[#000] rounded-xl p-4 text-left w-full max-w-md">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">What&apos;s next:</p>
        <ul className="text-xs text-[#6e6e73] dark:text-[#ebebf0] space-y-1.5 list-disc list-inside">
          <li>Finish your Brand Profile — tone, writing sample, CTA style</li>
          <li>Connect your YouTube channel below</li>
          <li>Come back to Content and generate your first post</li>
        </ul>
      </div>
      <div className="flex gap-3">
        <a href={wordpressUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">View site <ExternalLink size={13} /></a>
        <button onClick={() => router.push('/brand')} className="btn-primary">Set up brand profile <ChevronRight size={15} /></button>
      </div>
    </div>
  )
}

// ─── Manual Facebook token ────────────────────────────────────────────────────
function ManualFacebookToken({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!token.trim()) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/auth/facebook/manual-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageAccessToken: token.trim() }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save token')
      onConnected()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
        Paste your Facebook Page Access Token below.{' '}
        <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">Get it from Graph API Explorer →</a>
      </p>
      <input type="text" value={token} onChange={e => setToken(e.target.value)} placeholder="EAAxxxxxxx..." className="input-field font-mono text-xs" />
      {error && <p className="text-xs text-[#ff3b30]">{error}</p>}
      <button onClick={save} disabled={saving || !token.trim()} className="flex items-center gap-2 px-4 py-2 bg-[#1877F2] text-white text-sm font-medium rounded-lg hover:bg-[#1877F2]/90 transition-colors self-start disabled:opacity-50">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Facebook size={14} />}
        {saving ? 'Connecting…' : 'Connect Page'}
      </button>
    </div>
  )
}

// ─── Manual Threads token ─────────────────────────────────────────────────────
function ManualThreadsToken({ onConnected }: { onConnected: (username: string) => void }) {
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!token.trim()) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/auth/threads/manual-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token.trim() }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save token')
      onConnected(data.username)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
        Generate a long-lived token in the{' '}
        <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">Meta Developer Portal</a>
        {' '}→ MVP FLOW → Threads API → Settings → User Token Generator, then paste it below.
      </p>
      <input type="text" value={token} onChange={e => setToken(e.target.value)} placeholder="THQWJh..." className="input-field font-mono text-xs" />
      {error && <p className="text-xs text-[#ff3b30]">{error}</p>}
      <button onClick={save} disabled={saving || !token.trim()} className="flex items-center gap-2 px-4 py-2 bg-[#1d1d1f] text-white text-sm font-medium rounded-lg hover:bg-black transition-colors self-start disabled:opacity-50">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
        {saving ? 'Connecting…' : 'Connect Threads'}
      </button>
    </div>
  )
}

// ─── Integrations panel (shown after WordPress is connected) ──────────────────
function IntegrationsPanel({ onLoad }: { onLoad: () => void }) {
  const supabase = createBrowserClient()
  const searchParams = useSearchParams()

  const [youtubeChannelId, setYoutubeChannelId] = useState('')
  const [facebook, setFacebook] = useState({ connected: false, pageName: '', pageId: '', pages: [] as { id: string; name: string }[] })
  const [fbDisconnecting, setFbDisconnecting] = useState(false)
  const [fbNotice, setFbNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pinterest, setPinterest] = useState({ connected: false, boardId: '', boardName: '', boards: [] as { id: string; name: string }[] })
  const [ptDisconnecting, setPtDisconnecting] = useState(false)
  const [ptNotice, setPtNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [threads, setThreads] = useState({ connected: false, userId: '', username: '' })
  const [thDisconnecting, setThDisconnecting] = useState(false)
  const [thNotice, setThNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [linkedin, setLinkedin] = useState({ connected: false, personName: '' })
  const [liDisconnecting, setLiDisconnecting] = useState(false)
  const [liNotice, setLiNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [geniuslinkKey, setGeniuslinkKey] = useState('')
  const [geniuslinkSecret, setGeniuslinkSecret] = useState('')
  const [amazonAssociatesTag, setAmazonAssociatesTag] = useState('')
  const [youtubeOAuthConnected, setYoutubeOAuthConnected] = useState(false)
  const [ytOAuthNotice, setYtOAuthNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  const [wpTesting, setWpTesting] = useState(false)
  const [wpTestResult, setWpTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [fixingCss, setFixingCss] = useState(false)
  const [fixCssResult, setFixCssResult] = useState<string | null>(null)
  const [fixingThumbs, setFixingThumbs] = useState(false)
  const [fixThumbsResult, setFixThumbsResult] = useState<string | null>(null)
  const [wpUrl, setWpUrl] = useState('')
  const [wpUsername, setWpUsername] = useState('')
  const [wpAppPassword, setWpAppPassword] = useState('')
  const [showWpPassword, setShowWpPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any).from('integrations').select('*').eq('user_id', user.id).single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = data as any
    if (row) {
      setYoutubeChannelId(row.youtube_channel_id ?? '')
      setWpUrl(row.wordpress_url ?? '')
      setWpUsername(row.wordpress_username ?? '')
      setWpAppPassword(row.wordpress_app_password ?? '')
      const pages = JSON.parse(row.facebook_pages_json || '[]')
      setFacebook({ connected: !!row.facebook_page_id, pageName: row.facebook_page_name ?? '', pageId: row.facebook_page_id ?? '', pages })
      const boards = JSON.parse(row.pinterest_boards_json || '[]')
      setPinterest({ connected: !!row.pinterest_access_token && !!row.pinterest_board_id, boardId: row.pinterest_board_id ?? '', boardName: row.pinterest_board_name ?? '', boards })
      setThreads({ connected: !!row.threads_access_token, userId: row.threads_user_id ?? '', username: row.threads_username ?? '' })
      setLinkedin({ connected: !!row.linkedin_access_token, personName: row.linkedin_person_name ?? '' })
      setGeniuslinkKey(row.geniuslink_api_key ?? '')
      setGeniuslinkSecret(row.geniuslink_api_secret ?? '')
      setAmazonAssociatesTag(row.amazon_associates_tag ?? '')
      setYoutubeOAuthConnected(!!row.youtube_oauth_access_token)
    }
    setLoading(false)
    onLoad()
  }, [supabase, onLoad])

  useEffect(() => {
    const fbConnected = searchParams.get('fb_connected')
    const fbError = searchParams.get('fb_error')
    if (fbConnected) setFbNotice({ ok: true, msg: 'Facebook page connected!' })
    if (fbError) setFbNotice({ ok: false, msg: fbError === 'no_pages' ? 'No Facebook pages found on your account.' : `Facebook error: ${fbError}` })
    const ptConnected = searchParams.get('pinterest_connected')
    const ptError = searchParams.get('pinterest_error')
    if (ptConnected) setPtNotice({ ok: true, msg: 'Pinterest connected!' })
    if (ptError) setPtNotice({ ok: false, msg: `Pinterest error: ${ptError}` })
    const thConnected = searchParams.get('threads_connected')
    const thError = searchParams.get('threads_error')
    if (thConnected) setThNotice({ ok: true, msg: 'Threads connected!' })
    if (thError) setThNotice({ ok: false, msg: `Threads error: ${thError}` })
    const liConnected = searchParams.get('linkedin_connected')
    const liError = searchParams.get('linkedin_error')
    if (liConnected) { setLiNotice({ ok: true, msg: 'LinkedIn connected!' }); load() }
    if (liError) setLiNotice({ ok: false, msg: liError === 'callback_failed' ? 'LinkedIn connection failed — please try again.' : `LinkedIn error: ${liError}` })
    const ytConnected = searchParams.get('youtube_oauth_connected')
    const ytError = searchParams.get('youtube_oauth_error')
    if (ytConnected) { setYtOAuthNotice({ ok: true, msg: 'YouTube connected!' }); setYoutubeOAuthConnected(true); load() }
    if (ytError) setYtOAuthNotice({ ok: false, msg: `YouTube error: ${ytError}` })
  }, [searchParams, load])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true); setError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error: err } = await supabase.from('integrations').upsert({
      user_id: user.id,
      youtube_channel_id: youtubeChannelId || null,
      wordpress_url: wpUrl || null,
      wordpress_username: wpUsername || null,
      wordpress_app_password: wpAppPassword || null,
      geniuslink_api_key: geniuslinkKey || null,
      geniuslink_api_secret: geniuslinkSecret || null,
      amazon_associates_tag: amazonAssociatesTag || null,
    }, { onConflict: 'user_id' })
    setSaving(false)
    if (err) { setError(err.message) } else { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  async function testWordPress() {
    setWpTesting(true); setWpTestResult(null)
    try {
      const res = await fetch('/api/wordpress/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: wpUrl, username: wpUsername, password: wpAppPassword }) })
      const data = await res.json()
      setWpTestResult({ ok: data.ok, message: data.message || data.error })
    } catch { setWpTestResult({ ok: false, message: 'Request failed — check your site URL' }) }
    finally { setWpTesting(false) }
  }

  async function fixCssCorruption() {
    setFixingCss(true); setFixCssResult(null)
    try {
      const res = await fetch('/api/wordpress/fix-css-corruption', { method: 'POST' })
      const data = await res.json()
      if (data.error) setFixCssResult(`Error: ${data.error}`)
      else if (data.affected === 0) setFixCssResult('No corrupted posts found — all clean!')
      else setFixCssResult(`Fixed ${data.fixed} of ${data.affected} affected post${data.affected !== 1 ? 's' : ''}.`)
    } catch { setFixCssResult('Request failed.') }
    finally { setFixingCss(false) }
  }

  async function fixThumbnails() {
    setFixingThumbs(true); setFixThumbsResult(null)
    try {
      const res = await fetch('/api/wordpress/fix-thumbnails', { method: 'POST' })
      const data = await res.json()
      if (data.error) setFixThumbsResult(`Error: ${data.error}`)
      else setFixThumbsResult(`Fixed ${data.fixed} thumbnail${data.fixed !== 1 ? 's' : ''} (${data.skipped} already good, ${data.failed} failed).`)
    } catch { setFixThumbsResult('Request failed.') }
    finally { setFixingThumbs(false) }
  }

  async function disconnectFacebook() {
    setFbDisconnecting(true)
    try {
      const res = await fetch('/api/auth/facebook/disconnect', { method: 'POST' })
      if (res.ok) setFacebook({ connected: false, pageName: '', pageId: '', pages: [] })
    } finally { setFbDisconnecting(false) }
  }

  async function selectFacebookPage(pageId: string) {
    const res = await fetch('/api/auth/facebook/select-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId }) })
    const data = await res.json()
    if (data.ok) setFacebook(prev => ({ ...prev, pageId: data.page.id, pageName: data.page.name }))
  }

  async function disconnectPinterest() {
    setPtDisconnecting(true)
    try {
      const res = await fetch('/api/auth/pinterest/disconnect', { method: 'POST' })
      if (res.ok) setPinterest({ connected: false, boardId: '', boardName: '', boards: [] })
    } finally { setPtDisconnecting(false) }
  }

  async function selectPinterestBoard(boardId: string) {
    const board = pinterest.boards.find(b => b.id === boardId)
    if (!board) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations').update({ pinterest_board_id: board.id, pinterest_board_name: board.name }).eq('user_id', user.id)
    setPinterest(prev => ({ ...prev, boardId: board.id, boardName: board.name }))
  }

  async function disconnectThreads() {
    setThDisconnecting(true)
    try {
      const res = await fetch('/api/auth/threads/disconnect', { method: 'POST' })
      if (res.ok) setThreads({ connected: false, userId: '', username: '' })
    } finally { setThDisconnecting(false) }
  }

  async function disconnectLinkedIn() {
    setLiDisconnecting(true)
    try {
      const res = await fetch('/api/auth/linkedin/disconnect', { method: 'POST' })
      if (res.ok) setLinkedin({ connected: false, personName: '' })
    } finally { setLiDisconnecting(false) }
  }

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-[#86868b] dark:text-[#8e8e93] py-6">
      <Loader2 size={16} className="animate-spin" /> Loading…
    </div>
  )

  return (
    <div className="flex flex-col gap-5 mt-6">
      <div>
        <h2 className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Integrations</h2>
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-0.5">Connect your YouTube channel and social platforms.</p>
      </div>

      {/* Security notice */}
      <div className="rounded-xl border border-[#34c759]/30 bg-[#34c759]/5 px-4 py-3.5 flex gap-3">
        <div className="mt-0.5 flex-shrink-0">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34c759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Your credentials are safe</p>
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
            Every API key, password, and access token you enter here is encrypted and stored securely in our database — <strong>nothing is ever saved in your browser or locally on your device</strong>. Credentials are only used server-side to make authenticated API calls on your behalf (posting to your blog, pushing metadata to YouTube, creating affiliate links, etc.). We never share, log, or expose them. You can disconnect any integration or delete your account at any time.
          </p>
        </div>
      </div>

      {/* YouTube */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#FF0000"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 0 0 .5 6.19C0 8.03 0 12 0 12s0 3.97.5 5.81a3.02 3.02 0 0 0 2.12 2.14C4.46 20.5 12 20.5 12 20.5s7.54 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14C24 15.97 24 12 24 12s0-3.97-.5-5.81zM9.75 15.5v-7l6.5 3.5-6.5 3.5z"/></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">YouTube</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Sync your public video library for blog post generation</p>
          </div>
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Your Channel ID lets the tool pull your public video list so you can turn any video into a blog post. Find it at <a href="https://www.youtube.com/account_advanced" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">youtube.com/account_advanced</a> — it starts with <code className="bg-[var(--surface-2)] px-1 rounded">UC</code>.
        </p>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Channel ID</label>
          <input type="text" value={youtubeChannelId} onChange={e => setYoutubeChannelId(e.target.value)} placeholder="UCxxxxxxxxxxxxxxx" className="input-field font-mono text-xs" />
        </div>
      </div>

      {/* WordPress credentials */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#21759B"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">WordPress</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Publish blog posts and push customizations to your site</p>
          </div>
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Enter the same URL, username, and password you use to log in to <strong>yourdomain.com/wp-admin</strong>. These credentials are used server-side via the WordPress REST API to publish posts, push sidebars, update social links, and more — nothing is stored in your browser.
        </p>
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress Site URL</label>
            <input type="url" value={wpUrl} onChange={e => setWpUrl(e.target.value)} placeholder="https://yourdomain.com" className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress Username</label>
            <input type="text" value={wpUsername} onChange={e => setWpUsername(e.target.value)} placeholder="admin" className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">WordPress Password</label>
            <div className="relative">
              <input type={showWpPassword ? 'text' : 'password'} value={wpAppPassword} onChange={e => setWpAppPassword(e.target.value)} placeholder="Your wp-admin password" className="input-field pr-10" />
              <button type="button" onClick={() => setShowWpPassword(!showWpPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">
                {showWpPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">Same password you use to log in to wp-admin.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="button" onClick={testWordPress} disabled={wpTesting || !wpUrl || !wpUsername || !wpAppPassword} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-white/10 rounded-lg text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#0071e3]/40 disabled:opacity-40 transition-colors">
              {wpTesting ? <Loader2 size={12} className="animate-spin" /> : <Wifi size={12} />} Test connection
            </button>
            <button type="button" onClick={fixCssCorruption} disabled={fixingCss || !wpUrl} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-white/10 rounded-lg text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#ff3b30]/40 disabled:opacity-40 transition-colors">
              {fixingCss ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Fix corrupted posts
            </button>
            <button type="button" onClick={fixThumbnails} disabled={fixingThumbs || !wpUrl} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-white/10 rounded-lg text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-[#ff9500]/40 disabled:opacity-40 transition-colors">
              {fixingThumbs ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Fix thumbnails
            </button>
            {wpTestResult && <span className={`text-xs font-medium ${wpTestResult.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{wpTestResult.message}</span>}
            {fixCssResult && <span className={`text-xs font-medium ${fixCssResult.startsWith('Error') ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>{fixCssResult}</span>}
            {fixThumbsResult && <span className={`text-xs font-medium ${fixThumbsResult.startsWith('Error') ? 'text-[#ff3b30]' : 'text-[#34c759]'}`}>{fixThumbsResult}</span>}
          </div>
        </div>
      </div>

      {/* Facebook */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <Facebook size={16} className="text-[#1877F2]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Facebook Page</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Auto-post blog links to your page when published</p>
          </div>
          {facebook.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Click <strong>Connect Facebook</strong> and you'll be redirected to Facebook to grant permission. We only request access to post on your page's behalf — we never read your personal messages or profile data. Once connected, new blog posts can be shared to your page in one click.
        </p>
        {fbNotice && <p className={`text-xs mb-3 ${fbNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{fbNotice.msg}</p>}
        {facebook.connected ? (
          <div className="flex flex-col gap-3">
            {facebook.pages.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Active page</label>
                <select value={facebook.pageId} onChange={e => selectFacebookPage(e.target.value)} className="input-field text-sm">
                  {facebook.pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            {facebook.pages.length === 1 && (
              <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" /> {facebook.pageName}
              </p>
            )}
            <button onClick={disconnectFacebook} disabled={fbDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {fbDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
            </button>
          </div>
        ) : <ManualFacebookToken onConnected={() => load()} />}
      </div>

      {/* Pinterest */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#fef0f0' }}>
            <Pin size={16} style={{ color: '#E60023' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Pinterest</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Pin blog posts to your Pinterest boards</p>
          </div>
          {pinterest.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Connect via OAuth and we'll import your boards automatically. After connecting, choose which board new pins should be saved to. We only request permission to create pins — we never read your private boards or personal data.
        </p>
        {ptNotice && <p className={`text-xs mb-3 ${ptNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{ptNotice.msg}</p>}
        {pinterest.connected ? (
          <div className="flex flex-col gap-3">
            {pinterest.boards.length > 1 ? (
              <div>
                <label className="block text-xs font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Active board</label>
                <select value={pinterest.boardId} onChange={e => selectPinterestBoard(e.target.value)} className="input-field text-sm">
                  {pinterest.boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            ) : (
              <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" /> {pinterest.boardName || pinterest.boardId}
              </p>
            )}
            <button onClick={disconnectPinterest} disabled={ptDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {ptDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="badge bg-[#ff9500]/10 text-[#ff9500]">Coming soon</span>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Pinterest API approval in progress — available shortly.</p>
          </div>
        )}
      </div>

      {/* Threads */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
            <MessageCircle size={16} className="text-[#1d1d1f] dark:text-[#f5f5f7]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Threads</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Auto-post blog summaries to your Threads profile</p>
          </div>
          {threads.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Threads uses a User Access Token from Meta's developer portal. Go to <strong>developers.facebook.com → My Apps → your app → Threads API → Settings → User Token Generator</strong>, generate a token for your account, and paste it below. The token is stored securely and used only to post on your behalf.
        </p>
        {thNotice && <p className={`text-xs mb-3 ${thNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{thNotice.msg}</p>}
        {threads.connected ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
              <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" /> {threads.username ? `@${threads.username}` : 'Threads account connected'}
            </p>
            <button onClick={disconnectThreads} disabled={thDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {thDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <ManualThreadsToken onConnected={(username) => setThreads({ connected: true, userId: '', username })} />
          </div>
        )}
      </div>

      {/* LinkedIn */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#e8f0fb' }}>
            <Linkedin size={16} style={{ color: '#0A66C2' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">LinkedIn</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Share blog posts as LinkedIn articles with your network</p>
          </div>
          {linkedin.connected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
          Click <strong>Connect LinkedIn</strong> and you'll be redirected to LinkedIn to authorise the connection. We only request permission to post on your profile — we never access your inbox, connections, or any other account data.
        </p>
        {liNotice && <p className={`text-xs mb-3 ${liNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{liNotice.msg}</p>}
        {linkedin.connected ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
              <Link2 size={13} className="text-[#86868b] dark:text-[#8e8e93]" />
              {linkedin.personName || 'LinkedIn account connected'}
            </p>
            <button onClick={disconnectLinkedIn} disabled={liDisconnecting} className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors self-start">
              {liDisconnecting ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />} Disconnect
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <a
              href="/api/auth/linkedin"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start transition-colors"
              style={{ backgroundColor: '#0A66C2' }}
            >
              <Linkedin size={14} /> Connect LinkedIn
            </a>
          </div>
        )}
      </div>

      {/* YouTube OAuth — for YouTube Studio (draft video metadata) */}
      <div className="card p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#ff0000]/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#ff0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">YouTube Studio</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Read draft videos and auto-generate metadata from ASINs</p>
            </div>
          </div>
          {youtubeOAuthConnected && <span className="flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
          Click <strong>Connect YouTube</strong> and sign in with the Google account that owns your channel. This grants read access to your private and draft videos so the YouTube Studio tool can show them here, and write access to push generated titles, descriptions, and tags back to YouTube — saving you from copy-pasting manually.
        </p>
        {ytOAuthNotice && (
          <p className={`text-xs ${ytOAuthNotice.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{ytOAuthNotice.msg}</p>
        )}
        {youtubeOAuthConnected ? (
          <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">
            Your Google account is connected. Visit <a href="/studio" className="text-[#0071e3] hover:underline">YouTube Studio</a> to generate metadata for your draft videos.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <a
              href="/api/auth/youtube"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white self-start transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#ff0000' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              Connect YouTube
            </a>
          </div>
        )}
      </div>

      {/* Geniuslink */}
      <div className="card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#0071e3]/10">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0071e3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Geniuslink</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Auto-create smart affiliate links from ASINs in YouTube Studio</p>
          </div>
          {geniuslinkKey && geniuslinkSecret && <span className="ml-auto flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
          Geniuslink turns a plain Amazon product link into a geo-targeted short link (e.g. <code className="bg-[var(--surface-2)] px-1 rounded">geni.us/abc123</code>) that routes shoppers to their local Amazon store. To connect, log in to your Geniuslink account, go to <a href="https://app.geni.us/settings" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">app.geni.us/settings → Integrate with our API</a>, and copy your <strong>API Key</strong> and <strong>API Secret</strong>.
        </p>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">API Key</label>
            <input type="text" value={geniuslinkKey} onChange={e => setGeniuslinkKey(e.target.value)} placeholder="e.g. e353413c5f52..." className="input-field text-xs font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">API Secret</label>
            <input type="password" value={geniuslinkSecret} onChange={e => setGeniuslinkSecret(e.target.value)} placeholder="Your Geniuslink API secret" className="input-field text-xs font-mono" />
          </div>
        </div>
      </div>

      {/* Amazon Associates */}
      <div className="card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#ff9900]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-sm">🛒</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Amazon Associates</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Used as affiliate link fallback when Geniuslink isn't configured</p>
          </div>
          {amazonAssociatesTag && <span className="ml-auto flex items-center gap-1 text-xs font-medium text-[#34c759]"><Check size={12} /> Connected</span>}
        </div>
        <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
          If you're not using Geniuslink, your Amazon Associates tracking tag is used as the fallback — it's appended to product URLs so you still earn commissions. Find your tag in <a href="https://affiliate-program.amazon.com/home/account/tag/manage" target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline">Amazon Associates → Account → Manage Tracking IDs</a>. It looks like <code className="bg-[var(--surface-2)] px-1 rounded">yourbrand-20</code>.
        </p>
        <div>
          <label className="block text-xs font-medium text-[#6e6e73] dark:text-[#ebebf0] mb-1">Associates Tag</label>
          <input
            type="text"
            value={amazonAssociatesTag}
            onChange={e => setAmazonAssociatesTag(e.target.value)}
            placeholder="e.g. yourtag-20"
            className="input-field text-xs font-mono"
          />
        </div>
      </div>

      {error && <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">{error}</p>}

      <button onClick={save} disabled={saving} className="btn-primary self-start">
        {saved ? <><Check size={14} /> Saved!</> : saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save</>}
      </button>
    </div>
  )
}

// ─── Wizard shell ─────────────────────────────────────────────────────────────
function SetupPageInner() {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<'wordpress' | 'integrations'>(
    searchParams.get('tab') === 'integrations' ? 'integrations' : 'wordpress'
  )
  const [mode, setMode] = useState<Mode>(null)
  const [step, setStep] = useState<Step>(1)
  const [wordpressUrl, setWordpressUrl] = useState('')
  const [accentColor, setAccentColor] = useState('#f5a623')
  const [siteUrl, setSiteUrl] = useState('')
  const [username, setUsername] = useState('')
  const [brandData, setBrandData] = useState<BrandData>(defaultBrand)
  const [hydrated, setHydrated] = useState(false)
  const [setupComplete, setSetupComplete] = useState(false)
  const [completedUrl, setCompletedUrl] = useState('')
  const supabase = createBrowserClient()

  useEffect(() => {
    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: intRow } = await (supabase as any).from('integrations').select('wordpress_url,wp_site_url').eq('user_id', user.id).single()
          const connectedUrl = intRow?.wordpress_url || intRow?.wp_site_url
          if (connectedUrl) {
            setSetupComplete(true)
            setCompletedUrl(connectedUrl)
            setHydrated(true)
            return
          }
        }
      } catch { /* ignore */ }

      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const d = JSON.parse(raw)
          // If localStorage says we're connected, trust it as a fallback
          if (d.setupComplete && d.completedUrl) {
            setSetupComplete(true)
            setCompletedUrl(d.completedUrl)
            setHydrated(true)
            return
          }
          if (d.mode) setMode(d.mode as Mode)
          if (d.step && d.step < 5) setStep(d.step as Step)
          if (d.brandData) setBrandData(d.brandData)
          if (d.siteUrl) setSiteUrl(d.siteUrl)
          if (d.username) setUsername(d.username)
          if (d.accentColor) setAccentColor(d.accentColor)
          if (d.wordpressUrl) setWordpressUrl(d.wordpressUrl)
        }
      } catch { /* ignore */ }
      setHydrated(true)
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, step, brandData, siteUrl, username, accentColor, wordpressUrl, setupComplete, completedUrl }))
    } catch { /* ignore */ }
  }, [mode, step, brandData, siteUrl, username, accentColor, wordpressUrl, setupComplete, completedUrl, hydrated])

  async function handleReset() {
    // Clear Supabase wordpress_url so refresh doesn't re-detect as connected
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from('integrations').update({
          wordpress_url: null,
          wordpress_username: null,
          wordpress_app_password: null,
          wordpress_api_token: null,
        }).eq('user_id', user.id)
      }
    } catch { /* ignore */ }
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    setSetupComplete(false); setCompletedUrl(''); setMode(null); setStep(1); setBrandData(defaultBrand)
    setSiteUrl(''); setUsername(''); setAccentColor('#f5a623'); setWordpressUrl('')
  }

  if (!hydrated) return null

  // ── Tab bar (always shown) ─────────────────────────────────────────────────
  const TabBar = () => (
    <div className="flex items-center gap-1 bg-[#f5f5f7] dark:bg-[#000] p-1 rounded-xl w-fit mb-6">
      {([
        { key: 'wordpress', label: 'WordPress' },
        { key: 'integrations', label: 'Integrations' },
      ] as const).map(({ key, label }) => (
        <button
          key={key}
          onClick={() => setTab(key)}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === key
              ? 'bg-white dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-apple-sm border border-gray-200/80 dark:border-white/10'
              : 'text-[#6e6e73] dark:text-[#ebebf0] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  // ── Integrations tab ───────────────────────────────────────────────────────
  if (tab === 'integrations') {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Site & Integrations</h1>
        </div>
        <TabBar />
        <IntegrationsPanel onLoad={() => {}} />
      </div>
    )
  }

  // ── Already connected (WordPress tab) ─────────────────────────────────────
  if (setupComplete) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Site & Integrations</h1>
        </div>
        <TabBar />
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
            <div className="w-9 h-9 rounded-full bg-[#34c759]/10 flex items-center justify-center flex-shrink-0">
              <CheckCircle size={18} className="text-[#34c759]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">WordPress connected</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] truncate mt-0.5">{completedUrl || 'Your blog is ready to publish.'}</p>
            </div>
            <span className="flex items-center gap-1 text-xs font-medium text-[#34c759] flex-shrink-0">
              <Check size={12} /> Active
            </span>
          </div>
          <div className="flex items-center gap-3">
            {completedUrl && (
              <a href={completedUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs">
                Visit blog <ExternalLink size={11} />
              </a>
            )}
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#ff3b30] transition-colors"
            >
              <LogOut size={12} /> Disconnect & connect a different site
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Mode picker ────────────────────────────────────────────────────────────
  if (mode === null) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Site & Integrations</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Connect your affiliate blog to start publishing from YouTube.</p>
        </div>
        <TabBar />
        <div className="card p-7">
          <ModePicker onSelect={setMode} />
        </div>
      </div>
    )
  }

  // ── Existing site connect flow ─────────────────────────────────────────────
  if (mode === 'existing') {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Site & Integrations</h1>
        </div>
        <TabBar />
        <div className="card p-7">
          <ExistingConnect
            onBack={() => setMode(null)}
            onDone={url => {
              setSetupComplete(true); setCompletedUrl(url)
              try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
            }}
          />
        </div>
      </div>
    )
  }

  // ── Full new-site wizard ───────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Site & Integrations</h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Get your WordPress affiliate blog running in minutes.</p>
      </div>
      <TabBar />

      <div className="flex items-center justify-between mb-2">
        <StepIndicator current={step} />
      </div>
      <div className="mb-4">
        <button onClick={() => { setMode(null); setStep(1) }} className="inline-flex items-center gap-1.5 text-xs text-[#86868b] dark:text-[#8e8e93] hover:text-[#0071e3] transition-colors">
          <ArrowLeft size={12} /> Change setup type
        </button>
      </div>

      <div className="card p-7">
        {step === 1 && <Step1 onNext={() => setStep(2)} onBack={() => setMode(null)} />}
        {step === 2 && <Step2 onNext={() => setStep(3)} />}
        {step === 3 && <Step3 data={brandData} onChange={setBrandData} onNext={() => setStep(4)} />}
        {step === 4 && (
          <Step4
            brandData={brandData} siteUrl={siteUrl} setSiteUrl={setSiteUrl}
            username={username} setUsername={setUsername}
            accentColor={accentColor} setAccentColor={setAccentColor}
            onNext={url => { setWordpressUrl(url); setStep(5) }}
          />
        )}
        {step === 5 && <Step5 wordpressUrl={wordpressUrl} accentColor={accentColor} />}
      </div>
    </div>
  )
}

export default function SetupPage() {
  return (
    <Suspense>
      <SetupPageInner />
    </Suspense>
  )
}
