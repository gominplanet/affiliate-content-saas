<?php
/**
 * Shortcut accessors for the customizations stored by the MVP Affiliate plugin.
 * Templates call these instead of digging through nested arrays.
 */
if (!defined('ABSPATH')) exit;

if (!function_exists('mvp_affiliate_profile')) {
    function mvp_affiliate_profile(): array {
        $d = mvp_affiliate_data();
        return is_array($d['profile'] ?? null) ? $d['profile'] : [];
    }
}

if (!function_exists('mvp_affiliate_about')) {
    function mvp_affiliate_about(): array {
        $d = mvp_affiliate_data();
        return is_array($d['about'] ?? null) ? $d['about'] : [];
    }
}

if (!function_exists('mvp_affiliate_footer_data')) {
    function mvp_affiliate_footer_data(): array {
        $d = mvp_affiliate_data();
        return is_array($d['footer'] ?? null) ? $d['footer'] : [];
    }
}

if (!function_exists('mvp_affiliate_sidebar_blocks')) {
    function mvp_affiliate_sidebar_blocks(): array {
        $d = mvp_affiliate_data();
        return is_array($d['sidebar'] ?? null) ? $d['sidebar'] : [];
    }
}

if (!function_exists('mvp_affiliate_incontent_blocks')) {
    function mvp_affiliate_incontent_blocks(): array {
        $d = mvp_affiliate_data();
        return is_array($d['incontent'] ?? null) ? $d['incontent'] : [];
    }
}

/**
 * Pick of the Day config + helpers.
 */
if (!function_exists('mvp_affiliate_pick_of_day_config')) {
    function mvp_affiliate_pick_of_day_config(): array {
        $d = mvp_affiliate_data();
        $config = is_array($d['pickOfDay'] ?? null) ? $d['pickOfDay'] : [];
        $merged = array_merge([
            'enabled'        => true,
            'label'          => 'Our Pick of the Day',
            'showOnSidebar'  => true,
            'showOnHomepage' => false,
            'rotation'       => '24h',
            'pinnedPostId'   => '',
        ], $config);
        // Normalize rotation value
        if (!in_array($merged['rotation'], ['12h', '24h', 'pinned'], true)) {
            $merged['rotation'] = '24h';
        }
        return $merged;
    }
}

/**
 * Returns the post chosen as today's pick, or null.
 * Behavior depends on $config['rotation']:
 *   'pinned' → the post in pinnedPostId (or null if unset/invalid).
 *   '12h'    → rotates twice a day (midnight + noon, server time).
 *   '24h'    → rotates once a day at midnight (server time).
 * Picks are deterministic per rotation window + cached as a transient.
 */
