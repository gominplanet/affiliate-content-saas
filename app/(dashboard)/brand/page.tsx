'use client'

import { useEffect, useState, useCallback } from 'react'
import Header from '@/components/layout/Header'
import { Save, Check } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'

// ─── Amazon-style niches ──────────────────────────────────────────────────────
const NICHES = [
  'Home & Kitchen', 'Electronics & Tech', 'Outdoor & Sports', 'Beauty & Personal Care',
  'Health & Wellness', 'Pet Supplies', 'Tools & Home Improvement', 'Toys & Games',
  'Books & Education', 'Fashion & Apparel', 'Garden & Outdoors', 'Automotive',
  'Baby & Kids', 'Office & Productivity', 'Food & Grocery', 'Travel & Luggage',
  'Arts & Crafts', 'Musical Instruments', 'Software & Apps', 'Finance & Investing',
]

const TONE_OPTIONS = [
  'Professional', 'Conversational', 'Bold', 'Friendly',
  'Educational', 'Persuasive', 'Humorous', 'Inspiring',
]

// ─── Color palette ────────────────────────────────────────────────────────────
const COLORS = [
  // Blues
  '#0071e3', '#0ea5e9', '#3b82f6', '#6366f1',
  // Greens
  '#34c759', '#10b981', '#22c55e', '#84cc16',
  // Reds / Pinks
  '#ff3b30', '#ef4444', '#ec4899', '#f43f5e',
  // Oranges / Yellows
  '#ff9500', '#f97316', '#eab308', '#fbbf24',
  // Purples
  '#af52de', '#a855f7', '#7c3aed', '#8b5cf6',
  // Neutrals
  '#1d1d1f', '#374151', '#6b7280', '#d1d5db',
]

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (color: string) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-5 h-5 rounded-md border border-gray-200 flex-shrink-0" style={{ backgroundColor: value }} />
        <p className="text-xs font-medium text-[#6e6e73]">{label}</p>
        <code className="text-xs font-mono text-[#86868b] ml-auto">{value}</code>
      </div>
      <div className="grid grid-cols-8 gap-1.5">
        {COLORS.map((color) => (
          <button
            key={color}
            onClick={() => onChange(color)}
            className="w-7 h-7 rounded-lg border-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: color,
              borderColor: value === color ? '#1d1d1f' : 'transparent',
            }}
            title={color}
          />
        ))}
      </div>
    </div>
  )
}

