/**
 * /preview/studio — YouTube Co-Pilot redesign.
 *
 * Single-video focus. Pick a video (or one is auto-selected), and the
 * whole page revolves around making the title + thumbnail + first 10s
 * hook for THAT video as compelling as possible. AI variants front and
 * center; sidebar of upcoming videos on the right.
 *
 * Vibe: feels like Final Cut Pro's effects browser meets vidIQ's
 * scoring — but quieter, no garish gradients.
 */
'use client'

import { useState } from 'react'
import {
  Sparkles, RefreshCw, ArrowUpRight, CheckCircle2,
  Star, Image as ImageIcon, Type, Clock, Eye, ChevronRight, Wand2,
} from 'lucide-react'

interface ThumbnailVariant {
  id: string
  gradient: string
  ctrScore: number
  style: string
}

interface TitleVariant {
  id: string
  text: string
  score: number
  reason: string
}

const THUMBS: ThumbnailVariant[] = [
  { id: 't1', gradient: 'from-orange-500/60 via-red-500/40 to-purple-600/60', ctrScore: 94, style: 'Frame + face + bold caption' },
  { id: 't2', gradient: 'from-amber-500/60 via-orange-600/50 to-rose-500/60', ctrScore: 89, style: 'Product hero + comparison' },
  { id: 't3', gradient: 'from-emerald-500/50 via-teal-500/50 to-sky-600/60', ctrScore: 82, style: 'Lifestyle + action shot' },
  { id: 't4', gradient: 'from-indigo-500/50 via-purple-500/50 to-pink-500/60', ctrScore: 78, style: 'Minimal + big text' },
]

const TITLES: TitleVariant[] = [
  { id: 'ttl1', text: 'I Tested the MilePop1 3000W Electric Dirt Bike for 30 Days', score: 92, reason: 'Personal authority + time investment' },
  { id: 'ttl2', text: 'MilePop1 3000W: The $1,800 Electric Beast (Brutally Honest Review)', score: 88, reason: 'Price hook + honesty signal' },
  { id: 'ttl3', text: 'Why I Returned the MilePop1 Electric Dirt Bike', score: 85, reason: 'Curiosity gap, strong but risky' },
  { id: 'ttl4', text: 'MilePop1 3000W Off-Road Beast: Full Review After 30 Hours', score: 79, reason: 'Specific but conventional' },
]

