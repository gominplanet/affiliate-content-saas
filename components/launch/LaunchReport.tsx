// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Where every video in a launched batch landed. One row per video, one column
// for YouTube and one per Amazon country.
//
// WHAT HAPPENED, NEVER WHAT WAS ASKED. Every cell is drawn from what came back:
// YouTube's own read of the video after the uploader set it, SCOUT's read of
// Studio, and the storefront's answer for each listing. A cell that is still
// working says so, and the headline only says "All done" when no cell is.
'use client'

import { MARKETS } from '@/lib/markets'
import type { StoredStudioRun } from '@/lib/studio-finish'

const GOOD = '#10B981', WARN = '#d97706', BAD = '#ef4444', BUSY = '#0EA5A4', IDLE = 'var(--text-2)'
const text = { color: 'var(--text)' } as const
const muted = { color: 'var(--text-2)' } as const

export interface ReportItem {
  id: string
  position: number
  title: string | null
  state: string
  reason: string | null
  publish_at: string | null
  planned_publish_at?: string | null
  youtube_video_id: string | null
  thumbnail_set_at: string | null
  thumbnail_error: string | null
  playlist_added_at?: string | null
  playlist_error?: string | null
  studio_finish?: StoredStudioRun | null
  api_disclosures?: {
    asked?: boolean; paidPromotion?: boolean | null; aiUseNo?: boolean | null
    embeddable?: boolean | null; madeForKids?: boolean | null; error?: string | null
  } | null
  amazon?: Array<{ domain: string; state: string; detail: string | null; waitingOnDub: boolean }>
}

type Cell = { word: string; colour: string; done: boolean; problem?: string }

/** A YouTube cell: where the video is. */
function youtubeCell(i: ReportItem, when: (iso: string) => string): Cell {
  // CHOSEN, NOT MISSED: an Amazon-only batch never goes to YouTube.
  if (i.state === 'amazon_only') return { word: 'Skipped (Amazon only)', colour: IDLE, done: true }
  if (i.state === 'published') return { word: `Live${i.publish_at ? ` since ${when(i.publish_at)}` : ''}`, colour: GOOD, done: true }
  if (i.state === 'scheduled') return { word: `Scheduled${i.publish_at ? ` for ${when(i.publish_at)}` : ''}`, colour: GOOD, done: true }
  if (i.state === 'blocked') {
    return i.youtube_video_id
      ? { word: 'On YouTube, private', colour: WARN, done: true, problem: i.reason || 'Kept private.' }
      : { word: 'Did not upload', colour: BAD, done: true, problem: i.reason || 'It could not be uploaded.' }
  }
  if (i.state === 'prepared') {
    return i.planned_publish_at
      ? { word: /is running now/.test(i.reason || '') ? 'Uploading now' : 'Queued for upload', colour: BUSY, done: false }
      : { word: 'Ready, not launched', colour: WARN, done: false, problem: 'Ready but not launched yet. Press Launch these too.' }
  }
  return { word: 'Still being prepared', colour: BUSY, done: false }
}

/** One Amazon country for one video. */
type AmazonEntry = NonNullable<ReportItem['amazon']>[number]
function amazonCell(entry: AmazonEntry | undefined, onYouTube: boolean): Cell {
  if (!entry) return onYouTube ? { word: 'Starting', colour: BUSY, done: false } : { word: 'After YouTube', colour: IDLE, done: false }
  switch (entry.state) {
    case 'delivered': case 'grid:uploaded': case 'grid:live':
      return { word: 'Listed', colour: GOOD, done: true }
    case 'failed':
      return { word: 'Failed', colour: BAD, done: true, problem: entry.detail || 'The upload failed.' }
    case 'grid:blocked':
      return { word: 'Not sold here', colour: IDLE, done: true, problem: undefined }
    case 'localized':
      return entry.waitingOnDub ? { word: 'Dubbing', colour: BUSY, done: false } : { word: 'Ready to send', colour: BUSY, done: false }
    default:
      return { word: 'Preparing', colour: BUSY, done: false }
  }
}