if (!function_exists('mvp_affiliate_pick_of_day')) {
    function mvp_affiliate_pick_of_day(): ?WP_Post {
        $config = mvp_affiliate_pick_of_day_config();
        if (empty($config['enabled'])) return null;

        // Pinned mode — accepts either a URL or a raw numeric post ID
        if ($config['rotation'] === 'pinned') {
            $raw = trim((string)($config['pinnedPostId'] ?? ''));
            if ($raw === '') return null;

            // Numeric → treat as post ID (legacy)
            if (ctype_digit($raw)) {
                $pinned_id = intval($raw);
            } else {
                // URL → resolve via WP's built-in resolver
                $pinned_id = url_to_postid($raw);
                // url_to_postid returns 0 if it can't match (e.g. wrong domain).
                // Try one more time by extracting the slug from the path.
                if ($pinned_id === 0) {
                    $path = parse_url($raw, PHP_URL_PATH);
                    if ($path) {
                        $slug = trim($path, '/');
                        $slug = preg_replace('#^.*/#', '', $slug); // last path segment
                        if ($slug) {
                            $by_slug = get_posts([
                                'name'        => $slug,
                                'post_type'   => 'post',
                                'post_status' => 'publish',
                                'numberposts' => 1,
                            ]);
                            if (!empty($by_slug)) $pinned_id = $by_slug[0]->ID;
                        }
                    }
                }
            }

            if ($pinned_id <= 0) return null;
            $post = get_post($pinned_id);
            return ($post && $post->post_status === 'publish' && $post->post_type === 'post')
                ? $post
                : null;
        }

        // Rotation seed + cache key + TTL
        if ($config['rotation'] === '12h') {
            $half  = (intval(wp_date('G')) < 12) ? 'am' : 'pm';
            $seed  = wp_date('Ymd') . $half;
            $ttl   = 12 * HOUR_IN_SECONDS;
        } else {
            $seed  = wp_date('Ymd');
            $ttl   = DAY_IN_SECONDS;
        }

        $cache_key = 'mvp_pick_of_day_' . $seed;
        $cached = get_transient($cache_key);
        if ($cached !== false) {
            $post = ($cached === '0') ? null : get_post(intval($cached));
            return ($post && $post->post_status === 'publish') ? $post : null;
        }

        $all = get_posts([
            'numberposts' => -1,
            'fields'      => 'ids',
            'post_status' => 'publish',
            'post_type'   => 'post',
        ]);
        if (empty($all)) {
            set_transient($cache_key, '0', $ttl);
            return null;
        }

        mt_srand(crc32($seed));
        $idx = mt_rand(0, count($all) - 1);
        $post_id = $all[$idx];
        set_transient($cache_key, (string)$post_id, $ttl);
        return get_post($post_id);
    }
}

/**
 * Render the Pick of the Day card.
 * $variant: 'sidebar' | 'homepage'
 */
if (!function_exists('mvp_affiliate_render_pick_of_day')) {
    function mvp_affiliate_render_pick_of_day(string $variant = 'sidebar'): string {
        $config = mvp_affiliate_pick_of_day_config();
        if (empty($config['enabled'])) return '';
        if ($variant === 'sidebar' && empty($config['showOnSidebar'])) return '';
        if ($variant === 'homepage' && empty($config['showOnHomepage'])) return '';

        $post = mvp_affiliate_pick_of_day();
        if (!$post) return '';

        // Don't show on the post page that IS the pick
        if (is_singular('post') && get_the_ID() === $post->ID) return '';

        $title = get_the_title($post);
        $link  = get_permalink($post);
        $thumb = get_the_post_thumbnail($post, 'mvp-card', ['loading' => 'lazy']);
        $excerpt = wp_trim_words(get_the_excerpt($post), 24);
        $label = esc_html($config['label']);

        $class = $variant === 'homepage' ? 'mvp-pick-homepage' : 'mvp-pick-sidebar';
        $out = '<aside class="mvp-pick ' . $class . '">';
        $out .= '<p class="mvp-pick-label">' . $label . '</p>';
        $out .= '<a href="' . esc_url($link) . '" class="mvp-pick-link">';
        if ($thumb) $out .= '<div class="mvp-pick-image">' . $thumb . '</div>';
        $out .= '<div class="mvp-pick-body">';
        $out .= '<h3 class="mvp-pick-title">' . esc_html($title) . '</h3>';
        if ($variant === 'homepage' && $excerpt) {
            $out .= '<p class="mvp-pick-excerpt">' . esc_html($excerpt) . '</p>';
        }
        $out .= '<span class="mvp-pick-cta">Read review →</span>';
        $out .= '</div>';
        $out .= '</a>';
        $out .= '</aside>';
        return $out;
    }
}

/**
 * Effective bio — falls through empty strings (?? doesn't).
 */
if (!function_exists('mvp_affiliate_bio')) {
    function mvp_affiliate_bio(): string {
        $candidates = [
            mvp_affiliate_footer_data()['bio'] ?? '',
            mvp_affiliate_profile()['authorBio'] ?? '',
            mvp_affiliate_about()['bio'] ?? '',
        ];
        foreach ($candidates as $c) {
            $c = trim((string)$c);
            if ($c !== '') return $c;
        }
        return '';
    }
}

