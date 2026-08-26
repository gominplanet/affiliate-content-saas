'use client'

// Topbar "search MVP" box — a lightweight command palette that jumps to any
// page OR a specific section inside a page (Geniuslink keys, upload brand logo,
// AdSense, connect socials, …). Index lives in lib/app-search-index.ts.
//
// Interaction: type to filter, ↑/↓ to move, Enter to go, Esc to close, and
// ⌘K / Ctrl+K from anywhere focuses it. Section results carry a #hash; after
// navigating we scroll the anchor into view + flash it so the user sees exactly
// where they landed even when the section is far down a long page.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, CornerDownLeft } from 'lucide-react'
import { searchApp, type AppSearchEntry } from '@/lib/app-search-index'

export default function TopbarSearch({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const results = query.trim() ? searchApp(query, { isAdmin }) : []

  // ⌘K / Ctrl+K focuses the box from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Close when clicking outside the box.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  // Keep the highlighted row in range as results change.
  useEffect(() => { setActive(0) }, [query])

  const scrollToHash = useCallback((hash: string) => {
    let tries = 0
    const tick = () => {
      const el = document.getElementById(hash)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        const prev = el.style.boxShadow
        el.style.transition = 'box-shadow 0.35s ease'
        el.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.55)'
        setTimeout(() => { el.style.boxShadow = prev }, 1600)
      } else if (tries++ < 40) {
        setTimeout(tick, 60)
      }
    }
    // Give the destination route a beat to paint before we look for the anchor.
    setTimeout(tick, 140)
  }, [])

  const go = useCallback((entry: AppSearchEntry) => {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
    router.push(entry.href)
    const hash = entry.href.split('#')[1]
    if (hash) scrollToHash(hash)
  }, [router, scrollToHash])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return }
    if (!results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % results.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + results.length) % results.length) }
    else if (e.key === 'Enter') { e.preventDefault(); const pick = results[active] ?? results[0]; if (pick) go(pick) }
  }

  return (
    <div ref={boxRef} className="relative hidden md:block w-72">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[13px] transition-colors"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <Search size={14} style={{ color: 'var(--text-faint)' }} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search MVP…"
          aria-label="Search MVP for a page or section"
          className="flex-1 bg-transparent outline-none placeholder:text-[var(--text-faint)]"
          style={{ color: 'var(--text)' }}
        />
        <kbd
          className="hidden lg:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{ backgroundColor: 'var(--kbd-bg)', color: 'var(--text-faint)' }}
        >
          ⌘K
        </kbd>
      </div>

      {open && query.trim() && (
        <div className="mvp-panel absolute left-0 right-0 mt-2 rounded-xl border overflow-hidden shadow-xl z-50">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-[12px]" style={{ color: 'var(--text-faint)' }}>
              No matches for “{query.trim()}”. Try “geniuslink”, “logo”, or “schedule”.
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {results.map((r, i) => (
                <li key={`${r.href}-${r.label}`}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => { e.preventDefault(); go(r) }}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors"
                    style={{ backgroundColor: i === active ? 'var(--surface-hover)' : 'transparent' }}
                  >
                    <span className="flex flex-col min-w-0">
                      <span className="text-[13px] font-medium truncate" style={{ color: 'var(--text)' }}>{r.label}</span>
                      <span className="text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>{r.group}</span>
                    </span>
                    {i === active && <CornerDownLeft size={13} style={{ color: 'var(--text-faint)' }} className="flex-shrink-0" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
