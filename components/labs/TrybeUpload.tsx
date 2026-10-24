'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// TRYBE > Create > Upload videos (Seb, 2026-10-18: "upload your video
// directly to trybe in this page as well.. what the DROP feature does but
// directly here").
//
// Drop already sends a vertical video to a TRYBE brand. This is that same
// send, with a TRYBE-shaped front door: a creator who is already looking at
// their brands does not want to leave for another page, pick places they do
// not need, and come back.
//
// ONE IMPLEMENTATION, NOT TWO. The upload is the same storage path, the
// record is the same drop (/api/drop `create`, which makes its own drop and
// never touches the one the Drop page is setting up), the brand choices are
// Drop's own picker, and the send is lib/drop-run sendDropToTrybe through
// SCOUT. Nothing about submitting to TRYBE is reimplemented here, so nothing
// about it can drift.
//
// WHAT FAILURE LOOKS LIKE IS THE POINT. Each card says where its video
// actually got to: still uploading, waiting on a brand, being sent, in that
// brand's review, taken by TRYBE but not yet listed in your submissions, or
// not sent with the reason. A silent card is never a sent card.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, UploadCloud, X, Send, Check, AlertTriangle } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { uploadResumable, ResumableUnavailable } from '@/lib/upload-resumable'
import { uploadWithProgress } from '@/lib/upload-progress'
import { freshAccessToken, saysExpired } from '@/lib/fresh-token'
import { storageSizeRefusal, BULK_VIDEO_MAX_BYTES } from '@/lib/clip-source-limits'
import { getScoutStatus, requestTrybeApi, requestTrybePutFile } from '@/lib/extension-frame'
import { scoutAtLeast, SCOUT_TRYBE_SUBMIT_MIN_VERSION } from '@/lib/scout-version'
import { readBrandStats, type MyBrand } from '@/lib/trybe-mybrands'
import { browserHttp, sendDropToTrybe } from '@/lib/drop-run'
import DropTrybePicker, { emptyChoice, choiceBlocker, type TrybeChoice } from '@/components/labs/DropTrybePicker'

/** How far a video has got. Each value is a different sentence on the card,
 *  so "nothing happened" can never look like "it went". */
type Stage = 'uploading' | 'ready' | 'sending' | 'in_review' | 'sent_unconfirmed' | 'failed'

