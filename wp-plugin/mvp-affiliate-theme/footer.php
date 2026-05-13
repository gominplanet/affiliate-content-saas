<?php if (!defined('ABSPATH')) exit;
$profile = mvp_affiliate_profile();
$footer  = mvp_affiliate_footer_data();
$bio     = mvp_affiliate_bio();
$author  = trim($profile['authorName'] ?? '');
$headshot = trim($profile['headshotUrl'] ?? '');
$socials = mvp_affiliate_socials();
$links   = is_array($footer['links'] ?? null) ? $footer['links'] : [];
$brand   = get_bloginfo('name');
$disclaimer = trim($profile['affiliateDisclaimer'] ?? '');
?>

<footer class="mvp-footer">
  <div class="mvp-container mvp-footer-grid">

    <?php if ($author || $bio || $headshot): ?>
    <div class="mvp-footer-col mvp-footer-author">
      <h3 class="mvp-footer-heading">About</h3>
      <div class="mvp-footer-author-card">
        <?php if ($headshot): ?>
        <img src="<?php echo esc_url($headshot); ?>" alt="<?php echo esc_attr($author); ?>" class="mvp-footer-headshot" loading="lazy" />
        <?php endif; ?>
        <?php if ($author): ?>
        <p class="mvp-footer-author-name"><?php echo esc_html($author); ?></p>
        <?php endif; ?>
        <?php if ($bio): ?>
        <p class="mvp-footer-author-bio"><?php echo esc_html($bio); ?></p>
        <?php endif; ?>
      </div>
    </div>
    <?php endif; ?>

    <?php
    $cats = get_categories(['number' => 6, 'orderby' => 'count', 'order' => 'DESC']);
    if (!empty($cats)): ?>
    <div class="mvp-footer-col">
      <h3 class="mvp-footer-heading">Categories</h3>
      <ul class="mvp-footer-list">
        <?php foreach ($cats as $cat): ?>
        <li><a href="<?php echo esc_url(get_category_link($cat->term_id)); ?>"><?php echo esc_html($cat->name); ?></a></li>
        <?php endforeach; ?>
      </ul>
    </div>
    <?php endif; ?>

    <?php if (!empty($socials)): ?>
    <div class="mvp-footer-col">
      <h3 class="mvp-footer-heading">Follow</h3>
      <div class="mvp-footer-socials">
        <?php foreach ($socials as $key => $url):
          $svg = mvp_affiliate_social_svg($key);
          if (!$svg) continue;
          $href = ($key === 'contact') ? 'mailto:' . antispambot($url) : esc_url($url);
          $target = ($key === 'contact') ? '_self' : '_blank';
        ?>
        <a href="<?php echo $href; ?>" target="<?php echo $target; ?>" rel="noopener" aria-label="<?php echo esc_attr(ucfirst($key)); ?>" class="mvp-footer-social">
          <?php echo $svg; ?>
        </a>
        <?php endforeach; ?>
      </div>
    </div>
    <?php endif; ?>

    <?php if (!empty($links) || has_nav_menu('footer')): ?>
    <div class="mvp-footer-col">
      <h3 class="mvp-footer-heading">Links</h3>
      <ul class="mvp-footer-list">
        <?php if (has_nav_menu('footer')) {
            wp_nav_menu([
                'theme_location' => 'footer',
                'container'      => false,
                'items_wrap'     => '%3$s',
                'walker'         => null,
                'depth'          => 1,
            ]);
        }
        foreach ($links as $link):
            if (empty($link['label']) || empty($link['url'])) continue;
        ?>
        <li><a href="<?php echo esc_url($link['url']); ?>"><?php echo esc_html($link['label']); ?></a></li>
        <?php endforeach; ?>
      </ul>
    </div>
    <?php endif; ?>

  </div>

  <?php if ($disclaimer): ?>
  <div class="mvp-footer-disclaimer">
    <div class="mvp-container">
      <p><?php echo esc_html($disclaimer); ?></p>
    </div>
  </div>
  <?php endif; ?>

  <div class="mvp-footer-bottom">
    <div class="mvp-container mvp-footer-bottom-inner">
      <p class="mvp-footer-copyright">© <?php echo esc_html(date('Y')); ?> <?php echo esc_html($brand); ?>. All rights reserved.</p>
    </div>
  </div>
</footer>

<?php wp_footer(); ?>
</body>
</html>
