'use client'

import { useEffect, useState, useCallback } from 'react'
import Header from '@/components/layout/Header'
import { Save, Check, Loader2 } from 'lucide-react'
import {
  VOICE_QUESTIONS, STYLE_AXES, SPEECH_PATTERNS, THOUGHT_PROCESS,
  emptyLearnProfile, type LearnProfile,
} from '@/lib/learn'

const TEXT_FIELDS = [
  { key: 'author_bio', label: 'About You',
    hint: 'Who is writing these posts? Background, credibility, what you know.' },
  { key: 'target_audience', label: 'Target Reader',
    hint: 'Who are you writing for? What do they care about, what do they already know?' },
  { key: 'writing_sample', label: 'Your Writing Style',
    hint: 'Paste a chunk of writing that sounds exactly like you. The agents match this.' },
  { key: 'words_to_avoid', label: 'Words & Phrases to Avoid',
    hint: 'One per line. Deleted on sight in every generated post.' },
] as const

type TextKey = (typeof TEXT_FIELDS)[number]['key']

interface State {
  author_bio: string
  target_audience: string
  writing_sample: string
  words_to_avoid: string
  learn_profile: LearnProfile
}

const DEFAULT: State = {
  author_bio: '', target_audience: '', writing_sample: '', words_to_avoid: '',
  learn_profile: emptyLearnProfile(),
}

export default function LearnPage() {
  const [data, setData] = useState<State>(DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/learn')
      const d = await res.json()
      if (d.error) { setError(d.error); return }
      setData({
        author_bio: d.author_bio ?? '',
        target_audience: d.target_audience ?? '',
        writing_sample: d.writing_sample ?? '',
        words_to_avoid: d.words_to_avoid ?? '',
        learn_profile: { ...emptyLearnProfile(), ...d.learn_profile },
      })
    } catch {
      setError('Could not load your Learning profile.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function save() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Save failed')
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const setText = (k: TextKey, v: string) => setData(p => ({ ...p, [k]: v }))

  const setVoice = (k: string, v: string) =>
    setData(p => ({ ...p, learn_profile: { ...p.learn_profile, voice: { ...p.learn_profile.voice, [k]: v } } }))

  const toggleAxis = (k: string, side: string) =>
    setData(p => {
      const style = p.learn_profile.style as Record<string, string | null>
      const cur = style[k]
      return { ...p, learn_profile: { ...p.learn_profile, style: { ...style, [k]: cur === side ? null : side } } }
    })

  const toggleIn = (group: 'speech_patterns' | 'thought_process', key: string) =>
    setData(p => {
      const arr = p.learn_profile[group]
      const next = arr.includes(key) ? arr.filter(x => x !== key) : [...arr, key]
      return { ...p, learn_profile: { ...p.learn_profile, [group]: next } }
    })

  if (loading) {
    return (
      <>
        <Header title="Learning" subtitle="Train the blog writer in your voice. Everything here is read on every generation." />
        <div className="flex items-center gap-2 text-sm text-[#86868b] py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      </>
    )
  }

  const lp = data.learn_profile

  return (
    <>
      <Header
        title="Learning"
        subtitle="Train the blog writer in your voice. Every field here is read by the AI on every post — be specific."
      />

      <div className="max-w-3xl space-y-6 pb-28">

        {/* Foundational free-text */}
        <div className="card p-5 space-y-5">
          {TEXT_FIELDS.map(f => (
            <div key={f.key}>
              <label className="block text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">{f.label}</label>
              <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-2">{f.hint}</p>
              <textarea
                value={data[f.key]}
                onChange={e => setText(f.key, e.target.value)}
                rows={f.key === 'writing_sample' ? 8 : 4}
                className="input-field text-sm w-full resize-y"
                placeholder={f.label}
              />
            </div>
          ))}
        </div>

        {/* Voice calibration */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Voice calibration</h2>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-4">
            The agents avoid everything you call fake / weak / cringe and lean into what you call intelligent / trustworthy.
          </p>
          <div className="space-y-4">
            {VOICE_QUESTIONS.map(q => (
              <div key={q.key}>
                <label className="block text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">{q.label}</label>
                <textarea
                  value={lp.voice[q.key] ?? ''}
                  onChange={e => setVoice(q.key, e.target.value)}
                  rows={2}
                  className="input-field text-sm w-full resize-y"
                  placeholder="In your own words…"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Communicative style — either/or */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Your communicative style</h2>
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-4">Pick a side, or leave neutral. Tap a selected side again to clear it.</p>
          <div className="space-y-2.5">
            {STYLE_AXES.map(a => {
              const cur = lp.style[a.key]
              const btn = (side: string) =>
                `flex-1 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
                  cur === side
                    ? 'bg-[#0071e3] border-[#0071e3] text-white'
                    : 'bg-white dark:bg-[#1c1c1e] border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-gray-300'
                }`
              return (
                <div key={a.key} className="flex items-center gap-2">
                  <button type="button" onClick={() => toggleAxis(a.key, a.left)} className={btn(a.left)}>{a.left}</button>
                  <span className="text-[10px] text-[#86868b]">vs</span>
                  <button type="button" onClick={() => toggleAxis(a.key, a.right)} className={btn(a.right)}>{a.right}</button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Speech patterns */}
        <ChipGroup
          title="Your natural speech pattern"
          subtitle="Devices the writing should use."
          items={SPEECH_PATTERNS}
          selected={lp.speech_patterns}
          onToggle={k => toggleIn('speech_patterns', k)}
        />

        {/* Thought process */}
        <ChipGroup
          title="Your thought process"
          subtitle="How the writing should structure its reasoning."
          items={THOUGHT_PROCESS}
          selected={lp.thought_process}
          onToggle={k => toggleIn('thought_process', k)}
        />

        {error && <p className="text-xs text-[#ff3b30]">{error}</p>}
      </div>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 sm:left-64 border-t border-gray-200 dark:border-white/10 bg-white/90 dark:bg-[#1c1c1e]/90 backdrop-blur px-6 py-3 flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-[#1f8a3a] flex items-center gap-1"><Check size={12} /> Saved</span>}
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#0071e3] text-white hover:bg-[#0077ed] disabled:opacity-60 transition-colors"
        >
          {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save</>}
        </button>
      </div>
    </>
  )
}

function ChipGroup({
  title, subtitle, items, selected, onToggle,
}: {
  title: string
  subtitle: string
  items: readonly { key: string; label: string }[]
  selected: string[]
  onToggle: (key: string) => void
}) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">{title}</h2>
      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-4">{subtitle}</p>
      <div className="flex flex-wrap gap-2">
        {items.map(it => {
          const on = selected.includes(it.key)
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onToggle(it.key)}
              className={`text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
                on
                  ? 'bg-[#0071e3] border-[#0071e3] text-white'
                  : 'bg-white dark:bg-[#1c1c1e] border-gray-200 dark:border-white/10 text-[#1d1d1f] dark:text-[#f5f5f7] hover:border-gray-300'
              }`}
            >
              {it.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
