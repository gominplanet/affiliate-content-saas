'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Drop: THE SETUP, DONE ONCE (Seb, 2026-10-17: "set up their settings and
// their plan on one page. And then once that setup is done, they never have to
// look at it again. They can just upload, upload, upload"). Where each kind
// of video goes, and every YouTube and Amazon setting a Liftoff batch takes,
// with Liftoff's own pickers so the two pages always agree. Each drop's batch
// is made from what is saved here (lib/drop-run startDraftBatch).

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import CtaPicker from '@/components/launch/CtaPicker'
import ThumbnailPicker from '@/components/launch/ThumbnailPicker'
import { SlotEditor } from '@/components/launch/LaunchBoard'
import { PlaceTile, PLACES_OF, TEAL } from '@/components/labs/DropPlaces'
import { cadenceLabel } from '@/lib/launch-schedule'
import { setupMissing, type LaunchPlans, type DropSettings, type PlaceId, type DropKind } from '@/lib/drop-plan'
import type { CtaPreset } from '@/lib/launch-batch'
import { defaultThumbnailPreset, type ThumbnailPreset } from '@/lib/thumbnail-preset'

const STUDIO_STEPS: Array<[keyof DropSettings['studioOptions'], string, string]> = [
  ['disclosures', 'Paid promotion: Yes, and AI use: No', 'Untick if your videos are AI generated or altered.'],
  ['monetize', 'Monetization: On', 'Skipped on a channel without it.'],
  ['adRating', 'Ad suitability: None of the above, then Submit rating', 'YouTube checks this rating, so only tick it when it is true.'],
  ['endScreen', 'End screen imported from your latest video', ''],
]

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t pt-4 first:border-t-0 first:pt-0" style={{ borderColor: 'var(--border)' }}>
      <div>
        <h4 className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{title}</h4>
        {hint && <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--text-2)' }}>{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export default function DropSetup({ plans, settings, why, onSave, onClose, first }: {
  plans: LaunchPlans
  settings: DropSettings
  why: (place: PlaceId) => string | null
  onSave: (p: LaunchPlans) => Promise<boolean>
  onClose: () => void
  /** The first time: there is no saved setup to go back to. */
  first: boolean
}) {
  const [draft, setDraft] = useState<LaunchPlans>({ long: plans.long, vertical: plans.vertical })
  const [st, setSt] = useState<DropSettings>(settings)
  const [saving, setSaving] = useState(false)
  // PICKED IS NOT SAVED. The CTA and look pickers have their own buttons,
  // and pressing one must not read as done: the setup says it is not saved
  // until Save setup is pressed.
  const [start] = useState(() => JSON.stringify({ long: plans.long, vertical: plans.vertical, st: settings }))
  const unsaved = first || JSON.stringify({ long: draft.long, vertical: draft.vertical, st }) !== start
  const [channels, setChannels] = useState<Array<{ channelId: string; channelTitle: string; isDefault: boolean; hasOAuth: boolean }> | null>(null)
  const [playlists, setPlaylists] = useState<Array<{ id: string; title: string }> | null>(null)
  const [playlistsError, setPlaylistsError] = useState<string | null>(null)
  const set = (p: Partial<DropSettings>) => setSt((s) => ({ ...s, ...p }))
  const flip = (kind: DropKind, place: PlaceId) => setDraft((d) => ({ ...d, [kind]: d[kind].includes(place) ? d[kind].filter((x) => x !== place) : [...d[kind], place] }))

  useEffect(() => {
    fetch('/api/youtube/channels').then((r) => r.json()).then((j) => {
      const list = (Array.isArray(j?.channels) ? j.channels : []) as Array<{ channelId: string; channelTitle: string; isDefault: boolean; hasOAuth: boolean }>
      setChannels(list.filter((c) => c.hasOAuth))
      // The default channel that can upload, when none was picked yet.
      if (!st.channelId) {
        const def = list.find((c) => c.hasOAuth && c.isDefault) ?? list.find((c) => c.hasOAuth)
        if (def) set({ channelId: def.channelId })
      }
    }).catch(() => setChannels([]))
    // Only the first channel read decides the default.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    setPlaylists(null); setPlaylistsError(null)
    fetch(`/api/youtube/playlists?channel=${encodeURIComponent(st.channelId || 'default')}`).then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setPlaylistsError(j?.error || 'Could not read your playlists.'); setPlaylists([]); return }
      setPlaylists(Array.isArray(j?.playlists) ? j.playlists : [])
    }).catch(() => { setPlaylistsError('Could not read your playlists.'); setPlaylists([]) })
  }, [st.channelId])

  const longGoes = draft.long.includes('liftoff')
  const missing = longGoes ? setupMissing(st) : []
  const field = 'w-full rounded-lg border px-2.5 py-1.5 text-[12.5px] bg-transparent'
  const fieldStyle = { borderColor: 'var(--border)', color: 'var(--text)' }

  return (
    <div className="rounded-2xl border p-4 sm:p-5 flex flex-col gap-4" style={{ borderColor: TEAL, background: 'var(--surface)' }}>
      <div>
        <h3 className="text-[16px] font-semibold" style={{ color: 'var(--text)' }}>{first ? 'Set up Drop once' : 'Your setup'}</h3>
        <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--text-2)' }}>
          Where each kind of video goes, and how. Every video you drop follows this, so after today you only drop and press Launch.
          {first && ' It starts from your last Liftoff batch.'}
        </p>
      </div>

      <Section title="Where your videos go" hint="You can still change any one video before you press Launch.">
        {(['long', 'vertical'] as DropKind[]).map((kind) => (
          <div key={kind} className="flex flex-col gap-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>{kind === 'long' ? 'Long videos' : 'Vertical videos'}</p>
            <div className="grid gap-2 grid-cols-2 lg:grid-cols-3">
              {PLACES_OF[kind].map((p) => <PlaceTile key={p} place={p} on={draft[kind].includes(p)} why={why(p)} onClick={() => flip(kind, p)} />)}
            </div>
          </div>
        ))}
      </Section>

      {longGoes && (
        <>
          <Section title="YouTube or Amazon only" hint="Amazon is the US store. Global Storefront shows your US videos in the other countries.">
            <div className="flex flex-wrap gap-2">
              {[{ v: true, l: 'YouTube, then Amazon' }, { v: false, l: 'Amazon only, nothing to YouTube' }].map((o) => (
                <button key={String(o.v)} type="button" aria-pressed={st.sendToYouTube === o.v} onClick={() => set({ sendToYouTube: o.v, amazon: o.v ? st.amazon : true })}
                  className="rounded-full border px-3 py-1 text-[12px] font-semibold"
                  style={st.sendToYouTube === o.v ? { borderColor: TEAL, background: 'rgba(14,165,164,0.12)', color: 'var(--text)' } : { borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                  {o.l}
                </button>
              ))}
              {st.sendToYouTube && (
                <label className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text)' }}>
                  <input type="checkbox" checked={st.amazon} onChange={(e) => set({ amazon: e.target.checked })} /> Also the US Amazon store
                </label>
              )}
            </div>
          </Section>

          <Section title="Your CTA" hint={st.ctaChosen ? (st.cta ? 'Burned into every long video in the same spot.' : 'No CTA on your videos.') : 'Pick one, or No CTA. It is burned into every long video.'}>
            <CtaPicker value={(st.cta as CtaPreset | null) ?? null} saving={false} onSave={(preset) => set({ cta: preset, ctaChosen: true })} />
          </Section>

          <Section title="Your thumbnail look" hint={st.thumbnailChosen ? 'Every thumbnail is built in this look. Each video can still have its own face.' : 'The style, the face and the hook, for every thumbnail.'}>
            <ThumbnailPicker value={st.thumbnail && typeof st.thumbnail === 'object' ? { ...defaultThumbnailPreset(), ...(st.thumbnail as Partial<ThumbnailPreset>) } : null} chosen={st.thumbnailChosen} saving={false} onSave={(preset) => set({ thumbnail: preset, thumbnailChosen: true })} />
          </Section>

          {st.sendToYouTube && (
            <>
              <Section title="When they go public on YouTube" hint={`${cadenceLabel(st.dailySlots)}. Videos go out one per time, per day, in the order you drop them, starting with the next free time. Any video can have its own date and time on its card.`}>
                <SlotEditor slots={st.dailySlots} disabled={false} onChange={(next) => set({ dailySlots: next })} />
              </Section>

              <Section title="Your YouTube channel and playlist" hint="The channel is checked with YouTube for every drop, so videos never go to the wrong one.">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-[11.5px] font-semibold" style={{ color: 'var(--text-2)' }}>
                    Channel
                    {channels === null ? <span className="inline-flex items-center gap-1.5 font-normal"><Loader2 size={12} className="animate-spin" /> Reading your channels</span>
                      : channels.length === 0 ? <span className="font-normal text-amber-700 dark:text-amber-300">No channel is connected for uploading. <a href="/connect-youtube" className="underline">Connect one</a>.</span>
                        : (
                          <select className={field} style={fieldStyle} value={st.channelId ?? ''} onChange={(e) => set({ channelId: e.target.value || null, playlistId: null })}>
                            <option value="">Pick a channel</option>
                            {channels.map((c) => <option key={c.channelId} value={c.channelId}>{c.channelTitle}{c.isDefault ? ' (default)' : ''}</option>)}
                          </select>
                        )}
                  </label>
                  <label className="flex flex-col gap-1 text-[11.5px] font-semibold" style={{ color: 'var(--text-2)' }}>
                    Playlist
                    <select className={field} style={fieldStyle} value={st.playlistId ?? ''} disabled={!playlists} onChange={(e) => set({ playlistId: e.target.value || null })}>
                      <option value="">None</option>
                      {(playlists ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                      {st.playlistId && playlists && !playlists.some((p) => p.id === st.playlistId) && <option value={st.playlistId}>Saved playlist ({st.playlistId})</option>}
                    </select>
                    {playlistsError && <span className="font-normal text-amber-700 dark:text-amber-300">{playlistsError}</span>}
                  </label>
                </div>
                <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text)' }}>
                  <input type="checkbox" checked={st.notifySubscribers} onChange={(e) => set({ notifySubscribers: e.target.checked })} />
                  Notify subscribers when each video goes public
                </label>
              </Section>

              <Section title="What SCOUT sets in YouTube Studio" hint="Done for each video once it is on YouTube, one at a time, while Chrome is open.">
                <div className="flex flex-col gap-1.5">
                  {STUDIO_STEPS.map(([k, label, hint]) => {
                    const off = k === 'adRating' && !st.studioOptions.monetize
                    return (
                      <label key={k} className={`flex items-start gap-2 text-[12px] ${off ? 'opacity-50' : ''}`} style={{ color: 'var(--text)' }}>
                        <input type="checkbox" className="mt-0.5" checked={st.studioOptions[k] && !off} disabled={off}
                          onChange={(e) => set({ studioOptions: { ...st.studioOptions, [k]: e.target.checked } })} />
                        <span>{label}{hint && <span className="block text-[11px]" style={{ color: 'var(--text-2)' }}>{hint}</span>}</span>
                      </label>
                    )
                  })}
                  <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>Every video also gets its pinned first comment with your link.</p>
                </div>
              </Section>
            </>
          )}
        </>
      )}

      {missing.length > 0 && (
        <p className="rounded-lg px-3 py-2 text-[12px] text-amber-700 bg-amber-500/15 dark:text-amber-300 dark:bg-amber-400/15">
          Still to pick for long videos: {missing.join(', ')}. You can save now and pick them later; long videos wait until they are set.
        </p>
      )}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5" style={{ borderColor: unsaved ? TEAL : 'var(--border)', background: 'var(--surface)', boxShadow: '0 6px 24px rgba(0,0,0,0.12)' }}>
        <button type="button" disabled={saving} onClick={async () => { setSaving(true); const ok = await onSave({ ...draft, settings: st }); setSaving(false); if (ok) onClose() }}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60" style={{ background: TEAL }}>
          {saving && <Loader2 size={13} className="animate-spin" />} Save setup
        </button>
        {!first && (
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Cancel</button>
        )}
        <span className="text-[12px] min-w-0" style={{ color: 'var(--text-2)' }}>
          {unsaved ? 'Not saved yet. Nothing here applies until you press Save setup.' : 'No changes.'}
        </span>
      </div>
    </div>
  )
}
