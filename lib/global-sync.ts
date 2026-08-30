// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Global Storefront Sync — Milestone 1: the market registry + metadata
// localization. Given the creator's master video (title, description, transcript)
// and a set of target markets, produce a localized title + description per
// market, written in the creator's own voice. Captions and the dub come in
// Milestone 2; the SCOUT fan-out delivery in Milestone 3.

import { createAnthropicClient } from '@/lib/anthropic'
import { recordAnthropicUsage } from '@/lib/ai-usage'
import { creatorVoiceBlock, type CreatorVoiceFields } from '@/lib/creator-voice'

/** A supported Amazon marketplace. `needsTranslation` false = English market
 *  (US/CA/UK/AU), so we skip the translation call and reuse the master copy. */
export interface Market {
  domain: string   // amazon.co.uk
  code: string     // UK
  country: string  // United Kingdom
  lang: string     // de-DE (BCP-47)
  langName: string // German
  needsTranslation: boolean
}

// The launch set. English markets first (no translation needed), then the
// larger non-English marketplaces. Extend as we verify each Creator Hub flow.
export const MARKETS: Market[] = [
  { domain: 'amazon.com',    code: 'US', country: 'United States',  lang: 'en-US', langName: 'English',    needsTranslation: false },
  { domain: 'amazon.ca',     code: 'CA', country: 'Canada',         lang: 'en-CA', langName: 'English',    needsTranslation: false },
  { domain: 'amazon.co.uk',  code: 'UK', country: 'United Kingdom', lang: 'en-GB', langName: 'English',    needsTranslation: false },
  { domain: 'amazon.com.au', code: 'AU', country: 'Australia',      lang: 'en-AU', langName: 'English',    needsTranslation: false },
  { domain: 'amazon.de',     code: 'DE', country: 'Germany',        lang: 'de-DE', langName: 'German',     needsTranslation: true },
  { domain: 'amazon.fr',     code: 'FR', country: 'France',         lang: 'fr-FR', langName: 'French',     needsTranslation: true },
  { domain: 'amazon.it',     code: 'IT', country: 'Italy',          lang: 'it-IT', langName: 'Italian',    needsTranslation: true },
  { domain: 'amazon.es',     code: 'ES', country: 'Spain',          lang: 'es-ES', langName: 'Spanish',    needsTranslation: true },
  { domain: 'amazon.com.mx', code: 'MX', country: 'Mexico',         lang: 'es-MX', langName: 'Spanish',    needsTranslation: true },
  { domain: 'amazon.co.jp',  code: 'JP', country: 'Japan',          lang: 'ja-JP', langName: 'Japanese',   needsTranslation: true },
  { domain: 'amazon.nl',     code: 'NL', country: 'Netherlands',    lang: 'nl-NL', langName: 'Dutch',      needsTranslation: true },
  { domain: 'amazon.com.br', code: 'BR', country: 'Brazil',         lang: 'pt-BR', langName: 'Portuguese', needsTranslation: true },
]

export function marketByDomain(domain: string): Market | undefined {
  return MARKETS.find(m => m.domain === domain)
}

export interface LocalizedMeta { title: string; description: string }

/** Translate a master title + description into one market's language, in the
 *  creator's voice. English markets return the master copy unchanged (no spend).
 *  Best-effort: falls back to the master copy on any error, so a job never
 *  blocks on one market's translation. */
export async function localizeMetadata(
  master: { title: string; description: string },
  market: Market,
  brand: CreatorVoiceFields | null,
  ctx: { userId: string; tier?: string | null },
): Promise<LocalizedMeta> {
  const title = (master.title || '').trim()
  const description = (master.description || '').trim()
  if (!market.needsTranslation) return { title, description }
  if (!title && !description) return { title, description }

  const voice = creatorVoiceBlock(brand)
  const system = `You localize a creator's Amazon product-review video title and description into ${market.langName} for the ${market.country} Amazon store. Translate naturally for a native ${market.langName} shopper (not word-for-word), keep it the same length range, keep any product name, and DO NOT invent claims. Return ONLY valid JSON: {"title":"...","description":"..."}.`
  const prompt = `${voice ? `Keep it in this creator's voice where it still reads naturally in ${market.langName}:\n${voice}\n\n` : ''}TITLE:\n${title}\n\nDESCRIPTION:\n${description.slice(0, 2000)}`

  try {
    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
    recordAnthropicUsage(msg, { userId: ctx.userId, tier: ctx.tier ?? null, feature: 'global_sync_localize', model: 'claude-sonnet-4-6' })
    let raw = ''
    for (const b of msg.content) if (b.type === 'text') raw += b.text
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return { title, description }
    const parsed = JSON.parse(m[0]) as { title?: string; description?: string }
    return {
      title: (parsed.title || title).trim().slice(0, 500),
      description: (parsed.description || description).trim(),
    }
  } catch {
    return { title, description }
  }
}

/** Turn a master transcript into a natural spoken script in the market's
 *  language, ready for text-to-speech. Trims to a length TTS can voice in one
 *  pass and strips filler. Returns '' when there's nothing to dub. */
export async function translateScript(
  transcript: string,
  market: Market,
  brand: CreatorVoiceFields | null,
  ctx: { userId: string; tier?: string | null },
): Promise<string> {
  const src = (transcript || '').trim()
  if (!src || !market.needsTranslation) return ''

  const voice = creatorVoiceBlock(brand)
  const system = `You adapt a creator's spoken product-review transcript into a clean, natural voiceover script in ${market.langName} for a ${market.country} audience. Write it to be READ ALOUD: full sentences, no timestamps, no stage directions, no speaker labels, no markdown. Keep the meaning and the product recommendation, translate idioms naturally, and DO NOT invent claims or prices. Return ONLY the script text.`
  const prompt = `${voice ? `Match this creator's delivery where it still sounds natural in ${market.langName}:\n${voice}\n\n` : ''}TRANSCRIPT:\n${src.slice(0, 6000)}`

  try {
    const client = createAnthropicClient()
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: prompt }],
    })
    recordAnthropicUsage(msg, { userId: ctx.userId, tier: ctx.tier ?? null, feature: 'global_sync_dub_script', model: 'claude-sonnet-4-6' })
    let out = ''
    for (const b of msg.content) if (b.type === 'text') out += b.text
    return out.trim()
  } catch {
    return ''
  }
}
