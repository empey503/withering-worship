// Copyright © 2026 Steve Empey
// Standalone Final Battle test harness for the /testfinal skill — unlike
// scripts/playtest-sim.ts (which plays a whole game and only reaches the
// Final Battle if/when a bot legitimately gets there), this script starts
// EVERY trial already inside the Final Battle, with each player's starting
// equipment set directly from config: how many Artifacts (Weapon/Armor/
// Implement/Rune Stones) and how many Lore cards they enter with, both
// drawn from the real card pools (excluding Starter Set). Reuses the same
// Final Battle bot policy as the full simulation (see ./finalBattleSim) and
// the same trial setup/aggregation as the /testfinal browser UI (see
// ./finalBattleTestSetup and src/TestFinalPanel.tsx) so results reflect the
// same decision-making and reporting everywhere, just isolated to the fight.
//
// This is a prototyping tool, not part of the shipped app: run with
// `npx tsx scripts/final-battle-sim.ts [playerCount] [artifactsAttuned] [loreAttuned] [trials] [seed] [rotArtifacts]`.
import { buildRoster, runTrial, tallyResults, validateFinalBattleConfig, type TrialResult } from "./finalBattleTestSetup";

const playerCount = Number(process.argv[2] ?? 4);
const artifactsAttuned = Number(process.argv[3] ?? 3);
const loreAttuned = Number(process.argv[4] ?? 1);
const trials = Number(process.argv[5] ?? 100);
const seed = Number(process.argv[6] ?? 12345);
// Defaults to 1, not 0: with 0 Rot Artifacts the "remove the last Artifact"
// win condition is unreachable (nothing to remove — see runFinalBattle's
// win branch in ./finalBattleSim, a no-op when rotArtifacts is already
// empty), so the only way to win at all is exhausting the shared Rot Combat
// card supply. That's a legitimate config to test deliberately, but as a
// default it skews results hard toward whoever goes first (they can Press
// the Attack indefinitely without another combatant ever getting a turn) —
// not representative of a normal fight.
const rotArtifactCount = Number(process.argv[7] ?? 1);

const config = { playerCount, artifactsAttuned, loreAttuned, rotArtifactCount };
const validationError = validateFinalBattleConfig(config);
if (validationError) {
  console.error(validationError);
  process.exit(1);
}

const roster = buildRoster(playerCount);
const results: TrialResult[] = [];
for (let i = 0; i < trials; i++) {
  results.push(runTrial(config, seed + i));
}

const report = tallyResults(roster, results);

console.log(
  JSON.stringify(
    {
      config: { ...config, trials, seed },
      ...report,
      trials: results.map((r) => ({ seed: r.seed, winner: r.winner, combats: r.combats })),
    },
    null,
    2,
  ),
);
