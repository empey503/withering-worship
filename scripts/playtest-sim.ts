// Copyright © 2026 Steve Empey
// CLI entry point for the /playtest skill. All the actual bot policy and
// simulation logic (character strategies, Location scoring, runSimulation)
// lives in ./ascensionSim, shared with src/TestAscensionPanel.tsx (the "Test
// Ascension" browser UI) — this file just parses argv and prints the result
// as JSON.
//
// This is a prototyping tool, not part of the shipped app: run with
// `npx tsx scripts/playtest-sim.ts [playerCount] [seed] [gold] [mana] [actionTokens]`.
// gold/mana/actionTokens are optional overrides of the rulebook's
// player-count tables (STARTING_GOLD_BY_PLAYER_COUNT etc. in turnEngine.ts)
// — omit any of them to keep that table's default for the chosen player
// count. `mana` is the total split evenly across both Attunement Pools, same
// as the table reports it.
import { runSimulation } from "./ascensionSim";

const playerCount = Number(process.argv[2] ?? 3);
const seed = Number(process.argv[3] ?? 12345);
const gold = process.argv[4] !== undefined ? Number(process.argv[4]) : undefined;
const mana = process.argv[5] !== undefined ? Number(process.argv[5]) : undefined;
const actionTokens = process.argv[6] !== undefined ? Number(process.argv[6]) : undefined;

if (playerCount < 1 || playerCount > 6) {
  console.error("player count must be between 1 and 6");
  process.exit(1);
}

const startingResources = { gold, mana, actionTokens };

// Detailed single run, for the round-by-round report.
const detailed = runSimulation(playerCount, seed, 60, true, "full", startingResources);

// Batch of additional seeds for a turns-to-eligibility estimate.
const BATCH_SIZE = 100;
const batch = Array.from({ length: BATCH_SIZE }, (_, i) =>
  runSimulation(playerCount, seed + 1000 + i, 60, false, "full", startingResources),
);

console.log(
  JSON.stringify(
    {
      playerCount,
      seed,
      startingResources,
      detailed: {
        outcome: detailed.outcome,
        round: detailed.round,
        eligiblePlayer: detailed.eligiblePlayer,
        winner: detailed.winner,
        finalBattleLog: detailed.finalBattleLog,
        history: detailed.history,
      },
      batch: batch.map((b) => ({ outcome: b.outcome, round: b.round, eligiblePlayer: b.eligiblePlayer, winner: b.winner })),
    },
    null,
    2,
  ),
);
