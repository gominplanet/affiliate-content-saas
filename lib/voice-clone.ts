// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Per-creator voice cloning (ElevenLabs Instant Voice Cloning). We build a
// cloned voice from the creator's own audio so Storefront Sync dubs narrate in
// their voice, in every language. The clone id lives on brand_profiles; the dub
// pipeline reads it and passes it to the TTS engine.
//
// Consent is the caller's responsibility (the API route requires an explicit
// consent flag) — you must have the right to clone the voice in the samples.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any

export function voiceCloneConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY
}

/** The creator's stored cloned-voice id, or null. */
export async function getClonedVoiceId(sb: Sb, userId: string): Promise<string | null> {
  const { data } = await sb.from('brand_profiles').select('eleven_voice_id').eq('user_id', userId).maybeSingle()
  const id = (data?.eleven_voice_id as string | null) || null
  return id && id.trim() ? id : null
}

export interface CloneResult { voiceId: string }

/** Create an ElevenLabs cloned voice from one or more audio sample URLs and
 *  store its id on the creator's brand profile. Throws on failure. */
export async function createClonedVoice(
  sb: Sb,
  userId: string,
  audioUrls: string[],
  name: string,
): Promise<CloneResult> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error('Voice cloning is not configured.')
  const urls = audioUrls.filter(u => /^https:\/\//i.test(u)).slice(0, 5)
  if (urls.length === 0) throw new Error('No audio sample was available.')

  // Pull each sample and attach it as a file to the multipart request.
  const form = new FormData()
  form.append('name', (name || 'My voice').slice(0, 60))
  form.append('remove_background_noise', 'true')
  let attached = 0
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(120_000) })
      if (!r.ok) continue
      const blob = await r.blob()
      if (blob.size === 0) continue
      const ext = /\.(m4a|mp3|wav|mp4)(\?|$)/i.exec(u)?.[1]?.toLowerCase() || 'm4a'
      form.append('files', blob, `sample-${attached + 1}.${ext}`)
      attached++
    } catch { /* skip a sample that won't fetch */ }
  }
  if (attached === 0) throw new Error('Could not read the audio sample.')

  const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
    method: 'POST',
    headers: { 'xi-api-key': key },
    body: form,
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`Voice cloning failed (${res.status}). ${detail}`)
  }
  const data = await res.json().catch(() => ({})) as { voice_id?: string }
  const voiceId = data.voice_id
  if (!voiceId) throw new Error('Voice cloning did not return a voice.')

  await sb.from('brand_profiles').upsert(
    { user_id: userId, eleven_voice_id: voiceId, eleven_voice_name: name.slice(0, 60), eleven_voice_created_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  return { voiceId }
}

/** Delete the creator's cloned voice (ElevenLabs + the stored id). Best-effort
 *  on the ElevenLabs side; always clears the local id. */
export async function deleteClonedVoice(sb: Sb, userId: string): Promise<void> {
  const key = process.env.ELEVENLABS_API_KEY
  const id = await getClonedVoiceId(sb, userId)
  if (id && key) {
    try {
      await fetch(`https://api.elevenlabs.io/v1/voices/${id}`, { method: 'DELETE', headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(30_000) })
    } catch { /* ignore — we still clear locally */ }
  }
  await sb.from('brand_profiles').update({ eleven_voice_id: null, eleven_voice_name: null, eleven_voice_created_at: null }).eq('user_id', userId)
}
