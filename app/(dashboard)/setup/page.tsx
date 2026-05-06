'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ExternalLink, CheckCircle, ChevronRight, Loader2,
  Globe, Wrench, Link2, Rocket, Eye, EyeOff, Download,
} from 'lucide-react'

type Step = 1 | 2 | 3 | 4

const steps = [
  { n: 1, label: 'Create account', icon: Globe },
  { n: 2, label: 'Install WordPress', icon: Wrench },
  { n: 3, label: 'Connect', icon: Link2 },
  { n: 4, label: 'Done', icon: Rocket },
]

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center mb-10">
      {steps.map((s, i) => {
        const done = current > s.n
        const active = current === s.n
        const Icon = s.icon
        return (
          <div key={s.n} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                done ? 'bg-[#34c759] text-white' :
                active ? 'bg-[#0071e3] text-white' :
                'bg-gray-100 text-[#86868b]'
              }`}>
                {done ? <CheckCircle size={18} /> : <Icon size={16} />}
              </div>
              <span className={`text-xs font-medium whitespace-nowrap ${active ? 'text-[#1d1d1f]' : 'text-[#86868b]'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-16 h-px mx-2 mb-5 ${current > s.n ? 'bg-[#34c759]' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step 1: Create Hostinger account ────────────────────────────────────────
function Step1({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] mb-1">Create your Hostinger account</h2>
        <p className="text-sm text-[#6e6e73]">
          Hostinger is where your affiliate blog will live. You'll get a domain and fast hosting for under $3/month.
        </p>
      </div>

      {/* CTA card */}
      <div className="card p-5 border border-[#0071e3]/20 bg-[#0071e3]/3">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#0071e3]/10 flex items-center justify-center flex-shrink-0">
            <Globe size={20} className="text-[#0071e3]" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#1d1d1f] mb-0.5">Hostinger Web Hosting</p>
            <p className="text-xs text-[#6e6e73] mb-3">
              Includes a free domain name, 1-click WordPress installer, fast SSD hosting, and free SSL.
              The <strong>Premium</strong> plan is the sweet spot — enough for multiple sites.
            </p>
            <a
              href="https://geni.us/ANaArQ"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-sm"
            >
              Get Hostinger → <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="bg-[#f5f5f7] rounded-xl p-5">
        <p className="text-xs font-semibold text-[#1d1d1f] mb-3">What to do on Hostinger:</p>
        <ol className="flex flex-col gap-3">
          {[
            { n: 1, text: 'Click the link above and choose a hosting plan — Premium or Business recommended.' },
            { n: 2, text: 'During checkout, register a new domain name (included free for the first year).' },
            { n: 3, text: 'Complete payment and set up your account.' },
            { n: 4, text: 'Come back here — the next step will walk you through installing WordPress.' },
          ].map(({ n, text }) => (
            <li key={n} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[#0071e3]/10 text-[#0071e3] text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {n}
              </span>
              <p className="text-xs text-[#6e6e73]">{text}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={onNext} className="btn-primary">
          I have a Hostinger account <ChevronRight size={15} />
        </button>
        <p className="text-xs text-[#86868b]">Already signed up? Skip ahead.</p>
      </div>
    </div>
  )
}

// ─── Step 2: Install WordPress via hPanel ─────────────────────────────────────
function Step2({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] mb-1">Install WordPress on your domain</h2>
        <p className="text-sm text-[#6e6e73]">
          Hostinger has a built-in 1-click WordPress installer. Follow these steps inside hPanel.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {[
          {
            n: 1,
            title: 'Log in to hPanel',
            desc: 'Go to hpanel.hostinger.com and sign in to your Hostinger account.',
            action: { label: 'Open hPanel', href: 'https://hpanel.hostinger.com' },
          },
          {
            n: 2,
            title: 'Click "WordPress" in the sidebar',
            desc: 'In the left menu, find the WordPress section and click it.',
          },
          {
            n: 3,
            title: 'Click "Install"',
            desc: 'Hit the Install button. Select your domain from the dropdown.',
          },
          {
            n: 4,
            title: 'Set your admin credentials',
            desc: 'Enter an admin username, email, and a strong password. Write these down — you\'ll need them.',
          },
          {
            n: 5,
            title: 'Click "Install" and wait',
            desc: 'WordPress installs in about 1–2 minutes. You\'ll see a success message when done.',
          },
        ].map(({ n, title, desc, action }) => (
          <div key={n} className="flex items-start gap-4 p-4 rounded-xl bg-[#f5f5f7]">
            <span className="w-6 h-6 rounded-full bg-[#1d1d1f] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
              {n}
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-[#1d1d1f] mb-0.5">{title}</p>
              <p className="text-xs text-[#6e6e73]">{desc}</p>
            </div>
            {action && (
              <a
                href={action.href}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary text-xs px-3 py-1.5 flex-shrink-0"
              >
                {action.label} <ExternalLink size={11} />
              </a>
            )}
          </div>
        ))}
      </div>

      <button onClick={onNext} className="btn-primary self-start">
        WordPress is installed <ChevronRight size={15} />
      </button>
    </div>
  )
}

// ─── Step 3: Connect via App Password ────────────────────────────────────────
function Step3({ onNext }: { onNext: (url: string) => void }) {
  const [siteUrl, setSiteUrl] = useState('')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConnect() {
    let url = siteUrl.trim()
    if (!url.startsWith('http')) url = `https://${url}`
    url = url.replace(/\/wp-admin\/?.*$/, '').replace(/\/$/, '')
    if (!url || !username.trim() || !appPassword.trim()) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/wordpress/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: url, username: username.trim(), appPassword: appPassword.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onNext(url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection failed. Check your URL and password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] mb-1">Connect WordPress to AffiliateOS</h2>
        <p className="text-sm text-[#6e6e73]">
          We use WordPress Application Passwords — a secure way to publish posts without sharing your main password.
        </p>
      </div>

      {/* How to get App Password */}
      <div className="bg-[#f5f5f7] rounded-xl p-5">
        <p className="text-xs font-semibold text-[#1d1d1f] mb-3">How to generate an Application Password:</p>
        <ol className="flex flex-col gap-2.5">
          {[
            'Log in to your WordPress admin at yourdomain.com/wp-admin',
            'Click your username in the top right → Edit Profile',
            'Scroll down to "Application Passwords"',
            'Type "AffiliateOS" as the name and click "Add New Application Password"',
            'Copy the password shown — it won\'t appear again',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-white border border-gray-200 text-[#6e6e73] text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <p className="text-xs text-[#6e6e73]">{step}</p>
            </li>
          ))}
        </ol>
      </div>

      {/* Fields */}
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">WordPress site URL</label>
          <input
            type="text"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="gominreviews.com"
            className="input-field"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">WordPress username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. gomin"
            className="input-field"
          />
          <p className="text-xs text-[#86868b] mt-1">The username you use to log into wp-admin.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Application Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              className="input-field pr-10 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#86868b] hover:text-[#1d1d1f]"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-xs text-[#86868b] mt-1">Generated in WP Admin → Users → Profile → Application Passwords.</p>
        </div>
      </div>

      {error && (
        <p className="text-sm text-[#ff3b30] bg-[#ff3b30]/5 border border-[#ff3b30]/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        onClick={handleConnect}
        disabled={!siteUrl.trim() || !username.trim() || !appPassword.trim() || loading}
        className="btn-primary self-start"
      >
        {loading
          ? <><Loader2 size={15} className="animate-spin" /> Connecting…</>
          : <><Link2 size={15} /> Connect WordPress</>
        }
      </button>
    </div>
  )
}

// ─── Step 4: Done ─────────────────────────────────────────────────────────────
function Step4({ wordpressUrl }: { wordpressUrl: string }) {
  const router = useRouter()
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <div className="w-16 h-16 rounded-full bg-[#34c759]/15 flex items-center justify-center">
        <CheckCircle size={32} className="text-[#34c759]" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] mb-1">Your blog is connected!</h2>
        <p className="text-sm text-[#6e6e73]">
          AffiliateOS can now publish directly to{' '}
          <a href={wordpressUrl} target="_blank" rel="noopener noreferrer" className="text-[#0071e3] hover:underline font-medium">
            {wordpressUrl}
          </a>
        </p>
      </div>

      {/* Theme download */}
      <div className="bg-[#f5f5f7] rounded-xl p-5 text-left w-full max-w-md">
        <p className="text-xs font-semibold text-[#1d1d1f] mb-1">Install the magazine theme</p>
        <p className="text-xs text-[#6e6e73] mb-3">
          Download our Kadence child theme and upload it via WordPress Admin → Appearance → Themes → Add New → Upload Theme.
        </p>
        <div className="flex flex-col gap-2">
          <a
            href="/api/wordpress/theme"
            download="kadence-affiliate-child.zip"
            className="btn-primary text-sm"
          >
            <Download size={14} /> Download theme ZIP
          </a>
          <ol className="text-xs text-[#86868b] space-y-1 list-none mt-1">
            <li>1. Download the ZIP above</li>
            <li>2. WordPress Admin → Appearance → Themes → Add New → Upload Theme</li>
            <li>3. Upload the ZIP → Activate</li>
          </ol>
        </div>
      </div>

      <div className="bg-[#f5f5f7] rounded-xl p-4 text-left w-full max-w-md">
        <p className="text-xs font-semibold text-[#1d1d1f] mb-2">What&apos;s next:</p>
        <ul className="text-xs text-[#6e6e73] space-y-1.5 list-disc list-inside">
          <li>Go to Brand Profile and set your voice and niche</li>
          <li>Sync your YouTube channel on the Content page</li>
          <li>Add your Anthropic API key in Settings to enable blog generation</li>
        </ul>
      </div>

      <div className="flex gap-3">
        <a
          href={`${wordpressUrl}/wp-admin`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary"
        >
          WordPress admin <ExternalLink size={13} />
        </a>
        <button onClick={() => router.push('/brand')} className="btn-primary">
          Set up brand profile <ChevronRight size={15} />
        </button>
      </div>
    </div>
  )
}

// ─── Wizard shell ─────────────────────────────────────────────────────────────
export default function SetupPage() {
  const [step, setStep] = useState<Step>(1)
  const [wordpressUrl, setWordpressUrl] = useState('')

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1d1d1f] tracking-tight">Blog Setup</h1>
        <p className="text-sm text-[#6e6e73] mt-0.5">
          Get your WordPress affiliate blog running in minutes.
        </p>
      </div>

      <StepIndicator current={step} />

      <div className="card p-7">
        {step === 1 && <Step1 onNext={() => setStep(2)} />}
        {step === 2 && <Step2 onNext={() => setStep(3)} />}
        {step === 3 && <Step3 onNext={(url) => { setWordpressUrl(url); setStep(4) }} />}
        {step === 4 && <Step4 wordpressUrl={wordpressUrl} />}
      </div>
    </div>
  )
}
