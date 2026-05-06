// Anthropic Claude service for AI content generation
// Docs: https://docs.anthropic.com/en/api
// SDK:  npm install @anthropic-ai/sdk

// import Anthropic from '@anthropic-ai/sdk'  // uncomment when billing/AI is enabled

export interface BlogGenerationInput {
  videoTitle: string
  videoDescription: string
  transcript: string
  brandProfile: {
    name: string
    niche: string[]
    tone: string[]
    targetAudience: string
    postLength: string
    ctaStyle: string
    affiliateDisclaimer: string
  }
}

export interface BlogGenerationOutput {
  title: string
  slug: string
  excerpt: string
  content: string
  seoMetaDescription: string
  affiliateKeywords: string[]
  model: string
  promptVersion: string
  tokensUsed: number
}

export interface SocialDraftInput {
  platform: 'twitter' | 'linkedin' | 'instagram'
  videoTitle: string
  blogExcerpt: string
  videoUrl: string
  brandTone: string[]
}

export interface SocialDraftOutput {
  platform: 'twitter' | 'linkedin' | 'instagram'
  content: string
  charCount: number
  model: string
  promptVersion: string
}

export class ClaudeService {
  private apiKey: string
  // private client: Anthropic  // uncomment when enabling AI

  constructor(apiKey: string) {
    this.apiKey = apiKey
    // this.client = new Anthropic({ apiKey })
  }

  async generateBlogPost(_input: BlogGenerationInput): Promise<BlogGenerationOutput> {
    // TODO: implement with prompt caching for brand profile
    // Uses: claude-sonnet-4-6 with cache_control on system prompt (brand profile)
    // Prompt version tracked for reproducibility and A/B testing
    throw new Error('AI generation not enabled in V1')
  }

  async generateSocialDraft(_input: SocialDraftInput): Promise<SocialDraftOutput> {
    // TODO: implement
    // Uses: claude-haiku-4-5-20251001 for cost efficiency on short-form content
    throw new Error('AI generation not enabled in V1')
  }

  async checkConnection(): Promise<boolean> {
    // TODO: validate API key with a minimal ping
    return false
  }
}

export function createClaudeService(apiKey: string) {
  return new ClaudeService(apiKey)
}
