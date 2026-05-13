<?php if (!defined('ABSPATH')) exit; ?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
  <meta charset="<?php bloginfo('charset'); ?>" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link rel="profile" href="https://gmpg.org/xfn/11" />
  <?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<?php
$about    = mvp_affiliate_about();
$profile  = mvp_affiliate_profile();
$logo_url = $about['logoUrl'] ?? '';
$bg       = ($about['headerBg'] ?? 'black') === 'white' ? '#ffffff' : '#000000';
$brand    = get_bloginfo('name');
$socials  = mvp_affiliate_socials();
$disclaimer = trim($profile['affiliateDisclaimer'] ?? '');
if ($disclaimer === '') {
    $disclaimer = 'This site contains affiliate links. We may earn a commission on purchases made through links on this site, at no extra cost to you.';
}
?>

<!-- Utility bar: disclaimer + socials -->
<div class="mvp-utilitybar">
  <div class="mvp-container mvp-utilitybar-inner">
    <p class="mvp-utilitybar-disclaimer"><?php echo esc_html($disclaimer); ?></p>
    <?php if (!empty($socials)): ?>
    <div class="mvp-utilitybar-socials">
      <?php foreach ($socials as $key => $url):
        $svg = mvp_affiliate_social_svg($key);
        if (!$svg) continue;
        $href = ($key === 'contact') ? 'mailto:' . antispambot($url) : esc_url($url);
        $target = ($key === 'contact') ? '_self' : '_blank';
      ?>
      <a href="<?php echo $href; ?>" target="<?php echo $target; ?>" rel="noopener" aria-label="<?php echo esc_attr(ucfirst($key)); ?>" class="mvp-utilitybar-social">
        <?php echo $svg; ?>
      </a>
      <?php endforeach; ?>
    </div>
    <?php endif; ?>
  </div>
</div>

<!-- Logo banner -->
<?php if ($logo_url): ?>
<div class="mvp-logobanner" style="background:<?php echo $bg; ?>;">
  <a href="<?php echo esc_url(home_url('/')); ?>" class="mvp-logobanner-link" aria-label="<?php echo esc_attr($brand); ?>">
    <img src="<?php echo esc_url($logo_url); ?>" alt="<?php echo esc_attr($brand); ?>" class="mvp-logobanner-img" />
  </a>
</div>
<?php endif; ?>

<!-- Main header -->
<header class="mvp-header">
  <div class="mvp-container mvp-header-inner">
    <a href="<?php echo esc_url(home_url('/')); ?>" class="mvp-header-brand">
      <span class="mvp-header-title"><?php echo esc_html($brand); ?></span>
      <?php $tagline = get_bloginfo('description'); if ($tagline): ?>
      <span class="mvp-header-tagline"><?php echo esc_html($tagline); ?></span>
      <?php endif; ?>
    </a>

    <nav class="mvp-header-nav" aria-label="<?php esc_attr_e('Primary', 'mvp-affiliate'); ?>">
      <?php
      if (has_nav_menu('primary')) {
          wp_nav_menu([
              'theme_location' => 'primary',
              'container'      => false,
              'menu_class'     => 'mvp-nav-menu',
              'depth'          => 2,
          ]);
      } else {
          // Fallback: list categories
          wp_list_categories([
              'title_li' => '',
              'orderby'  => 'count',
              'order'    => 'DESC',
              'number'   => 5,
          ]);
      }
      ?>
    </nav>

    <button class="mvp-header-search-toggle" aria-label="<?php esc_attr_e('Toggle search', 'mvp-affiliate'); ?>" type="button" data-mvp-search-toggle>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-3.5-3.5"/></svg>
    </button>

    <button class="mvp-header-menu-toggle" aria-label="<?php esc_attr_e('Toggle menu', 'mvp-affiliate'); ?>" type="button" data-mvp-menu-toggle>
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
  </div>

  <!-- Search drawer -->
  <div class="mvp-header-search" data-mvp-search hidden>
    <div class="mvp-container">
      <?php get_search_form(); ?>
    </div>
  </div>
</header>
