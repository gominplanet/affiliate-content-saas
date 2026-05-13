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
 * Merged socials: footer.socials wins; falls back to profile.{socialUrl} keys.
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
            if (empty($socials[$key]) && !empty($profile[$profileKey])) {
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
 * Render a single ad block (image or HTML). Returns string; doesn't echo.
 */
if (!function_exists('mvp_affiliate_render_block')) {
    function mvp_affiliate_render_block(array $block): string {
        if (empty($block['enabled'])) return '';
        $type = $block['type'] ?? 'image';
        if ($type === 'image') {
            $img  = esc_url($block['imageUrl'] ?? '');
            $link = esc_url($block['linkUrl'] ?? '');
            if (!$img) return '';
            $out = '<div class="mvp-ad-block mvp-ad-image">';
            if ($link) $out .= '<a href="' . $link . '" target="_blank" rel="nofollow noopener">';
            $out .= '<img src="' . $img . '" alt="" loading="lazy" />';
            if ($link) $out .= '</a>';
            $out .= '</div>';
            return $out;
        }
        $html = $block['html'] ?? '';
        if (!$html) return '';
        return '<div class="mvp-ad-block mvp-ad-html">' . $html . '</div>';
    }
}
