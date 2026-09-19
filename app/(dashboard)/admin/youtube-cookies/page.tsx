// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// /admin/youtube-cookies — turn a cookies.txt into the Railway variables the
// ingest service reads, without the file touching anything but this browser.
//
// The ingest service runs yt-dlp from a datacenter IP, which is where YouTube's
// bot wall lives. A proxy and the POT provider get past some of it; cookies are
// what get past the rest. /health has been reporting `cookies: false` since the
// service was stood up, which makes every download a coin flip.
//
// WHY THIS IS A PAGE. Setting them means base64-encoding a file, and the
// obvious way to do that without a terminal is to paste it into a website. A
// YouTube cookies.txt is a logged-in session: whoever holds it holds the
// channel. So the encoder is here, it runs entirely in this tab, and the file
// is never sent anywhere. There is no API route behind this page on purpose.
//
// Gzip first, because Railway caps a variable at 32768 characters and a real
// cookies.txt gzips to roughly a fifth of its size. The service sniffs the gzip
// magic bytes and decompresses on its own, so a plain and a compressed blob are
// both valid and the creator never picks.

'use client'

import { useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import { Copy, Check, ShieldAlert, Upload } from 'lucide-react'

/** Railway's per-variable ceiling. The service concatenates _2, _3 … in order. */
const CHUNK = 30000

function toBase64(bytes: Uint8Array): string {
  let s = ''
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a file
  // of any real size.
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(s)
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  // CompressionStream is not everywhere. Uncompressed is still correct, just
  // more chunks, so a browser without it is not an error.
  const CS = (globalThis as unknown as { CompressionStream?: typeof CompressionStream }).CompressionStream
  if (!CS) return bytes
  try {
    const cs = new CS('gzip')
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(cs)
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return bytes
  }
}

export default function YouTubeCookiesPage() {
  const [chunks, setChunks] = useState<string[] | null>(null)
  const [meta, setMeta] = useState<{ lines: number; compressed: boolean } | null>(null)
  const [copied, setCopied] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setError(null); setChunks(null); setMeta(null)
    try {
      const text = await file.text()
      const lines = text.split('\n').filter(Boolean).length
      // A cookies.txt has a header line and tab-separated rows. Checked so a
      // wrong file fails here rather than silently producing a blob that makes
      // the service look broken.
      if (!/youtube\.com/i.test(text) || !text.includes('\t')) {
        setError('That does not look like a YouTube cookies.txt. It should be the Netscape format, with tab-separated rows and youtube.com in them.')
        return
      }
      const raw = new TextEncoder().encode(text)
      const packed = await gzip(raw)
      const compressed = packed.length < raw.length
      const b64 = toBase64(packed)
      const out: string[] = []
      for (let i = 0; i < b64.length; i += CHUNK) out.push(b64.slice(i, i + CHUNK))
      setChunks(out)
      setMeta({ lines, compressed })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    }
  }

  const varName = (i: number) => (i === 0 ? 'YOUTUBE_COOKIES_B64' : `YOUTUBE_COOKIES_B64_${i + 1}`)

  return (
    <div className="max-w-2xl mx-auto">
      <PageHero
        title="YouTube cookies for the downloader"
        subtitle="The video service downloads from a datacenter, which is where YouTube's bot wall is. Cookies are what get it through. This turns your cookies.txt into the variables Railway needs."
      />

      <div className="mt-5 rounded-2xl border p-4 flex gap-3" style={{ borderColor: '#f59e0b55' }}>
        <ShieldAlert size={18} className="mt-0.5 flex-shrink-0" style={{ color: '#f59e0b' }} />
        <div className="text-[13px] leading-snug" style={{ color: 'var(--text)' }}>
          <p className="font-semibold">This file is a logged-in session for that YouTube account.</p>
          <p className="mt-1" style={{ color: 'var(--muted)' }}>
            Anyone holding it can act as the account, so never paste it into a website that offers to
            encode or inspect it. This page does the work in your own browser: the file is not uploaded,
            not sent to MVP, and there is no server behind this screen. Use a throwaway or dedicated
            account if you would rather not use your main one.
          </p>
        </div>
      </div>

      <ol className="mt-6 flex flex-col gap-3 text-[13.5px] leading-relaxed" style={{ color: 'var(--text)' }}>
        <li><span className="font-semibold">1.</span> In Chrome, install a cookies.txt export extension (search the Web Store for &quot;Get cookies.txt LOCALLY&quot;).</li>
        <li><span className="font-semibold">2.</span> Open youtube.com, signed in, and export. You get a <code>cookies.txt</code> file.</li>
        <li><span className="font-semibold">3.</span> Drop that file below.</li>
        <li><span className="font-semibold">4.</span> Copy each block into Railway, on the affiliate-content-saas service, under Variables, using the name shown above it.</li>
        <li><span className="font-semibold">5.</span> Railway restarts the service. Open <code>/health</code> on it and check that <code>cookies</code> now reads true.</li>
      </ol>

      <label
        className="mt-6 flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-10 cursor-pointer"
        style={{ borderColor: 'var(--border)' }}
      >
        <Upload size={20} style={{ color: 'var(--muted)' }} />
        <span className="text-[13.5px] font-semibold">Choose your cookies.txt</span>
        <span className="text-[12px]" style={{ color: 'var(--muted)' }}>It stays on this computer</span>
        <input
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }}
        />
      </label>

      {error && (
        <p className="mt-4 text-[13px]" style={{ color: '#dc2626' }}>{error}</p>
      )}

      {chunks && meta && (
        <div className="mt-6">
          <p className="text-[13.5px] font-semibold" style={{ color: 'var(--text)' }}>
            {chunks.length === 1
              ? 'One variable to set.'
              : `${chunks.length} variables to set. Set all of them: the service joins them back together in order.`}
          </p>
          <p className="mt-1 text-[12.5px]" style={{ color: 'var(--muted)' }}>
            Read {meta.lines} cookie lines{meta.compressed ? ', compressed before encoding so it needs fewer variables' : ''}.
          </p>

          <div className="mt-4 flex flex-col gap-4">
            {chunks.map((c, i) => (
              <div key={i} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between gap-3">
                  <code className="text-[12.5px] font-semibold">{varName(i)}</code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(c).then(
                        () => { setCopied(i); setTimeout(() => setCopied(null), 2000) },
                        () => setError('The browser blocked the copy. Select the text and copy it by hand.'),
                      )
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white"
                    style={{ background: copied === i ? '#16a34a' : '#7C3AED' }}
                  >
                    {copied === i ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
                  </button>
                </div>
                <p className="mt-2 text-[11.5px] break-all font-mono" style={{ color: 'var(--muted)' }}>
                  {c.slice(0, 80)}… <span className="not-italic">({c.length.toLocaleString('en-US')} characters)</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
