/**
 * Shared negative-prompt clause for ALL AI image generation (thumbnails, pins,
 * Instagram, blog body images).
 *
 * Goal: never bake retailer/marketplace branding (especially "Amazon"), real
 * company logos, watermarks, copyright/trademark symbols, or invented signage
 * into a generated image — both for a clean look and to avoid trademark /
 * platform-policy issues. The product's OWN physical branding on a real
 * product photo is acceptable (it's the item being reviewed); what we forbid
 * is the model ADDING or INVENTING marketplace names, store logos, price tags,
 * watermarks, or any extraneous text.
 */
export const NO_BRAND_IMAGE_CLAUSE =
  'NO RETAILER LOGOS, NO INVENTED BRANDS, NO MARKETING COPY: Do NOT render, add, invent or overlay any retailer / marketplace names or logos (especially "Amazon", "Amazon Prime", "Prime", "Walmart", "eBay", "Best Buy", "Target", "AliExpress"), any store/app icons, any watermarks, any copyright (©) / trademark (™ ®) symbols, any price tags or badges, or any extraneous signage or text in the background or on surfaces. Do NOT reproduce retail PACKAGING or marketing-infographic copy — no printed feature lists, claims, percentages, ratings, warranty/award badges, or size charts. KEEP the product\'s OWN branding intact: its real brand mark, product name, and any label/text physically printed on the product itself (the bottle, the box face, the device, the cap) ARE the item being reviewed — render them faithfully so the product is recognisable. The simple rule: keep what\'s physically on the real product; add nothing else.'
