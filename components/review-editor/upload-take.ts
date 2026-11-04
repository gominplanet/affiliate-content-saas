'use client'
// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// ONE TAKE UPLOADED TO MVP, for the review editor: one video's takes (One
// video) and a batch from the computer (ComputerBatch) both send their files
// this one way. Into the creator's own folder, resumable so a big take
// survives a wobble, with the plain upload as the fallback. The file name
// starts source-edit-: the raw clean-up (lib/review-edit-server deleteRaw,
// and the nightly sweep in /api/cron/purge-shorts-sources) knows it by that.

import { uploadResumable, ResumableUnavailable } from '@/lib/upload-resumable'
import { uploadWithProgress } from '@/lib/upload-progress'
import { freshAccessToken, saysExpired } from '@/lib/fresh-token'
import { storageSizeRefusal } from '@/lib/clip-source-limits'
import type { createBrowserClient } from '@/lib/supabase/client'

export const TAKE_BUCKET = 'instagram-videos'

/** Upload one take; its public address and its place in storage. Throws a
 *  reason a person can read. */
export async function uploadTake(supabase: ReturnType<typeof createBrowserClient>, userId: string, file: File, onSent: (sent: number) => void): Promise<{ url: string; path: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
  const type = file.type || 'video/mp4'
  let path = `${userId}/source-edit-${crypto.randomUUID()}.${ext}`
  try {
    try {
      await uploadResumable({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        getAccessToken: (force) => freshAccessToken(supabase, force), bucket: TAKE_BUCKET, path, file, contentType: type,
        onProgress: ({ sent }) => onSent(sent),
      })
    } catch (e) {
      if (!(e instanceof ResumableUnavailable)) throw e
      path = `${userId}/source-edit-${crypto.randomUUID()}.${ext}`
      const token = await freshAccessToken(supabase, true)
      if (!token) throw new Error('Signed out during the upload. Sign in again and add it again.')
      await uploadWithProgress({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, accessToken: token,
        bucket: TAKE_BUCKET, path, file, contentType: type, onProgress: ({ sent }) => onSent(sent),
      })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'The upload failed.'
    // The browser's own words for a dropped connection ("Failed to fetch",
    // "Load failed", "NetworkError"), said plainly.
    const dropped = /failed to fetch|load failed|networkerror|network error|network request failed/i.test(msg)
    throw new Error(storageSizeRefusal(msg, file.size)
      || (saysExpired(msg) ? 'Your sign-in ran out during the upload. Refresh the page and add it again.'
        : dropped ? 'the upload stopped because the connection to MVP dropped. Check your internet and try it again.' : msg))
  }
  return { url: supabase.storage.from(TAKE_BUCKET).getPublicUrl(path).data.publicUrl, path }
}
