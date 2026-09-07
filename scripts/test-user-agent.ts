// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Who counts as a click.
//
// This function decides the headline number on a creator's Passport dashboard.
// It had two faults, and both inflated that number rather than deflating it,
// which is the direction that costs someone a decision.
//
//   The bot test ran LAST, after Chrome and Safari. Every modern crawler ships
//   "Chrome/" in its user agent, so Googlebot, Bingbot, AhrefsBot and most
//   scrapers matched Chrome and were counted as readers.
//
//   Device fell through to 'Desktop' for anything not mobile-shaped, so curl,
//   python-requests and headless tooling were filed as desktop visitors. On one
//   real account that was 329 of 453 clicks presented as people.
//
// So the cases below are real user-agent strings, and the rule is: a wrong
// answer here must fail toward "we do not know", never toward "a person".
import { parseUserAgent } from '../lib/passport-links'

const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (!cond) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const CHROME_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

// ── the bots that were being counted as people ──────────────────────────────
// Every one of these carries Chrome/ or Safari/ and used to come back as a
// human browser, because the bot test was the last branch.
{
  const DISGUISED = [
    ['Googlebot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36'],
    ['Bingbot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/103.0.5060.134 Safari/537.36'],
    ['AhrefsBot', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/) Chrome/120.0.0.0 Safari/537.36'],
    ['SemrushBot', 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)'],
    ['PetalBot', 'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot) Chrome/91 Safari/537.36'],
    ['Applebot', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)'],
    ['GPTBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'],
    ['HeadlessChrome', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36'],
    ['Lighthouse', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Chrome-Lighthouse'],
  ] as const
  for (const [name, ua] of DISGUISED) {
    check(`${name} is a bot despite claiming Chrome or Safari`,
      parseUserAgent(ua).browser === 'Bot', parseUserAgent(ua).browser ?? 'null')
    check(`${name} is not given a device`, parseUserAgent(ua).device === null)
  }
}

// ── the bots that were already caught, still caught ─────────────────────────
{
  for (const ua of [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.23.20.0 A',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'TelegramBot (like TwitterBot)',
    'Discordbot/2.0; +https://discordapp.com',
    'Twitterbot/1.0',
    'Pinterestbot/1.0 (+http://www.pinterest.com/bot.html)',
  ]) {
    check(`link previewer is a bot: ${ua.slice(0, 24)}`, parseUserAgent(ua).browser === 'Bot')
  }
}

// ── non-browser clients are not desktop visitors ────────────────────────────
{
  for (const ua of [
    'curl/8.4.0', 'Wget/1.21.3', 'python-requests/2.31.0', 'python-urllib3/2.0.7',
    'Go-http-client/2.0', 'okhttp/4.12.0', 'axios/1.6.8', 'node-fetch/1.0',
    'Java/17.0.2', 'Apache-HttpClient/4.5.13', 'PostmanRuntime/7.37.0', 'Scrapy/2.11',
  ]) {
    const r = parseUserAgent(ua)
    check(`${ua} is not a person`, r.browser === 'Bot', `browser=${r.browser}`)
    check(`${ua} is not a Desktop`, r.device === null, `device=${r.device}`)
  }
}

// ── an agent we cannot read is unknown, never a desktop ─────────────────────
// This is the 329-of-453 case. Guessing 'Desktop' here is how a dashboard
// reports hundreds of desktop visitors it never actually saw.
{
  for (const ua of ['', '   ', 'Mozilla/5.0', 'SomeApp/1.0', '-', 'Mozilla/4.0 (compatible)']) {
    const r = parseUserAgent(ua)
    check(`unreadable agent claims no device: ${JSON.stringify(ua)}`, r.device === null, `device=${r.device}`)
    check(`unreadable agent claims no browser: ${JSON.stringify(ua)}`, r.browser === null || r.browser === 'Bot')
  }
  check('null is unknown', parseUserAgent(null).device === null && parseUserAgent(null).browser === null)
  check('undefined is unknown', parseUserAgent(undefined).device === null)
}

// ── real people are still read correctly ────────────────────────────────────
// The fix must not have made the parser useless. These are the agents that
// should produce a confident answer.
{
  const chrome = parseUserAgent(CHROME_DESKTOP)
  check('Chrome on Windows', chrome.browser === 'Chrome' && chrome.device === 'Desktop' && chrome.os === 'Windows', JSON.stringify(chrome))

  const iphone = parseUserAgent(SAFARI_IPHONE)
  check('Safari on iPhone', iphone.browser === 'Safari' && iphone.device === 'Mobile' && iphone.os === 'iOS', JSON.stringify(iphone))

  const ipad = parseUserAgent('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1')
  check('Safari on iPad is a Tablet', ipad.device === 'Tablet' && ipad.browser === 'Safari', JSON.stringify(ipad))

  const androidPhone = parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36')
  check('Chrome on Android phone is Mobile', androidPhone.device === 'Mobile' && androidPhone.os === 'Android', JSON.stringify(androidPhone))

  const androidTab = parseUserAgent('Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
  check('Android without the Mobile token is a Tablet', androidTab.device === 'Tablet', JSON.stringify(androidTab))

  // The masquerade cases: these must NOT come back as Chrome.
  const edge = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0')
  check('Edge is not Chrome', edge.browser === 'Edge', edge.browser ?? 'null')
  const opera = parseUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0')
  check('Opera is not Chrome', opera.browser === 'Opera', opera.browser ?? 'null')
  const samsung = parseUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115 Mobile Safari/537.36')
  check('Samsung Internet is not Chrome', samsung.browser === 'Samsung Internet', samsung.browser ?? 'null')
  const firefoxIos = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 FxiOS/127.0 Mobile/15E148 Safari/605.1.15')
  check('Firefox on iOS is not Safari', firefoxIos.browser === 'Firefox', firefoxIos.browser ?? 'null')
  const chromeIos = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 CriOS/126.0 Mobile/15E148 Safari/604.1')
  check('Chrome on iOS is Chrome', chromeIos.browser === 'Chrome', chromeIos.browser ?? 'null')
}

// ── the direction of failure ────────────────────────────────────────────────
// Stated once, as a rule rather than a case: nothing may return a device
// without also having identified a browser. That is the invariant that stops
// unclassified traffic being presented as desktop readers.
{
  for (const ua of [
    '', 'curl/8.4.0', 'Googlebot/2.1', 'Mozilla/5.0', CHROME_DESKTOP, SAFARI_IPHONE,
    'python-requests/2.31.0', 'SomeApp/1.0',
  ]) {
    const r = parseUserAgent(ua)
    check(`device implies a known browser: ${ua.slice(0, 20) || '(empty)'}`,
      r.device === null || (r.browser !== null && r.browser !== 'Bot'),
      JSON.stringify(r))
  }
}

console.log(failures.length ? `FAIL (${failures.length})` : 'ALL PASS')
for (const f of failures.slice(0, 25)) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)
