<?php if (!defined('ABSPATH')) exit;
get_header();
?>
<main class="mvp-main mvp-page">
  <div class="mvp-container mvp-page-inner">
    <?php while (have_posts()): the_post(); ?>
    <article class="mvp-page-article">
      <header class="mvp-page-header">
        <h1 class="mvp-page-title"><?php the_title(); ?></h1>
      </header>
      <div class="mvp-page-body">
        <?php the_content(); ?>
      </div>
    </article>
    <?php endwhile; ?>
  </div>
</main>
<?php get_footer();
