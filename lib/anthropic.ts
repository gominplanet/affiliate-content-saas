import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'

/**
 * Reads ANTHROPIC_API_KEY from process.env, falling back to a direct parse of
 * .env.local when the key is absent or empty.
 *
 * Why the fallback is needed: Claude for Desktop injects ANTHROPIC_API_KEY=""
 * (empty string) into every Claude Code session's shell environment. Next.js
 * never overwrites an already-set env var, so .env.local's value never lands
 * in process.env. Reading the file directly bypasses that collision.
 */
function getAnthropicApiKey(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY

  try {
    const envPath = path.join(process.cwd(), '.env.local')
    const content = fs.readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('ANTHROPIC_API_KEY=')) {
        const val = trimmed.slice('ANTHROPIC_API_KEY='.length).trim()
        if (val) return val
      }
    }
  } catch {
    // .env.local not found or unreadable — fall through
  }
  return undefined
}

/**
 * Creates an Anthropic client with an explicit API key.
 * SDK v0.95+ changed to async credential resolution — passing the key
 * explicitly as a string bypasses the async flow that fails in some
 * Next.js execution contexts.
 */
export function createAnthropicClient(): Anthropic {
  const apiKey = getAnthropicApiKey()
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.',
    )
  }
  return new Anthropic({ apiKey })
}
