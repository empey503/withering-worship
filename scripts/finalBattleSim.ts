// Copyright © 2026 Steve Empey
// Shared Final Battle bot policy + driver, used by both scripts/playtest-sim.ts
// (a full game simulation that eventually reaches the Final Battle) and
// scripts/final-battle-sim.ts (a harness that starts directly inside it).
// Pulled out into its own module so the two don't duplicate this logic —
// this file has no top-level side effects, so it's safe for either script
// to import.
import type { ArtifactCard, LoreCard, RotCombatCard } from "../src/types/game";
import type { CharacterBoardSlotRef, EnginePlayer, GameState } from "../src/engine/types";
import type { ArtifactSlotName } from "../src/engine/turnEngine";
import {
  getArtifactSlots,
  initiateFinalBattle,
  resolveFinalBattleBoon,
  declineFinalBattleBoon,
  chooseFinalBattleLore,
  resolveFinalBattleAttackRoll,
  removeRotArtifact,
  rotArtifactsEarnedForMargin,
  removeOwnBoardCard,
  resolveDivineReclamation,
  resolvePressTheAttack,
} from "../src/engine/turnEngine";

// --- shared Lore-value helpers (also used outside the Final Battle, e.g. the
// Ancient Shrine visit and On Purchase free-attune in playtest-sim.ts) -------

export function loreCardValue(card: LoreCard): number {
  return (card.vsAberration + card.vsConstruct + card.vsUndead) / 3;
}

// Same tie-acceptance reasoning as chooseArtifactSlotToReplace in
// playtest-sim.ts: a decline here ends the whole visit/reward with nothing,
// so a tie (>=, not the stricter >) still gets swapped in rather than
// wasting the free/discounted Attunement on nothing.
export function chooseLoreReplaceIndex(player: EnginePlayer, card: LoreCard): number {
  let worstIdx = 0;
  let worstVal = Infinity;
  player.attunedLore.forEach((c, i) => {
    const v = loreCardValue(c);
    if (v < worstVal) {
      worstVal = v;
      worstIdx = i;
    }
  });
  return loreCardValue(card) >= worstVal ? worstIdx : -1;
}

// --- Final Battle Combat bot policy -----------------------------------------

function equippedArtifactAttackTotalForBot(player: EnginePlayer): number {
  return (
    (player.equippedWeapon?.attack ?? 0) +
    (player.equippedArmor?.attack ?? 0) +
    (player.equippedImplement?.attack ?? 0) +
    player.equippedRuneStones.reduce((s, c) => s + c.attack, 0)
  );
}

const AVERAGE_2D6 = 7;

// Final Battle Combat step 1, "Choose Lore": pick 1 or 2 Attuned Lore cards
// to attack with, ranked by the same best-of-2-creature-type value the
// engine itself uses (chooseFinalBattleLore in turnEngine.ts), not the
// flatter loreCardValue average used elsewhere in this bot. Since The Rot's
// Attack is fully known before this choice (both Combat cards are already
// revealed), the bot compares its best single card's expected Attack
// (average 2d6 + that card's value + Gear) against it: enough on its own,
// use just the one card and keep the second Attuned for a future combat;
// short, and a second card is available, spend it too rather than lose a
// winnable exchange to save a card for later.
export function chooseFinalBattleLoreIndices(
  player: EnginePlayer,
  rotCards: [RotCombatCard, RotCombatCard],
  rotAttack: number,
): number[] {
  const valueFor = (card: LoreCard, creatureType: RotCombatCard["creatureType"]) =>
    creatureType === "Aberration" ? card.vsAberration : creatureType === "Construct" ? card.vsConstruct : card.vsUndead;
  const bestFor = (card: LoreCard) => Math.max(valueFor(card, rotCards[0].creatureType), valueFor(card, rotCards[1].creatureType));

  const ranked = player.attunedLore
    .map((c, i) => ({ i, v: bestFor(c) }))
    .sort((a, b) => b.v - a.v);

  if (ranked.length <= 1) {
    return [ranked[0].i];
  }

  const gearAttack = equippedArtifactAttackTotalForBot(player);
  const singleCardEstimate = ranked[0].v + AVERAGE_2D6 + gearAttack;
  if (singleCardEstimate >= rotAttack) {
    return [ranked[0].i];
  }
  return [ranked[0].i, ranked[1].i];
}

