# WORLD_NOTES.md — Bradley's notebook for The Factor's Charter

A living scratch-pad for world-building, lore, place names, atmospheric
touchstones, and historical inspirations to be folded into the game. **Not
runtime code.** This file is feedstock — Claude reads it before any session
that touches narrative or new content, then translates entries into the
appropriate code: `LORE` entries, new ports, encounter seeds, new senders
for the auto-letter pool, building blurbs.

You append. I translate. We commit both files together.

---

## How to use this file

When you have an idea — a trip, a book, a thought, a name you like, a piece
of history — drop it in the right section below. Don't worry about format.
Two sentences is fine. A paragraph is fine. A bullet list is fine.

When the next session starts, I'll read this file in full and decide which
entries are ready to land in code. If something needs clarification I'll
ask before committing.

**Important:** real-world places, people, and dates are *inspirations*, not
literal entries. The game's geography is a vaguely Southeast-Asian colonial
frontier in the early 1720s — Bayan-Kor, Kota Pinang, Port St. Eustace, the
Pelican's Nest, Tanjung Cermin. When a real-world reference doesn't fit that
geography, I transpose the *spirit* of it: the Bacalar pirate-bay history
became Tanjung Cermin (a Bugis-coded SE-Asian lagoon with a ruined
Portuguese fort), not "Bacalar Lagoon" in the Caribbean.

---

## TONE TOUCHSTONES

Things that feel right in this world. Add to this list when you encounter a
voice / image / detail that captures the tone you want.

- Robinson Crusoe's journal voice — first-person, dry, period.
- Sunless Sea atmosphere — slight melancholy, dark humour, prose-driven.
- Morrowind's House Hlaalu / East Empire Company storyline — mercantile
  bureaucracy, faction politics, a bored clerk in a hostile climate.
- 1720s logbook aesthetic — leather, sealing wax, Garamond.
- Concrete sensory detail (heat, salt, mildew, palm oil, gunsmoke). No
  metaphors when a named thing will do.

## ANTI-PATTERNS

What we do NOT want.

- "okay", "literally", "just" — modern idiom of any flavour.
- More than one metaphor per passage.
- Generic fantasy ("a strange figure approached"). Always specific.
- The AI inventing characters that duplicate Hodge / Dass / Vizier / Pyke
  outside Bayan-Kor.

---

## INSPIRATIONS LANDED

Real-world references that have already been translated into game content.
Cross-reference with the LORE registry in `factors_charter.jsx`.

### Bacalar (Yucatan) → Tanjung Cermin

- **Inspiration:** the Bacalar pirate-bay history. Mayan town "Bakhalal"
  sacked by English pirates in 1648; sacked again in 1652 by Diego "el
  Mulato" with seven ships, who held the town for years; "Lagoon of Seven
  Colors" for the bands of natural blue water; Spanish built Fort San Felipe
  de Bacalar 1727–33 specifically to defend against the pirates.
- **Transposition:** Tanjung Cermin (Malay: "Cape of Mirrors") — a deep
  lagoon further east than the Pelican's Nest, with seven distinct shades of
  blue, gated on pirates standing ≥ +25 AND having visited the Pelican's
  Nest. The ruined fort is Portuguese (period-plausible — Malacca fell to
  the Dutch in 1641 and Iberian outposts in the region went dark). The
  Brotherhood meets in its old chapel each monsoon to settle accounts.
- **In code:** `PORTS['Tanjung Cermin']`, `LORE` entry keyed
  `tanjung-cermin`.

### VOC private trade passes → Dutch trade pass

- **Inspiration:** the VOC was protectionist on paper but their factors at
  Asian outposts privately granted "passes of free trade" to selected
  English Company servants in exchange for tribute, errands, or discretion.
  These were not transacted in the open ledger. They halved (or eliminated)
  the duty levied at Dutch ports for the holder.
- **Transposition:** a one-time letter from Mynheer Hendrik Boom, Junior
  Factor at Port St. Eustace, after the player has put into Eustace and
  Dutch standing is ≥ −10. Three responses: pay £250 tribute, take a
  sealed Dutch packet to deliver east (small Brotherhood cost, plants a
  hook), or decline. Holding the pass halves the Dutch duty regardless of
  standing — standing is now the fine-tuning layer on top of pass/no-pass.
- **In code:** `makeDutchPassLetter` + trigger in `tickDays`,
  `portTaxRate` halves when `gs.flags.dutchTradePass` is set, the duty
  banner in PortView surfaces "Yr. writ of free trade is honoured here."
  when held.

---

## INSPIRATIONS PENDING

Drop in things you've encountered that haven't been folded into the game
yet. I'll work through these on the next session that touches narrative.

*(empty — append below)*

---

## NAMES YOU LIKE

Period-plausible names worth keeping in the bank for future characters,
ships, places. I'll pick from here when generating new content.

*(empty — append below)*

---

## OPEN HOOKS (in plain English)

Threads currently live in the world that the AI should be aware of and
might pull on. Update when a hook gets resolved or a new one emerges.

- The inland teak concession — resolved as a one-time letter event;
  player's choice (Company / Dutch / decline) sets `gs.flags.teakConcession`.
- The Brotherhood's nature — Wilbraham's papers and the Director's letter
  both hint at something organised. Player can ask the Court (slow reply)
  or earn it through pirate standing.
- Wilbraham's death — fever in the wet season, no inquest. The papers and
  Hodge's loyalty both point at this. Could become a real thread (was it
  the Vizier? was it ter Borch? was it just the climate?).

---

## TODO / OPEN QUESTIONS

Things we've discussed but haven't built yet.

- **The Dutch packet** — if the player took option 2 from Boom's letter
  (`carryingDutchPacket: true`), the recipient and consequence are still
  pending. Likely fires on a voyage east (toward the Pelican's Nest or
  Tanjung Cermin) — an encounter where a Bugis or Brotherhood figure
  asks after "the Dutchman's papers" and the player decides what to do
  with the packet's contents.
- **Port arrival encounters** — interactive moment at the wharf on some
  arrivals (alongside the existing first-visit vignettes). Could be a
  touch point for mail delivery too.
- **Bigger ship beyond the brigantine** — eventually the Factor might
  command a small ship-rigged trader (~300cwt, deep voyages). Late-charter
  reward.
- **A second commodity quota** or **a Director-imposed embargo** — gives
  late-game tension once the brigantine makes the original quota easy.
