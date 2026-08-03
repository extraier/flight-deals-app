<?php
// WP Code Snippet — Comparetiger custom sitemap + robots via WP REST.
// Install via Code Snippets plugin → Add New → paste this → set scope=front-end → save & activate.
// Equivalent REST: POST /wp-json/code-snippets/v1/snippets with {code, active: true, scope: 'front-end'}.
//
/*
  Endpoint URLs (Synology nginx intercepts /sitemap.xml and /robots.txt
  with static 404, so we use the WP REST query-string form):

    Full sitemap:  https://comparetiger.com/?rest_route=/comparetiger/v1/comparetiger/v1/sitemap
    News sitemap:  https://comparetiger.com/?rest_route=/comparetiger/v1/comparetiger/v1/sitemap_news
    Robots.txt:    https://comparetiger.com/?rest_route=/comparetiger/v1/comparetiger/v1/robots

  Submit these to Google Search Console manually:
    1. https://search.google.com/search-console/sitemaps
    2. Add a new sitemap: paste the URL above

  The double /comparetiger/v1/ in the URL is because Code Snippets nests
  register_rest_route() under its own namespace. The actual route is
  registered as /comparetiger/v1/comparetiger/v1/<endpoint>.
*/

<?php
/**
 * Comparetiger custom sitemap + robots via WP REST API.
 *
 * Hermes 2026-08-03 (rev 3): The Synology nginx config intercepts all
 * /sitemap.xml and /robots.txt requests with a static 404 page — they
 * never reach PHP. We can't override nginx without root access.
 *
 * Workaround: expose the sitemap via a WP REST endpoint, which DOES
 * go through PHP because it's served by index.php. The endpoints are:
 *
 *   /wp-json/comparetiger/v1/sitemap         — full sitemap (1000 posts)
 *   /wp-json/comparetiger/v1/sitemap_news    — Google News sitemap (48h)
 *   /wp-json/comparetiger/v1/robots          — robots.txt content
 *
 * Then we submit the sitemap URL directly to Google Search Console
 * (which accepts ANY URL, not just /sitemap.xml at root).
 *
 * Alternatively, the page-level workaround would be to create a WP
 * page with a slug like `sitemap-comparetiger` and use a custom template.
 * But REST endpoints are lighter and don't pollute the page tree.
 */

add_action('rest_api_init', function () {
    $routes = [
        '/comparetiger/v1/sitemap'      => 'ct_rest_sitemap',
        '/comparetiger/v1/sitemap_news' => 'ct_rest_news_sitemap',
        '/comparetiger/v1/robots'       => 'ct_rest_robots',
    ];
    foreach ($routes as $route => $callback) {
        register_rest_route('comparetiger/v1', $route, [
            'methods'  => 'GET',
            'permission_callback' => '__return_true',
            'callback' => $callback,
        ]);
    }
});

function ct_rest_sitemap() {
    $urls = [];
    $urls[] = [
        'loc'        => home_url('/'),
        'lastmod'    => gmdate('Y-m-d\TH:i:s\Z'),
        'changefreq' => 'daily',
        'priority'   => '1.0',
    ];
    $cats = get_categories(['hide_empty' => true]);
    foreach ($cats as $cat) {
        $urls[] = [
            'loc'        => get_category_link($cat->term_id),
            'lastmod'    => gmdate('Y-m-d\TH:i:s\Z'),
            'changefreq' => 'daily',
            'priority'   => '0.7',
        ];
    }
    $posts = get_posts([
        'post_type'      => 'post',
        'post_status'    => 'publish',
        'posts_per_page' => 1000,
        'orderby'        => 'date',
        'order'          => 'DESC',
    ]);
    foreach ($posts as $p) {
        $urls[] = [
            'loc'        => get_permalink($p->ID),
            'lastmod'    => mysql2date('Y-m-d\TH:i:s\Z', $p->post_date_gmt),
            'changefreq' => 'weekly',
            'priority'   => '0.8',
        ];
    }
    $pages = get_pages(['post_status' => 'publish']);
    foreach ($pages as $p) {
        $urls[] = [
            'loc'        => get_permalink($p->ID),
            'lastmod'    => mysql2date('Y-m-d\TH:i:s\Z', $p->post_date_gmt),
            'changefreq' => 'monthly',
            'priority'   => '0.6',
        ];
    }

    $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
    $xml .= '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
    foreach ($urls as $u) {
        $xml .= "  <url>\n";
        $xml .= "    <loc>" . esc_url($u['loc']) . "</loc>\n";
        $xml .= "    <lastmod>{$u['lastmod']}</lastmod>\n";
        $xml .= "    <changefreq>{$u['changefreq']}</changefreq>\n";
        $xml .= "    <priority>{$u['priority']}</priority>\n";
        $xml .= "  </url>\n";
    }
    $xml .= "</urlset>\n";

    return new WP_REST_Response($xml, 200, [
        'Content-Type' => 'application/xml; charset=utf-8',
    ]);
}

function ct_rest_news_sitemap() {
    $since = gmdate('Y-m-d H:i:s', time() - 48 * HOUR_IN_SECONDS);
    $posts = get_posts([
        'post_type'      => 'post',
        'post_status'    => 'publish',
        'posts_per_page' => 1000,
        'category__in'   => [1023],
        'date_query'     => [['after' => $since, 'inclusive' => true]],
        'orderby'        => 'date',
        'order'          => 'DESC',
    ]);
    $lang = get_bloginfo('language');
    $sitename = get_bloginfo('name');

    $xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
    $xml .= '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">' . "\n";
    foreach ($posts as $p) {
        $title = wp_strip_all_tags($p->post_title);
        $xml .= "  <url>\n";
        $xml .= "    <loc>" . esc_url(get_permalink($p->ID)) . "</loc>\n";
        $xml .= "    <news:news>\n";
        $xml .= "      <news:publication>\n";
        $xml .= "        <news:name>" . esc_html($sitename) . "</news:name>\n";
        $xml .= "        <news:language>" . esc_html($lang) . "</news:language>\n";
        $xml .= "      </news:publication>\n";
        $xml .= "      <news:publication_date>" . mysql2date('Y-m-d\TH:i:s\Z', $p->post_date_gmt) . "</news:publication_date>\n";
        $xml .= "      <news:title>" . esc_html($title) . "</news:title>\n";
        $xml .= "    </news:news>\n";
        $xml .= "  </url>\n";
    }
    $xml .= "</urlset>\n";

    return new WP_REST_Response($xml, 200, [
        'Content-Type' => 'application/xml; charset=utf-8',
    ]);
}

function ct_rest_robots() {
    $sitemap = home_url('/wp-json/comparetiger/v1/sitemap');
    $news = home_url('/wp-json/comparetiger/v1/sitemap_news');
    $txt = "User-agent: *\n";
    $txt .= "Allow: /\n";
    $txt .= "Disallow: /wp-admin/\n";
    $txt .= "Disallow: /wp-json/\n";
    $txt .= "Disallow: /?s=\n";
    $txt .= "Disallow: /search/\n";
    $txt .= "Disallow: /cart/\n";
    $txt .= "Disallow: /checkout/\n";
    $txt .= "Disallow: /my-account/\n";
    $txt .= "\n";
    $txt .= "Sitemap: $sitemap\n";
    $txt .= "Sitemap: $news\n";
    return new WP_REST_Response($txt, 200, [
        'Content-Type' => 'text/plain; charset=utf-8',
    ]);
}
