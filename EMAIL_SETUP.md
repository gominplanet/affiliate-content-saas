# Email setup — send from `mvpaffiliate.io` instead of Supabase's default

This is a one-time setup. Do these 4 steps in order. Total: ~15 minutes
of work + DNS propagation wait (a few minutes to an hour).

After this is done:
- **Supabase Auth emails** (signup confirm, password reset, magic link)
  will go out from `noreply@mvpaffiliate.io` instead of Supabase's default.
- **App-level emails** (anything we send via `services/email/sendEmail()`)
  will also go out from the same address.

---

## Step 1 — Create a Resend account and get an API key

1. Go to https://resend.com and sign up (free tier covers 3,000 emails/month,
   100/day — plenty for now).
2. **Onboarding → Add a domain**. Enter `mvpaffiliate.io`.
3. Resend will show you 3 DNS records to add:
   - 1× **SPF** (TXT, hostname `send.mvpaffiliate.io`)
   - 2× **DKIM** (TXT, hostnames like `resend._domainkey.mvpaffiliate.io`)
4. Leave the Resend tab open — you'll come back to click "Verify".
5. In **Settings → API Keys**, create a new key. Name it `mvp-prod`.
   Scope: **Sending access** to `mvpaffiliate.io`. Copy the key (`re_...`).

---

## Step 2 — Add DNS records in Hostinger

1. Log in to Hostinger → **Domains** → `mvpaffiliate.io` → **DNS / Nameservers**.
2. For each record Resend gave you, click **Add Record**:
   - **Type**: TXT
   - **Name / Host**: paste exactly what Resend shows (just the subdomain
     part — Hostinger appends `.mvpaffiliate.io` automatically).
   - **Value / Content**: paste the long TXT value from Resend.
   - **TTL**: leave default (usually 14400 / 4 hours).
3. Add a **DMARC** record too (Resend doesn't always show this — add it manually):
   - **Type**: TXT
   - **Name**: `_dmarc`
   - **Value**: `v=DMARC1; p=none; rua=mailto:dmarc@mvpaffiliate.io`
   - `p=none` means "monitor only, don't reject anything" — safe default.
4. Save all records. Propagation typically takes 5–30 minutes.

---

## Step 3 — Verify the domain in Resend

1. Back in Resend → your domain page, click **Verify DNS records**.
2. If any show ❌, wait 10 more minutes and try again. DNS can be slow.
3. Once all show ✅, you're good. Send a test from Resend's **Email API
   playground** to confirm.

---

## Step 4 — Wire Supabase Auth to use Resend's SMTP

This is the step that makes signup-confirm / password-reset emails come
from your domain instead of Supabase's default sender.

1. In Resend → **Settings → SMTP**. Copy these values:
   - Host: `smtp.resend.com`
   - Port: `465` (SSL) or `587` (STARTTLS) — use 465
   - Username: `resend`
   - Password: your API key from Step 1 (the `re_...` string)

2. In Supabase dashboard → your project → **Authentication → Emails →
   SMTP Settings**:
   - Toggle **Enable Custom SMTP** ON
   - **Sender email**: `noreply@mvpaffiliate.io`
   - **Sender name**: `MVP Affiliate`
   - **Host**: `smtp.resend.com`
   - **Port**: `465`
   - **Username**: `resend`
   - **Password**: paste your Resend API key
   - **Minimum interval between emails**: leave at default (60 seconds)

3. Click **Save**. Supabase shows a tiny green dot when SMTP is verified.

4. Test it: create a new test account on your live signup page. The
   confirmation email should arrive from `noreply@mvpaffiliate.io`
   instead of Supabase's default.

---

## Step 5 — Add the API key to the app

In `.env.local` (and your production env — Vercel/Hostinger/wherever):

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxx
EMAIL_FROM=MVP Affiliate <noreply@mvpaffiliate.io>
```

Restart the dev server. Done.

---

## Sending app-level emails from code

```ts
import { sendEmail } from '@/services/email'

await sendEmail({
  to: user.email,
  subject: 'Your monthly digest is ready',
  html: '<p>Hey — 12 reviews published this month. <a href="...">See them</a>.</p>',
})
```

The helper handles `from`, error checks, and returns the Resend message
id on success.

---

## Troubleshooting

- **"Domain not verified" error** when sending → finish Step 3 first.
- **Email lands in spam** → check DMARC is set (Step 2.3), and consider
  warming up by sending real opens/clicks for a few days before relying
  on it for cold outreach. Transactional email rarely has this issue.
- **Supabase still sends from the default address** after Step 4 →
  make sure the green dot is showing in Supabase's SMTP panel, and that
  you saved the settings. Some Supabase plans require a billing card
  on file even for free SMTP — check the dashboard for a banner.