// Win path: remove whichever Rot Artifacts (as many as the win margin
// earns, capped at however many remain) contribute the most Attack, to
// weaken The Rot's board as fast as possible for whoever fights it next.
export function bestRotArtifactsToRemoveIndices(state: GameState, earned: number): number[] {
  const count = Math.min(earned, state.rotArtifacts.length);
  return state.rotArtifacts
    .map((c, i) => ({ i, attack: c.attack }))
    .sort((a, b) => b.attack - a.attack)
    .slice(0, count)
    .map((entry) => entry.i);
}

// Loss path: sacrifice whichever equipped item (Weapon/Armor/Implement/Rune
// Stone/attuned Lore, compared on the same Attack-ish scale via
// loreCardValue for Lore) contributes the least to future combats — same
// "minimize attack loss" priority used everywhere else in this bot. Only
// called when characterBoardIsEmpty was already false (see
// chooseFinalBattleLore/resolveFinalBattleAttackRoll's skipRemoval check),
// so at least one candidate always exists.
export function worstOwnBoardSlotToRemove(player: EnginePlayer): CharacterBoardSlotRef {
  const candidates: { ref: CharacterBoardSlotRef; value: number }[] = [];
  if (player.equippedWeapon) candidates.push({ ref: { kind: "weapon" }, value: player.equippedWeapon.attack });
  if (player.equippedArmor) candidates.push({ ref: { kind: "armor" }, value: player.equippedArmor.attack });
  if (player.equippedImplement) candidates.push({ ref: { kind: "implement" }, value: player.equippedImplement.attack });
  player.equippedRuneStones.forEach((c, i) => candidates.push({ ref: { kind: "runeStone", index: i }, value: c.attack }));
  player.attunedLore.forEach((c, i) => candidates.push({ ref: { kind: "lore", index: i }, value: loreCardValue(c) }));
  candidates.sort((a, b) => a.value - b.value);
  return candidates[0].ref;
}

