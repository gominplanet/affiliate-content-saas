import OpenAI, { toFile } from 'openai'
import sharp from 'sharp'

/**
 * Normalize an arbitrary image (JPEG/PNG/WEBP/HEIC, any colour mode,
 * EXIF-rotated) into a clean RGB PNG that gpt-image's image-edit endpoint
 * always accepts. Fixes "Invalid image file or mode" rejections from
 * user-uploaded reference photos. Throws if the input can't be decoded
 * (caller should skip that image).
 */
export async function normalizeToPng(bytes: Uint8Array): Promise<Uint8Array> {
  const out = await sharp(Buffer.from(bytes))
    .rotate()              // honor EXIF orientation
    .flatten({ background: '#ffffff' }) // drop alpha → consistent RGB
    .png()
    .toBuffer()
  return new Uint8Array(out)
}

export interface ImageSet {
  hero: string       // base64 PNG — 1792×1024 (16:9 hero)
  lifestyle: string  // base64 PNG — 1024×1024
  setting: string    // base64 PNG — 1024×1024
}

export class OpenAIService {
  private client: OpenAI

  constructor(apiKey: string) {
    // Pin requests to a specific organization when OPENAI_ORG_ID is set.
    // Needed when the API key belongs to multiple orgs and the verified one
    // (required for gpt-image-*) isn't the account default — otherwise image
    // calls fail with "organization must be verified".
    this.client = new OpenAI({
      apiKey,
      organization: process.env.OPENAI_ORG_ID || undefined,
    })
  }

  private async generateOne(prompt: string, size: '1792x1024' | '1024x1024'): Promise<string> {
    const response = await this.client.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size,
      quality: 'standard',
      response_format: 'b64_json',
    })
    const b64 = response.data?.[0]?.b64_json
    if (!b64) throw new Error('DALL-E returned no image data')
    return b64
  }

  /** Single 16:9 hero image (1792x1024 b64 PNG) — for campaign post
   *  featured images. Caller normalizes to exact 1280x720. */
  async generateHeroImage(prompt: string): Promise<string> {
    return this.generateOne(prompt, '1792x1024')
  }

  /**
   * Reference-based image generation with gpt-image-1 (the model behind
   * ChatGPT's image_gen). Pass one or more reference images — e.g. a few of
   * the creator's headshots (for facial-identity preservation) plus a product
   * photo — and a prompt describing the desired image. No LoRA training: the
   * model preserves identity/detail from the references directly.
   *
   * Returns a base64 PNG. Default size is 16:9 landscape at high quality.
   */
  async generateWithReferences(opts: {
    prompt: string
    images: Array<{ data: Buffer | Uint8Array; filename: string; mime: string }>
    // gpt-image-2 supports arbitrary WxH (both divisible by 16). 1536x864 is a
    // true 16:9 landscape — no 3:2 crop needed for YouTube thumbnails.
    size?: '1024x1024' | '1536x1024' | '1024x1536' | '1536x864'
    quality?: 'low' | 'medium' | 'high' | 'auto'
    /** 'transparent' returns a PNG with alpha (for cut-outs to composite). */
    background?: 'transparent' | 'opaque' | 'auto'
    /** Image model id. Defaults to OPENAI_IMAGE_MODEL env, else gpt-image-1.
     *  Set OPENAI_IMAGE_MODEL=gpt-image-2 to use the newer model. */
    model?: string
  }): Promise<string> {
    if (!opts.images.length) throw new Error('generateWithReferences needs at least one reference image')
    const model = opts.model || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'
    const files = await Promise.all(
      opts.images.map(i => toFile(Buffer.from(i.data), i.filename, { type: i.mime })),
    )
    // Retry transient failures (rate limit / overload / 5xx) with backoff. gpt-image
    // gets rate-limited under load; a single try surfaced those as a hard "snag".
    // Content-policy (400) and access (401/403) errors are NOT transient — fail fast.
    let lastErr: unknown = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await this.client.images.edit({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: model as any,
          image: files,
          prompt: opts.prompt,
          size: opts.size ?? '1536x1024',
          quality: opts.quality ?? 'high',
          ...(opts.background ? { background: opts.background, output_format: 'png' } : {}),
          n: 1,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        const b64 = res.data?.[0]?.b64_json
        if (!b64) throw new Error(`${model} returned no image data`)
        return b64
      } catch (err) {
        lastErr = err
        const status = (err as { status?: number })?.status
        const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
        const transient = status === 429 || (typeof status === 'number' && status >= 500)
          || /rate limit|overloaded|timeout|temporarily|try again/.test(msg)
        if (!transient || attempt === 3) throw err
        await new Promise(r => setTimeout(r, attempt * 2000))
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`${model} image edit failed`)
  }

  /** Resolve which image model is in effect (env-overridable). */
  static imageModel(): string {
    return process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'
  }

  /** Diagnostic: attempt a tiny low-cost image generation to confirm the
   *  key + org + model work (and the org is verified for image gen).
   *  Returns the exact OpenAI error message on failure. ~$0.01-0.02. */
  async testImageGenerate(): Promise<{ ok: boolean; model: string; error?: string }> {
    const model = OpenAIService.imageModel()
    try {
      await this.client.images.generate({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: model as any,
        prompt: 'a simple red circle centered on a white background',
        size: '1024x1024',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        quality: 'low' as any,
        n: 1,
      })
      return { ok: true, model }
    } catch (err) {
      return { ok: false, model, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Diagnostic: attempt a tiny reference-based EDIT — the exact path the
   *  thumbnail/blog composers use (and the one that gets refused on face /
   *  product prompts). A benign solid-colour reference isolates model/param
   *  access from content-policy refusals: if this OK's but production still
   *  falls back, the failures are prompt/content refusals, not access. ~$0.02. */
  async testImageEdit(): Promise<{ ok: boolean; model: string; error?: string }> {
    const model = OpenAIService.imageModel()
    try {
      const png = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 200, g: 60, b: 60 } } }).png().toBuffer()
      const file = await toFile(png, 'test.png', { type: 'image/png' })
      await this.client.images.edit({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: model as any, image: [file], prompt: 'add a small white star in the centre',
        size: '1024x1024', quality: 'low' as any, n: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      return { ok: true, model }
    } catch (err) {
      return { ok: false, model, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async generateImageSet(prompts: {
    hero: string
    lifestyle: string
    setting: string
  }): Promise<ImageSet> {
    // Run all 3 in parallel — ~5-10s total vs 15-30s sequential
    const [hero, lifestyle, setting] = await Promise.all([
      this.generateOne(prompts.hero, '1792x1024'),
      this.generateOne(prompts.lifestyle, '1024x1024'),
      this.generateOne(prompts.setting, '1024x1024'),
    ])
    return { hero, lifestyle, setting }
  }

  /** Synthesize speech from text (used for Storefront Sync dubs). OpenAI TTS
   *  detects the language from the input text, so a translated script narrates
   *  in that language. Returns an MP3 buffer. */
  async synthesizeSpeech(
    text: string,
    opts?: { voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'; model?: string },
  ): Promise<Buffer> {
    const res = await this.client.audio.speech.create({
      model: opts?.model || 'tts-1',
      voice: opts?.voice || 'alloy',
      input: text.slice(0, 4000), // TTS input cap
      response_format: 'mp3',
    })
    const arr = Buffer.from(await res.arrayBuffer())
    return arr
  }
}

export function createOpenAIService() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')
  return new OpenAIService(apiKey)
}
