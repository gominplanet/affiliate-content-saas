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
  'NO BRANDS, LOGOS, OR COPYRIGHT TEXT: Do NOT render, add, invent, or overlay any retailer or marketplace names or logos (especially "Amazon", "Amazon Prime", "Prime", "Walmart", "eBay", "Best Buy", "Target", "AliExpress"), any company/store/app logos or icons, any watermarks, any copyright (©) / trademark (™ ®) symbols, any price tags or badges, and any extraneous signage or text of any kind anywhere in the image. The only branding allowed is what is physically printed on the actual product itself; never add brand text or logos to the background, surfaces, packaging, or as an overlay.'