export default function StudioPreviewPage() {
  const [selectedThumb, setSelectedThumb] = useState('t1')
  const [selectedTitle, setSelectedTitle] = useState('ttl1')

  return (
    <main className="px-8 py-10 flex gap-8">
      {/* ── Left: main work area ────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col gap-8">
        {/* Video being optimized */}
        <header className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.15em] text-white/45 mb-2">Optimizing video</p>
            <h1 className="text-[28px] font-semibold tracking-tight text-white truncate">
              MilePop1 Electric Dirt Bike Review
            </h1>
            <div className="flex items-center gap-3 mt-2 text-[12px] text-white/55">
              <span className="inline-flex items-center gap-1.5"><Clock size={11} /> Recorded 3 days ago</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5"><Eye size={11} /> Unpublished</span>
              <span>·</span>
              <span>14m 32s</span>
            </div>
          </div>
          <button className="px-3.5 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-[13px] font-medium text-white inline-flex items-center gap-1.5 transition-colors flex-shrink-0">
            <Sparkles size={13} /> Publish to YouTube
          </button>
        </header>

        {/* AI suggestion banner */}
        <div className="rounded-xl bg-gradient-to-r from-[#7C3AED]/10 to-[#C026D3]/5 border border-[#7C3AED]/20 px-4 py-3 flex items-center gap-3">
          <Sparkles size={14} className="text-[#7C3AED] flex-shrink-0" />
          <p className="text-[13px] text-white flex-1">
            Your top-CTR videos use <span className="font-semibold">red-orange thumbnails with your face + 3-word caption</span>. Variant 1 follows that pattern.
          </p>
          <button className="text-[12px] font-medium text-[#7C3AED] hover:text-[#9D6BFF] inline-flex items-center gap-1">
            Why <ArrowUpRight size={11} />
          </button>
        </div>

        {/* Thumbnail section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ImageIcon size={14} className="text-white/55" />
              <h2 className="text-[14px] font-semibold tracking-tight text-white">Thumbnail variants</h2>
              <span className="text-[11px] text-white/40 px-2 py-0.5 rounded bg-white/[0.04]">4 generated</span>
            </div>
            <button className="text-[12px] text-white/60 hover:text-white inline-flex items-center gap-1.5">
              <RefreshCw size={11} /> Regenerate all
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {THUMBS.map(t => (
              <ThumbnailCard
                key={t.id}
                variant={t}
                selected={selectedThumb === t.id}
                onSelect={() => setSelectedThumb(t.id)}
              />
            ))}
          </div>

          {/* Refine row */}
          <div className="mt-3 rounded-lg bg-white/[0.03] border border-white/[0.06] p-3 flex items-center gap-2">
            <Wand2 size={13} className="text-[#7C3AED] flex-shrink-0" />
            <input
              type="text"
              placeholder='Refine: "Make the caption bigger" or "Try a forest background"'
              className="flex-1 bg-transparent text-[13px] text-white placeholder:text-white/35 focus:outline-none"
            />
            <button className="px-2.5 py-1 rounded text-[11px] font-medium text-white bg-white/[0.06] hover:bg-white/[0.1]">
              Apply
            </button>
          </div>
        </section>

        {/* Title section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Type size={14} className="text-white/55" />
              <h2 className="text-[14px] font-semibold tracking-tight text-white">Title variants</h2>
              <span className="text-[11px] text-white/40 px-2 py-0.5 rounded bg-white/[0.04]">5 generated</span>
            </div>
            <button className="text-[12px] text-white/60 hover:text-white inline-flex items-center gap-1.5">
              <RefreshCw size={11} /> Regenerate
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {TITLES.map(t => (
              <TitleRow
                key={t.id}
                variant={t}
                selected={selectedTitle === t.id}
                onSelect={() => setSelectedTitle(t.id)}
              />
            ))}
          </div>
        </section>

        {/* Hook section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Star size={14} className="text-white/55" />
              <h2 className="text-[14px] font-semibold tracking-tight text-white">First-10-seconds hook</h2>
            </div>
            <button className="text-[12px] text-white/60 hover:text-white inline-flex items-center gap-1.5">
              <RefreshCw size={11} /> Regenerate
            </button>
          </div>
          <div
            className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5"
            style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.2)' }}
          >
            <p className="text-[15px] text-white leading-relaxed">
              &ldquo;I just spent 30 days off-roading on a $1,800 Chinese electric dirt bike that promised 3000 watts of power and 50 miles of range. Here&apos;s what they don&apos;t tell you on the spec sheet — including the one thing that almost made me return it.&rdquo;
            </p>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/[0.06]">
              <span className="text-[10px] uppercase tracking-[0.12em] text-white/40">Retention score</span>
              <span className="text-[13px] font-semibold text-[#10B981] tabular-nums">86%</span>
              <span className="text-[11px] text-white/45">vs your channel average of 64%</span>
            </div>
          </div>
        </section>
      </div>

      {/* ── Right rail: upcoming videos ──────────────────────────────── */}
      <aside className="w-72 flex-shrink-0">
        <h3 className="text-[11px] uppercase tracking-[0.15em] text-white/45 mb-3">Next up</h3>
        <div className="flex flex-col gap-2">
          {[
            { title: 'YETI Tundra 45 Cooler — 5 Day Test', age: '1d ago' },
            { title: 'Caymus Cabernet 2021 — Five Vintage', age: '3d ago' },
            { title: 'Bose QC Ultra — 60 Day Honest Review', age: '4d ago' },
            { title: 'Sony WH-1000XM5 vs Bose QC Ultra', age: '5d ago' },
          ].map((v, i) => (
            <a
              key={i}
              href="#"
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] transition-colors group"
            >
              <div className="w-14 h-10 rounded bg-gradient-to-br from-white/10 to-white/5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-white/85 line-clamp-1 group-hover:text-white">{v.title}</p>
                <p className="text-[10px] text-white/40 mt-0.5">{v.age}</p>
              </div>
              <ChevronRight size={12} className="text-white/30 group-hover:text-white/60" />
            </a>
          ))}
        </div>

        <h3 className="text-[11px] uppercase tracking-[0.15em] text-white/45 mt-8 mb-3">Recent performance</h3>
        <div
          className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4"
          style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}
        >
          <p className="text-[11px] text-white/55">Your last 5 videos</p>
          <p className="text-[28px] font-semibold text-white tabular-nums leading-none mt-2">7.2%</p>
          <p className="text-[11px] text-white/55 mt-1">Avg CTR</p>
          <p className="text-[10px] text-[#10B981] mt-2">+1.4% vs the 30 days prior</p>
        </div>

        <h3 className="text-[11px] uppercase tracking-[0.15em] text-white/45 mt-8 mb-3">Tips</h3>
        <div className="flex flex-col gap-2">
          <TipCard text="Faces in thumbnails get +24% CTR on your channel" />
          <TipCard text="Titles with brackets [like this] underperform for you" />
        </div>
      </aside>
    </main>
  )
}

