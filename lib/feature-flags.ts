/**
 * Runtime feature flags.
 *
 * metaEnabled — gates ALL Meta-owned integrations (Instagram, Threads,
 * Facebook Pages): the connect/OAuth flows, the publish routes, the Instagram
 * Burner, and the social pills in Library & Social Push. While the Meta app is
 * pending App Review + Business Verification we keep these hidden from users so
 * nobody hits an unauthorized/broken flow.
 *
 * Controlled by NEXT_PUBLIC_META_ENABLED (readable on both client and server).
 * Defaults to ENABLED when unset — set it to the string "false" in the
 * environment to turn every Meta surface off. Flip back to "true" (or remove)
 * once the app is approved and Live; no code change required.
 */
export function metaEnabled(): boolean {
  return process.env.NEXT_PUBLIC_META_ENABLED !== 'false'
}