// Divine Reclamation: free Attunement, so always take the best available
// Lore Discard card if under the 3-card cap; at the cap, only replace the
// worst attuned card when the free card is actually at least as good
// (chooseLoreReplaceIndex — same worthwhile-check used at the Ancient
// Shrine), rather than forcing a downgrade just because it's free. Also
// used by playtest-sim.ts's On Purchase free-attune (same free-Attunement
// shape), outside the Final Battle.
export function chooseDivineReclamationChoice(player: EnginePlayer): { discardIndex: number; replaceIndex?: number } | null {
  if (player.loreDiscard.length === 0) return null;
  let bestIdx = 0;
  let bestVal = -1;
  player.loreDiscard.forEach((c, i) => {
    const v = loreCardValue(c);
    if (v > bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  });
  if (player.attunedLore.length < 3) {
    return { discardIndex: bestIdx };
  }
  const replaceIndex = chooseLoreReplaceIndex(player, player.loreDiscard[bestIdx]);
  return replaceIndex === -1 ? null : { discardIndex: bestIdx, replaceIndex };
}

// The first initiator's one-time boon (see initiateFinalBattle/
// resolveFinalBattleBoon in turnEngine.ts) — free Attunement, so always
// worth taking if anything is available. Compares the best Artifact
// (highest Attack, across both personal piles) against the best Lore card
// (best-of-two-creature-types value against the upcoming combat's Rot
// cards, same as chooseFinalBattleLoreIndices) and picks whichever helps
// more; at the Lore cap, only replaces an attuned card when it's actually
// an upgrade (chooseLoreReplaceIndex), falling back to the Artifact pick
// instead of forcing a downgrade just because it's free.
export function chooseFinalBattleBoonPick(
  player: EnginePlayer,
  rotCards: [RotCombatCard, RotCombatCard],
):
  | { source: "deck" | "discard"; deck: "artifact"; index: number; chosenSlot?: ArtifactSlotName }
  | { source: "deck" | "discard"; deck: "lore"; index: number; replaceIndex?: number }
  | null {
  // Plain `for` loops, not `.forEach` — reassigning a `let x: T | null`
  // inside a `.forEach` callback defeats TypeScript's control-flow
  // narrowing (it can end up inferring `never` after the loop), while a
  // loop in the same scope narrows correctly.
  let bestArtifact: { source: "deck" | "discard"; index: number; card: ArtifactCard } | null = null;
  for (const source of ["deck", "discard"] as const) {
    const pile = source === "deck" ? player.artifactDeck : player.artifactDiscard;
    for (let index = 0; index < pile.length; index++) {
      const card = pile[index];
      const slots = getArtifactSlots(card);
      // Same cap resolveFinalBattleBoon/attuneArtifactCardIntoSlot enforces —
      // a single-slot Rune Stone card can't be Attuned past 3 equipped, free
      // or not, so it's not a real candidate once the cap is reached.
      if (slots.length === 1 && slots[0] === "Rune Stone" && player.equippedRuneStones.length >= 3) continue;
      if (!bestArtifact || card.attack > bestArtifact.card.attack) bestArtifact = { source, index, card };
    }
  }

  const valueFor = (card: LoreCard, creatureType: RotCombatCard["creatureType"]) =>
    creatureType === "Aberration" ? card.vsAberration : creatureType === "Construct" ? card.vsConstruct : card.vsUndead;
  let bestLore: { source: "deck" | "discard"; index: number; card: LoreCard; value: number } | null = null;
  for (const source of ["deck", "discard"] as const) {
    const pile = source === "deck" ? player.loreDeck : player.loreDiscard;
    for (let index = 0; index < pile.length; index++) {
      const card = pile[index];
      const value = Math.max(valueFor(card, rotCards[0].creatureType), valueFor(card, rotCards[1].creatureType));
      if (!bestLore || value > bestLore.value) bestLore = { source, index, card, value };
    }
  }

  const artifactPick = () => {
    if (!bestArtifact) return null;
    const slots = getArtifactSlots(bestArtifact.card);
    return { source: bestArtifact.source, deck: "artifact" as const, index: bestArtifact.index, chosenSlot: slots.length > 1 ? slots[0] : undefined };
  };

  if (!bestLore) return artifactPick();
  if (bestArtifact && bestArtifact.card.attack > bestLore.value) return artifactPick();

  const atCap = player.attunedLore.length >= 3;
  const replaceIndex = atCap ? chooseLoreReplaceIndex(player, bestLore.card) : undefined;
  if (atCap && replaceIndex === -1) return artifactPick();
  return { source: bestLore.source, deck: "lore", index: bestLore.index, replaceIndex: atCap ? (replaceIndex as number) : undefined };
}

// One resolved Final Battle combat (docs/rules.md, "For each combat" steps
// 1-4) — every time chooseFinalBattleLore/resolveFinalBattleAttackRoll
// produces a pendingFinalBattleOutcome, not one entry per player or per
// round (a single player can fight several times in a row via Press the
// Attack, and The Final Battle doesn't advance GameState.round at all).
export interface FinalBattleCombatRecord {
  combatIndex: number; // 1-based sequence within The Final Battle
  playerName: string;
  playerAttack: number;
  rotAttack: number;
  outcome: "win" | "loss";
  rotCards: [string, string];
}

// Drives a Final Battle (state already in "finalBattleOffer" or "finalBattle"
// phase) to its actual conclusion — a win, a Rot-Combat-card-supply
// exhaustion win (see turnEngine.ts), or every combatant defeated — rather
// than just reporting who became eligible to start it. Always accepts an
// offer immediately. Rune of Fracture's pendingFinalBattleAttackRoll pause
// is handled defensively (resolved with no reroll) even though the card is
// no longer obtainable (see runeStones.ts), since nothing here depends on
// that staying true forever. Also returns a combat-by-combat log
// (recordIfResolved fires exactly once per resolved combat, whichever of
// the two call sites produced it) for reporting — see FinalBattleCombatRecord.
export function runFinalBattle(state: GameState, rng: () => number): { state: GameState; combatLog: FinalBattleCombatRecord[] } {
  let s = state;
  let guard = 0;
  const combatLog: FinalBattleCombatRecord[] = [];
  const recordIfResolved = (before: GameState, after: GameState) => {
    if (!before.pendingFinalBattleOutcome && after.pendingFinalBattleOutcome) {
      const resolution = after.pendingFinalBattleOutcome;
      combatLog.push({
        combatIndex: combatLog.length + 1,
        playerName: after.players[resolution.playerId].character.name,
        playerAttack: resolution.playerAttack,
        rotAttack: resolution.rotAttack,
        outcome: resolution.outcome,
        rotCards: [resolution.rotCards[0].name, resolution.rotCards[1].name],
      });
    }
  };

  while (s.phase !== "gameOver" && guard < 200) {
    guard++;
    if (s.phase === "finalBattleOffer" && s.pendingFinalBattleOffer) {
      s = initiateFinalBattle(s, rng);
      continue;
    }
    if (s.phase !== "finalBattle") break;

    if (s.pendingFinalBattleBoon && s.pendingFinalBattleCombat) {
      const { playerId, rotCards } = s.pendingFinalBattleCombat;
      const pick = chooseFinalBattleBoonPick(s.players[playerId], rotCards);
      s = pick ? resolveFinalBattleBoon(s, pick, rng) : declineFinalBattleBoon(s);
      continue;
    }
    if (s.pendingFinalBattleAttackRoll) {
      const before = s;
      s = resolveFinalBattleAttackRoll(s, undefined, undefined, rng);
      recordIfResolved(before, s);
      continue;
    }
    if (s.pendingFinalBattleCombat) {
      const { playerId, rotCards } = s.pendingFinalBattleCombat;
      const player = s.players[playerId];
      const rotAttack = rotCards[0].attack + rotCards[1].attack + s.rotArtifacts.reduce((sum, c) => sum + c.attack, 0);
      const loreIndices = chooseFinalBattleLoreIndices(player, rotCards, rotAttack);
      const preservationIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Preservation");
      const useWieldTheRot = player.character.name === "Taza, the Shadow Knight" && s.witheringTokens >= 1;
      const before = s;
      s = chooseFinalBattleLore(
        s,
        loreIndices,
        rng,
        preservationIndex >= 0 ? preservationIndex : undefined,
        preservationIndex >= 0 ? loreIndices[0] : undefined,
        useWieldTheRot,
      );
      recordIfResolved(before, s);
      continue;
    }
    if (s.pendingFinalBattleOutcome) {
      const resolution = s.pendingFinalBattleOutcome;
      if (resolution.stage === "removeCard") {
        if (resolution.outcome === "win") {
          // rotArtifacts is guaranteed non-empty here — chooseFinalBattleLore/
          // resolveFinalBattleAttackRoll in turnEngine.ts skip straight to
          // "divineReclamation" on a win when there's nothing to remove.
          const earned = rotArtifactsEarnedForMargin(resolution.playerAttack - resolution.rotAttack);
          s = removeRotArtifact(s, bestRotArtifactsToRemoveIndices(s, earned));
        } else {
          s = removeOwnBoardCard(s, worstOwnBoardSlotToRemove(s.players[resolution.playerId]));
        }
        continue;
      }
      if (resolution.stage === "divineReclamation") {
        s = resolveDivineReclamation(s, chooseDivineReclamationChoice(s.players[resolution.playerId]), rng);
        continue;
      }
      if (resolution.stage === "pressTheAttack") {
        // Removal comes from loreDiscard, not attunedLore (see
        // resolvePressTheAttack in turnEngine.ts) — Divine Reclamation
        // already left this player with (at most) 1 Attuned Lore card, which
        // the next combat's Choose Lore step needs, so pressing always
        // sacrifices the worst card sitting in discard instead, keeping
        // every Attuned card intact.
        const player = s.players[resolution.playerId];
        if (player.attunedLore.length > 0 && player.loreDiscard.length > 0) {
          let worstIdx = 0;
          let worstVal = Infinity;
          player.loreDiscard.forEach((c, i) => {
            const v = loreCardValue(c);
            if (v < worstVal) {
              worstVal = v;
              worstIdx = i;
            }
          });
          s = resolvePressTheAttack(s, worstIdx, rng);
        } else {
          s = resolvePressTheAttack(s, null, rng);
        }
        continue;
      }
    }
    // Shouldn't happen — every reachable pending state above is handled —
    // but bail out rather than spin forever if something unexpected slips
    // through.
    break;
  }
  return { state: s, combatLog };
}
