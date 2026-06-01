/**
 * /preview/library — the post catalog redesign. Theme-aware via CSS
 * variables set by app/preview/layout.tsx.
 */
'use client'

import { useState } from 'react'
import {
  Search, Filter, Sparkles, ArrowUpRight,
  RefreshCw, ImageIcon, Share2, Trash2,
  ChevronDown, MoreHorizontal, ExternalLink, CheckSquare,
} from 'lucide-react'

interface Post {
  id: string
  title: string
  site: 'Main' | 'Outdoor' | 'Wine Reviews'
  status: 'published' | 'draft' | 'failed'
  views: number
  seoScore: number
  publishedAt: string
  socialPosts: number
}

const POSTS: Post[] = [
  { id: '1', title: 'MilePop1 Electric Dirt Bike Review — 3000W Off-Road Beast Tested', site: 'Main', status: 'published', views: 1284, seoScore: 92, publishedAt: '2 days ago', socialPosts: 4 },
  { id: '2', title: 'YETI Tundra 45 Cooler — A 5-Day Field Test in the Rockies', site: 'Outdoor', status: 'published', views: 847, seoScore: 89, publishedAt: '5 days ago', socialPosts: 6 },
  { id: '3', title: 'Yaheetech 10×10 Pop Up Canopy Tent — Fastest Outdoor Setup?', site: 'Outdoor', status: 'published', views: 612, seoScore: 84, publishedAt: '7 days ago', socialPosts: 3 },
  { id: '4', title: 'Caymus Cabernet Sauvignon — Five Vintage Showdown', site: 'Wine Reviews', status: 'failed', views: 0, seoScore: 0, publishedAt: '—', socialPosts: 0 },
  { id: '5', title: 'Bose QuietComfort Ultra Headphones — Honest 60-Day Review', site: 'Main', status: 'published', views: 1944, seoScore: 95, publishedAt: '2 weeks ago', socialPosts: 8 },
  { id: '6', title: 'Coleman Sundome Tent — Surviving a Rainstorm in Yosemite', site: 'Outdoor', status: 'published', views: 422, seoScore: 78, publishedAt: '2 weeks ago', socialPosts: 2 },
  { id: '7', title: 'Sony WH-1000XM5 vs Bose QC Ultra — Side-by-Side', site: 'Main', status: 'draft', views: 0, seoScore: 0, publishedAt: '—', socialPosts: 0 },
  { id: '8', title: 'Decoy Pinot Noir 2021 — Mid-Tier Wine, Premium Taste?', site: 'Wine Reviews', status: 'published', views: 287, seoScore: 81, publishedAt: '3 weeks ago', socialPosts: 1 },
]

const SITE_FILTERS = ['All sites', 'Main', 'Outdoor', 'Wine Reviews'] as const
const SITE_COLORS: Record<Post['site'], string> = {
  Main: '#7C3AED',
  Outdoor: '#10B981',
  'Wine Reviews': '#F43F5E',
}