/**
 * Merged socials: profile.{socialUrl} wins (the Brand Profile source of
 * truth); falls back to footer.socials only when profile.{socialUrl} is
 * empty. This means updating a social URL in Brand Profile always wins
 * over any stale footer.socials.* value that might be lingering in
 * blog_customizations.
 */
if (!function_exists('mvp_affiliate_socials')) {
    function mvp_affiliate_socials(): array {
        $profile = mvp_affiliate_profile();
        $footer  = mvp_affiliate_footer_data();
        $socials = is_array($footer['socials'] ?? null) ? $footer['socials'] : [];
        $map = [
            'youtube'   => 'youtubeUrl',
            'instagram' => 'instagramUrl',
            'tiktok'    => 'tiktokUrl',
            'twitter'   => 'twitterUrl',
            'pinterest' => 'pinterestUrl',
            'facebook'  => 'facebookUrl',
            'threads'   => 'threadsUrl',
            'contact'   => 'contactEmail',
        ];
        foreach ($map as $key => $profileKey) {
            // profile.{socialUrl} wins. Only fall through to footer.socials
            // if Brand Profile has nothing for this platform.
            if (!empty($profile[$profileKey])) {
                $socials[$key] = $profile[$profileKey];
            }
        }
        return array_filter($socials, fn($v) => !empty(trim((string)$v)));
    }
}

/**
 * Inline SVG for each social platform — keeps templates clean.
 */
if (!function_exists('mvp_affiliate_social_svg')) {
    function mvp_affiliate_social_svg(string $key): string {
        $svgs = [
            'youtube'   => '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1C4.5 20.5 12 20.5 12 20.5s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8zM9.8 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>',
            'instagram' => '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.6.1 4.8 0 3.2 0 3.6-.1 4.8-.1 3.2-1.7 4.8-4.9 4.9-1.3.1-1.6.1-4.9.1-3.2 0-3.6 0-4.8-.1-3.3-.1-4.8-1.7-4.9-4.9C2.2 15.6 2.2 15.2 2.2 12c0-3.2 0-3.6.1-4.8C2.4 3.9 4 2.3 7.2 2.3c1.2-.1 1.6-.1 4.8-.1zM12 0C8.7 0 8.3 0 7.1.1 2.7.3.3 2.7.1 7.1.0 8.3 0 8.7 0 12c0 3.3 0 3.7.1 4.9.2 4.4 2.6 6.8 7 7C8.3 24 8.7 24 12 24c3.3 0 3.7 0 4.9-.1 4.4-.2 6.8-2.6 7-7 .1-1.2.1-1.6.1-4.9 0-3.3 0-3.7-.1-4.9C23.7 2.7 21.3.3 16.9.1 15.7 0 15.3 0 12 0zm0 5.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 12 5.8zm0 10.2a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.8a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z"/></svg>',
            'tiktok'    => '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.6 3.3A4.8 4.8 0 0 1 14.9 0h-3.6v16.4a2.9 2.9 0 0 1-2.9 2.5 2.9 2.9 0 0 1-2.9-2.9 2.9 2.9 0 0 1 2.9-2.9c.3 0 .5 0 .8.1V9.5a6.4 6.4 0 0 0-.8-.1 6.5 6.5 0 0 0-6.5 6.5 6.5 6.5 0 0 0 6.5 6.5 6.5 6.5 0 0 0 6.5-6.5V8.2a8.4 8.4 0 0 0 4.9 1.6V6.2a4.8 4.8 0 0 1-2.2-2.9z"/></svg>',
            'twitter'   => '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18.3 1.5h3.5L14.3 10l8.8 11.5H16l-5.2-6.8-6 6.8H1.3l8-9.2L1 1.5h7l4.7 6.2 5.6-6.2zm-1.2 18.5h1.9L7 3.4H5L17.1 20z"/></svg>',
            'pinterest' => '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12c0 5.1 3.2 9.5 7.8 11.2-.1-.9-.2-2.4.1-3.4.2-.8 1.5-6.5 1.5-6.5s-.4-.8-.4-1.9c0-1.8 1.1-3.2 2.4-3.2 1.1 0 1.7.8 1.7 1.8 0 1.1-.7 2.8-1 4.3-.3 1.3.6 2.3 1.8 2.3 2.1 0 3.6-2.3 3.6-5.5 0-2.9-2-4.9-4.9-4.9-3.3 0-5.3 2.5-5.3 5.1 0 1 .4 2.1.9 2.7.1.1.1.2.1.4-.1.4-.3 1.3-.3 1.5-.1.2-.2.3-.4.2-1.5-.7-2.4-2.9-2.4-4.7 0-3.8 2.8-7.4 8.1-7.4 4.2 0 7.5 3 7.5 7.1 0 4.2-2.6 7.6-6.3 7.6-1.2 0-2.4-.6-2.8-1.4l-.8 2.9c-.3 1-.9 2.2-1.4 3 1 .3 2.1.5 3.2.5 6.6 0 12-5.4 12-12C24 5.4 18.6 0 12 0z"/></svg>',
            'facebook'  => '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M24 12.1C24 5.4 18.6 0 12 0S0 5.4 0 12.1C0 18.1 4.4 23.1 10.1 24v-8.4H7.1v-3.5h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9v2.2h3.4l-.5 3.5H14V24C19.6 23.1 24 18.1 24 12.1z"/></svg>',
            'threads'   => '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12.2 2C7 2 3.7 5.5 3.7 10.5c0 3.3 1.4 5.8 3.8 7.2-.3.8-.4 1.7-.3 2.5.2 1.1.9 1.9 1.9 2.3.3.1.7.1 1 .1 1.3 0 2.6-.7 3.3-1.8.6.1 1.2.2 1.8.2 5.3 0 8.5-3.5 8.5-8.5S17.5 2 12.2 2z"/></svg>',
            'contact'   => '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>',
        ];
        return $svgs[$key] ?? '';
    }
}

