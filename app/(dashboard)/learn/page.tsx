'use client'

import { useEffect, useState, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import { VoiceTrainingGuide } from '@/components/guide/tool-guides'
import { Save, Check, Loader2, Sparkles } from 'lucide-react'
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

interface LearnedVoice {
  text: string
  sources: number
  updatedAt: string | null
}

interface ChannelVoice {
  channelId: string
  title: string
  text: string
  sources: number
  updatedAt: string | null
}

export default function LearnPage() {
  const [data, setData] = useState<State>(DEFAULT)
  const [learned, setLearned] = useState<LearnedVoice | null>(null)
  const [channelVoices, setChannelVoices] = useState<ChannelVoice[]>([])
  const [openChannel, setOpenChannel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [evolving, setEvolving] = useState(false)
  const [evolveResult, setEvolveResult] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [bootstrapMsg, setBootstrapMsg] = useState<string | null>(null)
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
      const fp = (d.voice_fingerprint || '').trim()
      setLearned(fp ? { text: fp, sources: d.voice_fingerprint_sources || 0, updatedAt: d.voice_fingerprint_updated_at || null } : null)
      setChannelVoices(Array.isArray(d.channelVoices) ? d.channelVoices : [])
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

  async function refreshFromPosts() {
    setEvolving(true); setEvolveResult(null)
    try {
      const res = await fetch('/api/learn/evolve', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Refresh failed')
      if (d.evolved) {
        setEvolveResult(`MVP filled ${d.fieldsFilled} empty field${d.fieldsFilled === 1 ? '' : 's'} based on your published posts. Reloading…`)
        setTimeout(() => load(), 800)
      } else {
        setEvolveResult(d.reason || 'Nothing to add right now.')
      }
    } catch (e) {
      setEvolveResult(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setEvolving(false)
      setTimeout(() => setEvolveResult(null), 6000)
    }
  }

  async function bootstrapFromVideos() {
    setBootstrapping(true); setBootstrapMsg(null)
    try {
      const res = await fetch('/api/learn/bootstrap', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Scan failed')
      if (d.learned || d.fetched > 0) {
        setBootstrapMsg(`MVP read ${d.fetched} video transcript${d.fetched === 1 ? '' : 's'} and updated your voice. Reloading…`)
        setTimeout(() => load(), 900)
      } else {
        setBootstrapMsg('No new transcripts were available to read. Try again after syncing your videos.')
      }
    } catch (e) {
      setBootstrapMsg(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setBootstrapping(false)
      setTimeout(() => setBootstrapMsg(null), 8000)
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
        <PageHero title="Voice Training" subtitle="Train the blog writer in your voice. Everything here is read on every generation." />
        <div className="flex items-center gap-2 text-sm text-[#86868b] py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      </>
    )
  }

  const lp = data.learn_profile

  return (
    <>
      <PageHero
        guide={<VoiceTrainingGuide />}
        title="Voice Training"
        subtitle="Train the blog writer in your voice. Every field here is read by MVP on every post — be specific."
      />


      <div className="max-w-3xl mb-4">
        <div className="card p-4 flex items-start gap-3" style={{ background: 'linear-gradient(180deg, rgba(88,86,214,0.05) 0%, transparent 100%)', borderColor: 'rgba(88,86,214,0.25)' }}>
          <div className="w-8 h-8 rounded-full bg-[#5856d6]/15 flex items-center justify-center flex-shrink-0">
            <Sparkles size={16} className="text-[#5856d6]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Let MVP fill in the gaps</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
              Once you&apos;ve published a few posts, MVP can read them and suggest answers for the fields you haven&apos;t filled in yet. Your existing answers are never overwritten — gaps only.
            </p>
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              <button
                onClick={refreshFromPosts}
                disabled={evolving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#5856d6] text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
              >
                {evolving
                  ? <><Loader2 size={11} className="animate-spin" /> Reading your posts…</>
                  : <><Sparkles size={11} /> Refresh MVP suggestions</>}
              </button>
              {evolveResult && (
                <span className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{evolveResult}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* What MVP has learned on its own — the continually-refined voice
          fingerprint, read from the creator's own videos over time. Read-only:
          it complements the fields below, it never replaces them. Only shown
          once the learner has read at least one transcript. */}
      {learned && (
        <div className="max-w-3xl mb-4">
          <div className="card p-5" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(52,199,89,0.05))', borderColor: 'rgba(124,58,237,0.25)' }}>
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-[#7C3AED]/15 flex items-center justify-center flex-shrink-0">
                <Sparkles size={16} className="text-[#7C3AED]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">What MVP has learned about your voice</p>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,0.12)', color: '#6d28d9' }}>
                    Learned from {learned.sources} {learned.sources === 1 ? 'video' : 'videos'}
                  </span>
                </div>
                <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                  MVP builds this automatically from your own YouTube videos and gets sharper the more you publish. It sits alongside your answers below, it never overwrites them.
                </p>
                <p className="text-[13px] leading-relaxed text-[#3a3a3c] dark:text-[#d2d2d7] mt-3 whitespace-pre-wrap">{learned.text}</p>
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  <button
                    onClick={bootstrapFromVideos}
                    disabled={bootstrapping}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
                  >
                    {bootstrapping
                      ? <><Loader2 size={11} className="animate-spin" /> Reading your videos…</>
                      : <><Sparkles size={11} /> Rescan my videos</>}
                  </button>
                  {learned.updatedAt && (
                    <span className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
                      Last updated {new Date(learned.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  {bootstrapMsg && (
                    <span className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0]">{bootstrapMsg}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Per-channel voices — only for creators with more than one connected
          channel. Each channel sounds a bit different, so MVP keeps a separate
          learned voice per channel and uses it for content made from that
          channel's videos. Read-only, collapsible so the list stays tidy. */}
      {channelVoices.length > 0 && (
        <div className="max-w-3xl mb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] mb-2" style={{ color: 'var(--text-faint)' }}>
            Voice per channel
          </p>
          <div className="space-y-2">
            {channelVoices.map(cv => {
              const open = openChannel === cv.channelId
              return (
                <div key={cv.channelId} className="card overflow-hidden" style={{ borderColor: 'rgba(124,58,237,0.2)' }}>
                  <button
                    type="button"
                    onClick={() => setOpenChannel(open ? null : cv.channelId)}
                    className="w-full flex items-center justify-between gap-3 p-4 text-left"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <Sparkles size={14} className="text-[#7C3AED] flex-shrink-0" />
                      <span className="text-sm font-semibold truncate text-[#1d1d1f] dark:text-[#f5f5f7]">{cv.title}</span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: 'rgba(124,58,237,0.12)', color: '#6d28d9' }}>
                        {cv.sources} {cv.sources === 1 ? 'video' : 'videos'}
                      </span>
                    </div>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-faint)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
                  </button>
                  {open && (
                    <div className="px-4 pb-4 -mt-1">
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-soft)' }}>{cv.text}</p>
                      {cv.updatedAt && (
                        <p className="text-[11px] mt-3" style={{ color: 'var(--text-faint)' }}>
                          Last updated {new Date(cv.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Cold start: no fingerprint yet. Offer to learn straight from the
          creator's videos now instead of waiting for them to publish. */}
      {!learned && (
        <div className="max-w-3xl mb-4">
          <div className="card p-4 flex items-start gap-3" style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(52,199,89,0.05))', borderColor: 'rgba(124,58,237,0.25)' }}>
            <div className="w-8 h-8 rounded-full bg-[#7C3AED]/15 flex items-center justify-center flex-shrink-0">
              <Sparkles size={16} className="text-[#7C3AED]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Learn my voice from my videos</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
                MVP can read your recent YouTube videos right now and build a profile of how you actually sound, so your very first post reads like you. It keeps getting sharper as you publish.
              </p>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <button
                  onClick={bootstrapFromVideos}
                  disabled={bootstrapping}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#7C3AED] text-white hover:opacity-90 disabled:opacity-60 transition-opacity"
                >
                  {bootstrapping
                    ? <><Loader2 size={11} className="animate-spin" /> Reading your videos…</>
                    : <><Sparkles size={11} /> Scan my recent videos</>}
                </button>
                {bootstrapMsg && (
                  <span className="text-xs text-[#6e6e73] dark:text-[#ebebf0]">{bootstrapMsg}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
                    ? 'bg-[#7C3AED] border-[#7C3AED] text-white'
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
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#7C3AED] text-white hover:bg-[#8B5CF6] disabled:opacity-60 transition-colors"
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
                  ? 'bg-[#7C3AED] border-[#7C3AED] text-white'
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
