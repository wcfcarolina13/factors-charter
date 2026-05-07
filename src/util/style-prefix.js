// Single source of truth for the image-generation style prefix used by both
// the illustration cache (src/util/illustration-cache.js) and the modal
// fallback path (factors_charter.jsx IllustrationModal). These two
// consumers MUST produce byte-identical Pollinations URLs for the same
// prose, otherwise cache hits and on-demand generations diverge — same
// scene, different image. Importing this constant in both places enforces
// it; updates land in one place.
export const STYLE_PREFIX = '1720s logbook engraving, period woodcut style, sepia line illustration, single-color brown ink on cream parchment, period 18th century book illustration. ';
