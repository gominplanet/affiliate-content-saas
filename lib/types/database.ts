export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_usage: {
        Row: {
          created_at: string
          feature: string
          id: string
          images: number
          input_tokens: number
          model: string
          output_tokens: number
          tier: string | null
          user_id: string | null
          web_searches: number
        }
        Insert: {
          created_at?: string
          feature: string
          id?: string
          images?: number
          input_tokens?: number
          model: string
          output_tokens?: number
          tier?: string | null
          user_id?: string | null
          web_searches?: number
        }
        Update: {
          created_at?: string
          feature?: string
          id?: string
          images?: number
          input_tokens?: number
          model?: string
          output_tokens?: number
          tier?: string | null
          user_id?: string | null
          web_searches?: number
        }
        Relationships: []
      }
      announcements: {
        Row: {
          active: boolean
          body: string
          created_at: string
          created_by: string | null
          cta_href: string | null
          cta_label: string | null
          id: string
          title: string
          updated_at: string
          variant: string
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          created_by?: string | null
          cta_href?: string | null
          cta_label?: string | null
          id?: string
          title: string
          updated_at?: string
          variant?: string
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          created_by?: string | null
          cta_href?: string | null
          cta_label?: string | null
          id?: string
          title?: string
          updated_at?: string
          variant?: string
        }
        Relationships: []
      }
      assistant_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      assistant_memory: {
        Row: {
          memory: string
          updated_at: string
          user_id: string
        }
        Insert: {
          memory?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          memory?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      assistant_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "assistant_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          affiliate_keywords: string[] | null
          ai_model: string | null
          bluesky_post_uri: string | null
          body_images_count: number | null
          content: string | null
          created_at: string
          excerpt: string | null
          facebook_post_id: string | null
          generation_prompt_version: string | null
          geniuslink_code: string | null
          has_images: boolean | null
          id: string
          image_prompts: Json | null
          instagram_image_post_id: string | null
          instagram_reel_id: string | null
          instagram_story_id: string | null
          last_rewrite_feedback: string | null
          linkedin_post_id: string | null
          meta_description: string | null
          pinterest_pin_id: string | null
          post_type: string
          published_at: string | null
          rewrite_count: number
          seo_keyword: string | null
          seo_meta_description: string | null
          slug: string
          social_publish_counts: Json
          status: string
          telegram_message_id: string | null
          threads_post_id: string | null
          tiktok_error_message: string | null
          tiktok_posted_at: string | null
          tiktok_publish_id: string | null
          tiktok_publish_status: string | null
          tiktok_share_url: string | null
          title: string
          twitter_post_id: string | null
          updated_at: string
          user_id: string
          video_id: string | null
          wordpress_post_id: number | null
          wordpress_site_id: string | null
          wordpress_url: string | null
        }
        Insert: {
          affiliate_keywords?: string[] | null
          ai_model?: string | null
          bluesky_post_uri?: string | null
          body_images_count?: number | null
          content?: string | null
          created_at?: string
          excerpt?: string | null
          facebook_post_id?: string | null
          generation_prompt_version?: string | null
          geniuslink_code?: string | null
          has_images?: boolean | null
          id?: string
          image_prompts?: Json | null
          instagram_image_post_id?: string | null
          instagram_reel_id?: string | null
          instagram_story_id?: string | null
          last_rewrite_feedback?: string | null
          linkedin_post_id?: string | null
          meta_description?: string | null
          pinterest_pin_id?: string | null
          post_type?: string
          published_at?: string | null
          rewrite_count?: number
          seo_keyword?: string | null
          seo_meta_description?: string | null
          slug: string
          social_publish_counts?: Json
          status?: string
          telegram_message_id?: string | null
          threads_post_id?: string | null
          tiktok_error_message?: string | null
          tiktok_posted_at?: string | null
          tiktok_publish_id?: string | null
          tiktok_publish_status?: string | null
          tiktok_share_url?: string | null
          title: string
          twitter_post_id?: string | null
          updated_at?: string
          user_id: string
          video_id?: string | null
          wordpress_post_id?: number | null
          wordpress_site_id?: string | null
          wordpress_url?: string | null
        }
        Update: {
          affiliate_keywords?: string[] | null
          ai_model?: string | null
          bluesky_post_uri?: string | null
          body_images_count?: number | null
          content?: string | null
          created_at?: string
          excerpt?: string | null
          facebook_post_id?: string | null
          generation_prompt_version?: string | null
          geniuslink_code?: string | null
          has_images?: boolean | null
          id?: string
          image_prompts?: Json | null
          instagram_image_post_id?: string | null
          instagram_reel_id?: string | null
          instagram_story_id?: string | null
          last_rewrite_feedback?: string | null
          linkedin_post_id?: string | null
          meta_description?: string | null
          pinterest_pin_id?: string | null
          post_type?: string
          published_at?: string | null
          rewrite_count?: number
          seo_keyword?: string | null
          seo_meta_description?: string | null
          slug?: string
          social_publish_counts?: Json
          status?: string
          telegram_message_id?: string | null
          threads_post_id?: string | null
          tiktok_error_message?: string | null
          tiktok_posted_at?: string | null
          tiktok_publish_id?: string | null
          tiktok_publish_status?: string | null
          tiktok_share_url?: string | null
          title?: string
          twitter_post_id?: string | null
          updated_at?: string
          user_id?: string
          video_id?: string | null
          wordpress_post_id?: number | null
          wordpress_site_id?: string | null
          wordpress_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blog_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_posts_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "youtube_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_posts_wordpress_site_id_fkey"
            columns: ["wordpress_site_id"]
            isOneToOne: false
            referencedRelation: "wordpress_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_profiles: {
        Row: {
          affiliate_disclaimer: string | null
          amazon_storefront_url: string | null
          audience_pain_points: string | null
          author_bio: string | null
          author_name: string | null
          awareness_level: string | null
          collab_example_links: string[]
          collab_extra_notes: string | null
          collab_livestream_link: string | null
          collab_livestreams: boolean
          collab_track_record: string | null
          contact_email: string | null
          contact_preference: string
          created_at: string
          cta_style: string
          custom_categories: string[] | null
          facebook_groups: Json
          facebook_url: string | null
          font_theme: string
          gear_sections: Json | null
          header_banner_url: string | null
          headshot_url: string | null
          headshot_urls: string[] | null
          id: string
          instagram_url: string | null
          learn_profile: Json
          learn_profile_evolved_at: string | null
          linktree_url: string | null
          logo_url: string | null
          name: string
          niches: string[]
          pinterest_url: string | null
          post_length: string
          primary_color: string | null
          sample_address: string | null
          sample_full_name: string | null
          sample_phone: string | null
          secondary_color: string | null
          tagline: string | null
          target_audience: string | null
          threads_url: string | null
          tiktok_url: string | null
          tone: string[]
          twitter_url: string | null
          updated_at: string
          user_id: string
          website_url: string | null
          words_to_avoid: string | null
          writing_sample: string | null
          youtube_channel_url: string | null
        }
        Insert: {
          affiliate_disclaimer?: string | null
          amazon_storefront_url?: string | null
          audience_pain_points?: string | null
          author_bio?: string | null
          author_name?: string | null
          awareness_level?: string | null
          collab_example_links?: string[]
          collab_extra_notes?: string | null
          collab_livestream_link?: string | null
          collab_livestreams?: boolean
          collab_track_record?: string | null
          contact_email?: string | null
          contact_preference?: string
          created_at?: string
          cta_style?: string
          custom_categories?: string[] | null
          facebook_groups?: Json
          facebook_url?: string | null
          font_theme?: string
          gear_sections?: Json | null
          header_banner_url?: string | null
          headshot_url?: string | null
          headshot_urls?: string[] | null
          id?: string
          instagram_url?: string | null
          learn_profile?: Json
          learn_profile_evolved_at?: string | null
          linktree_url?: string | null
          logo_url?: string | null
          name?: string
          niches?: string[]
          pinterest_url?: string | null
          post_length?: string
          primary_color?: string | null
          sample_address?: string | null
          sample_full_name?: string | null
          sample_phone?: string | null
          secondary_color?: string | null
          tagline?: string | null
          target_audience?: string | null
          threads_url?: string | null
          tiktok_url?: string | null
          tone?: string[]
          twitter_url?: string | null
          updated_at?: string
          user_id: string
          website_url?: string | null
          words_to_avoid?: string | null
          writing_sample?: string | null
          youtube_channel_url?: string | null
        }
        Update: {
          affiliate_disclaimer?: string | null
          amazon_storefront_url?: string | null
          audience_pain_points?: string | null
          author_bio?: string | null
          author_name?: string | null
          awareness_level?: string | null
          collab_example_links?: string[]
          collab_extra_notes?: string | null
          collab_livestream_link?: string | null
          collab_livestreams?: boolean
          collab_track_record?: string | null
          contact_email?: string | null
          contact_preference?: string
          created_at?: string
          cta_style?: string
          custom_categories?: string[] | null
          facebook_groups?: Json
          facebook_url?: string | null
          font_theme?: string
          gear_sections?: Json | null
          header_banner_url?: string | null
          headshot_url?: string | null
          headshot_urls?: string[] | null
          id?: string
          instagram_url?: string | null
          learn_profile?: Json
          learn_profile_evolved_at?: string | null
          linktree_url?: string | null
          logo_url?: string | null
          name?: string
          niches?: string[]
          pinterest_url?: string | null
          post_length?: string
          primary_color?: string | null
          sample_address?: string | null
          sample_full_name?: string | null
          sample_phone?: string | null
          secondary_color?: string | null
          tagline?: string | null
          target_audience?: string | null
          threads_url?: string | null
          tiktok_url?: string | null
          tone?: string[]
          twitter_url?: string | null
          updated_at?: string
          user_id?: string
          website_url?: string | null
          words_to_avoid?: string | null
          writing_sample?: string | null
          youtube_channel_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          asin: string
          blog_post_id: string | null
          campaign_name: string | null
          category: string | null
          cc_campaign_id: string | null
          created_at: string
          ends_at: string | null
          epc: string | null
          error_message: string | null
          hero_kind: string | null
          id: string
          product_title: string | null
          status: string
          updated_at: string
          user_id: string
          wordpress_url: string | null
        }
        Insert: {
          asin: string
          blog_post_id?: string | null
          campaign_name?: string | null
          category?: string | null
          cc_campaign_id?: string | null
          created_at?: string
          ends_at?: string | null
          epc?: string | null
          error_message?: string | null
          hero_kind?: string | null
          id?: string
          product_title?: string | null
          status?: string
          updated_at?: string
          user_id: string
          wordpress_url?: string | null
        }
        Update: {
          asin?: string
          blog_post_id?: string | null
          campaign_name?: string | null
          category?: string | null
          cc_campaign_id?: string | null
          created_at?: string
          ends_at?: string | null
          epc?: string | null
          error_message?: string | null
          hero_kind?: string | null
          id?: string
          product_title?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          wordpress_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_blog_post_id_fkey"
            columns: ["blog_post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborations: {
        Row: {
          amazon_storefront: string | null
          banner_ads: boolean
          banner_ads_amount: string | null
          brand_name: string
          collabs_done: string | null
          created_at: string
          example_links: string[]
          extra_notes: string | null
          free_sample: boolean
          generated_email: string | null
          id: string
          platforms: string[]
          portfolio_url: string | null
          product_or_asin: string | null
          production_fee: boolean
          production_fee_amount: string | null
          share_address: boolean
          user_id: string
          website_url: string | null
          youtube_url: string | null
        }
        Insert: {
          amazon_storefront?: string | null
          banner_ads?: boolean
          banner_ads_amount?: string | null
          brand_name: string
          collabs_done?: string | null
          created_at?: string
          example_links?: string[]
          extra_notes?: string | null
          free_sample?: boolean
          generated_email?: string | null
          id?: string
          platforms?: string[]
          portfolio_url?: string | null
          product_or_asin?: string | null
          production_fee?: boolean
          production_fee_amount?: string | null
          share_address?: boolean
          user_id: string
          website_url?: string | null
          youtube_url?: string | null
        }
        Update: {
          amazon_storefront?: string | null
          banner_ads?: boolean
          banner_ads_amount?: string | null
          brand_name?: string
          collabs_done?: string | null
          created_at?: string
          example_links?: string[]
          extra_notes?: string | null
          free_sample?: boolean
          generated_email?: string | null
          id?: string
          platforms?: string[]
          portfolio_url?: string | null
          product_or_asin?: string | null
          production_fee?: boolean
          production_fee_amount?: string | null
          share_address?: boolean
          user_id?: string
          website_url?: string | null
          youtube_url?: string | null
        }
        Relationships: []
      }
      creator_connections_catalog: {
        Row: {
          asin: string
          brand: string | null
          budget_remain: number | null
          campaign_id: string
          campaign_name: string | null
          commission: number | null
          days_left: number | null
          ends_at: string | null
          has_budget_and_slots: boolean | null
          id: string
          imported_at: string | null
          slots_available: number | null
        }
        Insert: {
          asin: string
          brand?: string | null
          budget_remain?: number | null
          campaign_id: string
          campaign_name?: string | null
          commission?: number | null
          days_left?: number | null
          ends_at?: string | null
          has_budget_and_slots?: boolean | null
          id?: string
          imported_at?: string | null
          slots_available?: number | null
        }
        Update: {
          asin?: string
          brand?: string | null
          budget_remain?: number | null
          campaign_id?: string
          campaign_name?: string | null
          commission?: number | null
          days_left?: number | null
          ends_at?: string | null
          has_budget_and_slots?: boolean | null
          id?: string
          imported_at?: string | null
          slots_available?: number | null
        }
        Relationships: []
      }
      face_models: {
        Row: {
          created_at: string
          failure_reason: string | null
          fal_request_id: string | null
          id: string
          lora_url: string | null
          name: string
          source_images: Json
          status: string
          trigger_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          failure_reason?: string | null
          fal_request_id?: string | null
          id?: string
          lora_url?: string | null
          name: string
          source_images?: Json
          status?: string
          trigger_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          failure_reason?: string | null
          fal_request_id?: string | null
          id?: string
          lora_url?: string | null
          name?: string
          source_images?: Json
          status?: string
          trigger_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ig_burn_jobs: {
        Row: {
          caption_text: string
          claimed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          ig_published: boolean
          position: string
          product: string | null
          reel_caption: string | null
          result_url: string | null
          scheduled_at: string
          source_video_url: string
          status: string
          style: string
          user_id: string
        }
        Insert: {
          caption_text?: string
          claimed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          ig_published?: boolean
          position?: string
          product?: string | null
          reel_caption?: string | null
          result_url?: string | null
          scheduled_at?: string
          source_video_url: string
          status?: string
          style?: string
          user_id: string
        }
        Update: {
          caption_text?: string
          claimed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          ig_published?: boolean
          position?: string
          product?: string | null
          reel_caption?: string | null
          result_url?: string | null
          scheduled_at?: string
          source_video_url?: string
          status?: string
          style?: string
          user_id?: string
        }
        Relationships: []
      }
      indexing_submissions: {
        Row: {
          created_at: string
          id: string
          message: string | null
          outcome: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          outcome: string
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          outcome?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      integrations: {
        Row: {
          amazon_associates_tag: string | null
          anthropic_api_key: string | null
          blog_customizations: Json | null
          bluesky_app_password: string | null
          bluesky_did: string | null
          bluesky_handle: string | null
          cc_ingest_token: string | null
          content_only: boolean
          created_at: string
          cta_style: string
          facebook_page_access_token: string | null
          facebook_page_id: string | null
          facebook_page_name: string | null
          facebook_pages_json: string | null
          gemini_api_key: string | null
          geniuslink_api_key: string | null
          geniuslink_api_secret: string | null
          gsc_oauth_access_token: string | null
          gsc_oauth_refresh_token: string | null
          gsc_oauth_token_expiry: number | null
          gsc_property: string | null
          hostinger_api_key: string | null
          id: string
          instagram_access_token: string | null
          instagram_token_expiry: number | null
          instagram_user_id: string | null
          instagram_username: string | null
          linkedin_access_token: string | null
          linkedin_person_id: string | null
          linkedin_person_name: string | null
          pinterest_access_token: string | null
          pinterest_board_id: string | null
          pinterest_board_name: string | null
          pinterest_boards_json: string | null
          pinterest_fallback_board: string | null
          pinterest_refresh_token: string | null
          setup_job_id: string | null
          setup_status: string | null
          setup_subscription_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_period_end: string | null
          subscription_period_start: string | null
          subscription_status: string | null
          telegram_channel_id: string | null
          telegram_channel_title: string | null
          threads_access_token: string | null
          threads_user_id: string | null
          threads_username: string | null
          tier: string
          tiktok_access_token: string | null
          tiktok_avatar_url: string | null
          tiktok_display_name: string | null
          tiktok_open_id: string | null
          tiktok_refresh_expiry: number | null
          tiktok_refresh_token: string | null
          tiktok_scopes: string | null
          tiktok_token_expiry: number | null
          tiktok_username: string | null
          twitter_access_token: string | null
          twitter_expires_at: string | null
          twitter_handle: string | null
          twitter_refresh_token: string | null
          twitter_user_id: string | null
          updated_at: string
          user_id: string
          vidiq_api_key: string | null
          vidiq_snapshot: Json | null
          wordpress_api_token: string | null
          wordpress_app_password: string | null
          wordpress_url: string | null
          wordpress_username: string | null
          youtube_api_key: string | null
          youtube_channel_id: string | null
          youtube_oauth_access_token: string | null
          youtube_oauth_refresh_token: string | null
          youtube_oauth_token_expiry: number | null
          yt_backlink_enabled: boolean
        }
        Insert: {
          amazon_associates_tag?: string | null
          anthropic_api_key?: string | null
          blog_customizations?: Json | null
          bluesky_app_password?: string | null
          bluesky_did?: string | null
          bluesky_handle?: string | null
          cc_ingest_token?: string | null
          content_only?: boolean
          created_at?: string
          cta_style?: string
          facebook_page_access_token?: string | null
          facebook_page_id?: string | null
          facebook_page_name?: string | null
          facebook_pages_json?: string | null
          gemini_api_key?: string | null
          geniuslink_api_key?: string | null
          geniuslink_api_secret?: string | null
          gsc_oauth_access_token?: string | null
          gsc_oauth_refresh_token?: string | null
          gsc_oauth_token_expiry?: number | null
          gsc_property?: string | null
          hostinger_api_key?: string | null
          id?: string
          instagram_access_token?: string | null
          instagram_token_expiry?: number | null
          instagram_user_id?: string | null
          instagram_username?: string | null
          linkedin_access_token?: string | null
          linkedin_person_id?: string | null
          linkedin_person_name?: string | null
          pinterest_access_token?: string | null
          pinterest_board_id?: string | null
          pinterest_board_name?: string | null
          pinterest_boards_json?: string | null
          pinterest_fallback_board?: string | null
          pinterest_refresh_token?: string | null
          setup_job_id?: string | null
          setup_status?: string | null
          setup_subscription_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_period_end?: string | null
          subscription_period_start?: string | null
          subscription_status?: string | null
          telegram_channel_id?: string | null
          telegram_channel_title?: string | null
          threads_access_token?: string | null
          threads_user_id?: string | null
          threads_username?: string | null
          tier?: string
          tiktok_access_token?: string | null
          tiktok_avatar_url?: string | null
          tiktok_display_name?: string | null
          tiktok_open_id?: string | null
          tiktok_refresh_expiry?: number | null
          tiktok_refresh_token?: string | null
          tiktok_scopes?: string | null
          tiktok_token_expiry?: number | null
          tiktok_username?: string | null
          twitter_access_token?: string | null
          twitter_expires_at?: string | null
          twitter_handle?: string | null
          twitter_refresh_token?: string | null
          twitter_user_id?: string | null
          updated_at?: string
          user_id: string
          vidiq_api_key?: string | null
          vidiq_snapshot?: Json | null
          wordpress_api_token?: string | null
          wordpress_app_password?: string | null
          wordpress_url?: string | null
          wordpress_username?: string | null
          youtube_api_key?: string | null
          youtube_channel_id?: string | null
          youtube_oauth_access_token?: string | null
          youtube_oauth_refresh_token?: string | null
          youtube_oauth_token_expiry?: number | null
          yt_backlink_enabled?: boolean
        }
        Update: {
          amazon_associates_tag?: string | null
          anthropic_api_key?: string | null
          blog_customizations?: Json | null
          bluesky_app_password?: string | null
          bluesky_did?: string | null
          bluesky_handle?: string | null
          cc_ingest_token?: string | null
          content_only?: boolean
          created_at?: string
          cta_style?: string
          facebook_page_access_token?: string | null
          facebook_page_id?: string | null
          facebook_page_name?: string | null
          facebook_pages_json?: string | null
          gemini_api_key?: string | null
          geniuslink_api_key?: string | null
          geniuslink_api_secret?: string | null
          gsc_oauth_access_token?: string | null
          gsc_oauth_refresh_token?: string | null
          gsc_oauth_token_expiry?: number | null
          gsc_property?: string | null
          hostinger_api_key?: string | null
          id?: string
          instagram_access_token?: string | null
          instagram_token_expiry?: number | null
          instagram_user_id?: string | null
          instagram_username?: string | null
          linkedin_access_token?: string | null
          linkedin_person_id?: string | null
          linkedin_person_name?: string | null
          pinterest_access_token?: string | null
          pinterest_board_id?: string | null
          pinterest_board_name?: string | null
          pinterest_boards_json?: string | null
          pinterest_fallback_board?: string | null
          pinterest_refresh_token?: string | null
          setup_job_id?: string | null
          setup_status?: string | null
          setup_subscription_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_period_end?: string | null
          subscription_period_start?: string | null
          subscription_status?: string | null
          telegram_channel_id?: string | null
          telegram_channel_title?: string | null
          threads_access_token?: string | null
          threads_user_id?: string | null
          threads_username?: string | null
          tier?: string
          tiktok_access_token?: string | null
          tiktok_avatar_url?: string | null
          tiktok_display_name?: string | null
          tiktok_open_id?: string | null
          tiktok_refresh_expiry?: number | null
          tiktok_refresh_token?: string | null
          tiktok_scopes?: string | null
          tiktok_token_expiry?: number | null
          tiktok_username?: string | null
          twitter_access_token?: string | null
          twitter_expires_at?: string | null
          twitter_handle?: string | null
          twitter_refresh_token?: string | null
          twitter_user_id?: string | null
          updated_at?: string
          user_id?: string
          vidiq_api_key?: string | null
          vidiq_snapshot?: Json | null
          wordpress_api_token?: string | null
          wordpress_app_password?: string | null
          wordpress_url?: string | null
          wordpress_username?: string | null
          youtube_api_key?: string | null
          youtube_channel_id?: string | null
          youtube_oauth_access_token?: string | null
          youtube_oauth_refresh_token?: string | null
          youtube_oauth_token_expiry?: number | null
          yt_backlink_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "integrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_failures: {
        Row: {
          created_at: string
          error_code: string | null
          error_message: string
          id: string
          job_type: string
          resolved_at: string | null
          retry_count: number
          stack_trace: string | null
          status: string
          updated_at: string
          user_id: string
          video_id: string | null
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          error_message: string
          id?: string
          job_type: string
          resolved_at?: string | null
          retry_count?: number
          stack_trace?: string | null
          status?: string
          updated_at?: string
          user_id: string
          video_id?: string | null
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_message?: string
          id?: string
          job_type?: string
          resolved_at?: string | null
          retry_count?: number
          stack_trace?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_failures_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_failures_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "youtube_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_broadcasts: {
        Row: {
          blog_post_ids: string[]
          created_at: string
          curated_links: Json
          error_message: string | null
          html: string
          id: string
          personal_message: string | null
          plain_text: string | null
          recipients_bounced: number
          recipients_clicked: number
          recipients_delivered: number
          recipients_opened: number
          recipients_total: number
          scheduled_at: string | null
          sent_at: string | null
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          blog_post_ids?: string[]
          created_at?: string
          curated_links?: Json
          error_message?: string | null
          html: string
          id?: string
          personal_message?: string | null
          plain_text?: string | null
          recipients_bounced?: number
          recipients_clicked?: number
          recipients_delivered?: number
          recipients_opened?: number
          recipients_total?: number
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          user_id: string
        }
        Update: {
          blog_post_ids?: string[]
          created_at?: string
          curated_links?: Json
          error_message?: string | null
          html?: string
          id?: string
          personal_message?: string | null
          plain_text?: string | null
          recipients_bounced?: number
          recipients_clicked?: number
          recipients_delivered?: number
          recipients_opened?: number
          recipients_total?: number
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: []
      }
      newsletter_settings: {
        Row: {
          created_at: string
          cta_bullet_1: string | null
          cta_bullet_2: string | null
          cta_bullet_3: string | null
          cta_button: string | null
          cta_subtitle: string | null
          cta_title: string | null
          dkim_records: Json | null
          domain_checked_at: string | null
          domain_status: string
          enabled: boolean
          homepage_placement: string | null
          mailing_address: string | null
          resend_domain_id: string | null
          sender_domain: string | null
          sender_local_part: string
          sender_name: string | null
          sidebar_placement: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cta_bullet_1?: string | null
          cta_bullet_2?: string | null
          cta_bullet_3?: string | null
          cta_button?: string | null
          cta_subtitle?: string | null
          cta_title?: string | null
          dkim_records?: Json | null
          domain_checked_at?: string | null
          domain_status?: string
          enabled?: boolean
          homepage_placement?: string | null
          mailing_address?: string | null
          resend_domain_id?: string | null
          sender_domain?: string | null
          sender_local_part?: string
          sender_name?: string | null
          sidebar_placement?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cta_bullet_1?: string | null
          cta_bullet_2?: string | null
          cta_bullet_3?: string | null
          cta_button?: string | null
          cta_subtitle?: string | null
          cta_title?: string | null
          dkim_records?: Json | null
          domain_checked_at?: string | null
          domain_status?: string
          enabled?: boolean
          homepage_placement?: string | null
          mailing_address?: string | null
          resend_domain_id?: string | null
          sender_domain?: string | null
          sender_local_part?: string
          sender_name?: string | null
          sidebar_placement?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      newsletter_subscribers: {
        Row: {
          confirm_token: string | null
          confirmed_at: string | null
          created_at: string
          email: string
          id: string
          signup_ip_hash: string | null
          source: string | null
          source_url: string | null
          status: string
          unsub_token: string
          unsubscribed_at: string | null
          user_id: string
        }
        Insert: {
          confirm_token?: string | null
          confirmed_at?: string | null
          created_at?: string
          email: string
          id?: string
          signup_ip_hash?: string | null
          source?: string | null
          source_url?: string | null
          status?: string
          unsub_token?: string
          unsubscribed_at?: string | null
          user_id: string
        }
        Update: {
          confirm_token?: string | null
          confirmed_at?: string | null
          created_at?: string
          email?: string
          id?: string
          signup_ip_hash?: string | null
          source?: string | null
          source_url?: string | null
          status?: string
          unsub_token?: string
          unsubscribed_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      post_seo: {
        Row: {
          checked_at: string | null
          clicks: number | null
          coverage_state: string | null
          ctr: number | null
          dropped_at: string | null
          impressions: number | null
          indexed_state: string | null
          last_crawl: string | null
          position: number | null
          post_id: string
          score_detail: Json | null
          seo_score: number | null
          top_queries: Json | null
          url: string | null
          user_id: string
        }
        Insert: {
          checked_at?: string | null
          clicks?: number | null
          coverage_state?: string | null
          ctr?: number | null
          dropped_at?: string | null
          impressions?: number | null
          indexed_state?: string | null
          last_crawl?: string | null
          position?: number | null
          post_id: string
          score_detail?: Json | null
          seo_score?: number | null
          top_queries?: Json | null
          url?: string | null
          user_id: string
        }
        Update: {
          checked_at?: string | null
          clicks?: number | null
          coverage_state?: string | null
          ctr?: number | null
          dropped_at?: string | null
          impressions?: number | null
          indexed_state?: string | null
          last_crawl?: string | null
          position?: number | null
          post_id?: string
          score_detail?: Json | null
          seo_score?: number | null
          top_queries?: Json | null
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_seo_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      scheduled_posts: {
        Row: {
          attempts: number
          blog_post_id: string
          body_text: string
          claimed_at: string | null
          created_at: string
          error_message: string | null
          external_id: string | null
          id: string
          last_attempt_at: string | null
          platform: string
          scheduled_at: string
          social_account_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          blog_post_id: string
          body_text: string
          claimed_at?: string | null
          created_at?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          last_attempt_at?: string | null
          platform: string
          scheduled_at: string
          social_account_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          blog_post_id?: string
          body_text?: string
          claimed_at?: string | null
          created_at?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          last_attempt_at?: string | null
          platform?: string
          scheduled_at?: string
          social_account_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_posts_blog_post_id_fkey"
            columns: ["blog_post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_posts_social_account_id_fkey"
            columns: ["social_account_id"]
            isOneToOne: false
            referencedRelation: "social_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_accounts: {
        Row: {
          access_token: string | null
          created_at: string
          display_name: string | null
          external_id: string
          extra: Json
          id: string
          is_default: boolean
          kind: string
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          display_name?: string | null
          external_id: string
          extra?: Json
          id?: string
          is_default?: boolean
          kind?: string
          platform: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          display_name?: string | null
          external_id?: string
          extra?: Json
          id?: string
          is_default?: boolean
          kind?: string
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      social_drafts: {
        Row: {
          ai_model: string | null
          approved_at: string | null
          blog_post_id: string | null
          char_count: number
          content: string
          created_at: string
          id: string
          platform: string
          published_at: string | null
          status: string
          updated_at: string
          user_id: string
          video_id: string
        }
        Insert: {
          ai_model?: string | null
          approved_at?: string | null
          blog_post_id?: string | null
          char_count: number
          content: string
          created_at?: string
          id?: string
          platform: string
          published_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          video_id: string
        }
        Update: {
          ai_model?: string | null
          approved_at?: string | null
          blog_post_id?: string | null
          char_count?: number
          content?: string
          created_at?: string
          id?: string
          platform?: string
          published_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_drafts_blog_post_id_fkey"
            columns: ["blog_post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_drafts_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "youtube_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      thumbnail_feedback: {
        Row: {
          created_at: string
          id: string
          model_used: string | null
          niche: string | null
          reaction: string
          style_id: string | null
          surface: string
          thumbnail_url: string
          user_id: string
          video_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          model_used?: string | null
          niche?: string | null
          reaction: string
          style_id?: string | null
          surface: string
          thumbnail_url: string
          user_id: string
          video_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          model_used?: string | null
          niche?: string | null
          reaction?: string
          style_id?: string | null
          surface?: string
          thumbnail_url?: string
          user_id?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "thumbnail_feedback_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "youtube_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      thumbnail_styles: {
        Row: {
          created_at: string | null
          id: string
          name: string
          reference_url: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          reference_url: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          reference_url?: string
          user_id?: string
        }
        Relationships: []
      }
      video_scripts: {
        Row: {
          ai_model: string | null
          asin: string | null
          created_at: string
          id: string
          input: string
          product_image_url: string | null
          product_title: string | null
          script: Json
          style: string
          user_id: string
        }
        Insert: {
          ai_model?: string | null
          asin?: string | null
          created_at?: string
          id?: string
          input: string
          product_image_url?: string | null
          product_title?: string | null
          script?: Json
          style: string
          user_id: string
        }
        Update: {
          ai_model?: string | null
          asin?: string | null
          created_at?: string
          id?: string
          input?: string
          product_image_url?: string | null
          product_title?: string | null
          script?: Json
          style?: string
          user_id?: string
        }
        Relationships: []
      }
      wordpress_sites: {
        Row: {
          api_token: string | null
          app_password: string
          blog_customizations: Json | null
          content_only: boolean
          created_at: string
          cta_style: string
          display_order: number
          id: string
          is_default: boolean
          label: string | null
          updated_at: string
          url: string
          user_id: string
          username: string
        }
        Insert: {
          api_token?: string | null
          app_password: string
          blog_customizations?: Json | null
          content_only?: boolean
          created_at?: string
          cta_style?: string
          display_order?: number
          id?: string
          is_default?: boolean
          label?: string | null
          updated_at?: string
          url: string
          user_id: string
          username: string
        }
        Update: {
          api_token?: string | null
          app_password?: string
          blog_customizations?: Json | null
          content_only?: boolean
          created_at?: string
          cta_style?: string
          display_order?: number
          id?: string
          is_default?: boolean
          label?: string | null
          updated_at?: string
          url?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      youtube_videos: {
        Row: {
          blog_thumbnail_url: string | null
          channel_id: string
          channel_title: string
          created_at: string
          description: string | null
          duration_seconds: number | null
          generated_description: string | null
          generated_pinned_comment: string | null
          generated_tags: Json | null
          generated_title: string | null
          id: string
          instagram_ai_thumbnail_generated_at: string | null
          instagram_ai_thumbnail_hook: string | null
          instagram_ai_thumbnail_url: string | null
          instagram_image_url: string | null
          instagram_posted_at: string | null
          instagram_reel_id: string | null
          instagram_story_id: string | null
          instagram_story_image_url: string | null
          instagram_video_url: string | null
          is_vertical: boolean | null
          metadata_generated_at: string | null
          product_image_url: string | null
          product_url: string | null
          published_at: string
          selected_category: string | null
          thumbnail_url: string | null
          tiktok_error_message: string | null
          tiktok_posted_at: string | null
          tiktok_publish_id: string | null
          tiktok_publish_status: string | null
          tiktok_share_url: string | null
          title: string
          transcript: string | null
          transcript_fetched_at: string | null
          updated_at: string
          user_id: string
          view_count: number | null
          youtube_video_id: string
        }
        Insert: {
          blog_thumbnail_url?: string | null
          channel_id: string
          channel_title: string
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          generated_description?: string | null
          generated_pinned_comment?: string | null
          generated_tags?: Json | null
          generated_title?: string | null
          id?: string
          instagram_ai_thumbnail_generated_at?: string | null
          instagram_ai_thumbnail_hook?: string | null
          instagram_ai_thumbnail_url?: string | null
          instagram_image_url?: string | null
          instagram_posted_at?: string | null
          instagram_reel_id?: string | null
          instagram_story_id?: string | null
          instagram_story_image_url?: string | null
          instagram_video_url?: string | null
          is_vertical?: boolean | null
          metadata_generated_at?: string | null
          product_image_url?: string | null
          product_url?: string | null
          published_at: string
          selected_category?: string | null
          thumbnail_url?: string | null
          tiktok_error_message?: string | null
          tiktok_posted_at?: string | null
          tiktok_publish_id?: string | null
          tiktok_publish_status?: string | null
          tiktok_share_url?: string | null
          title: string
          transcript?: string | null
          transcript_fetched_at?: string | null
          updated_at?: string
          user_id: string
          view_count?: number | null
          youtube_video_id: string
        }
        Update: {
          blog_thumbnail_url?: string | null
          channel_id?: string
          channel_title?: string
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          generated_description?: string | null
          generated_pinned_comment?: string | null
          generated_tags?: Json | null
          generated_title?: string | null
          id?: string
          instagram_ai_thumbnail_generated_at?: string | null
          instagram_ai_thumbnail_hook?: string | null
          instagram_ai_thumbnail_url?: string | null
          instagram_image_url?: string | null
          instagram_posted_at?: string | null
          instagram_reel_id?: string | null
          instagram_story_id?: string | null
          instagram_story_image_url?: string | null
          instagram_video_url?: string | null
          is_vertical?: boolean | null
          metadata_generated_at?: string | null
          product_image_url?: string | null
          product_url?: string | null
          published_at?: string
          selected_category?: string | null
          thumbnail_url?: string | null
          tiktok_error_message?: string | null
          tiktok_posted_at?: string | null
          tiktok_publish_id?: string | null
          tiktok_publish_status?: string | null
          tiktok_share_url?: string | null
          title?: string
          transcript?: string | null
          transcript_fetched_at?: string | null
          updated_at?: string
          user_id?: string
          view_count?: number | null
          youtube_video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "youtube_videos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      increment_broadcast_counter: {
        Args: { p_broadcast_id: string; p_column: string; p_user: string }
        Returns: undefined
      }
      search_creator_campaigns: {
        Args: {
          p_keyword: string
          p_limit: number
          p_min_commission: number
          p_min_days: number
          p_need_budget: boolean
        }
        Returns: {
          asin: string
          brand: string
          campaign_id: string
          campaign_name: string
          commission: number
          days_left: number
          ends_at: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      try_consume_post_quota: {
        Args: {
          p_lifetime: number
          p_monthly: number
          p_user: string
          p_window_start: string
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
