'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, RefreshCw, Plus, Check } from 'lucide-react'

/**
 * Pinterest board picker. Two modes:
 *   - Organize by category (default): a board per blog-post category, auto-created.
 *   - Send all pins to one board: the creator picks (or creates) a real board.
 *
 * Talks to /api/pinterest/boards (GET list + target; POST select/create/auto).
 * Picking a board also fixes the stale-sandbox-board problem — the creator points
 * pins at a real board they made.
 */

interface Board { id: string; name: string }

export function PinterestBoardPicker() {
  const [loading, setLoading] = useState(true)
  const [boards, setBoards] = useState<Board[]>([])
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await fetch('/api/pinterest/boards').then(r => r.json())
      if (Array.isArray(d.boards)) setBoards(d.boards)
      setTarget(d.target ?? null)
      if (d.error) setNote({ ok: false, msg: d.error })
    } catch { setNote({ ok: false, msg: 'Could not load your boards.' }) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setNote(null)
    try {
      const d = await fetch('/api/pinterest/boards', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(r => r.json())
      if (d.error) { setNote({ ok: false, msg: d.error }); return false }
      setTarget(d.target ?? null)
      if (d.board && !boards.some(b => b.id === d.board.id)) setBoards(prev => [d.board, ...prev])
      return true
    } catch { setNote({ ok: false, msg: 'Save failed. Try again.' }); return false }
    finally { setBusy(false) }
  }

  const mode: 'category' | 'single' = target ? 'single' : 'category'

  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 p-3 flex flex-col gap-3">
      <p className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Where should pins go?</p>

      {/* Mode radios */}
      <div className="flex flex-col gap-2">
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="radio" checked={mode === 'category'} disabled={busy}
            onChange={() => post({ action: 'auto' })} className="mt-0.5 accent-[#E60023]" />
          <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">
            <strong>Organize by category</strong> <span className="text-[#86868b]">— a board per blog category, created automatically.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="radio" checked={mode === 'single'} disabled={busy}
            onChange={() => { if (!target && boards[0]) post({ action: 'select', boardId: boards[0].id }) }} className="mt-0.5 accent-[#E60023]" />
          <span className="text-xs text-[#1d1d1f] dark:text-[#f5f5f7]">
            <strong>Send all pins to one board</strong> <span className="text-[#86868b]">— pick or create it below.</span>
          </span>
        </label>
      </div>

      {mode === 'single' && (
        <div className="flex flex-col gap-2 pl-6">
          {loading ? (
            <span className="text-xs text-[#86868b] inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading boards…</span>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={target ?? ''}
                disabled={busy}
                onChange={e => post({ action: 'select', boardId: e.target.value })}
                className="input-field text-sm flex-1"
              >
                {boards.length === 0 && <option value="">No boards yet — create one below</option>}
                {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button onClick={load} disabled={busy} title="Refresh boards"
                className="p-2 rounded-lg border border-gray-200 dark:border-white/10 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors">
                <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
              </button>
            </div>
          )}

          {/* Create a new board */}
          {creating ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="New board name (e.g. Kitchen Picks)"
                className="input-field text-sm flex-1"
                onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) post({ action: 'create', name: newName.trim() }).then(ok => { if (ok) { setNewName(''); setCreating(false) } }) }}
              />
              <button
                disabled={busy || !newName.trim()}
                onClick={() => post({ action: 'create', name: newName.trim() }).then(ok => { if (ok) { setNewName(''); setCreating(false) } })}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-[#E60023] disabled:opacity-50 inline-flex items-center gap-1"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Create
              </button>
              <button onClick={() => { setCreating(false); setNewName('') }} className="text-xs text-[#86868b] hover:text-[#1d1d1f]">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} className="self-start inline-flex items-center gap-1 text-xs font-semibold text-[#E60023] hover:underline">
              <Plus size={12} /> Create a new board
            </button>
          )}
        </div>
      )}

      {note && <p className={`text-[11px] ${note.ok ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>{note.msg}</p>}
    </div>
  )
}
