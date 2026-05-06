// Google Gemini service — alternative AI provider for content generation
// Docs: https://ai.google.dev/gemini-api/docs
// SDK:  npm install @google/generative-ai

// import { GoogleGenerativeAI } from '@google/generative-ai'  // uncomment when enabling AI

export interface GeminiGenerationInput {
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxOutputTokens?: number
}

export interface GeminiGenerationOutput {
  text: string
  model: string
  tokensUsed: number
  finishReason: string
}

export class GeminiService {
  private apiKey: string
  // private client: GoogleGenerativeAI  // uncomment when enabling AI

  constructor(apiKey: string) {
    this.apiKey = apiKey
    // this.client = new GoogleGenerativeAI(apiKey)
  }

  async generate(_input: GeminiGenerationInput): Promise<GeminiGenerationOutput> {
    // TODO: implement with gemini-2.0-flash for fast, cost-efficient generation
    // Use as fallback when Claude rate limit is hit, or for transcript summarization
    throw new Error('AI generation not enabled in V1')
  }

  async summarizeTranscript(_transcript: string, _maxWords = 300): Promise<string> {
    // TODO: implement — extract key points from YouTube transcript before blog generation
    throw new Error('AI generation not enabled in V1')
  }

  async checkConnection(): Promise<boolean> {
    // TODO: validate API key
    return false
  }
}

export function createGeminiService(apiKey: string) {
  return new GeminiService(apiKey)
}
