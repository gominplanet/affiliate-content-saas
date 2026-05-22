import OpenAI, { toFile } from 'openai'

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
    size?: '1024x1024' | '1536x1024' | '1024x1536'
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
}

export function createOpenAIService() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')
  return new OpenAIService(apiKey)
}
