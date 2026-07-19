// Deep links into a user's OWN Search Console reports.
//
// Sending someone to search.google.com/search-console means they land on
// whatever property Google picks and have to navigate to the report — a fair
// amount of friction for a step that's usually just "go read this one page".
// With their verified property string we can drop them straight on it.
//
// Search Console wants the resource_id's colons and slashes left intact, so
// encodeURIComponent then put those two back. Both property shapes work:
//   URL-prefix  → https://example.com/
//   domain      → sc-domain:example.com

const CONSOLE_ROOT = 'https://search.google.com/search-console'

/** Encode a property for use as a Search Console `resource_id`. */
export function gscResourceId(property: string): string {
  return encodeURIComponent(property).replace(/%3A/gi, ':').replace(/%2F/gi, '/')
}

function report(path: string, property: string | null | undefined): string {
  if (!property) return CONSOLE_ROOT
  return `${CONSOLE_ROOT}${path}?resource_id=${gscResourceId(property)}`
}

/** Sitemaps report — where you submit wp-sitemap.xml. */
export const gscSitemapsUrl = (property: string | null | undefined): string =>
  report('/sitemaps', property)

/** Page indexing report — coverage, and the "Not found (404)" list underneath it. */
export const gscPageIndexingUrl = (property: string | null | undefined): string =>
  report('/index', property)