export default function LibraryPreviewPage() {
  const [activeFilter, setActiveFilter] = useState<typeof SITE_FILTERS[number]>('All sites')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  const filteredPosts = POSTS.filter(p =>
    (activeFilter === 'All sites' || p.site === activeFilter) &&
    (query === '' || p.title.toLowerCase().includes(query.toLowerCase()))
  )

  const toggle = (id: string) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  const allSelected = filteredPosts.length > 0 && filteredPosts.every(p => selected.has(p.id))
  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(filteredPosts.map(p => p.id)))
  }

  return (
    <main className="px-8 py-10 flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>Library</h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--text-subtle)' }}>
            Every published, scheduled, and draft post across your sites.
          </p>
        </div>
        <button className="px-3.5 py-2 rounded-lg bg-[#7C3AED] hover:bg-[#6D28D9] text-[13px] font-medium text-white inline-flex items-center gap-1.5 transition-colors">
          <Sparkles size={13} /> Generate new
        </button>
      </header>

      <div
        className="rounded-xl border px-4 py-3 flex items-center gap-3"
        style={{
          backgroundColor: 'rgba(124, 58, 237, 0.08)',
          borderColor: 'rgba(124, 58, 237, 0.25)',
        }}
      >
        <Sparkles size={14} className="text-[#7C3AED] flex-shrink-0" />
        <p className="text-[13px] flex-1" style={{ color: 'var(--text)' }}>
          Your <span className="font-semibold">Outdoor</span> posts are getting 2.3× more views than average — consider <span className="font-semibold">generating 3 more</span> from your unprocessed Outdoor videos.
        </p>
        <button className="text-[12px]" style={{ color: 'var(--text-soft)' }}>Dismiss</button>
        <button className="text-[12px] font-medium text-[#7C3AED] inline-flex items-center gap-1">
          See videos <ArrowUpRight size={11} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div
          className="flex items-center gap-1 p-1 rounded-lg border"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          {SITE_FILTERS.map(filter => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className="px-3 py-1 rounded text-[12px] transition-colors"
              style={{
                backgroundColor: activeFilter === filter ? 'var(--surface-bright)' : 'transparent',
                color: activeFilter === filter ? 'var(--text)' : 'var(--text-subtle)',
              }}
            >
              {filter === 'All sites' ? filter : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SITE_COLORS[filter as Post['site']] }} />
                  {filter}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search posts"
              className="pl-8 pr-3 py-1.5 rounded-lg border text-[12px] focus:outline-none w-56"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border-bright)',
                color: 'var(--text)',
              }}
            />
          </div>
          <button
            className="px-3 py-1.5 rounded-lg border text-[12px] inline-flex items-center gap-1.5 transition-colors"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border-bright)',
              color: 'var(--text-soft)',
            }}
          >
            <Filter size={11} /> Filter
            <ChevronDown size={11} />
          </button>
        </div>
      </div>

      {selected.size > 0 && (
        <div
          className="rounded-lg border px-4 py-2.5 flex items-center gap-3"
          style={{
            backgroundColor: 'rgba(124, 58, 237, 0.10)',
            borderColor: 'rgba(124, 58, 237, 0.35)',
          }}
        >
          <p className="text-[12px]" style={{ color: 'var(--text)' }}>
            <span className="font-semibold tabular-nums">{selected.size}</span> selected
          </p>
          <div className="flex items-center gap-2 ml-2">
            <BulkButton icon={<RefreshCw size={11} />} label="Regenerate" />
            <BulkButton icon={<ImageIcon size={11} />} label="Refresh images" />
            <BulkButton icon={<Share2 size={11} />} label="Push to social" />
            <BulkButton icon={<Trash2 size={11} />} label="Delete" danger />
          </div>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[12px]" style={{ color: 'var(--text-subtle)' }}>
            Clear
          </button>
        </div>
      )}

      <div
        className="rounded-xl border overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--card-shadow)',
        }}
      >
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
              <th className="text-left px-4 py-2.5 w-8">
                <button onClick={toggleAll} style={{ color: allSelected ? '#7C3AED' : 'var(--text-faint)' }}>
                  <CheckSquare size={13} />
                </button>
              </th>
              <Th>Title</Th>
              <Th className="w-28">Site</Th>
              <Th className="w-24">Status</Th>
              <Th className="w-20">Views</Th>
              <Th className="w-16">SEO</Th>
              <Th className="w-16">Social</Th>
              <Th className="w-28">Published</Th>
              <Th className="w-10"></Th>
            </tr>
          </thead>
          <tbody>
            {filteredPosts.map(p => (
              <PostRow key={p.id} post={p} selected={selected.has(p.id)} onToggle={() => toggle(p.id)} />
            ))}
            {filteredPosts.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-12 text-[13px]" style={{ color: 'var(--text-faint)' }}>
                  No posts match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
        Showing {filteredPosts.length} of {POSTS.length} posts
      </p>
    </main>
  )
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`text-left px-3 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] ${className}`}
      style={{ color: 'var(--text-faint)' }}
    >
      {children}
    </th>
  )
}

function PostRow({ post, selected, onToggle }: { post: Post; selected: boolean; onToggle: () => void }) {
  return (
    <tr
      className="border-b last:border-0 transition-colors"
      style={{
        borderColor: 'var(--border)',
        backgroundColor: selected ? 'var(--surface-selected)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.backgroundColor = 'var(--surface-hover)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = selected ? 'var(--surface-selected)' : 'transparent'
      }}
    >
      <td className="px-4 py-3">
        <button onClick={onToggle} style={{ color: selected ? '#7C3AED' : 'var(--text-faint)' }}>
          <CheckSquare size={13} />
        </button>
      </td>
      <td className="px-3 py-3 max-w-md">
        <a href="#" className="text-[13px] line-clamp-1 hover:text-[#9D6BFF]" style={{ color: 'var(--text)' }}>
          {post.title}
        </a>
      </td>
      <td className="px-3 py-3">
        <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-soft)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SITE_COLORS[post.site] }} />
          {post.site}
        </span>
      </td>
      <td className="px-3 py-3"><StatusPill status={post.status} /></td>
      <td className="px-3 py-3 text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>{post.views.toLocaleString()}</td>
      <td className="px-3 py-3">
        {post.status === 'published' ? <SeoScore score={post.seoScore} /> : <span className="text-[12px]" style={{ color: 'var(--text-dim)' }}>—</span>}
      </td>
      <td className="px-3 py-3 text-[12px] tabular-nums" style={{ color: 'var(--text-soft)' }}>{post.socialPosts || '—'}</td>
      <td className="px-3 py-3 text-[12px]" style={{ color: 'var(--text-subtle)' }}>{post.publishedAt}</td>
      <td className="px-3 py-3">
        <button className="p-1 rounded" style={{ color: 'var(--text-faint)' }}>
          <MoreHorizontal size={13} />
        </button>
      </td>
    </tr>
  )
}

function StatusPill({ status }: { status: Post['status'] }) {
  const config = {
    published: { color: '#10B981', label: 'Published' },
    draft: { color: '#F59E0B', label: 'Draft' },
    failed: { color: '#F43F5E', label: 'Failed' },
  }[status]
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: config.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: config.color }} />
      {config.label}
    </span>
  )
}

function SeoScore({ score }: { score: number }) {
  const color = score >= 90 ? '#10B981' : score >= 75 ? '#F59E0B' : '#F43F5E'
  return <span className="text-[12px] font-medium tabular-nums" style={{ color }}>{score}</span>
}

function BulkButton({ icon, label, danger }: { icon: React.ReactNode; label: string; danger?: boolean }) {
  return (
    <button
      className="px-2.5 py-1 rounded text-[11px] font-medium inline-flex items-center gap-1.5 transition-colors"
      style={{ color: danger ? '#F43F5E' : 'var(--text)' }}
    >
      {icon}
      {label}
    </button>
  )
}
