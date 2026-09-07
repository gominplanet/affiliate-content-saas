-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- Keep the raw user agent, so a classification mistake is fixable.
--
-- A click stored only the PARSED result: device, browser, os. When the parser
-- turned out to be wrong (its bot test ran after Chrome, so every crawler that
-- ships "Chrome/" was counted as a reader, and any agent it could not read was
-- filed as Desktop), there was nothing left to re-examine. One account had 329
-- of 453 clicks in that state and no way to find out what they had been.
--
-- A parser can always be improved. What cannot be recovered is data thrown away
-- at write time. So the string itself is kept, capped, and the derived columns
-- become a cache of an opinion rather than the only record.
--
-- Capped at 512 characters: real user agents are well under 200, and the cap
-- stops a hostile client writing megabytes into the click log.

alter table if exists public.passport_link_clicks
  add column if not exists user_agent text;

comment on column public.passport_link_clicks.user_agent is
  'Raw User-Agent header, truncated to 512 chars. device/browser/os are derived from this by lib/passport-links parseUserAgent; keeping the source means a parser fix can be applied to history instead of only to new clicks.';

-- ── Correct what CAN be corrected in the history ────────────────────────────
--
-- The old parser set device = 'Desktop' as a fallback for any agent it could
-- not read, without ever identifying a browser. The new one only claims a
-- device when it identified a real browser, so a stored row with a device and
-- no browser is, by that rule, a row we never actually classified. On one
-- account that was 329 of 453 clicks being displayed as desktop visitors.
--
-- Those rows are set back to unknown. This is a correction, not a deletion: the
-- click still counts, it simply stops claiming to be a device nobody observed.
update public.passport_link_clicks
   set device = null
 where browser is null
   and device is not null;

-- WHAT THIS CANNOT FIX, stated so nobody assumes otherwise. Crawlers that ship
-- "Chrome/" in their user agent were recorded as browser = 'Chrome' by the old
-- parser, and with the raw agent not kept there is nothing left to tell them
-- apart from a person using Chrome. Those clicks stay in the human totals for
-- as long as they are in range. Only clicks logged from now on are judged by
-- the corrected rule, and only they keep the string needed to judge again.
