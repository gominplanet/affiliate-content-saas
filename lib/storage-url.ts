// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Extract the object key from a Supabase Storage PUBLIC url, so it can be passed
 * to `storage.from(bucket).remove([key])`. Returns null if the url isn't a
 * public object url for that bucket (e.g. an external/CDN url we don't own).
 *
 *   https://<proj>.supabase.co/storage/v1/object/public/instagram-videos/uid/x.mp4
 *     → "uid/x.mp4"
 */
export function storagePathFromPublicUrl(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null
  const marker = `/storage/v1/object/public/${bucket}/`
  const i = url.indexOf(marker)
  if (i === -1) return null
  const raw = url.slice(i + marker.length).split('?')[0]
  try { return decodeURIComponent(raw) } catch { return raw }
}