/**
 * Render a single ad block (image or HTML) with optional label eyebrow.
 * Returns string; doesn't echo.
 */
if (!function_exists('mvp_affiliate_render_block')) {
    function mvp_affiliate_render_block(array $block): string {
        if (empty($block['enabled'])) return '';
        $type  = $block['type'] ?? 'image';
        $label = trim((string)($block['label'] ?? ''));

        $label_html = $label !== ''
            ? '<p class="mvp-ad-block-label">' . esc_html($label) . '</p>'
            : '';

        if ($type === 'image') {
            $img  = esc_url($block['imageUrl'] ?? '');
            $link = esc_url($block['linkUrl'] ?? '');
            if (!$img) return '';
            $out = '<div class="mvp-ad-block mvp-ad-image">' . $label_html;
            if ($link) $out .= '<a href="' . $link . '" target="_blank" rel="nofollow noopener">';
            $out .= '<img src="' . $img . '" alt="" loading="lazy" />';
            if ($link) $out .= '</a>';
            $out .= '</div>';
            return $out;
        }
        $html = $block['html'] ?? '';
        if (!$html) return '';
        return '<div class="mvp-ad-block mvp-ad-html">' . $label_html . $html . '</div>';
    }
}

/**
 * Homepage 3-up banner strip — always returns exactly 3 slots so the
 * theme template can iterate without bounds checks. Each slot has
 * imageUrl + linkUrl; an empty imageUrl means "render placeholder".
 */
if (!function_exists('mvp_affiliate_homepage_ads')) {
    function mvp_affiliate_homepage_ads(): array {
        // Use the theme's own accessor — NOT mvp_affiliate_get_data(), which
        // only exists in the companion plugin. When a site runs the theme
        // without the plugin active, mvp_affiliate_get_data() is undefined and
        // the homepage ad strip fatals (WSOD) while single posts still render.
        $d = mvp_affiliate_data();
        $raw = is_array($d['homepageAds'] ?? null) ? $d['homepageAds'] : [];
        $out = [];
        for ($i = 0; $i < 3; $i++) {
            $a = is_array($raw[$i] ?? null) ? $raw[$i] : [];
            $out[] = [
                'imageUrl' => is_string($a['imageUrl'] ?? null) ? $a['imageUrl'] : '',
                'linkUrl'  => is_string($a['linkUrl']  ?? null) ? $a['linkUrl']  : '',
            ];
        }
        return $out;
    }
}

