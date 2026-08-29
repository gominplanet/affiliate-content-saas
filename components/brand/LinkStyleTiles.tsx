// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The one place a creator chooses HOW MVP builds every affiliate link it makes
// for them: Passport, Geniuslink, Bitly, or Direct. One selectable at a time —
// the choice sets the cloaker MVP uses everywhere (blog articles, YouTube
// descriptions, social pushes, Deal Radar). Purely presentational: it renders
// the four tiles and reports the pick; the parent owns state, setup fields, and
// saving. The selected tile's setup is rendered by the parent right below this.
//
// Geo-routing (sending an international shopper to their own country's Amazon)
// only exists on Passport and Geniuslink, so Bitly and Direct carry a
// "no geo-routing" note on the tile itself — the difference a creator most
// needs to see before picking.

'use client'

import { Globe, Link2, Scissors, ArrowUpRight, Check, Lock } from 'lucide-react'

export type LinkStyle = 'passport' | 'geniuslink' | 'bitly' | 'direct'

interface TileDef {
  key: LinkStyle
  name: string
  tagline: string
  geo: boolean
  cost: string
  Icon: typeof Globe
}

const TILES: TileDef[] = [
  { key: 'passport',   name: 'Passport Links', tagline: 'Geo-routes each shopper to their own country’s Amazon.', geo: true,  cost: 'Free', Icon: Globe },
  { key: 'geniuslink', name: 'Genius Links',   tagline: 'Branded geni.us links that geo-route by country.',            geo: true,  cost: 'Your paid Geniuslink plan', Icon: Link2 },
  { key: 'bitly',      name: 'Bitly',          tagline: 'Short links with click stats from your Bitly account.',        geo: false, cost: 'Free', Icon: Scissors },
  { key: 'direct',     name: 'Direct',         tagline: 'Plain tagged Amazon links, nothing in between.',               geo: false, cost: 'Free', Icon: ArrowUpRight },
]

export default function LinkStyleTiles({
  selected,
  passportCanUse,
  busy = false,
  onSelect,
}: {
  selected: LinkStyle
  passportCanUse: boolean
  busy?: boolean
  onSelect: (style: LinkStyle) => void
}) {
  return (
    <>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {TILES.map(({ key, name, tagline, geo, cost, Icon }) => {
        const on = selected === key
        const locked = key === 'passport' && !passportCanUse
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            disabled={busy}
            aria-pressed={on}
            className="relative text-left rounded-xl border p-3.5 transition-all disabled:opacity-70 disabled:cursor-wait focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]/40"
            style={{
              borderColor: on ? '#7C3AED' : 'var(--border-2,#e5e5e7)',
              borderWidth: on ? 2 : 1,
              // Compensate the 1px→2px border so tiles don't jump on select.
              margin: on ? 0 : 1,
              background: on ? 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(52,199,89,0.05))' : 'transparent',
            }}
          >
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: on ? 'linear-gradient(135deg,#7C3AED,#34c759)' : 'rgba(124,58,237,0.10)', color: on ? '#fff' : '#7C3AED' }}>
                <Icon size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{name}</span>
                  {key === 'passport' && (
                    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                      style={{ background: 'rgba(52,199,89,0.18)', color: '#1f7a4d' }}>
                      Best free pick
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#6e6e73] dark:text-[#ebebf0] mt-0.5 leading-snug">{tagline}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                    style={geo ? { background: 'rgba(52,199,89,0.12)', color: '#1f7a4d' } : { background: 'var(--surface-2,#f2f2f4)', color: '#86868b' }}>
                    {geo ? 'Geo-routing' : 'No geo-routing'}
                  </span>
                  <span className="text-[10px] text-[#86868b] dark:text-[#8e8e93]">{locked ? 'Amazon, Studio & Pro' : cost}</span>
                </div>
              </div>
              <div className="flex-shrink-0">
                {locked ? (
                  <Lock size={14} className="text-[#86868b]" />
                ) : on ? (
                  <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: '#7C3AED', color: '#fff' }}>
                    <Check size={12} strokeWidth={3} />
                  </span>
                ) : (
                  <span className="w-5 h-5 rounded-full border" style={{ borderColor: 'var(--border-2,#d2d2d7)' }} />
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>

    {/* Push the free alternative whenever the creator is eligible but not on it —
        especially Geniuslink users, who are paying per click for the same
        geo-routing Passport gives them free on their plan. */}
    {passportCanUse && selected !== 'passport' && (
      <button
        type="button"
        onClick={() => onSelect('passport')}
        disabled={busy}
        className="mt-2.5 w-full text-left rounded-xl border p-3 flex items-start gap-2.5 disabled:opacity-70"
        style={{ borderColor: 'rgba(124,58,237,0.35)', background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(52,199,89,0.04))' }}
      >
        <Globe size={15} style={{ color: '#7C3AED' }} className="mt-0.5 flex-shrink-0" />
        <span className="text-[11.5px] text-[#3a3a3c] dark:text-[#d2d2d7] leading-snug">
          <b className="text-[#1d1d1f] dark:text-[#f5f5f7]">Passport Links geo-routes your links free</b> on your plan, with no per-click fees.{' '}
          {selected === 'geniuslink'
            ? 'Keep Geniuslink if you use its choice pages or non-Amazon retailers. Otherwise, tap to switch to Passport.'
            : 'Tap to switch to Passport.'}
        </span>
      </button>
    )}
    </>
  )
}