function ThumbnailCard({ variant, selected, onSelect }: { variant: ThumbnailVariant; selected: boolean; onSelect: () => void }) {
  const ctrColor = variant.ctrScore >= 90 ? '#10B981' : variant.ctrScore >= 80 ? '#F59E0B' : '#F43F5E'
  return (
    <button
      onClick={onSelect}
      className={`group relative rounded-xl overflow-hidden border-2 transition-all duration-200 text-left ${
        selected ? 'border-[#7C3AED]' : 'border-transparent hover:border-white/[0.12]'
      }`}
    >
      <div className={`aspect-video bg-gradient-to-br ${variant.gradient} relative flex items-end p-3`}>
        {selected && (
          <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#7C3AED] flex items-center justify-center">
            <CheckCircle2 size={12} className="text-white" />
          </div>
        )}
        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums text-white" style={{ backgroundColor: `${ctrColor}33`, border: `1px solid ${ctrColor}` }}>
          {variant.ctrScore} CTR
        </span>
      </div>
      <p className="text-[11px] text-white/60 px-2 py-2">{variant.style}</p>
    </button>
  )
}

function TitleRow({ variant, selected, onSelect }: { variant: TitleVariant; selected: boolean; onSelect: () => void }) {
  const scoreColor = variant.score >= 90 ? '#10B981' : variant.score >= 80 ? '#F59E0B' : '#F43F5E'
  return (
    <button
      onClick={onSelect}
      className={`text-left rounded-xl p-4 border transition-all duration-200 ${
        selected
          ? 'bg-[#7C3AED]/[0.08] border-[#7C3AED]/40'
          : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]'
      }`}
      style={{ boxShadow: selected ? 'inset 0 1px 0 rgba(255,255,255,0.04)' : undefined }}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 flex-shrink-0 w-12">
          <span className="text-[18px] font-semibold tabular-nums" style={{ color: scoreColor }}>
            {variant.score}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-white/40">Score</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] text-white leading-snug">{variant.text}</p>
          <p className="text-[11px] text-white/50 mt-1">{variant.reason}</p>
        </div>
        {selected && <CheckCircle2 size={16} className="text-[#7C3AED] flex-shrink-0" />}
      </div>
    </button>
  )
}

function TipCard({ text }: { text: string }) {
  return (
    <div className="rounded-lg bg-white/[0.025] border border-white/[0.05] px-3 py-2 flex items-start gap-2">
      <Sparkles size={11} className="text-[#7C3AED] mt-0.5 flex-shrink-0" />
      <p className="text-[11px] text-white/70 leading-snug">{text}</p>
    </div>
  )
}
