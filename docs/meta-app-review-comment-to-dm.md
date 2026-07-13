# Meta App Review — Comment→DM (Instagram + Facebook)

Submission package to take MVP Affiliate's **comment→DM auto-responder** from
"Ready for testing" to "Ready to publish" so it works for all users, not just
app-role testers. **One submission covers both Instagram and Facebook** — the
feature is identical on each; lead the review with Instagram (the branded
"Instagram Auto-DM"), Facebook rides along.

App: **MVP Affiliate** · https://www.mvpaffiliate.io · App status: **Live**
Feature: when a follower comments a creator-defined keyword (e.g. "LINK") on a
post the creator published through MVP (to their IG Business account or FB Page),
the app sends that follower one Private Reply (DM) containing the relevant
affiliate product link. Opt-in, one reply per comment, within Meta's reply window.

---

## 0. What you (Seb) still have to provide — the only blockers

Everything below is written for you. Two inputs only you can supply:

1. **A test login** — a mvpaffiliate.io account (email + password) with an **IG
   Business account** and a **FB Page** already connected + Auto-DM configured
   (keyword `LINK`). The reviewer signs in with this. (Fill Section 4.)
2. **A screencast** — Meta requires a video of the flow working for messaging
   permissions (Section 5). **⚠️ Record it with the commenter being a
   *tester who is NOT the Page/IG-account admin*** — Meta suppresses the webhook
   for an account's own admin commenting on its own post (that's the wall we hit
   this session). Add a second real FB/IG account under **App roles → Roles →
   Testers**, have it accept, and comment from it.

Business Verification is already ✅. Nothing else is missing.

---

## 1. Permissions to submit

### Instagram (lead with these)
| Permission | Why we need it |
|---|---|
| **instagram_business_manage_messages** | Send the Private Reply (DM) to the commenter. |
| **instagram_business_manage_comments** | Read the comment + keyword; optionally post a public "Sent you a DM!" reply. |
| instagram_business_basic | Identify the connected IG Business account (already low-friction). |
| instagram_business_content_publish | Publish the creator's post/Reel the comment lands on. |

### Facebook (same submission)
| Permission | Why we need it |
|---|---|
| **pages_messaging** | Send the Private Reply (DM) to the commenter on a Page post. |
| **pages_manage_metadata** | Subscribe the Page to the `feed` webhook so we receive the comment event. |
| pages_read_engagement | Read the comment to match the keyword. (Already "Ready to publish".) |
| pages_show_list | List the Pages the creator manages so they can pick one. |

---

## 2. "How does your app use this permission?" — paste into each

**instagram_business_manage_messages** (and **pages_messaging** — same text, swap "IG Business account" ↔ "Facebook Page")
> Our users are content creators who publish product-review posts to their own
> Instagram Business account through our app. When a follower comments a
> creator-defined keyword (e.g. "LINK") on one of those posts, we send that
> follower a single Private Reply (Direct Message) containing the product link
> they asked for — the standard "comment [word] and I'll DM you the link" creator
> flow. We only message people who explicitly opt in by commenting the keyword,
> at most one reply per comment, and only within Meta's messaging window. We never
> send unsolicited, promotional, or bulk messages, and we never message anyone who
> has not commented the keyword.

**instagram_business_manage_comments** (and **pages_read_engagement**)
> We use this permission only to read the text of comments on the creator's own
> posts, so we can detect whether a comment contains the creator's opt-in keyword,
> and (optionally, if the creator enables it) to post a short public reply letting
> the commenter know a DM is on its way. We do not moderate, hide, delete, or
> otherwise manage comments on others' content.

**pages_manage_metadata**
> Used solely to subscribe the creator's connected Facebook Page to the `feed`
> webhook field, so our server is notified when someone comments on the creator's
> post — the trigger for the opted-in Private Reply above. We change no other Page
> settings.

---

## 3. App-level prerequisites (check once)

- **Business Verification** — done ✅.
- **Webhooks configured:** IG → `comments` field; FB Page → `feed` field, callback
  `https://www.mvpaffiliate.io/api/facebook/webhook` (and the IG webhook callback),
  both verified. FB `feed` is already subscribed (confirmed this session).
