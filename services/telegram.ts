/**
 * Telegram service module.
 *
 * Posts reviews to a user's Telegram channel via the Bot API.
 *
 * Architecture:
 * - One shared bot for the whole MVP Affiliate app (token in env:
 *   TELEGRAM_BOT_TOKEN). Created once via @BotFather.
 * - Each user creates their own Telegram channel and adds our bot as
 *   an admin with "Post Messages" permission, then pastes their channel
 *   ID into MVP's Integrations page.
 * - Channel ID can be either:
 *     - Public username form: "@theirchannel"
 *     - Numeric form: "-1001234567890" (works for both public and private)
 *
 * Bot API docs: https://core.telegram.org/bots/api
 */

const TG_BASE = 'https://api.telegram.org'

export interface TelegramPostResult {
  messageId: number
  chatId: number | string
  channelPostUrl?: string
}

/**
 * Send a photo with caption to a Telegram channel.
 *
 * Uses sendPhoto so the post lands with the review thumbnail as the
 * lead visual. Caption is limited to 1024 characters by Telegram —
 * caller should pre-trim if needed.
 *
 * @param botToken — Bot API token from @BotFather
 * @param chatId   — Channel ID ("@handle" or numeric "-100…")
 * @param photoUrl — Public URL of the image to send
 * @param caption  — Optional caption (max 1024 chars). Markdown supported.
 */
export async function sendPhoto(
  botToken: string,
  chatId: string,
  photoUrl: string,
  caption: string,
): Promise<TelegramPostResult> {
  const res = await fetch(`${TG_BASE}/bot${botToken}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption: caption.slice(0, 1024),
      parse_mode: 'MarkdownV2',
    }),
  })

  const data = await res.json() as { ok: boolean; result?: { message_id: number; chat: { id: number; username?: string } }; description?: string }
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram sendPhoto failed: ${data.description || `HTTP ${res.status}`}`)
  }

  const result = data.result!
  const messageId = result.message_id
  const chat = result.chat
  // For public channels we can build a t.me deep link to the post.
  const channelPostUrl = chat.username
    ? `https://t.me/${chat.username}/${messageId}`
    : undefined

  return { messageId, chatId: chat.id, channelPostUrl }
}

/**
 * Plain text fallback (no photo). Used when the blog post has no
 * featured image we can reach as a public URL.
 */
export async function sendMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<TelegramPostResult> {
  const res = await fetch(`${TG_BASE}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: false,
    }),
  })

  const data = await res.json() as { ok: boolean; result?: { message_id: number; chat: { id: number; username?: string } }; description?: string }
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram sendMessage failed: ${data.description || `HTTP ${res.status}`}`)
  }

  const result = data.result!
  const channelPostUrl = result.chat.username
    ? `https://t.me/${result.chat.username}/${result.message_id}`
    : undefined

  return { messageId: result.message_id, chatId: result.chat.id, channelPostUrl }
}

/**
 * Escape a string for Telegram MarkdownV2.
 *
 * Telegram's MarkdownV2 reserves these chars and requires they be
 * escaped with a backslash whenever they appear in plain text:
 *   _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * Without this you get a confusing 400 from the API on certain
 * punctuation. Apply this to any user-derived text BEFORE wrapping it
 * in Markdown syntax (bold, links, etc.).
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

/**
 * Verify the bot can actually post to the given channel.
 *
 * Calls getChat — succeeds if the bot is a member of the channel,
 * 400/403 if it isn't yet added (or isn't an admin). Use this in the
 * Integrations setup flow to give users a clear "✅ Bot is connected"
 * vs "❌ Add @BotName as admin first" signal before they try to publish.
 */
export async function verifyBotInChannel(botToken: string, chatId: string): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  const res = await fetch(`${TG_BASE}/bot${botToken}/getChat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId }),
  })
  const data = await res.json() as { ok: boolean; result?: { title?: string; type?: string }; description?: string }
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.description || `HTTP ${res.status}` }
  }
  return { ok: true, title: data.result?.title || chatId }
}
