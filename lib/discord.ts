/**
 * Best-effort Discord webhook ping.
 *
 * Dormant until `DISCORD_WEBHOOK_URL` is set in the environment, so it never
 * breaks anything in dev/preview and ships inert. Used to surface support
 * tickets — especially PRIORITY (Pro/Studio) ones — into the founder's Discord
 * in real time: the operational backing for the "priority Discord support"
 * plan claim. Never throws; failures are swallowed so the caller is never
 * blocked on Discord being reachable.
 */
export function isDiscordConfigured(): boolean {
  return !!process.env.DISCORD_WEBHOOK_URL
}

export async function notifyDiscord(content: string): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL
  if (!url || !content.trim()) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Discord caps message content at 2000 chars — trim defensively.
      body: JSON.stringify({ content: content.slice(0, 1900) }),
    })
  } catch {
    /* best-effort — never block the caller on a webhook hiccup */
  }
}