/**
 * Newsletter (auto-embed).
 *
 * The MVP plugin pushes { enabled, userId, senderName } into the
 * `newsletter` key of affiliateos_customizations every time the creator
 * toggles the dashboard switch or saves Customize Blog. The theme reads
 * those fields here so it can render the signup form on the home page
 * AND in every blog-post sidebar — no shortcode pasting required.
 *
 * `mvp_affiliate_newsletter_enabled()`  → true only when the toggle is on
 *                                         AND we have a valid user id.
 * `mvp_affiliate_render_newsletter_inline($atts = [])`
 *     → returns the rendered HTML (via the plugin's render function) or
 *       '' when the newsletter isn't ready. Callers can echo unconditionally.
 *
 * Atts forwarded to the plugin renderer: title, subtitle, button (all
 * optional — sensible defaults inside the renderer).
 */
if (!function_exists('mvp_affiliate_newsletter_data')) {
    function mvp_affiliate_newsletter_data(): array {
        $d = mvp_affiliate_data();
        $n = is_array($d['newsletter'] ?? null) ? $d['newsletter'] : [];
        return [
            'enabled'     => !empty($n['enabled']),
            'userId'      => is_string($n['userId'] ?? null) ? trim($n['userId']) : '',
            'senderName'  => is_string($n['senderName'] ?? null) ? trim($n['senderName']) : '',
            // CTA copy overrides — empty string when the creator hasn't
            // customised; the placement-specific defaults below kick in.
            'ctaTitle'    => is_string($n['ctaTitle'] ?? null) ? trim($n['ctaTitle']) : '',
            'ctaSubtitle' => is_string($n['ctaSubtitle'] ?? null) ? trim($n['ctaSubtitle']) : '',
            'ctaButton'   => is_string($n['ctaButton'] ?? null) ? trim($n['ctaButton']) : '',
        ];
    }
}

if (!function_exists('mvp_affiliate_newsletter_enabled')) {
    function mvp_affiliate_newsletter_enabled(): bool {
        $n = mvp_affiliate_newsletter_data();
        return $n['enabled'] && preg_match('/^[0-9a-f-]{36}$/i', $n['userId']);
    }
}

if (!function_exists('mvp_affiliate_render_newsletter_inline')) {
    function mvp_affiliate_render_newsletter_inline(array $atts = []): string {
        if (!mvp_affiliate_newsletter_enabled()) return '';
        // The plugin's renderer is what actually draws the form. If the
        // plugin isn't active (theme-only install) we just don't render —
        // the option's presence guarantees the plugin was active at
        // least at customize-save time, but a deactivation could leave
        // stale data; better to silently skip than fatal.
        if (!function_exists('mvp_affiliate_render_newsletter_form')) return '';
        $n = mvp_affiliate_newsletter_data();

        // Resolve the copy in priority order:
        //   1. Caller atts (placement-specific in single.php / front-page.php)
        //   2. Creator's dashboard CTA overrides (cta_title etc.)
        //   3. Theme defaults
        // A non-empty value at any earlier tier short-circuits the rest.
        $default_title = $n['senderName']
            ? sprintf('Get the next %s review in your inbox', $n['senderName'])
            : 'Get the next review in your inbox';
        $title    = !empty($atts['title'])    ? $atts['title']    : ($n['ctaTitle']    ?: $default_title);
        $subtitle = !empty($atts['subtitle']) ? $atts['subtitle'] : ($n['ctaSubtitle'] ?: 'No spam. One short email when there’s a new post worth your time or when there are things you might have missed online.');
        $button   = !empty($atts['button'])   ? $atts['button']   : ($n['ctaButton']   ?: 'Subscribe');

        return mvp_affiliate_render_newsletter_form([
            'user_id'  => $n['userId'],
            'title'    => $title,
            'subtitle' => $subtitle,
            'button'   => $button,
        ]);
    }
}
