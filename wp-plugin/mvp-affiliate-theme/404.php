<?php if (!defined('ABSPATH')) exit;
get_header();
?>
<main class="mvp-main mvp-404">
  <div class="mvp-container mvp-404-inner">
    <p class="mvp-404-eyebrow">404</p>
    <h1 class="mvp-404-title">Page not found</h1>
    <p class="mvp-404-text">The page you're looking for doesn't exist or has been moved.</p>
    <div class="mvp-404-actions">
      <a href="<?php echo esc_url(home_url('/')); ?>" class="mvp-button">← Back to homepage</a>
    </div>
    <div class="mvp-404-search">
      <h2 class="mvp-404-search-heading">Try searching:</h2>
      <?php get_search_form(); ?>
    </div>
  </div>
</main>
<?php get_footer();
