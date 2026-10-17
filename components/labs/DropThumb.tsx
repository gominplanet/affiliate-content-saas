'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Drop: a still from the creator's own file, read in the browser (nothing is
// uploaded for it), in the video's own shape. A frame the browser cannot read
// shows the shape and an icon instead of an empty box.

import { useEffect, useState } from 'react'
import { Film, Smartphone } from 'lucide-react'

export default function DropThumb({ file, vertical, className = '' }: { file: File | null; vertical: boolean; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!file) return
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  const box = vertical ? 'aspect-[9/16] w-[64px]' : 'aspect-video w-[112px]'
  return (
    <div className={`${box} shrink-0 overflow-hidden rounded-lg relative ${className}`} style={{ background: 'var(--surface-2)' }}>
      {url && !failed && (
        // #t=1: a frame a second in, past a black first frame.
        <video src={`${url}#t=1`} muted playsInline preload="metadata" onError={() => setFailed(true)}
          className="absolute inset-0 w-full h-full object-cover" aria-hidden />
      )}
      {(!url || failed) && (
        <span className="absolute inset-0 flex items-center justify-center" style={{ color: 'var(--text-3)' }}>
          {vertical ? <Smartphone size={18} /> : <Film size={18} />}
        </span>
      )}
    </div>
  )
}
