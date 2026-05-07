// Decide what should happen on launch given local state, cloud state, and
// what the client believes the cloud's version was at the last sync.
//
// Returns one of:
//   'none'     — remote.version === lastKnown.version: no change since sync.
//   'pull'     — remote.version > lastKnown.version AND local.day === lastKnown.day: silent pull.
//   'conflict' — remote.version > lastKnown.version AND local.day > lastKnown.day: modal.
//   'push'     — remote is missing entirely (404 from the server, expressed as remote === null):
//                local has data the cloud never saw; push immediately to seed.
//
// Inputs:
//   local      — { day }                  (the live save in localStorage)
//   remote     — { version, day } | null  (the cloud copy; null = 404)
//   lastKnown  — { version, day } | null  (what the client recorded after the most recent successful sync)
//
// Edge cases:
//   - lastKnown null AND remote present: conservative; treat as conflict (the local
//     state may have come from a different device's sync that this client never
//     saw, or the player imported a manuscript over the top).
//   - lastKnown null AND remote null: 'push' (fresh start; seed the cloud).

export function detectConflict({ local, remote, lastKnown }) {
  if (!remote) {
    return 'push';
  }
  if (!lastKnown) {
    return 'conflict';
  }
  if (remote.version === lastKnown.version) {
    return 'none';
  }
  if (remote.version > lastKnown.version) {
    if ((local?.day ?? 0) > (lastKnown?.day ?? 0)) {
      return 'conflict';
    }
    return 'pull';
  }
  // remote.version < lastKnown.version — server lost data or rolled back.
  // Treat as 'push' so the local state re-establishes ground truth.
  return 'push';
}
