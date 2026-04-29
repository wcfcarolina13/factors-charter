# HANDOFF — The Factor's Charter

**Date:** 2026-04-28
**For:** Bradley (or a fresh Claude session) resuming this branch
**Branch:** `claude/port-storage-defense-JFty8`
**Status:** Working prototype, late-stage iteration. Many features shipped this branch; playtest still pending.

---

## How to resume

1. Read `CLAUDE.md` (project charter, conventions, pitfalls) and `WORLD_NOTES.md` (lore feedstock — required before any narrative work).
2. The full source is in `factors_charter.jsx` at the repo root. Run the parser sanity check below before editing.
3. Check `WORLD_NOTES.md` "INSPIRATIONS PENDING" for anything Bradley has appended that hasn't been folded into code yet — that's the first translation pass.
4. `CHANGELOG.md` "Session 8" lists everything shipped on this branch in detail.

---

## What's in the world right now

### Geography (5 ports)
- **Bayan-Kor** (home, Rajah ground): trading + outpost + slipway
- **Kota Pinang** (Sultanate, 3 days): pepper / cinnamon source
- **Port St. Eustace** (Dutch, 5 days): buys pepper/cinnamon at premium, levies duty
- **The Pelican's Nest** (pirates, 7 days): silver/opium/saltpetre, gated on pirates ≥ +10
- **Tanjung Cermin** (pirates, 14 days): deep haven, gated on pirates ≥ +25 AND visited Pelican's Nest. Off the chart until then.

### Named NPCs
**Home-station** (only appear at Bayan-Kor or via correspondence):
- Mr. Hodge — clerk, drunkard, sobriety/loyalty tracked
- Sgt. Dass — sepoy, loyalty/morale/health tracked
- The Rajah's Vizier — friendliness/scheming tracked
- Reverend Pyke — at the Mission

**External / faction figures** (introduced through one-off scripted letters):
- Mynheer Hendrik Boom — Junior Dutch Factor at Eustace (trade pass)
- Capt. Gerrit Maas — Bugis-Dutch Brotherhood captain (compact)
- Capt. Edward Whitcombe — RN, HMS Adventure (Crown service)
- Daeng Mamping — Sultan's Bugis harbourmaster at Kota Pinang (LORE only)

### Mechanics shipped this branch
- **Godown** (port-side storage at home, 120 cwt base, +400 with Great Godown)
- **Powder Magazine** (caps raid losses)
- **Indiaman cycle** (every 180 days, 6 visits) with AI-aware Director letters
- **Quarterly Director nags** between visits
- **Charter end** at day 0 with three outcome variants
- **The Brigantine** (180 cwt teak ship, commissioned at Bayan-Kor, £900 / £600 with teak concession)
- **Five faction one-off letters** (Vizier teak, Boom Dutch pass, Pyke school, Maas compact, Whitcombe Crown)
- **Brotherhood compact** halves voyage encounter chance
- **Dutch port duty** with pass-held bypass
- **Scripted arrival encounters** (first: Dutch packet payoff)
- **Auto-delivered correspondence** from a gated, weighted sender pool (~one letter per 30–55 days)
- **LORE registry** + **WORLD_NOTES.md** scaffold for lore-by-trigger
- **Multi-save slots** with title roster
- **Header HUD** showing godown capacity and quota progress always
- **Raid event** + **raid-as-scene** on return home
- **AI quota awareness** in `stateContext`

---

## How to add new content

