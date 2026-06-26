// winCounsel — a strategic advisor for the Journal hub (toggleable). Reads a
// normalized projection of the game state and returns the SINGLE highest-leverage
// next step toward winning the charter (400 cwt pepper + 200 cwt cinnamon lodged
// and lifted to London by the Indiaman). The monolith renders the returned kind
// into the Factor's first-person voice.
//
// The win model the ladder encodes (see the strategy the numbers bear out):
//   • You don't sell quota spice — you LODGE it; the Indiaman lifts the godown
//     free every 180 days. Production ventures/buildings lodge it passively.
//   • Cinnamon is the structural bottleneck (one cheap source, thin stock).
//   • The brigantine (3× hold) breaks the early throughput wall.
//   • Cash (arbitrage, loans, income ventures) funds the engine; it isn't the win.

export function winCounsel(s = {}) {
  const {
    daysRemaining = 0, charterLength = 1095,
    pepperSecured = 0, pepperNeeded = 400,
    cinnamonSecured = 0, cinnamonNeeded = 200,
    indiamanInDays = null,
    money = 0,
    hasBrigantine = false, hasShipyard = false,
    hasPepperGarden = false, hasSpiceEstate = false,
    hasPlantation = false, plantationEligible = false,
    pepperGardenCost = 700, spiceEstateCost = 1300, brigCost = 900,
  } = s;

  const won = pepperSecured >= pepperNeeded && cinnamonSecured >= cinnamonNeeded;
  if (won) return { kind: 'won', indiamanInDays };

  const elapsed = charterLength > 0 ? (charterLength - daysRemaining) / charterLength : 0;
  const pepRatio = pepperNeeded > 0 ? pepperSecured / pepperNeeded : 1;
  const cinRatio = cinnamonNeeded > 0 ? cinnamonSecured / cinnamonNeeded : 1;
  const cinnamonLagging = cinRatio < pepRatio - 0.05 || cinRatio < elapsed - 0.1;
  const overallBehind = (pepRatio + cinRatio) / 2 < elapsed - 0.15;

  // Near the end and behind pace — no slow engine fixes it now; sail hard.
  if (daysRemaining <= 220 && overallBehind) {
    return { kind: 'behind', focus: cinRatio <= pepRatio ? 'cinnamon' : 'pepper', daysRemaining };
  }

  // Build the engine — buy the highest-leverage missing piece you can afford.
  if (!hasBrigantine && money >= brigCost) return { kind: 'brigantine', hasShipyard };
  if (!hasPepperGarden && money >= pepperGardenCost) return { kind: 'pepper-garden' };
  if (cinnamonLagging && hasPepperGarden && !hasSpiceEstate && money >= spiceEstateCost) return { kind: 'spice-estate' };
  if (plantationEligible && !hasPlantation && money >= 200) return { kind: 'plantation' };

  // Cash-poor and the engine isn't built yet — grind capital toward it.
  if (!hasBrigantine && !hasPepperGarden) return { kind: 'capital' };

  // Engine (partly) built — execute. Cinnamon first if it lags.
  if (cinnamonLagging) return { kind: 'cinnamon-runs' };
  return { kind: 'steady', indiamanInDays };
}