/** A tick, a cross or a question mark for one thing YouTube or Studio read back. */
function Check({ label, value, title }: { label: string; value: boolean | null | undefined; title?: string }) {
  const [mark, colour] = value === true ? ['✓', GOOD] : value === false ? ['✗', BAD] : ['?', IDLE]
  return (
    <span title={title} className="whitespace-nowrap">
      <span style={{ color: colour }}>{mark}</span> <span style={muted}>{label}</span>
    </span>
  )
}

export default function LaunchReport({
  items, markets, timezone, playlistChosen, studioPossible,
}: {
  items: ReportItem[]
  markets: string[]
  timezone: string
  playlistChosen: boolean
  /** False when SCOUT cannot run the Studio steps in this browser. */
  studioPossible: boolean
}) {
  const when = (iso: string) => new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
  const mkts = markets.map((d) => MARKETS.find((m) => m.domain === d)).filter((m): m is NonNullable<typeof m> => !!m)
  const sorted = [...items].sort((a, b) => a.position - b.position)

  // ── WHAT IS STILL WORKING, counted from the cells themselves ────────────
  let ytLeft = 0, amzLeft = 0, studioLeft = 0, listed = 0, amzTotal = 0, notSold = 0, failed = 0
  const problems: Array<{ video: string; where: string; what: string }> = []
  for (const i of sorted) {
    const name = i.title || `Video ${i.position + 1}`
    const yc = youtubeCell(i, when)
    if (!yc.done) ytLeft++
    if (yc.problem) problems.push({ video: name, where: 'YouTube', what: yc.problem })
    const d = i.api_disclosures
    if (d?.error) problems.push({ video: name, where: 'YouTube settings', what: d.error })
    if (d?.asked && d.paidPromotion === false) problems.push({ video: name, where: 'YouTube settings', what: 'YouTube reports paid promotion as No.' })
    if (i.playlist_error) problems.push({ video: name, where: 'Playlist', what: i.playlist_error })
    if (i.thumbnail_error) problems.push({ video: name, where: 'Thumbnail', what: i.thumbnail_error })
    if (i.youtube_video_id && studioPossible && !i.studio_finish) studioLeft++
    if (i.studio_finish && !i.studio_finish.ok) {
      const open = i.studio_finish.steps.filter((s) => !s.ok && !s.skipped).map((s) => s.detail).filter(Boolean)
      if (open.length) problems.push({ video: name, where: 'YouTube Studio', what: open.join(' ') })
    }
    for (const m of mkts) {
      const c = amazonCell(i.amazon?.find((a) => a.domain === m.domain), !!i.youtube_video_id)
      amzTotal++
      if (!c.done) amzLeft++
      if (c.word === 'Listed') listed++
      if (c.word === 'Not sold here') notSold++
      if (c.word === 'Failed') { failed++; problems.push({ video: name, where: `Amazon ${m.country}`, what: c.problem || '' }) }
    }
  }
  const allDone = ytLeft === 0 && amzLeft === 0 && studioLeft === 0
  const working = [
    ytLeft ? `${ytLeft} on YouTube` : '',
    studioLeft ? `${studioLeft} Studio ${studioLeft === 1 ? 'pass' : 'passes'}` : '',
    amzLeft ? `${amzLeft} Amazon ${amzLeft === 1 ? 'listing' : 'listings'}` : '',
  ].filter(Boolean)

  return (
    <section className="rounded-2xl border p-4" style={{ borderColor: allDone ? GOOD : 'var(--border)', background: 'var(--surface)' }}>
      <h2 className="text-[13.5px] font-semibold" style={{ color: allDone ? GOOD : text.color }}>
        {allDone ? 'All done. Here is where every video landed.' : 'Launch report'}
      </h2>
      <p className="text-[12px] mt-0.5" style={muted}>
        {allDone
          ? `YouTube: ${sorted.filter((i) => i.state === 'scheduled' || i.state === 'published').length} of ${sorted.length} scheduled or live. Amazon: ${listed} of ${amzTotal - notSold} possible listings up${notSold ? `, ${notSold} not sold in that country` : ''}${failed ? `, ${failed} failed` : ''}.`
          : `Still working: ${working.join(', ')}. Keep this batch open on this page while SCOUT runs; YouTube uploads carry on without it.`}
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[11.5px] border-collapse" style={{ minWidth: 360 + mkts.length * 96 }}>
          <thead>
            <tr style={muted}>
              <th className="text-left font-medium py-1.5 pr-2">Video</th>
              <th className="text-left font-medium py-1.5 pr-2">YouTube</th>
              {mkts.map((m) => (
                <th key={m.domain} className="text-left font-medium py-1.5 pr-2 align-bottom">
                  <span className="block" style={text}>{m.country}</span>
                  {/* WHAT THIS COUNTRY GETS, so nobody has to remember which
                      stores were dubbed and which image each one carries. */}
                  <span className="block text-[10.5px] font-normal">
                    {m.needsTranslation ? `${m.langName} dub, no-words thumbnail` : 'English, thumbnail with hook'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((i) => {
              const yc = youtubeCell(i, when)
              const d = i.api_disclosures
              const run = i.studio_finish
              return (
                <tr key={i.id} className="align-top" style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="py-2 pr-2 max-w-[180px]">
                    <span className="block truncate" style={text}>{i.title || `Video ${i.position + 1}`}</span>
                    {i.youtube_video_id && (
                      <a href={`https://youtu.be/${i.youtube_video_id}`} target="_blank" rel="noopener noreferrer"
                        className="underline" style={{ color: BUSY }}>youtu.be/{i.youtube_video_id}</a>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <span className="block font-medium" style={{ color: yc.colour }}>{yc.word}</span>
                    {i.youtube_video_id && (
                      <span className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                        {/* READ BACK FROM YOUTUBE after the uploader set them;
                            ? means YouTube did not say (or migration 368 is
                            not in yet). */}
                        {d?.asked !== false && <Check label="Paid promotion" value={d?.paidPromotion} />}
                        {d?.asked !== false && <Check label="AI use: No" value={d?.aiUseNo} />}
                        <Check label="Embedding" value={d?.embeddable} />
                        <Check label="Thumbnail" value={i.thumbnail_set_at ? true : i.thumbnail_error ? false : null}
                          title={i.thumbnail_error || undefined} />
                        {playlistChosen && (
                          <Check label="Playlist" value={i.playlist_added_at ? true : i.playlist_error ? false : null}
                            title={i.playlist_error || undefined} />
                        )}
                        <Check label="Studio steps" value={run ? run.ok : null}
                          title={run ? run.steps.map((s) => `${s.step}: ${s.detail}`).join('\n') : studioPossible ? 'Not run yet' : 'SCOUT is not available in this browser'} />
                      </span>
                    )}
                  </td>
                  {mkts.map((m) => {
                    const c = amazonCell(i.amazon?.find((a) => a.domain === m.domain), !!i.youtube_video_id)
                    return (
                      <td key={m.domain} className="py-2 pr-2" title={c.problem || undefined}>
                        <span style={{ color: c.colour }}>{c.done && c.word === 'Listed' ? '✓ ' : c.word === 'Failed' ? '✗ ' : ''}{c.word}</span>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* EVERY PROBLEM, WITH ITS REASON, in one list: a report whose failures
          are only in hover titles is a report that hides them. */}
      {problems.length > 0 && (
        <div className="mt-3 rounded-lg px-3 py-2" style={{ background: 'rgba(217,119,6,0.08)' }}>
          <p className="text-[12px] font-semibold mb-1" style={{ color: WARN }}>
            {problems.length === 1 ? 'One thing needs a look' : `${problems.length} things need a look`}
          </p>
          <ul className="flex flex-col gap-0.5">
            {problems.map((p, n) => (
              <li key={n} className="text-[11.5px]" style={text}>
                <strong>{p.video}</strong> <span style={muted}>· {p.where}:</span> {p.what}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
