// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// A SERVER'S ERROR PAGE, IN WORDS (Seb, 2026-11-10: Refresh everything's Meta
// ads step said "<html> <head><title>502 Bad Gateway</title></head> <body>
// <center><h1>502 Bad Gateway</h1></center> <hr><center>cloudflare</center>
// </body> </html>"). A service MVP's server relies on answered with a gateway
// page instead of an answer; the page was shown as it came. Said in words
// here, and told apart from a real refusal, so a passing one is asked again
// instead of ending a run that takes hours. Pure.

/** Whether a text is a web page rather than words. */
export function looksLikeHtml(text: string): boolean {
  return /<\s*(html|head|body|title|h1|center)\b/i.test(String(text || ''))
}

/** An error's words, with a gateway's HTML page turned into one sentence. */
export function plainServerError(text: string, status?: number | null): string {
  const t = String(text || '').trim()
  if (!looksLikeHtml(t)) return t.slice(0, 600) || (status ? `The server answered ${status}.` : 'The server did not answer.')
  const title = (/<title>([\s\S]*?)<\/title>/i.exec(t)?.[1] || /<h1>([\s\S]*?)<\/h1>/i.exec(t)?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const what = title || (status ? `error ${status}` : 'an error page')
  const via = /cloudflare/i.test(t) ? ', through Cloudflare' : /vercel/i.test(t) ? ', through Vercel' : ''
  return `A service MVP's server relies on did not answer (${what}${via}). This is usually over within a minute.`.slice(0, 600)
}

/** Trouble that passes on its own: a gateway that did not answer, a timeout,
 *  a dropped connection. Never a refusal or a mistake in what was asked. */
export function isPassingTrouble(status: number | null | undefined, text: string): boolean {
  if (status === 408 || status === 425 || status === 429 || status === 502 || status === 503 || status === 504 || (status != null && status >= 520 && status <= 524)) return true
  return /\b(502|503|504|52[0-4])\b[^.]{0,40}(gateway|unavailable|time-?out|origin)|bad gateway|gateway time-?out|service unavailable|failed to fetch|fetch failed|networkerror|network request failed|econnreset|etimedout|socket hang up|timed out|did not send a proper answer/i.test(String(text || ''))
}

/** How long to wait before each try again of a passing trouble. */
export const PASSING_WAITS_MS = [2000, 5000, 10000, 20000] as const
