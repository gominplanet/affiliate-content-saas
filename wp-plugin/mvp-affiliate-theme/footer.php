<?php if (!defined('ABSPATH')) exit;
$profile = mvp_affiliate_profile();
$footer  = mvp_affiliate_footer_data();
$about   = mvp_affiliate_about();
$bio     = mvp_affiliate_bio();
$author  = trim($profile['authorName'] ?? '');
$headshot = trim($profile['headshotUrl'] ?? '');
$socials = mvp_affiliate_socials();
$links   = is_array($footer['links'] ?? null) ? $footer['links'] : [];
$brand   = get_bloginfo('name');
$logo_url = trim($about['logoUrl'] ?? '');
$disclaimer = trim($profile['affiliateDisclaimer'] ?? '');
?>

<?php if ($author || $bio || $headshot): ?>
<section class="mvp-about-band">
  <div class="mvp-container mvp-about-inner">
    <?php if ($headshot): ?>
    <img src="<?php echo esc_url($headshot); ?>" alt="<?php echo esc_attr($author); ?>" class="mvp-about-headshot" loading="lazy" />
    <?php endif; ?>
    <div class="mvp-about-text">
      <p class="mvp-about-eyebrow">About us</p>
      <?php if ($author): ?>
      <h2 class="mvp-about-name"><?php echo esc_html($author); ?></h2>
      <?php endif; ?>
      <?php if ($bio):
        // Collapse everything from "How we got here" onward behind a
        // Read more toggle. If that marker isn't in the bio (user edited
        // it), fall back to showing the whole thing — no broken state.
        $marker = 'How we got here';
        $pos = stripos($bio, $marker);
        $intro = ($pos !== false && $pos > 0) ? trim(substr($bio, 0, $pos)) : $bio;
        $rest  = ($pos !== false && $pos > 0) ? trim(substr($bio, $pos)) : '';
      ?>
      <div class="mvp-about-bio">
        <div class="mvp-about-bio-intro"><?php echo nl2br(esc_html($intro)); ?></div>
        <?php if ($rest !== ''): ?>
        <div class="mvp-about-bio-rest" hidden><?php echo nl2br(esc_html($rest)); ?></div>
        <button type="button" class="mvp-about-readmore" aria-expanded="false">Read more</button>
        <?php endif; ?>
      </div>
      <?php endif; ?>
    </div>
  </div>
</section>
<?php endif; ?>

<footer class="mvp-footer">
  <div class="mvp-container mvp-footer-grid">

    <?php
    // 2026-06-09: bumped from 6 → 15, added hide_empty + exclude
    // Uncategorized. The hard cap of 6 was cutting off legitimate
    // categories the top nav was already showing (e.g. Travel &
    // Luggage). 15 covers any realistic niche set without sprawling
    // the footer visually; the list flexes vertically if a site
    // genuinely has more categories.
    $uncat_id = (int) get_option('default_category', 0);
    $cats = get_categories([
        'number'     => 15,
        'orderby'    => 'count',
        'order'      => 'DESC',
        'hide_empty' => true,
        'exclude'    => $uncat_id ? [$uncat_id] : [],
    ]);
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
      <?php if ($logo_url): ?>
      <a href="<?php echo esc_url(home_url('/')); ?>" class="mvp-footer-logo-link" aria-label="<?php echo esc_attr($brand); ?>">
        <img src="<?php echo esc_url($logo_url); ?>" alt="<?php echo esc_attr($brand); ?>" class="mvp-footer-logo" loading="lazy" />
      </a>
      <?php endif; ?>
      <p class="mvp-footer-copyright">© <?php echo esc_html(date('Y')); ?> <?php echo esc_html($brand); ?>. All rights reserved.</p>
    </div>
  </div>
</footer>

<?php wp_footer(); ?>
</body>
</html>
