// Detect WordPress "plain" permalinks (…/?p=123 or …&p=123).
//
// WordPress returns this ID-based form as a post's `link` whenever the post
// isn't publicly published yet (draft / pending / future/scheduled). If we
// capture that at create/schedule time and store it as blog_posts.wordpress_url,
// every social re-share links to the ugly ?p= URL even though the live site uses
// pretty "Post name" permalinks. Callers use this to decide when to re-resolve
// the real permalink from WordPress before sharing.

export function isPlainPermalink(url: string | null | undefined): boolean {
  return !!url && /[?&]p=\d+(&|$)/.test(url)
}
