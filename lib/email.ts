import { Resend } from 'resend'
import { createServerClient } from '@/lib/supabase/server'

const FROM = 'MVP Affiliate <notifications@mvpaffiliate.co>'

function getResend() {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  return new Resend(key)
}

// ── Fetch user email + notification prefs ─────────────────────────────────────
async function getUserEmailAndPrefs(userId: string): Promise<{
  email: string | null
  prefs: { new_video: boolean; blog_published: boolean; job_failures: boolean; weekly_digest: boolean }
}> {
  const defaultPrefs = { new_video: true, blog_published: true, job_failures: true, weekly_digest: false }
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    const email = user?.email ?? null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (supabase as any)
      .from('integrations')
      .select('notification_preferences')
      .eq('user_id', userId)
      .single()

    const prefs = row?.notification_preferences ?? defaultPrefs
    return { email, prefs }
  } catch {
    return { email: null, prefs: defaultPrefs }
  }
}

// ── Email: new video detected ─────────────────────────────────────────────────
export async function sendNewVideoEmail(userId: string, videoTitle: string, videoId: string) {
  const resend = getResend()
  if (!resend) return
  const { email, prefs } = await getUserEmailAndPrefs(userId)
  if (!email || !prefs.new_video) return

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `New video detected: ${videoTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <p style="font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888;margin:0 0 24px">MVP Affiliate</p>
        <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 8px">New video detected</h1>
        <p style="font-size:16px;color:#444;margin:0 0 24px">${videoTitle}</p>
        <a href="https://app.mvpaffiliate.co/content" style="display:inline-block;background:#111;color:#fff;font-size:13px;font-weight:700;padding:12px 20px;border-radius:4px;text-decoration:none">
          Generate blog post →
        </a>
        <p style="font-size:12px;color:#999;margin:32px 0 0">
          You're receiving this because you have new video notifications enabled.
          <a href="https://app.mvpaffiliate.co/settings" style="color:#999">Manage preferences</a>
        </p>
      </div>
    `,
  }).catch(() => { /* non-fatal */ })
}

// ── Email: blog post published ────────────────────────────────────────────────
export async function sendBlogPublishedEmail(
  userId: string,
  postTitle: string,
  postUrl: string,
  videoTitle: string,
) {
  const resend = getResend()
  if (!resend) return
  const { email, prefs } = await getUserEmailAndPrefs(userId)
  if (!email || !prefs.blog_published) return

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Post published: ${postTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <p style="font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888;margin:0 0 24px">MVP Affiliate</p>
        <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 8px">Blog post published</h1>
        <p style="font-size:15px;color:#444;margin:0 0 4px">${postTitle}</p>
        <p style="font-size:13px;color:#888;margin:0 0 24px">From: ${videoTitle}</p>
        <a href="${postUrl}" style="display:inline-block;background:#111;color:#fff;font-size:13px;font-weight:700;padding:12px 20px;border-radius:4px;text-decoration:none;margin-right:12px">
          View post →
        </a>
        <p style="font-size:12px;color:#999;margin:32px 0 0">
          <a href="https://app.mvpaffiliate.co/settings" style="color:#999">Manage preferences</a>
        </p>
      </div>
    `,
  }).catch(() => { /* non-fatal */ })
}

// ── Email: job failure ────────────────────────────────────────────────────────
export async function sendJobFailureEmail(userId: string, videoTitle: string, error: string) {
  const resend = getResend()
  if (!resend) return
  const { email, prefs } = await getUserEmailAndPrefs(userId)
  if (!email || !prefs.job_failures) return

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Generation failed: ${videoTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <p style="font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888;margin:0 0 24px">MVP Affiliate</p>
        <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 8px">Generation failed</h1>
        <p style="font-size:15px;color:#444;margin:0 0 4px">${videoTitle}</p>
        <p style="font-size:13px;color:#e53e3e;background:#fff5f5;border:1px solid #fed7d7;border-radius:4px;padding:12px;margin:0 0 24px;font-family:monospace">${error.slice(0, 300)}</p>
        <a href="https://app.mvpaffiliate.co/content" style="display:inline-block;background:#111;color:#fff;font-size:13px;font-weight:700;padding:12px 20px;border-radius:4px;text-decoration:none">
          Try again →
        </a>
        <p style="font-size:12px;color:#999;margin:32px 0 0">
          <a href="https://app.mvpaffiliate.co/settings" style="color:#999">Manage preferences</a>
        </p>
      </div>
    `,
  }).catch(() => { /* non-fatal */ })
}

// ── Email: weekly digest ──────────────────────────────────────────────────────
export async function sendWeeklyDigest(
  userEmail: string,
  stats: { postsThisWeek: number; totalPosts: number; totalVideos: number; recentTitles: string[] },
) {
  const resend = getResend()
  if (!resend) return

  const titleList = stats.recentTitles.map(t => `<li style="margin-bottom:6px;color:#444">${t}</li>`).join('')

  await resend.emails.send({
    from: FROM,
    to: userEmail,
    subject: `Your weekly content summary — ${stats.postsThisWeek} post${stats.postsThisWeek !== 1 ? 's' : ''} this week`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <p style="font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#888;margin:0 0 24px">MVP Affiliate · Weekly Digest</p>
        <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 24px">This week's summary</h1>
        <div style="display:flex;gap:24px;margin:0 0 32px">
          <div style="flex:1;background:#f7f7f7;border-radius:8px;padding:16px 20px;text-align:center">
            <div style="font-size:32px;font-weight:900;color:#111">${stats.postsThisWeek}</div>
            <div style="font-size:12px;color:#888;margin-top:4px">Posts this week</div>
          </div>
          <div style="flex:1;background:#f7f7f7;border-radius:8px;padding:16px 20px;text-align:center">
            <div style="font-size:32px;font-weight:900;color:#111">${stats.totalPosts}</div>
            <div style="font-size:12px;color:#888;margin-top:4px">Total published</div>
          </div>
          <div style="flex:1;background:#f7f7f7;border-radius:8px;padding:16px 20px;text-align:center">
            <div style="font-size:32px;font-weight:900;color:#111">${stats.totalVideos}</div>
            <div style="font-size:12px;color:#888;margin-top:4px">Videos tracked</div>
          </div>
        </div>
        ${stats.recentTitles.length ? `
        <p style="font-size:13px;font-weight:700;color:#111;margin:0 0 12px">Published this week</p>
        <ul style="padding:0 0 0 20px;margin:0 0 32px">${titleList}</ul>
        ` : ''}
        <a href="https://app.mvpaffiliate.co/content" style="display:inline-block;background:#111;color:#fff;font-size:13px;font-weight:700;padding:12px 20px;border-radius:4px;text-decoration:none">
          Go to Content →
        </a>
        <p style="font-size:12px;color:#999;margin:32px 0 0">
          <a href="https://app.mvpaffiliate.co/settings" style="color:#999">Manage preferences</a>
        </p>
      </div>
    `,
  }).catch(() => { /* non-fatal */ })
}