interface Vid {
  key: string
  file: File | null
  name: string
  size: number
  type: string
  width: number
  height: number
  duration: number
  vertical: boolean
  stage: Stage
  /** Bytes up, for the bar. */
  sent: number
  url: string | null
  /** The drop_items row, once the drop is made. */
  itemId: string | null
  choice: TrybeChoice
  /** What is happening right now, in words, while it is being sent. */
  step: string | null
  /** Why it stopped, or what TRYBE said. Never empty on a failed card. */
  note: string | null
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1)} MB`

/** The frame size and length, read by the browser without uploading. Zeroes
 *  mean it could not tell, and the card says so rather than guessing. */
function probe(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    try {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.onloadedmetadata = () => {
        const d = Number(v.duration)
        resolve({ duration: Number.isFinite(d) ? Math.round(d) : 0, width: Number(v.videoWidth) || 0, height: Number(v.videoHeight) || 0 })
        URL.revokeObjectURL(v.src)
      }
      v.onerror = () => resolve({ duration: 0, width: 0, height: 0 })
      v.src = URL.createObjectURL(file)
    } catch { resolve({ duration: 0, width: 0, height: 0 }) }
  })
}

const card = 'rounded-2xl border p-4'
const cardStyle = { borderColor: 'var(--border)', background: 'var(--surface)' }
const soft = { color: 'var(--text-soft)' }

export default function TrybeUpload() {
  const supabase = createBrowserClient()
  const [vids, setVids] = useState<Vid[]>([])
  const vidsRef = useRef<Vid[]>([])
  vidsRef.current = vids
  const [scout, setScout] = useState<{ installed: boolean; version: string | null } | null>(null)
  const [brands, setBrands] = useState<MyBrand[] | null>(null)
  const [brandsError, setBrandsError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const mark = useCallback((key: string, patch: Partial<Vid>) => {
    setVids((list) => list.map((v) => (v.key === key ? { ...v, ...patch } : v)))
  }, [])

  // SCOUT, and through it the brands this creator actually works with. The
  // same read Drop makes, so both screens offer the same brands.
  useEffect(() => {
    getScoutStatus().then((st) => {
      setScout(st)
      if (!st.installed || !scoutAtLeast(st.version, SCOUT_TRYBE_SUBMIT_MIN_VERSION)) return
      requestTrybeApi('GET', '/backend/api/creator/v2/brands/stats?period=all').then((r) => {
        if (!r.ok) { setBrandsError(`TRYBE did not answer${r.status ? ` (${r.status})` : ''}. Sign in to TRYBE in this Chrome, then reload.`); return }
        setBrands(readBrandStats(r.json))
      }).catch((e) => setBrandsError(e instanceof Error ? e.message : 'SCOUT did not answer.'))
    }).catch(() => setScout({ installed: false, version: null }))
  }, [])

  const canSend = !!scout?.installed && scoutAtLeast(scout.version, SCOUT_TRYBE_SUBMIT_MIN_VERSION)

  async function add(files: FileList | null) {
    const picked = Array.from(files ?? []).filter((f) => f.type.startsWith('video/'))
    if (!picked.length) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Sign in again, then add the video.'); return }

    const rows: Vid[] = []
    for (const file of picked) {
      const p = await probe(file)
      rows.push({
        key: crypto.randomUUID(), file, name: file.name, size: file.size, type: file.type || 'video/mp4',
        width: p.width, height: p.height, duration: p.duration, vertical: p.height > p.width,
        stage: 'uploading', sent: 0, url: null, itemId: null, choice: emptyChoice(), step: null, note: null,
      })
    }
    setVids((list) => [...list, ...rows])

    for (const r of rows) {
      if (r.size > BULK_VIDEO_MAX_BYTES) {
        mark(r.key, { stage: 'failed', note: `${mb(r.size)} is over the ${mb(BULK_VIDEO_MAX_BYTES)} limit.` })
        continue
      }
      const ext = r.name.split('.').pop()?.toLowerCase() || 'mp4'
      let path = `${user.id}/trybe-${crypto.randomUUID()}.${ext}`
      try {
        try {
          await uploadResumable({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            getAccessToken: (force) => freshAccessToken(supabase, force),
            bucket: 'instagram-videos', path, file: r.file!, contentType: r.type,
            onProgress: ({ sent }) => mark(r.key, { sent }),
          })
        } catch (e) {
          if (!(e instanceof ResumableUnavailable)) throw e
          path = `${user.id}/trybe-${crypto.randomUUID()}.${ext}`
          const token = await freshAccessToken(supabase, true)
          if (!token) throw new Error('Signed out during the upload. Sign in again and add it again.')
          await uploadWithProgress({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, accessToken: token,
            bucket: 'instagram-videos', path, file: r.file!, contentType: r.type,
            onProgress: ({ sent }) => mark(r.key, { sent }),
          })
        }
        const url = supabase.storage.from('instagram-videos').getPublicUrl(path).data.publicUrl
        mark(r.key, { stage: 'ready', sent: r.size, url })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'The upload failed.'
        mark(r.key, {
          stage: 'failed',
          note: storageSizeRefusal(msg, r.size)
            || (saysExpired(msg) ? 'Your sign-in ran out during the upload. Refresh the page and add it again.' : msg),
        })
      }
    }
  }

  /**
   * Send every video that has a brand picked.
   *
   * ITS OWN DROP, every time. /api/drop `create` makes a new one from these
   * videos alone. It deliberately does not reuse the draft the Drop page
   * keeps, because launching that draft from here would delete the videos the
   * creator is still setting up over there.
   */
  async function sendAll() {
    const go = vidsRef.current.filter((v) => v.stage === 'ready' && v.url && !choiceBlocker(v.choice))
    if (!go.length) return
    setSending(true)
    try {
      for (const v of go) mark(v.key, { stage: 'sending', step: 'Making the record', note: null })
      const made = await browserHttp('/api/drop', { method: 'POST', body: {
        action: 'create',
        name: `TRYBE ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        items: go.map((v) => ({
          fileName: v.name, sourceUrl: v.url, mimeType: v.type, sizeBytes: v.size,
          durationSeconds: v.duration, width: v.width, height: v.height,
          kind: v.vertical ? 'vertical' : 'long',
          toLiftoff: false, toBlog: false, toTrybe: true, places: [], trybe: v.choice,
        })),
      } })
      const items = (made.json.items ?? []) as Array<{ id: string; position: number }>
      if (!made.ok || !items.length) {
        // Nothing reached TRYBE: the videos go back to ready, saying why, so
        // Send is there to press again (a failed card with no record had no
        // way to be sent).
        const why = String(made.json.error || 'MVP could not keep the record of this send.')
        for (const v of go) mark(v.key, { stage: 'ready', step: null, note: `Not sent yet: ${why}` })
        toast.error(why, { duration: 12000 })
        return
      }
      for (const m of items) {
        const v = go[m.position]
        if (v) mark(v.key, { itemId: m.id })
      }
      // One at a time, each through SCOUT, each with its own answer.
      for (const m of items) {
        const v = go[m.position]
        if (!v) continue
        await sendOne({ ...v, itemId: m.id })
      }
    } catch (e) {
      // The record call itself threw: anything still "sending" never left.
      const why = e instanceof Error ? e.message : 'The send stopped.'
      for (const v of go) {
        const now = vidsRef.current.find((x) => x.key === v.key)
        if (now?.stage === 'sending' && !now.itemId) mark(v.key, { stage: 'ready', step: null, note: `Not sent yet: ${why}` })
      }
      toast.error(why, { duration: 12000 })
    } finally {
      setSending(false)
    }
  }

  async function sendOne(v: Vid & { itemId: string }) {
    const brand = v.choice.brandName || 'the brand'
    mark(v.key, { stage: 'sending', step: `Sending to ${brand}`, note: null })
    try {
      const res = await sendDropToTrybe({
        id: v.itemId, source_url: v.url, file_name: v.name, mime_type: v.type, size_bytes: v.size,
        trybe_brand_id: v.choice.brandId, trybe_program_id: v.choice.programId, trybe_angle_id: v.choice.angleId,
        trybe_product_ids: v.choice.productIds, trybe_exclusive: v.choice.exclusive, trybe_notes: v.choice.notes,
      }, browserHttp, {
        api: requestTrybeApi, put: requestTrybePutFile,
        onStep: (t, done, total) => mark(v.key, { step: total && total > 1 ? `${t} (${done ?? 0} of ${total})` : t }),
      })
      if (!res) {
        mark(v.key, { stage: 'failed', step: null, note: 'Another tab is already sending this one.' })
      } else if (res.state === 'in_review') {
        mark(v.key, { stage: 'in_review', step: null, note: `${brand} has it, waiting on their review.` })
      } else if (res.state === 'sent_unconfirmed') {
        mark(v.key, { stage: 'sent_unconfirmed', step: null, note: `TRYBE took it, but it is not in your ${brand} submissions yet. Check TRYBE before sending it again.` })
      } else {
        mark(v.key, { stage: 'failed', step: null, note: `Not sent to ${brand}: ${res.error || 'TRYBE did not take it.'}` })
      }
    } catch (e) {
      mark(v.key, { stage: 'failed', step: null, note: e instanceof Error ? e.message : 'The send stopped.' })
    }
  }

  const ready = vids.filter((v) => v.stage === 'ready' && !choiceBlocker(v.choice)).length
  const waiting = vids.filter((v) => v.stage === 'ready' && choiceBlocker(v.choice)).length

  return (
    <div className="space-y-4">
      <div className={card} style={cardStyle}>
        <h3 className="text-[15px] font-semibold">Upload videos</h3>
        <p className="text-[13.5px] mt-1" style={soft}>
          Add the videos you filmed, pick the brand each one is for, and send them to TRYBE without leaving this page. This is the same send Drop makes, so anything you send here shows up in Drop too.
        </p>

        {!scout && <p className="text-[13px] mt-3 inline-flex items-center gap-1.5" style={soft}><Loader2 size={13} className="animate-spin" /> Looking for SCOUT...</p>}
        {scout && !canSend && (
          <p className="text-[13px] mt-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)', ...soft }}>
            Sending to TRYBE needs SCOUT {SCOUT_TRYBE_SUBMIT_MIN_VERSION}{scout.version ? ` (this Chrome has ${scout.version})` : ' (not installed in this Chrome)'}. You can still add videos here; they stay until SCOUT is ready.
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold border"
            style={{ borderColor: 'var(--border)' }}
          >
            <UploadCloud size={14} /> Add videos
          </button>
          {ready > 0 && (
            <button
              type="button"
              onClick={() => void sendAll()}
              disabled={sending || !canSend}
              className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: '#7C3AED' }}
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send {ready} to TRYBE
            </button>
          )}
          {waiting > 0 && <span className="text-[12.5px]" style={soft}>{waiting} still {waiting === 1 ? 'needs' : 'need'} a brand</span>}
        </div>
        <input ref={fileInput} type="file" accept="video/*" multiple className="hidden" onChange={(e) => { void add(e.target.files); e.target.value = '' }} />
      </div>

      {vids.map((v) => {
        const blocker = choiceBlocker(v.choice)
        const pct = v.size > 0 ? Math.min(100, Math.round((v.sent / v.size) * 100)) : 0
        return (
          <div key={v.key} className={card} style={cardStyle}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold truncate">{v.name}</p>
                <p className="text-[12px] mt-0.5" style={soft}>
                  {mb(v.size)}
                  {v.width > 0 && ` · ${v.width}x${v.height}`}
                  {v.duration > 0 && ` · ${Math.floor(v.duration / 60)}:${String(v.duration % 60).padStart(2, '0')}`}
                  {v.width > 0 && !v.vertical && ' · not a vertical video, which is what TRYBE brands ask for'}
                </p>
              </div>
              {v.stage !== 'sending' && (
                <button type="button" aria-label={`Remove ${v.name}`} onClick={() => setVids((list) => list.filter((x) => x.key !== v.key))} style={soft}>
                  <X size={15} />
                </button>
              )}
            </div>

            {v.stage === 'uploading' && (
              <div className="mt-3">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                  <div className="h-full" style={{ width: `${pct}%`, background: '#7C3AED' }} />
                </div>
                <p className="text-[12px] mt-1.5" style={soft}>Uploading {pct}%</p>
              </div>
            )}

            {v.stage === 'ready' && (
              <div className="mt-3">
                <DropTrybePicker brands={brands} brandsError={brandsError} value={v.choice} onChange={(c) => mark(v.key, { choice: c })} />
                {v.note && <p className="text-[12.5px] mt-2 inline-flex items-start gap-1.5" style={{ color: '#B45309' }}><AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> <span>{v.note}</span></p>}
                <p className="text-[12px] mt-2" style={soft}>{blocker ? `${blocker} before this one can go.` : 'Ready to send.'}</p>
              </div>
            )}

            {v.stage === 'sending' && (
              <p className="text-[13px] mt-3 inline-flex items-center gap-1.5" style={soft}>
                <Loader2 size={13} className="animate-spin" /> {v.step || 'Sending'}
              </p>
            )}

            {v.stage === 'in_review' && (
              <p className="text-[13px] mt-3 inline-flex items-center gap-1.5" style={{ color: '#15803D' }}>
                <Check size={14} /> {v.note}
              </p>
            )}

            {v.stage === 'sent_unconfirmed' && (
              <p className="text-[13px] mt-3 inline-flex items-start gap-1.5" style={{ color: '#B45309' }}>
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> <span>{v.note}</span>
              </p>
            )}

            {v.stage === 'failed' && (
              <div className="mt-3">
                <p className="text-[13px] inline-flex items-start gap-1.5" style={{ color: '#B91C1C' }}>
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> <span>{v.note || 'It did not go, and MVP did not record why.'}</span>
                </p>
                {v.url && v.itemId && (
                  <button
                    type="button"
                    onClick={() => void sendOne({ ...v, itemId: v.itemId! })}
                    disabled={!canSend}
                    className="mt-2 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    Try this one again
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