- **Privacy Policy URL** live: https://www.mvpaffiliate.io/privacy — Meta checks it.
- App is **Live** (Published) — required to submit for Advanced Access.

---

## 4. Step-by-step instructions for the Meta reviewer

> Fill the two bracketed values with a real test login you control. Set that
> account (and the commenter account) to **Tester/Admin** on the app so they work
> pre-approval.

**Instagram:**
1. Go to **https://www.mvpaffiliate.io** and log in: `[TEST_EMAIL]` / `[TEST_PASSWORD]`.
2. The account has an IG Business account connected and Auto-DM configured
   (keyword **LINK**). See it under **Instagram Auto-DM** in the left sidebar —
   the "connection status" panel there shows every check green.
3. Open this IG post published by the app: **[LINK_TO_AN_IG_POST]**
4. From a **different** account (not the IG account's own admin), comment **LINK**.
5. Within seconds, that account receives an Instagram DM with the product link.
   (Also shown in the attached screencast.)

**Facebook (identical flow):**
1. Same login. A Facebook Page ("Gomin Reviews") is connected + Auto-DM on.
2. Open this Page post published by the app: **[LINK_TO_A_FB_PAGE_POST]**
3. From a different account, comment **LINK** → a Messenger DM with the link arrives.

---

## 5. Screencast script (~90 sec, one take — REQUIRED)

Record Instagram (primary); optionally append the Facebook flow.
1. Log in at mvpaffiliate.io.
2. Open **Instagram Auto-DM** — show keyword ("LINK"), the DM message, and the
   all-green connection-status panel.
3. Open the IG post (in a second window / phone) as a **tester who is not the
   account admin**. Comment **LINK**.
4. Cut to that account's Instagram DMs — show the message with the link arriving.
5. (Optional) show the public "Sent you a DM! 📩" reply on the comment.
6. (Optional) repeat the same on the Facebook Page for completeness.

Keep it continuous — don't cut between the comment and the DM landing.

---

## 6. Data Handling questions (Data Use Checkup)

- **What data do you access?** The comment id, the commenter's Instagram-/Page-
  scoped ID, the comment text (only to match the keyword), and the post/media id.
- **How do you use it?** Solely to (a) match the keyword and (b) send the one
  requested Private Reply, plus prevent a duplicate reply to the same comment. No
  profiling, ad targeting, or resale.
- **Do you store it?** A minimal audit row — comment id, status (sent/failed),
  timestamp — for dedup + support. No long-term message content, no user profiles.
- **Do you share it with third parties?** No.
- **Deletion / retention?** Audit rows retained only for operational dedup; we
  honor deletion requests via the data-deletion callback / privacy contact.
  Privacy policy: https://www.mvpaffiliate.io/privacy

---

## 7. Notes to reviewer (cover message — paste into the submission note)

> MVP Affiliate is a content tool for creators who monetize with affiliate links.
> This feature is a standard opt-in "comment a keyword → get the link in a DM"
> auto-responder for the creator's OWN Instagram Business account / Facebook Page.
> It only messages users who opt in by commenting the keyword, sends one reply per
> comment, and never sends unsolicited or bulk messages. Test credentials and
> exact reproduction steps are provided; a screencast of the full flow is attached.
> The same code path serves Instagram and Facebook — both permission sets support
> the single feature described here.

---

## 8. Pre-submit checklist

- [ ] Test login created; set to Tester/Admin; IG Business + FB Page connected; Auto-DM keyword `LINK` set.
- [ ] A **second** account added as **Tester** (App roles → Roles) to be the commenter (avoids the admin-self-comment webhook suppression).
- [ ] One IG post + one FB Page post published through MVP to comment on.
- [ ] **Screencast recorded** showing comment → DM (Section 5). Recording it is also your proof the flow works.
- [ ] Privacy Policy URL live.
- [ ] Section 2 text pasted into each permission; Section 4 into reviewer instructions; Section 6 into Data Use Checkup; Section 7 into the submission note.
- [ ] Submit the IG (`manage_messages` + `manage_comments`) + FB (`pages_messaging` + `pages_manage_metadata`) permissions together.
