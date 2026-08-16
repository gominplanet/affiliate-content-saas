// Account-level thumbnail headline style. Read server-side by the automatic
// surfaces (blog featured-hero, background Social Push pins) that can't see the
// per-browser toggle. Set from any interactive toggle.
//
// Degrades safely: any read error (or a pre-migration DB missing the column)
// returns 'statement', so the automatic surfaces keep their current behaviour.

export type HeadlineStyle = 'statement' | 'question'

export async function getAccountHeadlineStyle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  userId: string,
): Promise<HeadlineStyle> {
  try {
    const { data } = await sb
      .from('integrations')
      .select('thumbnail_headline_style')
      .eq('user_id', userId)
      .maybeSingle()
    return (data?.thumbnail_headline_style as string) === 'question' ? 'question' : 'statement'
  } catch {
    return 'statement'
  }
}
