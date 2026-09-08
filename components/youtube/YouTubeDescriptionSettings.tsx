'use client'

/**
 * YouTubeDescriptionSettings — the two "what MVP adds to every YouTube
 * description" editors, living on the YouTube page (/connect-youtube).
 *
 *  1. Description sections — titled blocks of name → link rows (gear, setup,
 *     recurring affiliate links). Stored in brand_profiles.gear_sections.
 *  2. Custom block — free text the creator manages themselves; Co-Pilot appends
 *     it verbatim (spacing/emojis kept) to every description. Stored in
 *     brand_profiles.youtube_description_block.
 *  3. MVP's own lines — the disclosure, blog backlink, sign-off and
 *     collaboration line, which used to be hard-coded in the route. A creator
 *     could only ever APPEND to their description; when MVP's wording was wrong
 *     (one creator's blog URL printed twice) their only options were to fix it
 *     by hand on every video or wait for us. Stored in
 *     brand_profiles.yt_description_lines as { lineKey: text }; an untouched
 *     line is simply absent and uses MVP's default.
 *
 * Self-contained: loads just these two columns and saves them with a targeted
 * upsert (never touches the rest of the brand profile). This is the SOLE editor
 * for them — Brand Profile no longer carries these blocks.
 */

import { useCallback, useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { LINE_KEYS, LINE_META, DEFAULT_LINES, disclosureIsValid, type LineKey } from '@/lib/yt-description-lines'
import { Plus, Trash2, GripVertical, Loader2, Check, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'

interface GearItem { name: string; url: string }
interface GearSection { title: string; items: GearItem[] }

export function YouTubeDescriptionSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sections, setSections] = useState<GearSection[]>([])
  const [customBlock, setCustomBlock] = useState('')
  const [lines, setLines] = useState<Partial<Record<LineKey, string>>>({})
  const [linesOpen, setLinesOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const supabase = createBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).from('brand_profiles')
        .select('gear_sections, youtube_description_block, yt_description_lines')
        .eq('user_id', user.id).maybeSingle()
      setSections((data?.gear_sections ?? []) as GearSection[])
      setCustomBlock((data?.youtube_description_block as string | null) ?? '')
      setLines((data?.yt_description_lines as Partial<Record<LineKey, string>> | null) ?? {})
    } catch { /* leave empty */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  /** How many of MVP's lines this creator has rewritten, so the collapsed
   *  header says whether there is anything inside worth opening. */
  const changedCount = LINE_KEYS.filter((k) => String(lines[k] ?? '').trim()).length

  async function save() {
    setSaving(true)
    try {
      const supabase = createBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setSaving(false); return }
      // Targeted upsert: only these two columns. On an existing row it updates
      // just them; a brand-new row takes DB defaults for everything else.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from('brand_profiles').upsert(
        // Only lines the creator actually changed are stored. An empty box means
        // "give me MVP's default back", not "print nothing", so it is dropped
        // from the object rather than saved as an empty string.
        {
          user_id: user.id,
          gear_sections: sections,
          youtube_description_block: customBlock,
          yt_description_lines: Object.fromEntries(
            Object.entries(lines).filter(([, v]) => String(v ?? '').trim()),
          ),
        },
        { onConflict: 'user_id' },
      )
      if (error) { toast.error(`Couldn’t save: ${error.message}`); return }
      toast.success('Saved. Co-Pilot will add this to every YouTube description.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed.')
    } finally { setSaving(false) }
  }

  if (loading) {
    return (
      <div className="card p-6 mt-5 flex items-center gap-2 text-sm text-[#86868b]">
        <Loader2 size={16} className="animate-spin" /> Loading your description settings…
      </div>
    )
  }

  return (
    <div className="card p-6 mt-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Every YouTube description</h2>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white bg-[#7C3AED] hover:bg-[#6d28d9] disabled:opacity-60 transition-colors flex-shrink-0"
        >
          {saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : <><Check size={14} /> Save</>}
        </button>
      </div>
      <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-6">
        Everything Co-Pilot adds to the bottom of every YouTube description it writes for you.
      </p>

      {/* Sub-section: structured link sections (gear, setup, recurring links) */}
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Description sections</h3>
        <button
          type="button"
          onClick={() => setSections([...sections, { title: '', items: [{ name: '', url: '' }] }])}
          className="flex items-center gap-1 text-xs text-[#7C3AED] hover:underline"
        >
          <Plus size={12} /> Add section
        </button>
      </div>
      <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-4">
        Titled blocks of name → link rows — great for your gear, editing setup, or any recurring affiliate links.
      </p>
      {sections.length === 0 && (
        <p className="text-xs text-[#86868b] dark:text-[#8e8e93] italic">No sections yet. Click &quot;Add section&quot; to create one.</p>
      )}
      <div className="flex flex-col gap-5">
        {sections.map((section, si) => (
          <div key={si} className="border border-gray-200 dark:border-white/10 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <GripVertical size={14} className="text-[#86868b] dark:text-[#8e8e93] flex-shrink-0" />
              <input
                type="text"
                value={section.title}
                onChange={e => {
                  const updated = [...sections]
                  updated[si] = { ...updated[si], title: e.target.value }
                  setSections(updated)
                }}
                placeholder="e.g. WHAT I USE TO RECORD MY VIDEOS"
                className="input-field text-xs font-semibold flex-1"
              />
              <button
                type="button"
                onClick={() => setSections(sections.filter((_, i) => i !== si))}
                className="text-[#ff3b30] hover:opacity-70 flex-shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="flex flex-col gap-2 pl-5">
              {section.items.map((item, ii) => (
                <div key={ii} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item.name}
                    onChange={e => {
                      const updated = [...sections]
                      updated[si].items[ii] = { ...updated[si].items[ii], name: e.target.value }
                      setSections(updated)
                    }}
                    placeholder="Product name"
                    className="input-field text-xs flex-1"
                  />
                  <input
                    type="url"
                    value={item.url}
                    onChange={e => {
                      const updated = [...sections]
                      updated[si].items[ii] = { ...updated[si].items[ii], url: e.target.value }
                      setSections(updated)
                    }}
                    placeholder="https://amzn.to/..."
                    className="input-field text-xs flex-1 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const updated = [...sections]
                      updated[si].items = updated[si].items.filter((_, i) => i !== ii)
                      setSections(updated)
                    }}
                    className="text-[#86868b] hover:text-[#ff3b30] flex-shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const updated = [...sections]
                  updated[si].items.push({ name: '', url: '' })
                  setSections(updated)
                }}
                className="flex items-center gap-1 text-xs text-[#7C3AED] hover:underline self-start mt-1"
              >
                <Plus size={11} /> Add item
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Divider between the two sub-sections. */}
      <div className="border-t border-gray-200 dark:border-white/10 my-6" />

      {/* Sub-section: free-text custom block — Co-Pilot appends it verbatim. */}
      <h3 className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Custom block</h3>
      <p className="text-xs text-[#6e6e73] dark:text-[#ebebf0] mb-3">
        Write anything you want on <strong>every</strong> description — your socials, a discount code, a standard sign-off, emojis. Co-Pilot adds it exactly as you type it. Your spacing and line breaks are kept.
      </p>
      <textarea
        value={customBlock}
        onChange={(e) => setCustomBlock(e.target.value)}
        placeholder={'📸 Follow me:\nInstagram: https://instagram.com/yourname\nTikTok: https://tiktok.com/@yourname\n\n💸 Save 10% with code SAVE10'}
        rows={8}
        className="input-field text-sm font-mono resize-y whitespace-pre-wrap"
      />
      <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mt-2">
        Leave empty to skip it. Links here are added as-is (they aren&rsquo;t turned into affiliate links).
      </p>

      <div className="border-t border-gray-200 dark:border-white/10 my-6" />

      {/* Sub-section: MVP's own lines. Collapsed by default — most creators are
          happy with the defaults, and the ones who are not were previously
          stuck editing the same sentence on every video by hand. */}
      <button
        onClick={() => setLinesOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
        aria-expanded={linesOpen}
      >
        <span>
          <span className="block text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">MVP&rsquo;s own lines</span>
          <span className="block text-xs text-[#6e6e73] dark:text-[#ebebf0] mt-0.5">
            The disclosure, blog link, sign-off and collaboration line. Edit any of them in your own words.
            {changedCount > 0 && <> <strong>{changedCount} changed.</strong></>}
          </span>
        </span>
        <ChevronDown size={16} className={`shrink-0 transition-transform ${linesOpen ? 'rotate-180' : ''}`} />
      </button>

      {linesOpen && (
        <div className="mt-4 space-y-4">
          {LINE_KEYS.map((key) => {
            const meta = LINE_META[key]
            const value = lines[key] ?? ''
            const isDisclosure = key === 'disclosureProduct' || key === 'disclosureGeneral'
            // The disclosure is the one line a creator's freedom runs into
            // someone else's rules. Say so here rather than silently ignoring
            // what they typed at generation time.
            const badDisclosure = isDisclosure && !!value.trim() && !disclosureIsValid(value)
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{meta.label}</label>
                  {value.trim() && (
                    <button
                      onClick={() => setLines((p) => { const n = { ...p }; delete n[key]; return n })}
                      className="text-[10px] text-[#7C3AED] hover:underline"
                    >
                      Reset to default
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93] mb-1.5">
                  {meta.help}
                  {meta.tokens.length > 0 && (
                    <> Use {meta.tokens.map((t, i) => (
                      <span key={t}>{i > 0 && ' or '}<code className="font-mono text-[10px]">{t}</code></span>
                    ))} and MVP fills it in.</>
                  )}
                </p>
                <textarea
                  value={value}
                  onChange={(e) => setLines((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder={DEFAULT_LINES[key]}
                  rows={2}
                  className="input-field text-xs font-mono resize-y"
                />
                {badDisclosure && (
                  <p className="text-[11px] mt-1 text-[#ff9500]">
                    This needs to stay a disclosure. Amazon and the FTC both require it, so MVP will keep using the default until it mentions a commission or affiliate links.
                  </p>
                )}
              </div>
            )
          })}
          <p className="text-[11px] text-[#86868b] dark:text-[#8e8e93]">
            Empty means MVP&rsquo;s default. These apply to every new description you generate.
          </p>
        </div>
      )}
    </div>
  )
}
