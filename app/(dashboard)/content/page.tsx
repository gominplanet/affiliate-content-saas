import type { Metadata } from 'next'
import { createServerClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import ContentList from '@/components/content/ContentList'

export const metadata: Metadata = { title: 'Content' }

export default async function ContentPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: videos } = await supabase
    .from('youtube_videos')
    .select('*')
    .eq('user_id', user!.id)
    .order('published_at', { ascending: false })

  return (
    <>
      <Header
        title="Content"
        subtitle={
          videos && videos.length > 0
            ? `${videos.length} video${videos.length !== 1 ? 's' : ''} from your channel.`
            : 'Sync your YouTube channel to get started.'
        }
      />
      <ContentList videos={videos ?? []} />
    </>
  )
}
