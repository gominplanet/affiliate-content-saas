// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /admin/audio-tracks — does YouTube hand us the dubs it shows in Studio?
//
// Studio lists a dozen languages as Published and the audio row says
// Auto-dubbed. Whether those tracks are DOWNLOADABLE is a separate question,
// and the answer decides whether Global Storefront Sync can stop paying to
// synthesize dubs it could have pulled for free.
//
// It is a page rather than a command because the only other way to ask was
// yt-dlp on the ingest box, and a question the product depends on should be
// answerable by pasting a link.
//
// THREE ANSWERS, NOT TWO. "No dubs on this video" and "we could not check" look
// the same in a list of zero languages and mean opposite things: one says
// synthesize, the other says fix the downloader's cookies and ask again.

'use client'

import { useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Loader2, CheckCircle2, MinusCircle, AlertTriangle } from 'lucide-react'

interface FreeMarket { domain: string; country: string; langName: string }
interface Result {
  ok: boolean
  videoId?: string
  languages?: string[]
  originalLanguage?: string | null
  multiTrack?: boolean
  freeMarkets?: FreeMarket[]
  verdict?: string
  reason?: string
  message?: string
  error?: string
}

export default function AudioTracksPage() {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function check() {
    if (!value.trim() || loading) return
    setLoading(true)
    setResult(null)
    try {
      const r = await fetch(`/api/admin/audio-tracks?v=${encodeURIComponent(value.trim())}`)
      setResult(await r.json())
    } catch {
      setResult({ ok: false, reason: 'lookup_failed', message: 'Could not reach the server.' })
    } finally {
      setLoading(false)
    }
  }

  const found = result?.ok && result.multiTrack
  const none = result?.ok && !result.multiTrack
  const unknown = result && !result.ok

  return (
    <div className="max-w-2xl mx-auto">
      <PageHero
        title="YouTube audio tracks"
        subtitle="Paste one of your videos. This says whether YouTube will hand us its dubbed audio, which decides if a market can be dubbed for free instead of synthesized."
      />

      <div className="mt-6 flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') check() }}
          placeholder="Paste a YouTube link, or the 11-character id"
          className="flex-1 rounded-xl border border-black/15 dark:border-white/15 bg-white dark:bg-black/30 px-4 py-3 text-[14px] text-[#1d1d1f] dark:text-[#f5f5f7]"
        />
        <button
          type="button"
          onClick={check}
          disabled={loading || !value.trim()}
          className="rounded-xl px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-50"
          style={{ background: '#7C3AED' }}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : 'Check'}
        </button>
      </div>

      <p className="mt-2 text-[12.5px] text-[#6e6e73] dark:text-[#ebebf0]">
        Nothing is downloaded and nothing is spent. This reads the video&apos;s track list only.
      </p>

      {result && (
        <div
          className="mt-6 rounded-2xl border p-5"
          style={{ borderColor: found ? '#16a34a55' : unknown ? '#f59e0b55' : 'rgba(0,0,0,0.12)' }}
        >
          <div className="flex items-start gap-3">
            {found && <CheckCircle2 size={20} className="mt-0.5 flex-shrink-0" style={{ color: '#16a34a' }} />}
            {none && <MinusCircle size={20} className="mt-0.5 flex-shrink-0" style={{ color: '#6e6e73' }} />}
            {unknown && <AlertTriangle size={20} className="mt-0.5 flex-shrink-0" style={{ color: '#f59e0b' }} />}
            <div className="flex-1">
              <p className="text-[14.5px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                {result.verdict || result.message || result.error || 'No answer came back.'}
              </p>

              {result.ok && (result.languages?.length ?? 0) > 0 && (
                <p className="mt-2 text-[13px] text-[#6e6e73] dark:text-[#ebebf0]">
                  Tracks: {result.languages!.join(', ')}
                  {result.originalLanguage ? ` · original: ${result.originalLanguage}` : ''}
                </p>
              )}

              {(result.freeMarkets?.length ?? 0) > 0 && (
                <div className="mt-4">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#6e6e73] dark:text-[#ebebf0]">
                    Free dubs available for
                  </p>
                  <ul className="mt-2 flex flex-col gap-1">
                    {result.freeMarkets!.map((m) => (
                      <li key={m.domain} className="text-[13.5px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {m.domain} · {m.country} · {m.langName}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* The distinction the whole page turns on, said out loud rather
                  than implied by a colour. */}
              {unknown && (
                <p className="mt-2 text-[13px] text-[#6e6e73] dark:text-[#ebebf0]">
                  This is not a result about the video. Nothing was learned either way, so do not read it as
                  &quot;this video has no dubs&quot;.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
