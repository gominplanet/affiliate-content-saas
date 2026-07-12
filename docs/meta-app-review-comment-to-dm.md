# Meta App Review — Facebook Comment→DM (Private Replies)

Submission package for taking `pages_messaging` (+ `pages_manage_metadata`) from
**"Ready for testing"** to **"Ready to publish"** so the comment→DM auto-responder
works for the general public, not just app-role testers.

App: **MVP Affiliate** · https://www.mvpaffiliate.io
Feature: when a follower comments a creator-defined keyword on a Facebook Page
post the creator published through MVP, the app sends that commenter a one-time
Private Reply (Messenger DM) with the relevant affiliate product link.

---

## 1. Permissions to submit

| Permission | Status now | Why we need it |
|---|---|---|
| **pages_messaging** | Ready for testing → SUBMIT | Send the Private Reply (the DM) to the commenter via `POST /{comment-id}/private_replies`. |
| **pages_manage_metadata** | Ready for testing → SUBMIT | Subscribe the creator's Page to the `feed` webhook so we receive the comment event that triggers the reply. |
| pages_read_engagement | Ready to publish ✅ | Read the comment (text + author) to match the keyword. Already publishable. |
| pages_show_list | Ready to publish ✅ | List the Pages the creator manages so they can pick which to connect. |
| pages_manage_posts | (publishing) | Publish the creator's post to their Page. |

Business Verification is already ✅. Remaining for `pages_messaging`: **App Review**
+ **Data handling questions** (both covered below).

---

## 2. "How does your app use this permission?" (paste into each permission)

**pages_messaging**
> Our users are content creators who publish product-review posts to their own
> Facebook Page through our app. When one of their followers comments a
> creator-defined keyword (e.g. "LINK") on such a post, we send that follower a
> single Private Reply (Messenger message) containing the product link they asked
> for — the standard "comment [word] and I'll DM you the link" creator flow. We
> only message people who explicitly opt in by commenting the keyword, we send at
> most one reply per comment, and only within Meta's 7-day comment-reply window.
> We never send unsolicited, promotional, or bulk messages, and we do not message
> anyone who has not commented the keyword.

**pages_manage_metadata**
> We use pages_manage_metadata solely to subscribe the creator's connected Page to
> the `feed` webhook field, so our server is notified when someone comments on the
> creator's post. That webhook notification is what triggers the opted-in Private
> Reply described above. We do not change any other Page settings or metadata.

---

## 3. Step-by-step instructions for the Meta reviewer

> Meta requires working test credentials + exact repro steps. Fill in the two
> bracketed values with a real test login you control (set that account's app role
> to Tester or Admin so it can exercise the permission in the current state).

1. Go to **https://www.mvpaffiliate.io** and log in:
   Email: `[TEST_EMAIL]`  ·  Password: `[TEST_PASSWORD]`
2. This account already has a Facebook test Page connected and Auto-DM configured
   (keyword **LINK**, message **"Here you go 🔗 {link}"**). You can review it at
   **Instagram Auto-DM** in the left sidebar — the "Facebook Auto-DM connection
   status" panel at the top shows every check green.
3. Open this Page post (published by the app): **[LINK_TO_A_PUBLISHED_PAGE_POST]**
4. Add a comment with the single word: **LINK**
5. Within a few seconds, the Page sends you a Messenger message containing the
   product link. (Also shown end-to-end in the attached screencast.)

---

## 4. Screencast script (record ~90 seconds — this is REQUIRED for messaging)

Record one continuous take (no cuts that hide the trigger → delivery):

1. Open https://www.mvpaffiliate.io and log in.
2. Go to **Instagram Auto-DM** — show the keyword ("LINK"), the DM message, and
   the green **Facebook Auto-DM connection status** panel (all checks green).
3. Switch to Facebook. Open a Page post that MVP published.
4. As a follower/tester account, type **LINK** as a comment and post it.
5. Cut to Messenger — show the DM arriving with the product link.
6. (Optional) Show the public "Sent you a DM! 📩" reply appearing under the comment.

Tips: use a real Page + a real second account for the commenter; keep it under
2 minutes; narrate briefly ("the user comments LINK, the Page DMs them the link").

---

## 5. Data Handling questions (Data Use Checkup) — suggested answers

- **What data do you access?** The comment id, the commenter's Page-scoped ID
  (PSID), the comment text (only to match the keyword), and the post id.
- **How do you use it?** Solely to (a) match the keyword and (b) send the one
  requested Private Reply, and to prevent sending a duplicate reply to the same
  comment. No profiling, ads targeting, or resale.
- **Do you store it?** We store a minimal audit row — comment id, status
  (sent/failed), and timestamp — to deduplicate replies and support the user. We
  do not store message content long-term or build user profiles.
- **Do you share it with third parties?** No.
- **Deletion / retention?** Audit rows are retained only for operational dedup and
  support; we honor data-deletion requests via our privacy contact / data deletion
  callback. Privacy policy: https://www.mvpaffiliate.io/privacy

---

## 6. Pre-submit checklist

- [ ] Test login created + set to Tester/Admin role on the app.
- [ ] A Facebook test Page connected on that account, Auto-DM keyword + message set.
- [ ] At least one Page post published through MVP to comment on.
- [ ] Screencast recorded showing comment → DM (Section 4). **Recording this is the
      test — if the DM arrives on camera, the flow is proven.**
- [ ] Privacy Policy URL live (https://www.mvpaffiliate.io/privacy).
- [ ] Sections 2, 3, 5 pasted into the corresponding Meta fields.
- [ ] Submit `pages_messaging` + `pages_manage_metadata` for review.
