'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ExternalLink, CheckCircle, ChevronRight, Loader2,
  Globe, Wrench, Sparkles, Link2, Rocket, Eye, EyeOff,
  Download, Upload, X, ArrowLeft, Building2, Wand2,
  Facebook, Pin, MessageCircle, Wifi, Check, LogOut, Save,
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
          Choose the option that fits your situation. You can always start fresh later.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => onSelect('existing')}
          className="group flex flex-col items-start gap-4 p-6 rounded-2xl border-2 border-gray-200 dark:border-white/10 hover:border-[#0071e3] bg-white dark:bg-[#1c1c1e] text-left transition-all hover:shadow-md"
        >
          <div className="w-12 h-12 rounded-xl bg-[#0071e3]/10 flex items-center justify-center group-hover:bg-[#0071e3]/20 transition-colors">
            <Building2 size={22} className="text-[#0071e3]" />
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">I already have a WordPress blog</p>
            <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
              Connect your existing site. MVP Affiliate will only publish new posts — it won&apos;t touch your theme, design, or existing content.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0071e3] group-hover:gap-2.5 transition-all">
            Connect my site <ChevronRight size={15} />
          </span>
        </button>

        <button
          onClick={() => onSelect('new')}
          className="group flex flex-col items-start gap-4 p-6 rounded-2xl border-2 border-gray-200 dark:border-white/10 hover:border-[#34c759] bg-white dark:bg-[#1c1c1e] text-left transition-all hover:shadow-md"
        >
          <div className="w-12 h-12 rounded-xl bg-[#34c759]/10 flex items-center justify-center group-hover:bg-[#34c759]/20 transition-colors">
            <Wand2 size={22} className="text-[#34c759]" />
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Build me a new blog from scratch</p>
            <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] leading-relaxed">
              Start fresh with Hostinger hosting. We&apos;ll set up WordPress, install your theme, create your home page, and configure everything automatically.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#34c759] group-hover:gap-2.5 transition-all">
            Start the setup wizard <ChevronRight size={15} />
          </span>
        </button>
      </div>
    </div>
  )
}

