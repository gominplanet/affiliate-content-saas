import OpenAI from 'openai'

export interface ImageSet {
  hero: string       // base64 PNG — 1792×1024 (16:9 hero)
  lifestyle: string  // base64 PNG — 1024×1024
  setting: string    // base64 PNG — 1024×1024
}

export class OpenAIService {
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
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
