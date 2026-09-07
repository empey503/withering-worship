// Copyright © 2026 Steve Empey
// Config-driven Final Battle trial setup, shared by scripts/final-battle-sim.ts
// (the /testfinal CLI) and src/TestFinalPanel.tsx (the /testfinal browser UI).
// Pure functions only — no Node APIs (process, fs) — so this is safe to
// import from either a CLI script or a Vite-bundled React component.
import { characters } from "../src/data/characters";
import { artifacts } from "../src/data/artifacts";
import { runeStonesAsArtifacts } from "../src/data/runeStones";
import { loreCards } from "../src/data/loreCards";
import { createGame, getArtifactSlots, type ArtifactSlotName } from "../src/engine/turnEngine";
import type { ArtifactCard, Character, LoreCard } from "../src/types/game";
import type { EnginePlayer, GameState } from "../src/engine/types";
import { runFinalBattle, type FinalBattleCombatRecord } from "./finalBattleSim";

// --- small RNG + shuffle ----------------------------------------------------
export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// --- config-driven starting equipment ---------------------------------------

const NON_STARTER_ARTIFACTS: ArtifactCard[] = [...artifacts.filter((a) => a.type !== "Starter Set"), ...runeStonesAsArtifacts];
const NON_STARTER_LORE: LoreCard[] = loreCards.filter((c) => c.type !== "Starter Set");

// Fills Weapon, then Armor, then Implement, then up to 3 Rune Stones (the 6
// possible Artifact pieces a player can have equipped) with real cards drawn
// from `pool`, stopping once `count` pieces are equipped. Player-only — The
// Rot's Character Mat has no slot typing, so it uses equipRotArtifacts below
// instead. Searches the *whole* pool for each slot (not just a small nearby
// slice) so a card type being under-represented near the front doesn't leave
// a slot empty while plenty of matching cards sit later in the pool; `used`
// is shared across every player and The Rot for the trial so nobody ends up
// with the same card object. If the pool is truly out of cards for a given
// slot type, that slot is simply left empty rather than throwing — a config
// asking for more Artifacts than the real pool can fill for a particular
// slot is a config problem, not a crash.
function equipArtifacts(
  count: number,
  pool: ArtifactCard[],
  used: Set<ArtifactCard>,
): { weapon?: ArtifactCard; armor?: ArtifactCard; implement?: ArtifactCard; runeStones: ArtifactCard[] } {
  const pickForSlot = (slot: ArtifactSlotName) => pool.find((c) => !used.has(c) && getArtifactSlots(c).includes(slot));

  const result: { weapon?: ArtifactCard; armor?: ArtifactCard; implement?: ArtifactCard; runeStones: ArtifactCard[] } = { runeStones: [] };
  const slotOrder: ArtifactSlotName[] = ["Weapon", "Armor", "Implement", "Rune Stone", "Rune Stone", "Rune Stone"];
  let equipped = 0;
  for (const slot of slotOrder) {
    if (equipped >= count) break;
    const card = pickForSlot(slot);
    if (!card) continue;
    used.add(card);
    equipped++;
    if (slot === "Weapon") result.weapon = card;
    else if (slot === "Armor") result.armor = card;
    else if (slot === "Implement") result.implement = card;
    else result.runeStones.push(card);
  }
  return result;
}

// The Rot Character Mat has no slot typing (unlike a player's Weapon/Armor/
// Implement/Rune Stone slots) — it just holds up to 7 arbitrary Artifact
// cards (equipRotWithHighestGoldArtifact in turnEngine.ts). So unlike
// equipArtifacts above, this doesn't route through slotOrder at all: it
// takes the next `count` unused cards from `pool` regardless of type.
function equipRotArtifacts(count: number, pool: ArtifactCard[], used: Set<ArtifactCard>): ArtifactCard[] {
  const result: ArtifactCard[] = [];
  for (const card of pool) {
    if (result.length >= count) break;
    if (used.has(card)) continue;
    used.add(card);
    result.push(card);
  }
  return result;
}

export function buildRoster(playerCount: number): Character[] {
  const pool = playerCount === 1 ? characters.filter((c) => c.canPlaySolo) : characters;
  return pool.slice(0, playerCount);
}