### A new piece of lore
1. Add to `WORLD_NOTES.md` "INSPIRATIONS PENDING" first (Bradley's notebook).
2. Translate to code: a `LORE` entry in `factors_charter.jsx` (text 2–4 short sentences, with a `trigger` matching when it should surface).
3. If it warrants a port: add to `PORTS`. If a sender: add to `AUTO_SENDERS`. If an event: add a `make…Letter()` helper + a trigger in `tickDays`.
4. Promote from PENDING to LANDED in `WORLD_NOTES.md` with cross-refs.

### A new faction one-off (the established pattern)
Mirror `makeTeakConcessionLetter` / `makeDutchPassLetter` / `makePykeSchoolLetter` / `makeBrotherhoodLetter` / `makeCrownLetter`:
- A top-level helper that returns a letter object with three response choices, each carrying a `fixedOutcome: { prose, changes }`.
- A trigger in `tickDays` gated on `!s.charterClosed && !s.flags?.{nameOfLetterSent}` plus the faction's standing/visit conditions.
- The letter response goes through `handleLetterResponse`, which detects `fixedOutcome` and skips the AI call.

### A new scripted arrival encounter
Add to `SCRIPTED_ARRIVALS` registry. Trigger keys: `flag`, `location`, `locationIn`, `repAtLeast`, `visited`. Each choice has `prose` + `changes` shape. The `ScriptedArrivalScreen` renders automatically.

### A new ship type
Add to `SHIP_TYPES` (holdCwt, blurb, wearMin/Max, voyageBonus). The Commission flow currently only supports brigantine; would need extension for a third ship.

---

## Open threads (pending, in WORLD_NOTES.md detail)

- **The opened-packet ledger** — if the Factor read Boom's seal, a Dutch ledger of English-pirate dealings is in their head. Hook plants but no payoff yet. Could become a Director letter ("we hear you saw something at Eustace").
- **The jettisoned-packet retaliation** — Boom won't forget. Could become a follow-up Dutch letter, a denied service at Eustace, or a hostile encounter.
- **Mail-by-port** — currently letters arrive on time-only schedule. Could deliver some letters via specific ports (Faulke at Kota Pinang, etc.) for atmosphere.
- **Pyke's school children** — the generous subscription plants a hook for one of the children to grow into a recurring household figure.
- **Bigger ship beyond brigantine** — late-charter ship-rigged trader (~300 cwt). Deferred.
- **Second commodity quota / Director embargo** — late-game tension when the original quota is met early. Deferred.

---

## What was tabled or removed

### Disabled but present in code
- **GitHub backup** (`ENABLE_GITHUB_BACKUP = false`). The Claude artifact iframe's CSP blocks `api.github.com`; every push fails with "Failed to fetch". All code (`GithubBackupModal`, `pushFileToGitHub`, config helpers) left intact for when the game runs outside Claude. Flip the flag to true when that happens.

### Removed
- The manual `Await the post` button in the Letters tab.
- The marginalia `Conjure a letter` button.
- The in-game `Begin anew` button (replaced by Return to Title → Begin a New Charter on the title screen, which never overwrites).

---

## Conventions

### Save shape evolution
`ensureShape(gs)` is the migration funnel. Add new fields here as `if (!next.X) next.X = default`. Old saves load and gain the new shape transparently. Don't ever rely on a field being present without going through `ensureShape` on load.

### Flags discipline (per the system prompt's PROSE DISCIPLINE block)
- One flag per fact. No paired keys for the same truth.
- Only set a flag a later scene could plausibly read.
- Don't proliferate orphans.

### Hooks discipline
- Before adding a new hook, look at open threads. Refine an existing thread (leave hook empty) before parallel-tracking.

### Letter ID ranges (to avoid collisions)
- 1–999: hand-seeded letters
- 1,000,000+: Indiaman letters
- 2,000,000+: teak concession
- 3,000,000+: quarterly nags
- 4,000,000+: Dutch trade pass
- 5,000,000+: charter end
- 6,000,000+: Pyke school
- 7,000,000+: Brotherhood compact
- 8,000,000+: Crown service
- Auto-letter (genLetter) and arbitrary new IDs use seed-based unique values

---

## Useful diagnostic commands

```bash
# Sanity check the file parses
node -e "const p=require('/tmp/node_modules/@babel/parser'); const fs=require('fs'); const c=fs.readFileSync('/home/user/hello-world/factors_charter.jsx','utf8'); try { p.parse(c,{sourceType:'module',plugins:['jsx']}); console.log('OK',c.split('\n').length,'lines'); } catch(e) { console.log('ERR:',e.message); }"

# Find all loading messages and verify pickVignette covers them
grep -nE "setPendingMsg|pendingMsg=" /home/user/hello-world/factors_charter.jsx

# Find all top-level state fields (audit ensureShape coverage)
grep -nE "^  [a-zA-Z]+:" /home/user/hello-world/factors_charter.jsx | head -30
```

---

## Bradley's working style

- Mobile, Claude app. Short responses preferred.
- Will say "do that now", "ship it", "proceed", "keep going" — these mean stop discussing and write code.
- Will say "this doesn't work" directly. Believe him.
- Values period accuracy and dry tone over feature volume.
- Has a 140-book reading list, an Obsidian vault, a trading interest. Trips and reading become world-building feedstock — append to `WORLD_NOTES.md`, not chat history.
- The Drive folder workflow ("Factor's Charter", id `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU`) is the canonical save backup channel — paste manuscript JSON in chat → Claude saves to Drive with timestamp.

---

## Drive folder

**Folder:** "Factor's Charter"
**ID:** `1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU`
**URL:** https://drive.google.com/drive/folders/1yqTKacEuy4j3_Ph2QR5CKr1T_xIqpjeU

**Should contain:** `CLAUDE.md`, `CHANGELOG.md`, `HANDOFF.md`, `WORLD_NOTES.md`, manuscript and AI-log JSON exports.
