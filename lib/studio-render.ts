// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// WHAT THE VIDEO SERVER REALLY DID WITH A VIDEO BUILDER VIDEO (Seb,
// 2026-11-27: "we need to update.."): the music bed under the voice, and a
// voiceover video's B-roll picture. Each is said from what the server
// reported, never from what was asked: music that was picked but not mixed
// reads as left out, with why, so a video without music never looks like
// one with it. Pure, so the words are tested (scripts/test-edit-studio.ts).

/** The music on one video, as it stands. `asked` while it is being made;
 *  `in` once the server says it mixed it; `missed` with the reason when not. */
export interface MusicPlaced { label: string; asked?: true; in?: true; missed?: string }

/** What the server's answer to the make says about the music: a server
 *  from before music says nothing, and makes the video without it. */
export function musicAfterAccept(asked: { label: string } | null, serverMixes: unknown): MusicPlaced | null {
  if (!asked) return null
  if (serverMixes === true) return { label: asked.label, asked: true }
  return { label: asked.label, missed: 'MVP’s video server was being updated and made this one without music. Press Make it again to add it.' }
}

/** What the finished video's report says about the music. */
export function musicAfterFinish(placed: MusicPlaced | null | undefined, reported: unknown): MusicPlaced | null {
  if (!placed) return null
  if (placed.missed) return placed
  if (reported === 'mixed') return { label: placed.label, in: true }
  const why = typeof reported === 'string' && reported.trim() ? reported.trim().replace(/^left out:\s*/i, '') : 'the video server did not say it was added'
  return { label: placed.label, missed: `The music was left out: ${why.slice(0, 200)}. Press Make it again to try once more.` }
}

/** The music in a sentence, for the video's note. */
export function musicWords(m: MusicPlaced | null | undefined): string {
  if (!m) return ''
  if (m.in) return ` Music: ${m.label || 'your music bed'}, under the voice.`
  if (m.missed) return ` ${m.missed}`
  return ''
}

/** A voiceover video's picture in words: how many shots, from how many of
 *  the clips, so a clip that was not used is not taken for one that was. */
export function voiceoverWords(vo: unknown): string {
  const v = (vo && typeof vo === 'object' ? vo : {}) as { shots?: unknown; clips?: unknown; of?: unknown }
  const shots = Number(v.shots) || 0, clips = Number(v.clips) || 0, of = Number(v.of) || 0
  if (!shots) return ''
  const from = of > clips ? `${clips} of your ${of} B-roll clips` : `${clips === 1 ? 'your B-roll clip' : `your ${clips} B-roll clips`}`
  return ` Voiceover over ${shots} ${shots === 1 ? 'shot' : 'shots'} from ${from}.`
}

/** Sound files a voiceover can be recorded as, besides any video (whose
 *  sound is used). */
export const VOICE_NAME = /\.(m4a|mp3|wav|aac|caf|ogg|opus|flac|aif|aiff|mov|mp4|m4v|webm|3gp)$/i
