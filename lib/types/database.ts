// Auto-generated from Supabase schema — run `supabase gen types typescript` to regenerate.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      brand_profiles: {
        Row: {
          id: string
          user_id: string
          name: string
          tagline: string | null
          author_name: string | null
          website_url: string | null
          niches: string[]
          target_audience: string | null
          audience_pain_points: string | null
          awareness_level: string | null
          tone: string[]
          post_length: string
          cta_style: string
          affiliate_disclaimer: string | null
          primary_color: string | null
          secondary_color: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['brand_profiles']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['brand_profiles']['Insert']>
      }
      integrations: {
        Row: {
          id: string
          user_id: string
          youtube_api_key: string | null
          youtube_channel_id: string | null
          wordpress_url: string | null
          wordpress_app_password: string | null
          hostinger_api_key: string | null
          anthropic_api_key: string | null
          gemini_api_key: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['integrations']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['integrations']['Insert']>
      }
      youtube_videos: {
        Row: {
          id: string
          user_id: string
          youtube_video_id: string
          title: string
          description: string | null
          thumbnail_url: string | null
          channel_id: string
          channel_title: string
          published_at: string
          view_count: number | null
          transcript: string | null
          transcript_fetched_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['youtube_videos']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['youtube_videos']['Insert']>
      }
      blog_posts: {
        Row: {
          id: string
          user_id: string
          video_id: string
          title: string
          slug: string
          content: string | null
          excerpt: string | null
          status: 'pending' | 'draft' | 'published' | 'failed'
          wordpress_post_id: number | null
          wordpress_url: string | null
          ai_model: string | null
          generation_prompt_version: string | null
          published_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['blog_posts']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['blog_posts']['Insert']>
      }
      social_drafts: {
        Row: {
          id: string
          user_id: string
          video_id: string
          blog_post_id: string | null
          platform: 'twitter' | 'linkedin' | 'instagram'
          content: string
          char_count: number
          status: 'pending' | 'approved' | 'rejected' | 'published'
          approved_at: string | null
          published_at: string | null
          ai_model: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['social_drafts']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['social_drafts']['Insert']>
      }
      job_failures: {
        Row: {
          id: string
          user_id: string
          job_type: 'blog_generation' | 'wp_publish' | 'social_draft' | 'youtube_sync'
          video_id: string | null
          error_message: string
          error_code: string | null
          stack_trace: string | null
          retry_count: number
          status: 'pending_retry' | 'retrying' | 'resolved' | 'dismissed'
          resolved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['job_failures']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['job_failures']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
