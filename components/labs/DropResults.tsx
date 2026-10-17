'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Drop: what each recent drop actually did, per video and per place. Every
// line is read from the result (Liftoff's rows, the blog route's answer,
// TRYBE's own submissions list), never from what was asked for, so a place
// that did not take a video looks different from one that did
// (lib/drop-plan placeLines).

import Link from 'next/link'
import { ExternalLink, RotateCcw, Trash2, Loader2 } from 'lucide-react'
import { placeLines, dropHeadline, isStale, type DropItemRow, type LaunchItemView, type Tone } from '@/lib/drop-plan'

export interface DropView {
  id: string
  name: string
  state: string
  note: string | null
  batch_id: string | null
  created_at: string
  items: Array<DropItemRow & { file_name: string | null; title: string | null; asin: string | null }>
}

export interface BatchView { state: string; send_to_youtube?: boolean; items: Array<LaunchItemView & { id: string }> }

/** Each state's colours, light and dark, so a red line stays readable on
 *  either ground. */
export const TONE: Record<Tone, { cls: string; label: string }> = {
  good: { cls: 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300 dark:bg-emerald-400/15', label: 'Done' },
  busy: { cls: 'text-cyan-700 bg-cyan-500/10 dark:text-cyan-300 dark:bg-cyan-400/15', label: 'Moving' },
  warn: { cls: 'text-amber-700 bg-amber-500/15 dark:text-amber-300 dark:bg-amber-400/15', label: 'Check' },
  bad: { cls: 'text-red-700 bg-red-500/10 dark:text-red-300 dark:bg-red-400/15', label: 'Stopped' },
  idle: { cls: 'text-[color:var(--text-2)] bg-[color:var(--surface-2)]', label: 'Waiting' },
}

const ago = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
}

export default function DropResults({ drops, batches, sending, canSendTrybe, onBlogAgain, onTrybeAgain, onRemove }: {
  drops: DropView[]
  batches: Record<string, BatchView | 'missing' | undefined>
  /** Live progress of a TRYBE send this page is running, by video. */
  sending: Record<string, string>
  canSendTrybe: boolean
  onBlogAgain: (itemId: string) => void
  onTrybeAgain: (itemId: string) => void
  onRemove: (dropId: string) => void
}) {
  if (drops.length === 0) return null
  const now = Date.now()
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Your drops</h2>
      {drops.map((d) => {
        const b = d.batch_id ? batches[d.batch_id] : undefined
        const batch = b && b !== 'missing' ? b : null
        const rows = d.items.map((it) => {
          const li = batch?.items.find((x) => x.id === it.launch_item_id) ?? null
          const lines = placeLines(it, li, { dropState: d.state, sendToYouTube: batch?.send_to_youtube, now })
          // This page's own send, live, over the last saved step.
          const live = sending[it.id]
          return { it, lines: live ? lines.map((l) => (l.place === 'TRYBE' ? { ...l, tone: 'busy' as Tone, text: live } : l)) : lines }
        })
        const head = dropHeadline(d, rows.map((r) => r.lines))
        return (
          <article key={d.id} className="rounded-2xl border p-4 flex flex-col gap-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}>{d.name}</p>
                <p className="text-[11.5px]" style={{ color: 'var(--text-2)' }}>{ago(d.created_at)} · {d.items.length} video{d.items.length === 1 ? '' : 's'}</p>
              </div>
              <div className="flex items-center gap-2">
                {d.batch_id && (
                  <Link href={`/liftoff?batch=${d.batch_id}`} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-semibold"
                    style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                    Open in Liftoff <ExternalLink size={12} />
                  </Link>
                )}
                <button type="button" onClick={() => onRemove(d.id)} aria-label="Remove this drop from the list"
                  className="rounded-lg border p-1.5" style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </header>
            <p className={`rounded-lg px-3 py-2 text-[12.5px] font-medium ${TONE[head.tone].cls}`}>
              {head.tone === 'busy' && <Loader2 size={12} className="inline animate-spin mr-1.5 -mt-0.5" />}{head.text}
            </p>
            {b === 'missing' && <p className="text-[12px] text-amber-700 dark:text-amber-300">Liftoff could not be read for this drop just now. It is read again in a moment.</p>}
            <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--border)' }}>
              {rows.map(({ it, lines }) => (
                <li key={it.id} className="py-2.5 flex flex-col gap-1.5" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text)' }} title={it.file_name || ''}>
                    {it.title || it.file_name || 'Video'}
                    <span className="ml-2 text-[11px] font-normal" style={{ color: 'var(--text-2)' }}>{it.kind === 'vertical' ? 'Vertical' : 'Long'}{it.asin ? ` · ${it.asin}` : ''}</span>
                  </p>
                  <div className="flex flex-col gap-1">
                    {lines.map((l, i) => (
                      <div key={i} className="flex items-start gap-2 text-[12px]">
                        <span className="shrink-0 w-[62px] font-semibold" style={{ color: 'var(--text-2)' }}>{l.place}</span>
                        <span className={`shrink-0 rounded-md px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide ${TONE[l.tone].cls}`}>{TONE[l.tone].label}</span>
                        <span className="min-w-0 break-words" style={{ color: 'var(--text)' }}>
                          {l.text}
                          {l.place === 'Blog' && it.blog_state === 'scheduled' && it.blog_url && (
                            <a href={it.blog_url} target="_blank" rel="noreferrer" className="ml-1.5 underline text-cyan-700 dark:text-cyan-300">See the post</a>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {it.to_blog && (it.blog_state === 'failed' || (it.blog_state === 'writing' && isStale(it.updated_at, now))) && (
                      <button type="button" onClick={() => onBlogAgain(it.id)} className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11.5px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                        <RotateCcw size={11} /> Write the blog post again
                      </button>
                    )}
                    {it.to_trybe && !sending[it.id] && (it.trybe_state === 'failed' || it.trybe_state === 'wanted' || it.trybe_state === 'sent_unconfirmed' || (it.trybe_state === 'sending' && isStale(it.updated_at, now))) && (
                      <button type="button" disabled={!canSendTrybe} onClick={() => onTrybeAgain(it.id)} title={canSendTrybe ? '' : 'Needs SCOUT 1.52.0 in this Chrome'}
                        className="inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11.5px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                        <RotateCcw size={11} /> {it.trybe_state === 'wanted' ? 'Send to TRYBE' : 'Send to TRYBE again'}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </article>
        )
      })}
    </section>
  )
}
