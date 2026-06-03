'use client'

/**
 * /admin/designer-text — playground for the designer-grade thumbnail text
 * overlay system. Paste a base image URL + headline, optionally force one
 * specific template, hit Render, and see the composited output side-by-side
 * with the picker's decisions. Admin-only via the API route's gate.
 *
 * Use this before integrating the system into the live thumbnail flow —
 * lets us validate templates, palettes, and the picker without affecting
 * any user-facing path.
 */

import { useState } from 'react'

const TEMPLATE_OPTIONS = [
  { id: '', label: '(let the picker choose)' },
  { id: '__random__', label: '🎲 Random — what users will see' },
  { id: 'block-display', label: 'Block Display' },
  { id: 'banner-pill', label: 'Banner Pill' },
  { id: 'badge-score', label: 'Badge Score' },
  { id: 'dual-color-stack', label: 'Dual Color Stack' },
  { id: 'mega-word', label: 'Mega Word' },
  { id: 'brush-highlight', label: 'Brush Highlight' },
  { id: 'stamp-tilt', label: 'Stamp Tilt' },
  { id: 'arrow-pointer', label: 'Arrow Pointer' },
  { id: 'burst-pop', label: 'Burst Pop' },
  { id: 'price-tag', label: 'Price Tag' },
]

interface RenderResponse {
  pngDataUri: string
  picked: {
    templateId: string
    content: { topLine?: string; leading?: string; punch: string; subtitle?: string; badge?: { text: string; subtext?: string; iconHint?: string | null } | null }
    palette: { primary: string; accent: string; outline: string; bannerBg?: string }
  }
  width: number
  height: number
  renderError: { step: string; message: string } | null
}

export default function DesignerTextTestPage() {
  const [baseImageUrl, setBaseImageUrl] = useState('')
  const [headline, setHeadline] = useState('')
  const [productContext, setProductContext] = useState('')
  const [forceTemplateId, setForceTemplateId] = useState('')
  const [subjectSide, setSubjectSide] = useState<'left' | 'right'>('right')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RenderResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleRender() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/admin/designer-text-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseImageUrl: baseImageUrl.trim(),
          headline: headline.trim(),
          productContext: productContext.trim() || undefined,
          // __random__ is the sentinel from the dropdown — translated into the
          // `randomize: true` flag so the orchestrator picks uniformly across
          // all 10 templates (same code path the live thumbnail flow will use).
          ...(forceTemplateId === '__random__'
            ? { randomize: true }
            : forceTemplateId
              ? { forceTemplateId }
              : {}),
          subjectSide,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'render failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Designer Text Overlay — Playground</h1>
        <p className="text-sm text-gray-500 mt-1">
          Paste a base image URL (a clean thumbnail with no text), provide a headline, and the picker will choose
          a designer template + render it on top. Use the dropdown to force a specific template for comparison.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* INPUTS */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Base image URL
            </label>
            <input
              type="text"
              value={baseImageUrl}
              onChange={e => setBaseImageUrl(e.target.value)}
              placeholder="https://... (a clean thumbnail without baked text)"
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Headline (what you want on the thumbnail)
            </label>
            <input
              type="text"
              value={headline}
              onChange={e => setHeadline(e.target.value)}
              placeholder='e.g. "I tested this for 30 days"'
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
              Product / topic context (optional, helps picker)
            </label>
            <input
              type="text"
              value={productContext}
              onChange={e => setProductContext(e.target.value)}
              placeholder='e.g. "office chair review with rating"'
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                Force template
              </label>
              <select
                value={forceTemplateId}
                onChange={e => setForceTemplateId(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                {TEMPLATE_OPTIONS.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                Subject side (text goes opposite)
              </label>
              <select
                value={subjectSide}
                onChange={e => setSubjectSide(e.target.value as 'left' | 'right')}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="right">Subject on right → text on left</option>
                <option value="left">Subject on left → text on right</option>
              </select>
            </div>
          </div>

          <button
            onClick={handleRender}
            disabled={loading || !baseImageUrl || !headline}
            className="w-full py-3 rounded-lg font-semibold text-white disabled:opacity-50"
            style={{ background: '#7C3AED' }}
          >
            {loading ? 'Rendering…' : 'Render thumbnail'}
          </button>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded">
              ❌ {error}
            </div>
          )}
        </div>

        {/* OUTPUT */}
        <div className="space-y-4">
          {result ? (
            <>
              <div className="border rounded-lg overflow-hidden bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result.pngDataUri} alt="rendered thumbnail" className="w-full h-auto block" />
              </div>
              {result.renderError && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded space-y-1">
                  <div className="font-semibold">⚠️ Overlay render failed at step: <span className="font-mono">{result.renderError.step}</span></div>
                  <div className="font-mono text-xs whitespace-pre-wrap">{result.renderError.message}</div>
                  <div className="text-xs text-red-600">Image above is the bare base — text overlay was skipped.</div>
                </div>
              )}
              <div className="bg-gray-50 border rounded-lg p-3 text-xs font-mono space-y-2">
                <div><b>Template:</b> {result.picked.templateId}</div>
                <div><b>Dims:</b> {result.width} × {result.height}</div>
                <div>
                  <b>Palette:</b>
                  <span className="inline-flex items-center gap-1 ml-2">
                    <span className="inline-block w-4 h-4 border" style={{ background: result.picked.palette.primary }} /> {result.picked.palette.primary}
                  </span>
                  <span className="inline-flex items-center gap-1 ml-3">
                    <span className="inline-block w-4 h-4 border" style={{ background: result.picked.palette.accent }} /> {result.picked.palette.accent}
                  </span>
                  <span className="inline-flex items-center gap-1 ml-3">
                    <span className="inline-block w-4 h-4 border" style={{ background: result.picked.palette.outline }} /> {result.picked.palette.outline}
                  </span>
                </div>
                <div>
                  <b>Content:</b>
                  <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(result.picked.content, null, 2)}</pre>
                </div>
              </div>
            </>
          ) : (
            <div className="border-2 border-dashed rounded-lg h-96 flex items-center justify-center text-gray-400 text-sm">
              Output will appear here after rendering
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
