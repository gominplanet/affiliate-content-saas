/**
 * POST /api/auth/telegram/connect
 *
 * Verifies that the MVP Affiliate bot can actually post to the channel
 * the user pasted (via getChat), then saves the channel ID + title to
 * integrations.telegram_channel_id / telegram_channel_title.
 *
 * Gated to Growth+ since Telegram fan-out is a Growth-tier feature.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { verifyBotInChannel } from '@/services/telegram'
import { tierAllowsSocial, type Tier } from '@/lib/tier'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { channelId: rawId } = await request.json() as { channelId?: string }
    const channelId = (rawId || '').trim()
    if (!channelId) {
      return NextResponse.json({ error: 'Channel ID is required' }, { status: 400 })
    }

    // Normalize the format slightly — accept inputs like "t.me/foo",
    // "https://t.me/foo", or "foo". Anything that's not numeric and not
    // already prefixed gets "@" prepended.
    let normalized = channelId
      .replace(/^https?:\/\/t\.me\//i, '')
      .replace(/^t\.me\//i, '')
      .trim()
    if (!normalized.startsWith('@') && !normalized.startsWith('-') && !/^\d/.test(normalized)) {
      normalized = '@' + normalized
    }

    // Tier gate
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await (supabase as any)
      .from('integrations')
      .select('tier')
      .eq('user_id', user.id)
      .single()
    const tier = (tierRow?.tier as Tier) ?? 'free'
    if (!tierAllowsSocial(tier, 'telegram')) {
      return NextResponse.json(
        { error: 'Telegram is a Pro plan feature. Upgrade to Pro to connect a Telegram channel.' },
        { status: 403 },
      )
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) {
      return NextResponse.json({ error: 'Telegram bot not configured on the server' }, { status: 500 })
    }

    // Verify the bot has access to the channel
    const verify = await verifyBotInChannel(botToken, normalized)
    if (!verify.ok) {
      // Most common: bot wasn't added as admin yet, or wrong channel id.
      return NextResponse.json({
        error: `Couldn't reach that channel. Make sure you added the bot as an admin first. Telegram said: ${verify.error}`,
      }, { status: 400 })
    }

    // Save
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upErr } = await (supabase as any)
      .from('integrations')
      .upsert(
        {
          user_id: user.id,
          telegram_channel_id: normalized,
          telegram_channel_title: verify.title,
        },
        { onConflict: 'user_id' },
      )
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    return NextResponse.json({
      ok: true,
      channelId: normalized,
      channelTitle: verify.title,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