// ─── Existing site connect ────────────────────────────────────────────────────
function ExistingConnect({ onBack, onDone }: { onBack: () => void; onDone: (url: string) => void }) {
  const [siteUrl, setSiteUrl] = useState('')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = siteUrl.trim() && username.trim() && appPassword.trim() && !loading

  async function handleConnect() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/wordpress/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: siteUrl.trim(), username: username.trim(), appPassword: appPassword.trim() }),
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
        <h2 className="text-xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Connect your WordPress site</h2>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0]">
          MVP Affiliate will only publish posts — it won&apos;t change your theme, design, or any existing content.
        </p>
      </div>

      <div className="bg-[#f5f5f7] dark:bg-[#000] rounded-xl p-5">
        <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">You&apos;ll need a WordPress Application Password</p>
        <ol className="flex flex-col gap-2">
          {[
            'Log in to your WordPress admin (yourdomain.com/wp-admin).',
            'Go to Users → Profile, scroll down to "Application Passwords".',
            'Enter a name like "MVP Affiliate" and click "Add New Application Password".',
            'Copy the generated password (spaces are fine — paste it as-is).',
          ].map((text, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="w-4 h-4 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{text}</p>
            </li>
          ))}
        </ol>
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
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Application Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={appPassword}
              onChange={e => setAppPassword(e.target.value)}
              placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              className="input-field pr-10"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">Not your regular password — this is a separate Application Password created in your WordPress profile.</p>
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
  const [wpTesting, setWpTesting] = useState(false)
  const [wpTestResult, setWpTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [fixingCss, setFixingCss] = useState(false)
  const [fixCssResult, setFixCssResult] = useState<string | null>(null)
  const [fixingThumbs, setFixingThumbs] = useState(false)
  const [fixThumbsResult, setFixThumbsResult] = useState<string | null>(null)
  const [wpUrl, setWpUrl] = useState('')
  const [wpUsername, setWpUsername] = useState('')
  const [wpAppPassword, setWpAppPassword] = useState('')
  const [wpApiToken, setWpApiToken] = useState('')
  const [showWpPassword, setShowWpPassword] = useState(false)
  const [showWpToken, setShowWpToken] = useState(false)
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
      setWpApiToken(row.wordpress_api_token ?? '')
      const pages = JSON.parse(row.facebook_pages_json || '[]')
      setFacebook({ connected: !!row.facebook_page_id, pageName: row.facebook_page_name ?? '', pageId: row.facebook_page_id ?? '', pages })
      const boards = JSON.parse(row.pinterest_boards_json || '[]')
      setPinterest({ connected: !!row.pinterest_access_token && !!row.pinterest_board_id, boardId: row.pinterest_board_id ?? '', boardName: row.pinterest_board_name ?? '', boards })
      setThreads({ connected: !!row.threads_access_token, userId: row.threads_user_id ?? '', username: row.threads_username ?? '' })
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
  }, [searchParams])

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
      wordpress_api_token: wpApiToken || null,
    }, { onConflict: 'user_id' })
    setSaving(false)
    if (err) { setError(err.message) } else { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  async function testWordPress() {
    setWpTesting(true); setWpTestResult(null)
    try {
      const res = await fetch('/api/wordpress/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: wpUrl, username: wpUsername, password: wpAppPassword, apiToken: wpApiToken || undefined }) })
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
    await fetch('/api/auth/facebook/disconnect', { method: 'POST' })
    setFacebook({ connected: false, pageName: '', pageId: '', pages: [] })
    setFbDisconnecting(false)
  }

  async function selectFacebookPage(pageId: string) {
    const res = await fetch('/api/auth/facebook/select-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageId }) })
    const data = await res.json()
    if (data.ok) setFacebook(prev => ({ ...prev, pageId: data.page.id, pageName: data.page.name }))
  }

  async function disconnectPinterest() {
    setPtDisconnecting(true)
    await fetch('/api/auth/pinterest/disconnect', { method: 'POST' })
    setPinterest({ connected: false, boardId: '', boardName: '', boards: [] })
    setPtDisconnecting(false)
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
    await fetch('/api/auth/threads/disconnect', { method: 'POST' })
    setThreads({ connected: false, userId: '', username: '' })
    setThDisconnecting(false)
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

      {/* YouTube */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100 dark:border-white/10">
          <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#FF0000"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 0 0 .5 6.19C0 8.03 0 12 0 12s0 3.97.5 5.81a3.02 3.02 0 0 0 2.12 2.14C4.46 20.5 12 20.5 12 20.5s7.54 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14C24 15.97 24 12 24 12s0-3.97-.5-5.81zM9.75 15.5v-7l6.5 3.5-6.5 3.5z"/></svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">YouTube</p>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Paste your channel ID to sync videos</p>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Channel ID</label>
          <input type="text" value={youtubeChannelId} onChange={e => setYoutubeChannelId(e.target.value)} placeholder="UCxxxxxxxxxxxxxxx" className="input-field font-mono text-xs" />
          <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">Found in your YouTube Studio → Settings → Channel → Advanced</p>
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
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93]">Update credentials if needed</p>
          </div>
        </div>
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
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">Application Password</label>
            <div className="relative">
              <input type={showWpPassword ? 'text' : 'password'} value={wpAppPassword} onChange={e => setWpAppPassword(e.target.value)} placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" className="input-field pr-10 font-mono text-xs" />
              <button type="button" onClick={() => setShowWpPassword(!showWpPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">
                {showWpPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">WP Admin → Users → Profile → Application Passwords</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1.5">
              API Token <span className="text-xs font-normal text-[#86868b] dark:text-[#8e8e93]">— recommended for Hostinger</span>
            </label>
            <div className="relative">
              <input type={showWpToken ? 'text' : 'password'} value={wpApiToken} onChange={e => setWpApiToken(e.target.value)} placeholder="ctt_k8mP2xQnR5vL9wJ3..." className="input-field pr-10 font-mono text-xs" />
              <button type="button" onClick={() => setShowWpToken(!showWpToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] dark:text-[#8e8e93] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]">
                {showWpToken ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-1">Set this in wp-config.php as CONTENT_TOOL_TOKEN and install the mu-plugin — bypasses host auth issues</p>
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
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">Connect your Pinterest account to pin blog posts directly from the content page.</p>
            <button onClick={() => { window.location.href = '/api/auth/pinterest' }} className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors self-start" style={{ background: '#E60023' }}>
              <Pin size={14} /> Connect Pinterest
            </button>
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
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">Connect your Threads account to post blog summaries directly from the content page.</p>
            <ManualThreadsToken onConnected={(username) => setThreads({ connected: true, userId: '', username })} />
          </div>
        )}
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, step, brandData, siteUrl, username, accentColor, wordpressUrl }))
    } catch { /* ignore */ }
  }, [mode, step, brandData, siteUrl, username, accentColor, wordpressUrl, hydrated])

  function handleReset() {
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    setSetupComplete(false); setMode(null); setStep(1); setBrandData(defaultBrand)
    setSiteUrl(''); setUsername(''); setAccentColor('#f5a623'); setWordpressUrl('')
  }

  if (!hydrated) return null

  // ── Already connected ──────────────────────────────────────────────────────
  if (setupComplete) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Blog Setup</h1>
        </div>

        {/* WordPress connected card */}
        <div className="card p-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-[#34c759]/10 flex items-center justify-center flex-shrink-0">
              <CheckCircle size={22} className="text-[#34c759]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">WordPress connected</p>
              <p className="text-xs text-[#86868b] dark:text-[#8e8e93] mt-0.5">Your blog is connected and ready to publish.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {completedUrl && (
              <a href={completedUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs">
                Visit Blog <ExternalLink size={11} />
              </a>
            )}
            <button onClick={handleReset} className="btn-secondary text-xs text-[#ff3b30] border-[#ff3b30]/30 hover:border-[#ff3b30]">
              Reset
            </button>
          </div>
        </div>

        {/* Integrations section */}
        <IntegrationsPanel onLoad={() => {}} />
      </div>
    )
  }

  // ── Mode picker ────────────────────────────────────────────────────────────
  if (mode === null) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Blog Setup</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Connect your affiliate blog to start publishing from YouTube.</p>
        </div>
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
          <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Blog Setup</h1>
        </div>
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
        <h1 className="text-2xl font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">Blog Setup</h1>
        <p className="text-sm text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">Get your WordPress affiliate blog running in minutes.</p>
      </div>

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