// Builds a GameState already inside the Final Battle: every player equipped/
// Attuned per config, no Rot Artifacts unless rotArtifactCount says
// otherwise, and the one-time initiator's boon skipped (finalBattleBoonClaimed
// pre-set to true) — this harness is testing the fight itself, not who gets
// to claim a pre-fight bonus for having initiated it.
export function buildFinalBattleState(
  playerCount: number,
  artifactsAttuned: number,
  loreAttuned: number,
  rotArtifactCount: number,
  rng: () => number,
): GameState {
  const roster = buildRoster(playerCount);
  const state = createGame(roster, rng);

  const shuffledArtifacts = shuffle(NON_STARTER_ARTIFACTS, rng);
  const shuffledLore = shuffle(NON_STARTER_LORE, rng);
  const usedArtifacts = new Set<ArtifactCard>();
  let loreCursor = 0;

  const players: Record<string, EnginePlayer> = {};
  state.playerOrder.forEach((id) => {
    const player = state.players[id];
    const equipped = equipArtifacts(artifactsAttuned, shuffledArtifacts, usedArtifacts);
    const attunedLore = shuffledLore.slice(loreCursor, loreCursor + loreAttuned);
    loreCursor += loreAttuned;
    players[id] = {
      ...player,
      equippedWeapon: equipped.weapon,
      equippedArmor: equipped.armor,
      equippedImplement: equipped.implement,
      equippedRuneStones: equipped.runeStones,
      attunedLore,
    };
  });

  const rotArtifacts = equipRotArtifacts(rotArtifactCount, shuffledArtifacts, usedArtifacts);

  return {
    ...state,
    players,
    rotArtifacts,
    phase: "finalBattleOffer",
    pendingFinalBattleOffer: { playerId: state.playerOrder[0], scanIndex: 0 },
    finalBattleBoonClaimed: true,
  };
}

export interface FinalBattleTrialConfig {
  playerCount: number;
  artifactsAttuned: number;
  loreAttuned: number;
  rotArtifactCount: number;
}

export interface TrialResult {
  seed: number;
  winner: string | null; // character name, or null for a Rot win
  combats: number;
  combatLog: FinalBattleCombatRecord[];
}

export function runTrial(config: FinalBattleTrialConfig, seed: number): TrialResult {
  const rng = mulberry32(seed);
  const state = buildFinalBattleState(config.playerCount, config.artifactsAttuned, config.loreAttuned, config.rotArtifactCount, rng);
  const { state: afterBattle, combatLog } = runFinalBattle(state, rng);
  const winnerEntry = afterBattle.finalRanking?.find((e) => e.isWinner) ?? null;
  const winner = winnerEntry ? afterBattle.players[winnerEntry.playerId].character.name : null;
  return { seed, winner, combats: combatLog.length, combatLog };
}

export interface FinalBattleTallyReport {
  roster: string[];
  tally: Record<string, { wins: number; losses: number }>;
  gamesWon: number;
  rotWins: number;
  combatsPerBattle: { min: number; max: number; median: number };
}

// Shared aggregation, used by both the CLI's printed report and the browser
// dashboard, so the two stay consistent by construction.
export function tallyResults(roster: Character[], results: TrialResult[]): FinalBattleTallyReport {
  const tally: Record<string, { wins: number; losses: number }> = {};
  roster.forEach((c) => (tally[c.name] = { wins: 0, losses: 0 }));
  let rotWins = 0;
  results.forEach((r) => {
    if (r.winner) {
      tally[r.winner].wins++;
      roster.forEach((c) => {
        if (c.name !== r.winner) tally[c.name].losses++;
      });
    } else {
      rotWins++;
      roster.forEach((c) => tally[c.name].losses++);
    }
  });
  const combatCounts = results.map((r) => r.combats).sort((a, b) => a - b);
  return {
    roster: roster.map((c) => c.name),
    tally,
    gamesWon: results.length - rotWins,
    rotWins,
    combatsPerBattle: {
      min: combatCounts[0] ?? 0,
      max: combatCounts[combatCounts.length - 1] ?? 0,
      median: combatCounts[Math.floor(combatCounts.length / 2)] ?? 0,
    },
  };
}

// Shared input validation, used by both the CLI (which exits with the
// message on stderr) and the browser UI (which shows it inline instead of
// running). Returns an error message, or null if the config is valid.
export function validateFinalBattleConfig(config: FinalBattleTrialConfig): string | null {
  if (config.playerCount < 1 || config.playerCount > 6) {
    return "player count must be between 1 and 6";
  }
  if (config.artifactsAttuned < 0 || config.artifactsAttuned > 6) {
    return "artifacts attuned must be between 0 and 6 (Weapon + Armor + Implement + 3 Rune Stones)";
  }
  if (config.loreAttuned < 1 || config.loreAttuned > 3) {
    // Not 0: "each player who has not been defeated and has at least one
    // Lore card Attuned takes a turn fighting The Rot" (docs/rules.md) — a
    // player with 0 Attuned Lore can't take a turn at all, and Choose Lore
    // itself throws with nothing to pick from (chooseFinalBattleLore in
    // turnEngine.ts).
    return "lore attuned must be between 1 and 3 (the Lore Attunement cap) — 0 can't take a Final Battle turn at all";
  }
  if (config.rotArtifactCount < 0 || config.rotArtifactCount > 7) {
    return "Rot Artifacts must be between 0 and 7 (the Rot Character Mat's cap)";
  }
  return null;
}
