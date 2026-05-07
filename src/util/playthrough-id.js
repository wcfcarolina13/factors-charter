// Three vocabulary arrays for themed playthrough IDs. ~32 words each.
// Curated to fit the 1720s mercantile world. Don't reorder — IDs already in
// the wild can be regenerated from these lists, but only if the lists stay
// stable. New words can be APPENDED (existing IDs unaffected); reordering or
// removing entries is a breaking change.
const NOUNS = [
  'pelican', 'sloop', 'lagoon', 'harbor', 'lighthouse', 'anchor', 'sextant', 'compass',
  'lantern', 'godown', 'wharf', 'junk', 'brigantine', 'pinnace', 'schooner', 'packet',
  'clipper', 'galleon', 'mast', 'sail', 'hold', 'helm', 'ledger', 'manifest',
  'charter', 'voyage', 'monsoon', 'strait', 'atoll', 'cape', 'palm', 'cinnamon',
];

const MODIFIERS = [
  'salt', 'brass', 'leaden', 'weathered', 'sealed', 'dry', 'slow', 'plain',
  'tarred', 'brined', 'cured', 'smoke', 'oil', 'rust', 'mildew', 'wax',
  'bone', 'ivory', 'ebony', 'ink', 'parchment', 'leather', 'hemp', 'copper',
  'iron', 'pewter', 'faded', 'ragged', 'scrimshaw', 'ochre', 'indigo', 'sienna',
];

const MARITIME = [
  'pepper', 'calico', 'tobacco', 'opium', 'saltpetre', 'sandalwood', 'camphor', 'gambier',
  'ambergris', 'pearls', 'silver', 'rum', 'rice', 'teak', 'gunsmoke', 'gunpowder',
  'taffrail', 'capstan', 'shroud', 'halyard', 'gangway', 'bowsprit', 'transom', 'larboard',
  'leeward', 'fathom', 'league', 'bosun', 'lookout', 'chandler', 'topsail', 'foretop',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generates a themed three-word + four-digit playthrough ID, e.g.
// "pelican-salt-pepper-1923". Format is fixed and parsed by isValidPlaythroughId
// and by the server's request handler.
export function generatePlaythroughId() {
  const noun = pick(NOUNS);
  const mod = pick(MODIFIERS);
  const mar = pick(MARITIME);
  const digits = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${noun}-${mod}-${mar}-${digits}`;
}

const ID_PATTERN = /^[a-z]+-[a-z]+-[a-z]+-\d{4}$/;

// Format-only validation. We deliberately do NOT cross-check the wordlist:
// new words can be appended to the lists without breaking existing IDs in
// the wild, and the server has the same loose check. The 28-bit entropy
// space is the security gate, not the wordlist contents.
export function isValidPlaythroughId(s) {
  return typeof s === 'string' && ID_PATTERN.test(s);
}

export { NOUNS, MODIFIERS, MARITIME, ID_PATTERN };