function WordCount({ text, max }: { text: string; max: number }) {
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length
  const pct = Math.min((words / max) * 100, 100)
  const over = words > max
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${over ? 'bg-[#ff3b30]' : pct > 80 ? 'bg-[#ff9500]' : 'bg-[#0071e3]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums ${over ? 'text-[#ff3b30]' : 'text-[#86868b]'}`}>
        {words} / {max} words
      </span>
    </div>
  )
}

interface BrandData {
  name: string
  tagline: string
  author_name: string
  website_url: string
  niches: string[]
  tone: string[]
  post_length: string
  cta_style: string
  affiliate_disclaimer: string
  primary_color: string
  secondary_color: string
  writing_sample: string
}

const DEFAULT: BrandData = {
  name: '',
  tagline: '',
  author_name: '',
  website_url: '',
  niches: [],
  tone: [],
  post_length: 'medium',
  cta_style: 'soft_recommendation',
  affiliate_disclaimer: 'This post contains affiliate links. I may earn a commission at no extra cost to you.',
  primary_color: '#0071e3',
  secondary_color: '#34c759',
  writing_sample: '',
}

export default function BrandPage() {
  const supabase = createBrowserClient()
  const [data, setData] = useState<BrandData>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: row } = await supabase
      .from('brand_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()
    if (row) {
      setData({
        name: row.name ?? '',
        tagline: row.tagline ?? '',
        author_name: row.author_name ?? '',
        website_url: row.website_url ?? '',
        niches: row.niches ?? [],
        tone: row.tone ?? [],
        post_length: row.post_length ?? 'medium',
        cta_style: row.cta_style ?? 'soft_recommendation',
        affiliate_disclaimer: row.affiliate_disclaimer ?? DEFAULT.affiliate_disclaimer,
        primary_color: row.primary_color ?? '#0071e3',
        secondary_color: row.secondary_color ?? '#34c759',
        writing_sample: row.writing_sample ?? '',
      })
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('brand_profiles').upsert(
      { ...data, user_id: user.id },
      { onConflict: 'user_id' },
    )
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  function set<K extends keyof BrandData>(key: K, value: BrandData[K]) {
    setData((prev) => ({ ...prev, [key]: value }))
  }

  function toggleArray(key: 'niches' | 'tone', value: string) {
    setData((prev) => ({
      ...prev,
      [key]: prev[key].includes(value)
        ? prev[key].filter((v) => v !== value)
        : [...prev[key], value],
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#86868b] text-sm">
        Loading…
      </div>
    )
  }

  return (
    <>
      <Header
        title="Brand Profile"
        subtitle="Define your brand voice for consistent AI-generated content."
        actions={
          <button onClick={save} disabled={saving} className="btn-primary">
            {saved
              ? <><Check size={14} /> Saved!</>
              : saving
              ? 'Saving…'
              : <><Save size={14} /> Save changes</>
            }
          </button>
        }
      />

      <div className="grid grid-cols-3 gap-6">
        {/* Left — identity */}
        <div className="col-span-2 flex flex-col gap-5">

          {/* Basic info */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-4">Brand Identity</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Brand / Site name</label>
                <input
                  type="text"
                  value={data.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. GearHunter"
                  className="input-field"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Tagline</label>
                <input
                  type="text"
                  value={data.tagline}
                  onChange={(e) => set('tagline', e.target.value)}
                  placeholder="One-line description of your brand"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Author name</label>
                <input
                  type="text"
                  value={data.author_name}
                  onChange={(e) => set('author_name', e.target.value)}
                  placeholder="Jane Smith"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#1d1d1f] mb-1.5">Website URL</label>
                <input
                  type="url"
                  value={data.website_url}
                  onChange={(e) => set('website_url', e.target.value)}
                  placeholder="https://yourdomain.com"
                  className="input-field"
                />
              </div>
            </div>
          </div>

          {/* Niches */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-1">Affiliate Niches</h2>
            <p className="text-xs text-[#6e6e73] mb-4">Select the product categories you promote.</p>
            <div className="flex flex-wrap gap-2">
              {NICHES.map((niche) => {
                const active = data.niches.includes(niche)
                return (
                  <button
                    key={niche}
                    onClick={() => toggleArray('niches', niche)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-[#0071e3]/10 text-[#0071e3] border-[#0071e3]/30'
                        : 'bg-white text-[#6e6e73] border-gray-200 hover:border-[#0071e3]/40 hover:text-[#0071e3]'
                    }`}
                  >
                    {niche}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Writing sample */}
          <div className="card p-6">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-1">Your Writing Style</h2>
            <p className="text-xs text-[#6e6e73] mb-4">
              Paste a sample of your writing — a blog post, email, or caption you&apos;re happy with.
              The AI uses this to match your voice and tone when generating content.
            </p>
            <textarea
              rows={10}
              maxLength={6000}
              value={data.writing_sample}
              onChange={(e) => set('writing_sample', e.target.value)}
              placeholder="Paste up to 1,000 words of your own writing here…"
              className="input-field resize-none leading-relaxed"
            />
            <WordCount text={data.writing_sample} max={1000} />
          </div>
        </div>

        {/* Right — voice & style */}
        <div className="flex flex-col gap-5">

          {/* Tone */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-1">Brand Tone</h2>
            <p className="text-xs text-[#6e6e73] mb-4">Select all that apply.</p>
            <div className="flex flex-col gap-1">
              {TONE_OPTIONS.map((tone) => {
                const active = data.tone.includes(tone)
                return (
                  <label key={tone} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <div
                      onClick={() => toggleArray('tone', tone)}
                      className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors ${
                        active ? 'bg-[#0071e3] border-[#0071e3]' : 'border-gray-300'
                      }`}
                    >
                      {active && <Check size={10} className="text-white" />}
                    </div>
                    <span className="text-sm text-[#1d1d1f]">{tone}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {/* Writing preferences */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-4">Content Preferences</h2>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6e6e73] mb-1.5">Post length</label>
                <select
                  value={data.post_length}
                  onChange={(e) => set('post_length', e.target.value)}
                  className="input-field text-xs"
                >
                  <option value="short">Short (600–900 words)</option>
                  <option value="medium">Medium (900–1,500 words)</option>
                  <option value="long">Long (1,500–2,500 words)</option>
                  <option value="deep">Deep-dive (2,500+ words)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6e6e73] mb-1.5">CTA style</label>
                <select
                  value={data.cta_style}
                  onChange={(e) => set('cta_style', e.target.value)}
                  className="input-field text-xs"
                >
                  <option value="soft_recommendation">Soft recommendation</option>
                  <option value="direct_cta">Direct CTA</option>
                  <option value="comparison_table">Comparison table</option>
                  <option value="pros_cons">Pros / cons list</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6e6e73] mb-1.5">Affiliate disclaimer</label>
                <textarea
                  rows={3}
                  value={data.affiliate_disclaimer}
                  onChange={(e) => set('affiliate_disclaimer', e.target.value)}
                  className="input-field resize-none text-xs"
                />
              </div>
            </div>
          </div>

          {/* Brand colors */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-[#1d1d1f] mb-4">Brand Colors</h2>
            <div className="flex flex-col gap-5">
              <ColorPicker
                label="Primary color"
                value={data.primary_color}
                onChange={(c) => set('primary_color', c)}
              />
              <ColorPicker
                label="Secondary color"
                value={data.secondary_color}
                onChange={(c) => set('secondary_color', c)}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
