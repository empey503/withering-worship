// Copyright © 2026 Steve Empey
// Shared Ascension bot policy + driver (character strategies, Location
// scoring, Market/Artificer/Ancient Shrine/Valley/Arena/Exchange visit
// logic, and runSimulation), used by scripts/playtest-sim.ts (the /playtest
// CLI) and src/TestAscensionPanel.tsx (the /testfinal-adjacent "Test
// Ascension" browser UI). Pulled into its own module — mirroring the
// finalBattleSim.ts / playtest-sim.ts split already in place for the Final
// Battle half — so both entry points share one implementation instead of
// drifting apart. No top-level side effects, so this is safe to import from
// either a CLI script or a Vite-bundled React component.
//
// runSimulation's `mode` controls how far a run goes: "ascensionOnly" stops
// the moment a player becomes eligible for The Final Battle (reporting
// "finalBattleEligible" rather than playing it out) — useful for isolating
// Ascension balance from Final Battle balance; "full" (what /playtest has
// always done) drives straight into runFinalBattle and reports the real
// outcome.
import { characters } from "../src/data/characters";
import type { ArtifactCard, Character, LocationId, LoreCard } from "../src/types/game";
import type { EnginePlayer, GameState, RotCard } from "../src/engine/types";
import {
  createGame,
  isLocationAvailable,
  placeActionToken,
  cleansePool,
  resolveDeepWatersClaim,
  rollWellspring,
  resolveWellspringAllocation,
  purchaseFromMarket,
  skipMarket,
  resolveOnPurchaseFreeLoreAttune,
  skipOnPurchaseFreeLoreAttune,
  purchaseFromLibrary,
  skipLibrary,
  resolveRowRefillPerk,
  skipRotToMarketRowPerk,
  resolveGuildFreeCardPerk,
  skipGuildFreeCardPerk,
  resolveExchangeFactionBump,
  skipExchangeFactionBump,
  exchangeGoldForMana,
  leaveExchange,
  revealArtifactCard,
  attuneArtifactCard,
  discardArtifactCard,
  leaveArtificer,
  getArtifactSlots,
  revealLoreCard,
  attuneLoreCard,
  discardLoreCard,
  leaveAncientShrine,
  chooseValleyLore,
  resolveValleyAttackRoll,
  chooseValleyScenario,
  finalizeValleyOutcome,
  detectRotEffectChoice,
  skipValleyScry,
  peekValleyRotCard,
  resolveValleyScry,
  discardPremonition,
  resolveValleyPremonition,
  chooseForesightEncounter,
  runCleanupPhase,
  payArenaEntryFee,
  leaveArena,
  resolveArenaReward,
  revealForbiddenKnowledge,
  chooseForbiddenKnowledge,
  chooseWhisperedSecretsDeck,
  resolveWhisperedSecrets,
  discardIgnoreValleyLoss,
  discardCleansingRune,
  discardConvergence,
  declineFinalBattle,
  type StartingResourceOverrides,
} from "../src/engine/turnEngine";
import { loreCardValue, chooseLoreReplaceIndex, chooseDivineReclamationChoice, runFinalBattle, type FinalBattleCombatRecord } from "./finalBattleSim";

// --- small RNG so runs are reproducible ------------------------------------
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

// --- attack-value reporting (per the skill's formula) ----------------------
// loreCardValue is imported from ./finalBattleSim (shared with the Final
// Battle bot policy there).

function artifactAttackSum(player: EnginePlayer): number {
  return (
    (player.equippedWeapon?.attack ?? 0) +
    (player.equippedArmor?.attack ?? 0) +
    (player.equippedImplement?.attack ?? 0) +
    player.equippedRuneStones.reduce((s, c) => s + c.attack, 0)
  );
}

function equippedArtifactCount(player: EnginePlayer): number {
  return (
    (player.equippedWeapon ? 1 : 0) +
    (player.equippedArmor ? 1 : 0) +
    (player.equippedImplement ? 1 : 0) +
    player.equippedRuneStones.length
  );
}

function loreAverageCapped(cards: LoreCard[]): number {
  if (cards.length === 0) return 0;
  const avg = cards.reduce((s, c) => s + loreCardValue(c), 0) / cards.length;
  return Math.min(3, avg);
}

function attackValueStrength(artifactSum: number, loreAvgCapped: number): number {
  return artifactSum + loreAvgCapped;
}

export function playerReport(player: EnginePlayer) {
  const artifactSum = artifactAttackSum(player);
  const loreAvg = loreAverageCapped(player.attunedLore);
  return {
    name: player.character.name,
    artifactSum,
    loreAvg: Number(loreAvg.toFixed(2)),
    strength: Number(attackValueStrength(artifactSum, loreAvg).toFixed(2)),
    attuned: {
      weapon: player.equippedWeapon?.name ?? null,
      armor: player.equippedArmor?.name ?? null,
      implement: player.equippedImplement?.name ?? null,
      runeStones: player.equippedRuneStones.map((c) => c.name),
      lore: player.attunedLore.map((c) => c.name),
    },
    rotCardsInPlayerArea: player.rotCardsInPlayerArea.length,
    factionTrack: { ...player.factionTrack },
    // Raw resources, not just derived attack value — gold and both Mana
    // Pools, plus how much of each pool is currently tainted by a Withering
    // Token (see Cleansing in docs/rules.md) since that Mana isn't spendable
    // on anything else until cleared.
    gold: player.gold,
    manaPools: { ...player.manaPools },
    witheringTokens: { ...player.witheringTokens },
    artifactDeckSize: player.artifactDeck.length,
    loreDeckSize: player.loreDeck.length,
  };
}

export function rotReport(state: GameState) {
  const artifactSum = state.rotArtifacts.reduce((s, c) => s + c.attack, 0);
  // The Rot has no Lore-equivalent cards attuned in this engine — see the
  // report's caveat about this half of the formula not applying to it.
  return {
    artifactSum,
    strength: artifactSum,
    rotArtifacts: state.rotArtifacts.map((c) => c.name),
    rotCounter: state.rotCounter,
    witheringTokens: state.witheringTokens,
  };
}

// --- player strategies --------------------------------------------------------

// "equipment": prioritizes Market purchases above nearly everything else.
// "arena": prioritizes The Arena whenever it's available (needs a Rot card
// in the player area to pay entry — see isLocationAvailable). "adaptive" is
// the general-purpose heuristic every earlier version of this bot used.
type Strategy = "equipment" | "arena" | "adaptive" | "balanced";

// The default 3-player scenario: Shar (equipment-focused), Taza
// (Arena-focused — assigned by name below, not roster position), Sylva
// (adaptive). `characters.slice(0, 3)` would have excluded Taza entirely.
const THREE_PLAYER_ROSTER = ["Shar", "Taza", "Sylva"];

// 4-player adds Cira (balanced — assigned by name below, same as Taza).
const FOUR_PLAYER_ROSTER = ["Shar", "Taza", "Sylva", "Cira"];

export function buildAscensionRoster(playerCount: number): Character[] {
  const fixedRoster = playerCount === 3 ? THREE_PLAYER_ROSTER : playerCount === 4 ? FOUR_PLAYER_ROSTER : null;
  if (fixedRoster) {
    return fixedRoster.map((shortName) => {
      const found = characters.find((c) => c.name.startsWith(shortName));
      if (!found) throw new Error(`Character "${shortName}" not found in src/data/characters.ts.`);
      return found;
    });
  }
  return characters.slice(0, playerCount);
}

// Taza always gets the Arena strategy and Cira the balanced strategy (by
// name, not seat position); the first non-Taza/non-Cira seat gets the
// equipment strategy; everyone else is adaptive. Generalizes past the fixed
// 3/4-player rosters if either is missing entirely (5-6 players via the
// default characters.slice fallback above still hits these name checks,
// since Taza and Cira are both in that slice too).
function assignStrategies(chosenCharacters: Character[]): Strategy[] {
  let equipmentAssigned = false;
  return chosenCharacters.map((c) => {
    if (c.name.startsWith("Taza")) return "arena";
    if (c.name.startsWith("Cira")) return "balanced";
    if (!equipmentAssigned) {
      equipmentAssigned = true;
      return "equipment";
    }
    return "adaptive";
  });
}

// --- bot policy --------------------------------------------------------------

// Rulebook: "If you Attuned the Artifact, you may reveal the next card... and
// repeat this process. Otherwise, end the Attunement action." Declining ends
// the WHOLE visit, even with Mana still banked — so a strict "only a real
// upgrade counts" bar (the old `>` here) was quietly cutting visits short on
// a coin-flip tie and forfeiting whatever might have come next in the deck.
// Accepting a tie can't hurt the Attack total and keeps the reveal train
// going; an actual downgrade is still declined.
function chooseArtifactSlotToReplace(player: EnginePlayer, card: ArtifactCard): { slot: "Weapon" | "Armor" | "Implement" | "Rune Stone"; worthwhile: boolean } {
  const slots = getArtifactSlots(card);
  if (slots.length === 1) {
    const slot = slots[0];
    if (slot === "Rune Stone") {
      return { slot, worthwhile: player.equippedRuneStones.length < 3 };
    }
    const current = slot === "Weapon" ? player.equippedWeapon : slot === "Armor" ? player.equippedArmor : player.equippedImplement;
    return { slot, worthwhile: !current || card.attack >= current.attack };
  }
  // Multi-slot (Godslayer: Weapon / Implement) — pick whichever candidate slot is weaker.
  const candidates = slots.filter((s) => s !== "Rune Stone") as ("Weapon" | "Implement")[];
  let best: "Weapon" | "Implement" = candidates[0];
  let bestCurrentAttack = best === "Weapon" ? (player.equippedWeapon?.attack ?? -1) : (player.equippedImplement?.attack ?? -1);
  for (const s of candidates.slice(1)) {
    const cur = s === "Weapon" ? (player.equippedWeapon?.attack ?? -1) : (player.equippedImplement?.attack ?? -1);
    if (cur < bestCurrentAttack) {
      best = s;
      bestCurrentAttack = cur;
    }
  }
  return { slot: best, worthwhile: card.attack >= bestCurrentAttack };
}

// Cleansing: "you must spend 1 Mana from that Pool to remove the Withering
// Token before you may spend Mana from that Pool for any other purpose."
function cleansePoolFully(state: GameState, playerId: string, pool: "artifact" | "lore"): GameState {
  let s = state;
  while (s.players[playerId].witheringTokens[pool] > 0 && s.players[playerId].manaPools[pool] >= 1) {
    s = cleansePool(s, playerId, pool);
  }
  return s;
}

function runArtificerVisit(state: GameState, rng: () => number): GameState {
  let s = cleansePoolFully(state, state.pendingAction!.playerId, "artifact");
  for (let i = 0; i < 15; i++) {
    s = revealArtifactCard(s, rng);
    if (!s.pendingReveal) {
      return leaveArtificer(s);
    }
    const playerId = s.pendingAction!.playerId;
    const player = s.players[playerId];
    const card = s.pendingReveal.card as ArtifactCard;
    const { slot, worthwhile } = chooseArtifactSlotToReplace(player, card);
    const canAfford = player.manaPools.artifact - player.witheringTokens.artifact >= card.attunementCost;
    if (worthwhile && canAfford) {
      s = attuneArtifactCard(s, slot === "Weapon" || slot === "Implement" ? slot : undefined);
    } else {
      s = discardArtifactCard(s);
      return s; // discardArtifactCard already completes the turn
    }
  }
  return leaveArtificer(s);
}

// chooseLoreReplaceIndex is imported from ./finalBattleSim.

function runAncientShrineVisit(state: GameState, rng: () => number): GameState {
  let s = cleansePoolFully(state, state.pendingAction!.playerId, "lore");
  for (let i = 0; i < 15; i++) {
    s = revealLoreCard(s, rng);
    if (!s.pendingReveal) {
      return leaveAncientShrine(s);
    }
    const playerId = s.pendingAction!.playerId;
    const player = s.players[playerId];
    const card = s.pendingReveal.card as LoreCard;
    const canAfford = player.manaPools.lore - player.witheringTokens.lore >= card.attunementCost;
    if (!canAfford) {
      s = discardLoreCard(s);
      return s;
    }
    if (player.attunedLore.length < 3) {
      s = attuneLoreCard(s);
    } else {
      const replaceIdx = chooseLoreReplaceIndex(player, card);
      if (replaceIdx === -1) {
        s = discardLoreCard(s);
        return s;
      }
      s = attuneLoreCard(s, replaceIdx);
    }
  }
  return leaveAncientShrine(s);
}

function runWellspringVisit(state: GameState, rng: () => number): GameState {
  const playerId = state.pendingAction!.playerId;
  const player = state.players[playerId];
  const level = player.factionTrack.wellspring ?? 0;
  let s = level >= 2 ? rollWellspring(state, { takeFlatSeven: true }, rng) : rollWellspring(state, {}, rng);
  const total = s.pendingWellspringRoll!.total;
  const artifactMana = Math.ceil(total / 2);
  const loreMana = total - artifactMana;
  return resolveWellspringAllocation(s, artifactMana, loreMana);
}

// Rulebook: "You may perform any number of exchanges while visiting this
// location" — rather than one fixed conversion regardless of how much Gold
// was just claimed, the bot weighs what it actually needs:
//   1. Keep enough Gold to buy the best affordable Market/Library card —
//      an Artifact or Lore card in hand is worth more than the 2 Mana that
//      Gold would convert into, so it's reserved rather than exchanged.
//   2. Convert only what's left over that reserve, biased toward whichever
//      pool most needs it: Lore mana comes first if the player has no Lore
//      Attuned yet and none banked to attune one (the Victory Condition
//      needs at least 1 Attuned Lore — see meetsVictoryCondition); Artifact
//      mana comes first if that pool is empty but Lore isn't; otherwise it's
//      split evenly.
function runExchangeVisit(state: GameState): GameState {
  const playerId = state.pendingAction!.playerId;
  let s = state;

  for (let i = 0; i < 20; i++) {
    const player = s.players[playerId];
    if (player.gold < 1) break;

    // Reserve for whichever single purchase is most worth keeping Gold for
    // right now, not both at once — summing them was too conservative and
    // suppressed conversion almost entirely (there's usually *something*
    // affordable in one Row or the other). The player can always reserve
    // again next visit once this round's need is met.
    const marketIdx = bestMarketIndex(s, player.gold, player);
    const marketReserve = marketIdx !== -1 ? s.artifactRow[marketIdx]!.goldCost : 0;
    const libraryIdx = bestLibraryIndex(s, player.gold);
    const libraryReserve = libraryIdx !== -1 ? s.loreRow[libraryIdx]!.goldCost : 0;
    const reserve = Math.max(marketReserve, libraryReserve);

    if (player.gold <= reserve) break; // a card worth buying beats 2 Mana — keep the Gold

    // Both checks also require a card actually waiting to spend that Mana
    // on — no point loading up a pool when the matching personal deck and
    // discard are both empty; that Mana would just sit there instead of
    // going toward whichever purchase reserve comes up next visit.
    const hasLoreCard = player.loreDeck.length > 0 || player.loreDiscard.length > 0;
    const hasArtifactCard = player.artifactDeck.length > 0 || player.artifactDiscard.length > 0;
    const needsLoreFoothold = player.attunedLore.length === 0 && player.manaPools.lore === 0 && hasLoreCard;
    const artifactStarved = player.manaPools.artifact === 0 && player.manaPools.lore > 0 && hasArtifactCard;
    const artifact = needsLoreFoothold ? 0 : artifactStarved ? 2 : 1;
    const lore = 2 - artifact;

    s = exchangeGoldForMana(s, artifact, lore);
  }

  return leaveExchange(s);
}

// Trigger condition for the Market purchase cap: once the 3 fixed equipment
// slots — Weapon, Armor, Implement — each carry at least Attack 2, the
// baseline loadout is solid enough that further Market purchases stop being
// worth the Gold. Named for those 3 slots specifically (the ones every
// Character always has exactly one of) — Rune Stone slots are the other kind
// of Artifact slot (0-3, no fixed "one per"), so they don't factor into
// *triggering* the cap. But Rune Stones are still Artifact Deck cards ("The
// Artifact Deck contains: Weapons, Armor, Implements, Rune Stones" —
// docs/rules.md) bought from the same Market Row as everything else, so once
// this cap engages it stops Rune Stone purchases too, not just
// Weapon/Armor/Implement ones — see every call site below.
function hasSolidCoreLoadout(player: EnginePlayer): boolean {
  return (
    (player.equippedWeapon?.attack ?? 0) >= 2 &&
    (player.equippedArmor?.attack ?? 0) >= 2 &&
    (player.equippedImplement?.attack ?? 0) >= 2
  );
}

// Aggressive acquisition policy: every player should own at least 1 Rune
// Stone whose ability removes Withering Tokens from The Rot unconditionally,
// with no extra target/resource precondition beyond being equipped — that's
// Cleansing (drains The Rot first, see turnEngine.ts) and Convergence (can
// target "rot" directly). The other Rot-token-removing stones from the
// 2026-09-06 rework (Community, Culling, Corruption, Decay, Renewal,
// Sacrifice, Preservation, Prophecy, Time, Vengeance, Whispers) all need
// something else to be true first (a Faction track under 3, a card in a
// discard pile, an opponent to target, a just-lost combat) so they're not
// reliable "always usable" picks for this policy.
const ROT_CLEANSING_RUNESTONES = new Set(["Rune of Cleansing", "Rune of Convergence"]);

// "Owns" counts one already equipped, or already bought and sitting
// unattuned in the personal Artifact deck/discard (Market purchases land
// there, not directly equipped — see purchaseFromMarket) — so the bot
// doesn't keep re-buying once one is already in the pipeline.
function hasOrIsGettingRotCleansingRuneStone(player: EnginePlayer): boolean {
  return (
    player.equippedRuneStones.some((r) => ROT_CLEANSING_RUNESTONES.has(r.name)) ||
    player.artifactDeck.some((c) => ROT_CLEANSING_RUNESTONES.has(c.name)) ||
    player.artifactDiscard.some((c) => ROT_CLEANSING_RUNESTONES.has(c.name))
  );
}

// Row index of an affordable Rot-cleansing Rune Stone, if the player
// doesn't already have one coming — used to override the normal
// highest-Attack Market pick (and the hasSolidCoreLoadout skip) below.
function priorityRuneStoneRowIndex(state: GameState, player: EnginePlayer, gold: number): number {
  if (hasOrIsGettingRotCleansingRuneStone(player)) return -1;
  return state.artifactRow.findIndex((c) => c && ROT_CLEANSING_RUNESTONES.has(c.name) && c.goldCost <= gold);
}

function bestMarketIndex(state: GameState, gold: number, player?: EnginePlayer): number {
  if (player) {
    const priority = priorityRuneStoneRowIndex(state, player, gold);
    if (priority !== -1) return priority;
  }
  let best = -1;
  let bestAttack = -1;
  state.artifactRow.forEach((c, i) => {
    if (c && c.goldCost <= gold && c.attack > bestAttack) {
      best = i;
      bestAttack = c.attack;
    }
  });
  return best;
}

// Real "should I actually purchase now" decision (as opposed to
// bestMarketIndex alone, which only ranks what's in the Row): skips once
// the core loadout is solid — hasSolidCoreLoadout — *unless* a Rot-cleansing
// Rune Stone the player doesn't have yet is sitting there, which always
// overrides that skip per the aggressive-acquisition policy above.
function marketIndexToVisit(state: GameState, player: EnginePlayer): number {
  const priority = priorityRuneStoneRowIndex(state, player, player.gold);
  if (priority !== -1) return priority;
  if (hasSolidCoreLoadout(player)) return -1;
  return bestMarketIndex(state, player.gold);
}

function bestLibraryIndex(state: GameState, gold: number): number {
  let best = -1;
  let bestVal = -1;
  state.loreRow.forEach((c, i) => {
    if (c && c.goldCost <= gold && loreCardValue(c) > bestVal) {
      best = i;
      bestVal = loreCardValue(c);
    }
  });
  return best;
}

function scenarioChoiceFor(name: string, strategy: Strategy, player: EnginePlayer, state: GameState): "embrace" | "resist" {
  if (strategy === "arena" || strategy === "balanced") {
    // Both Taza and Cira need the same Rot-card accumulation policy — every
    // Victory Condition needs 3 Rot cards in the player's own area, and a
    // Rot card only ever enters it via a Combat win or a Scenario Embrace
    // (docs/rules.md) — so Embracing broadly is how either of them actually
    // gets there. Taza's Arena focus barely touches Valley combat on its own
    // (and Arena entry actively *spends* a Rot card rather than adding one);
    // Cira's "balanced" spread means no single Location gets visited often
    // enough to accumulate Rot cards incidentally either. Skip only the two
    // types whose prerequisite can't be met right now (the shared Lore Deck
    // AND its discard pile both empty, so there's nothing left to reshuffle
    // and reveal / an empty personal Artifact deck+discard) — with nothing
    // valid to resolve them against, Embracing would have nowhere to go.
    // See runValleyVisit for how the other four (including the two that
    // need a multi-step reveal) actually resolve.
    if (name === "Forbidden Knowledge" && state.loreDeck.length === 0 && state.loreDiscard.length === 0) return "resist";
    if (name === "Tainted Trade" && player.artifactDeck.length === 0 && player.artifactDiscard.length === 0) return "resist";
    return "embrace";
  }
  // Simplification for every other strategy: only embrace the two Scenario
  // types with a purely beneficial, no-extra-choice effect (flat Gold / a
  // Mana split). The other four either help The Rot too (Corrupted Greed),
  // are situational trades (Tainted Trade), or need the multi-step reveal
  // only implemented for the broad-Embrace strategies above (Forbidden
  // Knowledge, Whispered Secrets).
  return name === "Tainted Fortune" || name === "Underground Wellspring" ? "embrace" : "resist";
}

function buildFinalizeChoice(text: string | null, player: EnginePlayer, state: GameState) {
  if (!text) return {};
  const d = detectRotEffectChoice(text);
  if (!d) return {};
  if (d.kind === "pool") {
    return { pool: player.witheringTokens.artifact <= player.witheringTokens.lore ? ("artifact" as const) : ("lore" as const) };
  }
  if (d.kind === "manaSplit") {
    const artifact = Math.ceil(d.total / 2);
    return { manaSplit: { artifact, lore: d.total - artifact } };
  }
  if (d.kind === "corruptedGreed") {
    // "Place 1 Artifact card from the Artifact Row in your Artifact Discard
    // Pile... Then place the highest-Gold-Cost Artifact from the Row on The
    // Rot." Sacrifice the Row's least valuable card (lowest Attack) — the
    // Row is always kept refilled to 3, so there's always something here.
    let rowIndex = 0;
    let worst = Infinity;
    state.artifactRow.forEach((c, i) => {
      if (c && c.attack < worst) {
        worst = c.attack;
        rowIndex = i;
      }
    });
    return { rowIndex };
  }
  if (d.kind === "taintedTrade") {
    // "Exchange 1 Artifact card from your Artifact Deck or Artifact Discard
    // Pile with 1 Artifact card from the Artifact Row." Trade away the
    // worst card we own (discard pile first, since those are already
    // rejected cards) for the best one currently in the Row. Only called
    // when scenarioChoiceFor has already confirmed we own at least one.
    const fromDiscard = player.artifactDiscard.length > 0;
    const source = fromDiscard ? player.artifactDiscard : player.artifactDeck;
    let sourceIndex = 0;
    let worst = Infinity;
    source.forEach((c, i) => {
      if (c.attack < worst) {
        worst = c.attack;
        sourceIndex = i;
      }
    });
    let tradeRowIndex = 0;
    let best = -1;
    state.artifactRow.forEach((c, i) => {
      if (c && c.attack > best) {
        best = c.attack;
        tradeRowIndex = i;
      }
    });
    return { tradeSource: { from: fromDiscard ? ("discard" as const) : ("deck" as const), index: sourceIndex }, tradeRowIndex };
  }
  return {};
}

// --- reveal-ahead risk assessment ---------------------------------------
//
// Shared by every "look before you fight" trigger tied to encountering a
// Rot card at The Valley: Cira's power (Foresight, look at 2), Valley
// Faction 3 (peek 1, keep-or-discard), and Rune of Premonition (look at 3,
// pick 1). None of these were being used before — the bot always declined
// the Faction 3/Premonition peek and picked the Foresight choice with ad
// hoc logic — so none of the survivability upside they exist for was
// actually happening. This gives all three one consistent notion of "how
// dangerous does this card look."

const AVERAGE_2D6 = 7;

function rotBoardAttackBonus(state: GameState): number {
  return state.rotArtifacts.reduce((sum, c) => sum + c.attack, 0);
}

function bestLoreAttackFor(player: EnginePlayer, creatureType: "Aberration" | "Construct" | "Undead"): number {
  const field = creatureType === "Aberration" ? "vsAberration" : creatureType === "Construct" ? "vsConstruct" : "vsUndead";
  return player.attunedLore.reduce((best, c) => Math.max(best, c[field]), 0);
}

// Taza's power, Wield the Rot: "Once per combat, remove 1 Withering Token
// from The Rot to gain +2 Attack" — an opt-in choice (see resolveWieldTheRot
// in turnEngine.ts, which isn't exported), but a free one with no real
// downside whenever a token exists (it even slightly helps the whole
// table's shared clock), so this estimate assumes he always takes it when
// state.witheringTokens >= 1 — matching runValleyVisit/runFinalBattle's
// actual behavior below.
function estimatedPlayerAttack(
  state: GameState,
  player: EnginePlayer,
  creatureType: "Aberration" | "Construct" | "Undead",
): number {
  const powerBonus = player.character.name.startsWith("Taza") && state.witheringTokens >= 1 ? 2 : 0;
  return artifactAttackSum(player) + bestLoreAttackFor(player, creatureType) + AVERAGE_2D6 + powerBonus;
}

// Lower is safer. Scenarios carry no combat risk at all (the worst case is
// Resisting, never a forced loss), so they always outrank a Combat card
// regardless of that card's Attack value.
function rotCardDangerScore(card: RotCard): number {
  return card.kind === "scenario" ? -1 : card.card.attack;
}

// Used by Cira's Foresight (2 cards) and Rune of Premonition (3 cards) —
// both hand the bot a genuine choice among already-revealed cards, so the
// safest one by rotCardDangerScore is simply the right answer either way.
function pickSafestRotCardIndex(cards: RotCard[]): number {
  let bestIdx = 0;
  let bestScore = Infinity;
  cards.forEach((c, i) => {
    const score = rotCardDangerScore(c);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });
  return bestIdx;
}

// Used by the Valley Faction 3 peek, which only ever shows one card and
// asks keep-or-discard rather than a straight choice. A Combat card is
// worth discarding (try for something else) when the player has no Lore
// Attuned at all — Combat without Lore Attuned is an automatic Loss,
// docs/rules.md — or when their estimated Attack falls short of The Rot's
// total (its own card value plus everything already equipped to The Rot's
// board).
function looksSurvivable(state: GameState, player: EnginePlayer, card: RotCard): boolean {
  if (card.kind === "scenario") return true;
  if (player.attunedLore.length === 0) return false;
  const rotTotal = card.card.attack + rotBoardAttackBonus(state);
  return estimatedPlayerAttack(state, player, card.card.creatureType) >= rotTotal;
}

function runValleyVisit(state: GameState, rng: () => number, strategy: Strategy): GameState {
  let s = state;
  const playerId = s.pendingAction!.playerId;

  if (s.pendingValleyScry && s.pendingValleyScry.stage === "offered") {
    const player = s.players[playerId];
    const premonitionIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Premonition");
    if (premonitionIndex !== -1) {
      // Discarding the Rune Stone is a one-way trade, but seeing 3 cards and
      // picking the safest beats the Faction 3 peek's "see 1, keep or
      // discard" every time it's available — use it whenever offered.
      s = discardPremonition(s, premonitionIndex, rng);
      if (s.pendingValleyPremonition) {
        const idx = pickSafestRotCardIndex(s.pendingValleyPremonition.revealed);
        s = resolveValleyPremonition(s, idx);
      }
    } else if ((player.factionTrack.valley ?? 0) >= 3) {
      s = peekValleyRotCard(s, rng);
      if (s.pendingValleyScry && s.pendingValleyScry.stage === "peeked") {
        const keep = looksSurvivable(s, s.players[playerId], s.pendingValleyScry.card);
        s = resolveValleyScry(s, keep ? "keep" : "discard", rng);
      }
    } else {
      s = skipValleyScry(s, rng);
    }
  }
  if (s.pendingForesightChoice) {
    const choose = pickSafestRotCardIndex(s.pendingForesightChoice) as 0 | 1;
    s = chooseForesightEncounter(s, choose);
  }
  if (!s.pendingValleyEncounter) {
    return s; // nothing revealed (empty deck) — turn already completed
  }

  if (s.pendingValleyEncounter.kind === "combat") {
    const player = s.players[playerId];
    const creatureType = s.pendingValleyEncounter.card.creatureType;
    const field = creatureType === "Aberration" ? "vsAberration" : creatureType === "Construct" ? "vsConstruct" : "vsUndead";
    let bestIdx: number | null = null;
    let bestVal = -1;
    player.attunedLore.forEach((c, i) => {
      if (c[field] > bestVal) {
        bestVal = c[field];
        bestIdx = i;
      }
    });
    const useWieldTheRot = bestIdx !== null && player.character.name === "Taza, the Shadow Knight" && s.witheringTokens >= 1;
    s = chooseValleyLore(s, bestIdx, rng, undefined, undefined, useWieldTheRot);
    if (s.pendingValleyAttackRoll) {
      s = resolveValleyAttackRoll(s, undefined, undefined, rng);
    }
  } else {
    const choice = scenarioChoiceFor(s.pendingValleyEncounter.card.name, strategy, s.players[playerId], s);
    s = chooseValleyScenario(s, choice);
  }

  if (s.pendingValleyOutcome) {
    const player = s.players[playerId];

    // Rune of Teleportation / Rune of Time: "ignore the loss condition on
    // the Rot card." Every printed Loss effect in the game is bad for the
    // player or the team (advance the Rot Track, place Withering Tokens,
    // arm The Rot's board) — there's no case where letting it resolve
    // instead beats spending a Rune Stone that's otherwise just sitting
    // there for its Attack value, so use it on every Loss it's available for.
    if (s.pendingValleyOutcome.outcome === "loss") {
      const lossIgnoreIndex = player.equippedRuneStones.findIndex(
        (r) => r.name === "Rune of Teleportation" || r.name === "Rune of Time",
      );
      if (lossIgnoreIndex !== -1) {
        return discardIgnoreValleyLoss(s, lossIgnoreIndex); // already completes the turn
      }
    }

    const effectText = s.pendingValleyOutcome.effectText;
    const detected = effectText ? detectRotEffectChoice(effectText) : null;

    if (detected?.kind === "forbiddenKnowledge") {
      // "Reveal the top 3 Lore cards. Place 1 in your Lore Discard Pile and
      // discard the others." Keep the highest-value one; only reached when
      // scenarioChoiceFor has confirmed the shared Lore Deck or its discard
      // pile has cards left (revealForbiddenKnowledge reshuffles the latter
      // in automatically if the deck itself is dry).
      s = revealForbiddenKnowledge(s, rng);
      const step = s.pendingEmbraceStep;
      const revealed = step && step.kind === "forbiddenKnowledge" ? step.revealed : [];
      let bestIdx = 0;
      let bestVal = -1;
      revealed.forEach((c, i) => {
        const v = loreCardValue(c);
        if (v > bestVal) {
          bestVal = v;
          bestIdx = i;
        }
      });
      s = chooseForbiddenKnowledge(s, bestIdx);
    } else if (detected?.kind === "whisperedSecrets") {
      // "Look at the top 5 cards of any deck and place them back in any
      // order." No discard either way, so any deck is safe to pick — the
      // shared Artifact Deck is the least likely of the 4 to ever be empty.
      // Reordering doesn't matter to this bot (it can't see future reveals
      // any better in one order than another), so it returns them unchanged.
      s = chooseWhisperedSecretsDeck(s, "sharedArtifact", rng);
      const step = s.pendingEmbraceStep;
      const revealedCount = step && step.kind === "whisperedSecrets" ? step.revealed.length : 0;
      s = resolveWhisperedSecrets(
        s,
        Array.from({ length: revealedCount }, (_, i) => i),
      );
    } else {
      const choice = buildFinalizeChoice(effectText, player, s);
      s = finalizeValleyOutcome(s, choice, rng);
    }
  }
  return s;
}

// Rulebook: "Pay 1 Rot Card by placing it in the discard pile" to enter —
// spend whichever kind (Combat or Scenario) the player actually has. Combat
// resolution and the Arena Reward both happen later, at Cleanup Phase (see
// runRound's post-cleanup arenaReward handling) — this just pays to get in.
// Skips the optional Faction 1 deck-peek perk (same simplification as the
// other Faction perks this bot never uses).
function runArenaVisit(state: GameState, playerId: string): GameState {
  const player = state.players[playerId];
  // Arena Faction 2: "you may choose to pay 1 Gold entry instead of 1 Rot
  // Card." Preferred whenever available — Gold is the cheaper resource to
  // spend here relative to what the Victory Condition needs (3 Rot cards in
  // the player's own area), directly easing the "Arena spends the same Rot
  // cards the Victory Condition needs" tension noted in scoreLocations.
  if ((player.factionTrack.arena ?? 0) >= 2 && player.gold >= 1) {
    return leaveArena(payArenaEntryFee(state, "gold"));
  }
  const kind: "combat" | "scenario" | null = player.rotCardsInPlayerArea.some((c) => c.kind === "combat")
    ? "combat"
    : player.rotCardsInPlayerArea.some((c) => c.kind === "scenario")
      ? "scenario"
      : null;
  if (!kind) {
    // Shouldn't happen — isLocationAvailable guarantees either a Rot card or
    // (Faction 2+) Gold to pay with — but fail safe rather than throw mid-visit.
    return leaveArena(state);
  }
  return leaveArena(payArenaEntryFee(state, kind));
}

// "The Warriors Guild allows the visitor to perform actions at both the
// Market and the Artificer as though they had placed their action token on
// both." purchaseFromMarket/skipMarket now defer completeTurn when the
// pending Location is "warriorsGuild" (see turnEngine.ts) instead of ending
// the turn after the purchase half — so runArtificerVisit's own
// leaveArtificer/discardArtifactCard is what finally ends it here.
function runWarriorsGuildVisit(state: GameState, rng: () => number): GameState {
  const playerId = state.pendingAction!.playerId;
  const player = state.players[playerId];
  // Same "loadout is already solid" cap as the standalone Market — the
  // Guild's Artificer half (Rune Stones especially) is still worth doing
  // even once Weapon/Armor/Implement are set, so only the purchase half
  // skips.
  const idx = marketIndexToVisit(state, player);
  const afterMarket = resolveOnPurchaseIfPending(idx === -1 ? skipMarket(state) : purchaseFromMarket(state, idx, undefined, rng));
  return runArtificerVisit(afterMarket, rng);
}

// Same pattern as runWarriorsGuildVisit, for Library + Ancient Shrine.
function runScholarsGuildVisit(state: GameState, rng: () => number): GameState {
  const playerId = state.pendingAction!.playerId;
  const idx = bestLibraryIndex(state, state.players[playerId].gold);
  const afterLibrary = idx === -1 ? skipLibrary(state) : purchaseFromLibrary(state, idx, undefined, rng);
  return runAncientShrineVisit(afterLibrary, rng);
}

// Cleanup Phase step 1 resolves Arena combat and, when there's a real choice
// (both cards revealed, Faction < 3), pauses in "arenaReward" waiting for
// the winner to pick.
//
// Arena combat totals only ever count Artifact attack (see
// equippedArtifactAttackTotal in turnEngine.ts — Lore never enters the
// roll), so the Arena strategy takes the Artifact card whenever it would
// actually be an upgrade (chooseArtifactSlotToReplace — same "worthwhile"
// check used at the Artificer), since that's what improves their odds of
// winning future Arena combats. It only falls back to Lore when the
// Artifact offers no upgrade at all. Other strategies keep the simple
// raw-value comparison used everywhere else in this bot for card quality.
function chooseArenaReward(state: GameState, strategy: Strategy): "artifact" | "lore" {
  const reward = state.pendingArenaReward!;
  const artifactCard = reward.artifactCard;
  const loreCard = reward.loreCard;
  if (!artifactCard) return "lore";
  if (!loreCard) return "artifact";

  if (strategy === "arena") {
    const player = state.players[reward.playerId];
    return chooseArtifactSlotToReplace(player, artifactCard).worthwhile ? "artifact" : "lore";
  }

  const artifactVal = artifactCard.attack;
  const loreVal = loreCardValue(loreCard);
  return artifactVal >= loreVal ? "artifact" : "lore";
}

// Clears any pending Faction perks with the simplest possible answer before
// taking the Location's own action (some of those actions refuse to proceed
// while a perk is still queued).
//
// Exchange Faction 1/2 each grant "increase your Faction by 1 at any
// Location" (Faction 3 is a separate passive Mana benefit now — see
// placeActionToken's Exchange arrival handling in turnEngine.ts, not a
// perk at all) — every strategy but "balanced" skips this one (declining is
// always safe), but Cira spends it toward whichever of her Victory
// Condition's two remaining gaps needs it most, in priority order: Library,
// then Ancient Shrine (Scholars Guild access — see scoreLocations' "focus"
// branch, which races these same two Locations ahead of everything else
// until both hit Faction 3), then Valley (the Faction 3 reveal-ahead peek,
// once Guild access no longer needs the help). Each bump raises that exact
// counter without spending one of her own token-visits on it. Skips once
// all three are already at 3 (nothing left to bump anywhere useful) —
// resolveExchangeFactionBump throws on a target already at 3, so each
// candidate is checked before it's used.
function resolvePendingFactionPerks(state: GameState, strategy: Strategy): GameState {
  let s = state;
  while (s.pendingFactionPerks.length > 0) {
    const perk = s.pendingFactionPerks[0];
    if (perk.kind === "discardRefillRow") s = resolveRowRefillPerk(s, []);
    else if (perk.kind === "rotToMarketRow") s = skipRotToMarketRowPerk(s);
    else if (perk.kind === "guildFreeCard") {
      // Free card, no Gold cost to weigh — reuse bestMarketIndex/
      // bestLibraryIndex with an unlimited budget so it always takes the
      // best available Row card instead of the affordability-gated pick
      // those make for an actual purchase.
      const idx =
        perk.locationId === "warriorsGuild" ? bestMarketIndex(s, Infinity, s.players[perk.playerId]) : bestLibraryIndex(s, Infinity);
      s = idx === -1 ? skipGuildFreeCardPerk(s) : resolveGuildFreeCardPerk(s, idx);
    } else if (perk.kind === "exchangeFactionBump" && strategy === "balanced") {
      const player = s.players[perk.playerId];
      if ((player.factionTrack.library ?? 0) < 3) s = resolveExchangeFactionBump(s, "library");
      else if ((player.factionTrack.ancientShrine ?? 0) < 3) s = resolveExchangeFactionBump(s, "ancientShrine");
      else if ((player.factionTrack.valley ?? 0) < 3) s = resolveExchangeFactionBump(s, "valley");
      else s = skipExchangeFactionBump(s);
    } else s = skipExchangeFactionBump(s);
  }
  return s;
}

type LocationScore = { id: Parameters<typeof isLocationAvailable>[2]; score: number };

function scoreLocations(state: GameState, playerId: string, excludeValley: boolean, strategy: Strategy): LocationScore[] {
  const player = state.players[playerId];
  const candidates: LocationScore[] = [];

  // Once a Guild is unlocked (3 Faction at both underlying Locations), it
  // replaces separate visits to them entirely rather than just outscoring
  // them — the whole point of "perform actions at both X and Y as though
  // you had placed a token on both" is doing it in ONE token instead of two,
  // so leaving the standalone options on the table would waste that.
  const warriorsGuildEligible = isLocationAvailable(state, playerId, "warriorsGuild");
  const scholarsGuildEligible = isLocationAvailable(state, playerId, "scholarsGuild");

  // Threshold of 3, not just "has any Mana at all": a visit here only gets
  // ONE attunement loop, and declining a reveal (unaffordable or not
  // worthwhile) ends that loop immediately — see chooseArtifactSlotToReplace.
  // Rushing over with 1-2 Mana banked means the very first reveal is likely
  // to be unaffordable, burning the whole token on a single "no" instead of
  // attuning multiple cards in one visit once there's enough saved up.
  const artificerReady = player.manaPools.artifact >= 3 && (player.artifactDeck.length > 0 || player.artifactDiscard.length > 0);
  candidates.push({ id: "artificer", score: warriorsGuildEligible ? -1 : artificerReady ? 10 : 0 });

  const shrineReady = player.manaPools.lore >= 3 && (player.loreDeck.length > 0 || player.loreDiscard.length > 0);
  candidates.push({ id: "ancientShrine", score: scholarsGuildEligible ? -1 : shrineReady ? 9 : 0 });

  // "Focused on equipment purchases": Market outranks everything but a
  // forced/urgent override (Exchange piling up, a same-token Valley/Arena
  // mandate) whenever there's anything affordable to buy. Excluded outright
  // (score -1, not just 0) rather than merely deprioritized when nothing in
  // the Row is affordable — a score of 0 could still get chosen by the
  // ranked-fallback if every other option also scored 0, wasting a token on
  // a visit that was never going to buy anything. Also excluded once the
  // core loadout (Weapon/Armor/Implement, all Attack 2+) is already solid —
  // see hasSolidCoreLoadout — *unless* an affordable Rot-cleansing Rune
  // Stone the player doesn't have yet is sitting in the Row, which keeps
  // Market worthwhile regardless (see priorityRuneStoneRowIndex).
  const hasPriorityPick = priorityRuneStoneRowIndex(state, player, player.gold) !== -1;
  const marketAfford = hasPriorityPick || bestMarketIndex(state, player.gold) !== -1;
  const marketWorthwhile = marketAfford && (hasPriorityPick || !hasSolidCoreLoadout(player));
  candidates.push({ id: "market", score: warriorsGuildEligible || !marketWorthwhile ? -1 : strategy === "equipment" ? 25 : 7 });

  // Scored above both of its underlying Locations' own baselines (Artificer
  // 10 / Market 7-25) so it wins the comparison even though those two are
  // simultaneously excluded above, not just left to compete on score.
  candidates.push({ id: "warriorsGuild", score: warriorsGuildEligible ? (strategy === "equipment" ? 26 : 12) : -1 });

  // "Focused on Arena when possible": dominates every other choice whenever
  // it's actually available (requires a Rot card OR, at Arena Faction 2+, 1
  // Gold in the player area to pay entry — see isLocationAvailable's arena
  // case, applied by the caller's final filter below). Below Faction 2 (or
  // without Gold to spare), entry still trades away the same Rot cards the
  // Victory Condition needs (3 in player area) — a real tension, not a bug —
  // though runArenaVisit prefers paying Gold once that option exists.
  //
  // Gated on having at least 1 attuned Lore card first (meetsVictoryCondition
  // in turnEngine.ts requires >= 1): without this, an all-in Arena strategy
  // can spend the whole game racking up Rot cards and attack strength while
  // never actually attuning the one Lore card the Victory Condition needs,
  // so it never becomes eligible at all. Before that first attunement,
  // Arena scores the same as every other strategy (0) so Ancient Shrine/
  // Wellspring naturally win instead.
  //
  // Also gated on equipped Artifacts (Weapon/Armor/Implement/Rune Stones)
  // staying at 3 or fewer: past that, gear is no longer the bottleneck on
  // winning Arena combat (only Artifact attack counts there — see
  // equippedArtifactAttackTotal in turnEngine.ts), so continuing to prioritize
  // Arena just keeps trading away Rot cards the Victory Condition needs (see
  // above) for reward cards this player barely needs anymore. Dropping to 0
  // here lets Valley (score 8, since the Lore gate above already guarantees
  // attunedLore >= 1 whenever this branch is reachable) take over instead.
  const wellGeared = equippedArtifactCount(player) > 3;
  candidates.push({ id: "arena", score: strategy === "arena" && player.attunedLore.length >= 1 && !wellGeared ? 30 : 0 });

  // Same "don't visit for nothing" exclusion as Market — no equivalent
  // "loadout is solid" cap here, since that rule is specifically about
  // Artifact purchases (see hasSolidCoreLoadout); Lore is still worth
  // buying regardless of gear.
  const libraryAfford = bestLibraryIndex(state, player.gold) !== -1;
  candidates.push({ id: "library", score: scholarsGuildEligible || !libraryAfford ? -1 : 7 });
  candidates.push({ id: "scholarsGuild", score: scholarsGuildEligible ? 12 : -1 });

  const totalMana = player.manaPools.artifact + player.manaPools.lore;
  candidates.push({ id: "wellspring", score: totalMana < 6 ? 6 : 2 });

  // Scored just under Ancient Shrine: a player pursuing their Victory
  // Condition (which needs Rot cards in their player area) treats fighting
  // The Rot as close to as important as spending Mana, not as a last resort
  // — visiting also removes 1 Withering Token, which is the only thing that
  // slows the shared Rot Counter clock. An earlier version of this bot scored
  // Valley at 4 (below Market/Library/Wellspring), which meant it was never
  // visited at all — see the round-6-Rot-win report this script produced.
  // Once the Rot Counter reaches the danger zone, the mandatory-visit rule
  // below reserves Valley for each player's last token of the round, so
  // it's excluded here on any earlier token that round (excludeValley) —
  // otherwise a high score could still let a player wander into it early
  // and defeat the "last action" guarantee.
  candidates.push({ id: "valley", score: excludeValley ? -1 : player.attunedLore.length >= 1 ? 8 : 0 });

  // "The first Character each round to visit The Exchange takes all Gold on
  // the Location" — since it's uncapped and just keeps accumulating (+1 Gold
  // every Cleanup) until someone claims it, a large pile sitting unclaimed is
  // pure waste. Once it exceeds 3 Gold, claiming it outranks every other
  // Location (score 20, above Artificer's 10) so it gets grabbed the moment
  // any player has a free token — this only takes one visit per round to
  // resolve (the whole pile), unlike Valley's per-player requirement, and it
  // still loses to a same-token Valley mandate (that's a hard bypass above
  // this scoring, not a score comparison).
  const exchangeGoldPilingUp = state.exchangeGold > 3;
  const exchangeUseful = (player.gold === 0 && (player.manaPools.artifact >= 3 || player.manaPools.lore >= 3)) || state.exchangeGold > 0;
  candidates.push({ id: "exchange", score: exchangeGoldPilingUp ? 20 : exchangeUseful ? 5 : 1 });

  // "balanced" (Cira): a completely separate policy from the ternaries
  // above, not a variant threaded through them — spreads visits across
  // every Location based on current benefit and resource readiness instead
  // of fixating on whichever single Location scores highest.
  //
  // A Location's own Faction Track already tracks "times visited, capped at
  // 3" (applyFactionMilestone in turnEngine.ts clamps it there) — reused
  // directly as the visit count instead of tracking it separately. Below 2
  // visits, a less-visited Location is boosted over an equally-ready but
  // more-visited one; at 2 visits the boost drops away and the Location
  // competes purely on the same plain ("optimal") benefit score every other
  // strategy would use for it — the "cap of 2 visits... before reverting to
  // an optimal mechanic" this strategy was asked for. (The Location's own
  // Faction Track can still climb to 3 after that — this cap only governs
  // how much "balanced" itself prefers a repeat visit, not what the Location
  // grants.)
  //
  // Every candidate below is hard-excluded (-1), not just deprioritized,
  // when the resource it needs to actually benefit from a visit isn't there
  // yet (enough Mana banked, something affordable, a Rot card to pay Arena
  // entry, Lore attuned to fight with) — "balanced" never spends a token
  // somewhere it knows in advance won't pay off. Wellspring and Exchange
  // have no such prerequisite (a visit always does something), so they stay
  // eligible at a lower score instead of excluded outright.
  //
  // No Warriors Guild consolidation: unlike Scholars Guild (which Cira's own
  // Victory Condition needs), Warriors Guild has no bearing on her build, so
  // she just keeps visiting Market and Artificer individually — never
  // excluded once the Guild becomes eligible (which would otherwise lock her
  // out of both the moment they hit Faction 3 together), and the Guild
  // itself is never offered as an option.
  //
  // Scholars Guild access comes first, though: until Library and Ancient
  // Shrine are both at Faction 3, spreading evenly across all 8 Locations
  // (the "balanced" ethos below) actively works against the one thing her
  // Victory Condition actually needs — see the "focus" branch immediately
  // below, which races those two Locations ahead of the general spread.
  // Once both hit 3, this falls through to the normal "balanced" scoring.
  if (strategy === "balanced") {
    const visits = (id: LocationId) => player.factionTrack[id] ?? 0;
    const balance = (baseline: number, id: LocationId) => (visits(id) >= 2 ? baseline : baseline + (2 - visits(id)) * 5);
    const arenaReady = player.rotCardsInPlayerArea.length > 0;

    if (!scholarsGuildEligible) {
      // Library/Ancient Shrine score above everything else whenever either
      // is still short of Faction 3 — a visit always advances that
      // Location's own Faction Track regardless of whether anything's
      // affordable/attunable there, so unlike the resource-gated treatment
      // below, this is guaranteed progress toward Guild access even with
      // nothing to buy or attune. Library goes first (arbitrary but
      // consistent tie-break — total visits needed to get both to 3 is the
      // same either order). Everything else keeps its normal balanced/
      // resource-gated scoring so Wellspring still feeds Mana and Valley
      // still builds the Rot-card/Lore legs of her Victory Condition
      // in the meantime — this is a reordering of priority, not a
      // total-tunnel-vision policy that starves the rest of her build.
      const libraryLevel = visits("library");
      const shrineLevel = visits("ancientShrine");
      const focus: LocationScore[] = [
        { id: "library", score: libraryLevel < 3 ? 25 : -1 },
        { id: "ancientShrine", score: shrineLevel < 3 ? 24 : -1 },
        { id: "artificer", score: !artificerReady ? -1 : balance(10, "artificer") },
        { id: "valley", score: excludeValley || player.attunedLore.length < 1 ? -1 : balance(8, "valley") },
        { id: "arena", score: !arenaReady ? -1 : balance(8, "arena") },
        { id: "market", score: !marketWorthwhile ? -1 : balance(7, "market") },
        { id: "wellspring", score: balance(totalMana < 6 ? 6 : 2, "wellspring") },
        { id: "exchange", score: exchangeGoldPilingUp ? 20 : balance(exchangeUseful ? 5 : 1, "exchange") },
      ];
      return focus.filter((c) => isLocationAvailable(state, playerId, c.id) && c.score >= 0).sort((a, b) => b.score - a.score);
    }

    const balanced: LocationScore[] = [
      { id: "artificer", score: !artificerReady ? -1 : balance(10, "artificer") },
      { id: "ancientShrine", score: scholarsGuildEligible || !shrineReady ? -1 : balance(9, "ancientShrine") },
      { id: "market", score: !marketWorthwhile ? -1 : balance(7, "market") },
      { id: "arena", score: !arenaReady ? -1 : balance(8, "arena") },
      { id: "library", score: scholarsGuildEligible || !libraryAfford ? -1 : balance(7, "library") },
      { id: "scholarsGuild", score: scholarsGuildEligible ? 12 : -1 },
      { id: "wellspring", score: balance(totalMana < 6 ? 6 : 2, "wellspring") },
      { id: "valley", score: excludeValley || player.attunedLore.length < 1 ? -1 : balance(8, "valley") },
      { id: "exchange", score: exchangeGoldPilingUp ? 20 : balance(exchangeUseful ? 5 : 1, "exchange") },
    ];
    return balanced.filter((c) => isLocationAvailable(state, playerId, c.id) && c.score >= 0).sort((a, b) => b.score - a.score);
  }

  return candidates
    .filter((c) => isLocationAvailable(state, playerId, c.id) && c.score >= 0)
    .sort((a, b) => b.score - a.score);
}

// Anti-runaway-Rot measure, deliberately delayed: below Rot Counter 8,
// nobody is forced anywhere near Valley — every player (Taza included) just
// pursues their own strategy, building attack strength, Victory Condition
// progress, and the Gold/Mana the Final Battle will need. Once the Rot
// Counter reaches 8 (5 short of 13, the Rot's win condition — Cleanup step
// 7), that changes: every player's LAST Action Token of the round is forced
// to Valley, no exceptions — actually fighting is the only thing that
// removes Withering Tokens before they convert straight into Rot Counter,
// and by this point that's the only thing left worth spending a token on.
// Valley is excluded from every earlier token once the danger zone hits
// (see scoreLocations' excludeValley) so the mandatory visit is guaranteed
// to be the last thing a player does that round. `valleyVisitedThisRound` is
// reset by runRound at the start of each round; it also guards a player who
// somehow already visited (e.g. a caught placeActionToken failure
// elsewhere) from being forced again.
function takeOneTurn(
  state: GameState,
  rng: () => number,
  valleyVisitedThisRound: Set<string>,
  strategy: Strategy,
): { state: GameState; playerId: string; locationId: ReturnType<typeof scoreLocations>[number]["id"] } {
  let s = state;
  const playerId = s.playerOrder[s.activePlayerIndex];

  if (s.pendingDeepWatersClaim) {
    s = resolveDeepWatersClaim(s, null);
  }

  // Rot-cleansing policy, part 2 (see priorityRuneStoneRowIndex for part 1,
  // acquiring one): on a player's last Action Token of the round, if the
  // shared Withering Token count has reached the player count, discard the
  // Rune Stone to drain it — doesn't cost an Action Token itself, so this
  // just happens alongside whatever Location this token visits below.
  // Framed on "last" rather than a fixed token number (previously "3rd")
  // since Action Tokens per round now varies by player count (2 or 3 — see
  // actionTokensForPlayerCount) and can change independently of it, so a
  // fixed count would silently stop firing (or fire on the wrong token) the
  // next time that table changes.
  const isLastTokenThisRound = s.players[playerId].actionTokensRemaining === 1;
  if (isLastTokenThisRound && s.witheringTokens >= s.playerOrder.length) {
    const holder = s.players[playerId];
    const cleansingIdx = holder.equippedRuneStones.findIndex((r) => r.name === "Rune of Cleansing");
    const convergenceIdx = holder.equippedRuneStones.findIndex((r) => r.name === "Rune of Convergence");
    try {
      if (cleansingIdx >= 0) {
        s = discardCleansingRune(s, playerId, cleansingIdx);
      } else if (convergenceIdx >= 0) {
        s = discardConvergence(s, playerId, convergenceIdx, "rot");
      }
    } catch {
      // Shouldn't happen (no other Rune Stone choice should be pending at
      // this point in the turn), but don't let a stale precondition crash
      // the whole simulation over what's meant to be a free bonus action.
    }
  }

  // Trips 1 short of where it used to (was 9): with 13 as the Rot's win
  // condition, catching the climb a round earlier buys the mandatory
  // Valley response one more round to actually turn it around.
  const rotDangerZone = s.rotCounter >= 8;
  // Unconditional from round 5 on (independent of rotDangerZone): every
  // player's last Action Token every round after round 3 goes to The
  // Valley, to keep Rot-card/Victory-Condition progress flowing steadily
  // once the early game is done, not just as an emergency response once the
  // Rot Counter is already close to 13. Applies at every player count now
  // (previously gated to 3-4 players' 3-token rounds only) — see the
  // isLastTokenThisRound comment above for why "last" replaced a fixed count.
  const forcedValleyRound = s.round > 3 && isLastTokenThisRound;
  const mandatoryFightDue = ((rotDangerZone && isLastTokenThisRound) || forcedValleyRound) && !valleyVisitedThisRound.has(playerId);

  let placed = false;
  let locationId: ReturnType<typeof scoreLocations>[number]["id"] = "wellspring";

  if (mandatoryFightDue) {
    try {
      s = placeActionToken(s, playerId, "valley", rng);
      locationId = "valley";
      placed = true;
    } catch {
      placed = false;
    }
  }

  if (!placed) {
    // Reserve Valley for the token that's actually supposed to force it
    // (the last token, whether because of the danger zone or the round-4-on
    // rule) — otherwise the one-token-per-Location rule could let an
    // earlier token claim it first via normal scoring, making the
    // guaranteed visit below impossible for that round.
    const excludeValley = (rotDangerZone || s.round > 3) && !isLastTokenThisRound;
    const ranked = scoreLocations(s, playerId, excludeValley, strategy);
    for (const candidate of ranked.length > 0 ? ranked : [{ id: "wellspring" as const, score: 0 }]) {
      try {
        s = placeActionToken(s, playerId, candidate.id, rng);
        locationId = candidate.id;
        placed = true;
        break;
      } catch {
        continue;
      }
    }
    // Reserving Valley is best-effort, not a guarantee: in a crowded round
    // (more likely now that it's held back on every token but the last from
    // round 4 on) every other Location can end up already occupied by
    // other players. Rather than deadlock the whole simulation over a
    // scheduling nicety, fall back to considering Valley too before giving
    // up — it may still be free even though this token wasn't the "official"
    // reserved one.
    if (!placed && excludeValley) {
      const fallbackRanked = scoreLocations(s, playerId, false, strategy);
      for (const candidate of fallbackRanked.length > 0 ? fallbackRanked : [{ id: "wellspring" as const, score: 0 }]) {
        try {
          s = placeActionToken(s, playerId, candidate.id, rng);
          locationId = candidate.id;
          placed = true;
          break;
        } catch {
          continue;
        }
      }
    }
  }
  if (!placed) {
    throw new Error(`${playerId} could not place an Action Token anywhere.`);
  }

  s = resolvePendingFactionPerks(s, strategy);

  if (locationId === "wellspring") s = runWellspringVisit(s, rng);
  else if (locationId === "market") {
    // Belt-and-suspenders alongside scoreLocations' exclusion: this
    // shouldn't be reachable once the core loadout is solid and there's no
    // priority Rune Stone to grab (Market scores -1 there), but checking
    // again here means that guarantee doesn't depend on the scoring stack
    // staying exactly in sync. See marketIndexToVisit for the
    // aggressive-acquisition override.
    const idx = marketIndexToVisit(s, s.players[playerId]);
    s = resolveOnPurchaseIfPending(idx === -1 ? skipMarket(s) : purchaseFromMarket(s, idx, undefined, rng));
  } else if (locationId === "library") {
    const idx = bestLibraryIndex(s, s.players[playerId].gold);
    s = idx === -1 ? skipLibrary(s) : purchaseFromLibrary(s, idx, undefined, rng);
  } else if (locationId === "exchange") s = runExchangeVisit(s);
  else if (locationId === "artificer") s = runArtificerVisit(s, rng);
  else if (locationId === "ancientShrine") s = runAncientShrineVisit(s, rng);
  else if (locationId === "valley") s = runValleyVisit(s, rng, strategy);
  else if (locationId === "arena") s = runArenaVisit(s, playerId);
  else if (locationId === "warriorsGuild") s = runWarriorsGuildVisit(s, rng);
  else if (locationId === "scholarsGuild") s = runScholarsGuildVisit(s, rng);

  if (locationId === "valley") valleyVisitedThisRound.add(playerId);

  return { state: s, playerId, locationId };
}

function runRound(
  state: GameState,
  rng: () => number,
  strategyByPlayerId: Record<string, Strategy>,
): { state: GameState; visitsByPlayer: Record<string, string[]> } {
  let s = state;
  let guard = 0;
  const valleyVisitedThisRound = new Set<string>();
  const visitsByPlayer: Record<string, string[]> = {};
  while (s.phase === "action" && guard < 500) {
    const playerId = s.playerOrder[s.activePlayerIndex];
    const turn = takeOneTurn(s, rng, valleyVisitedThisRound, strategyByPlayerId[playerId]);
    s = turn.state;
    (visitsByPlayer[turn.playerId] ??= []).push(turn.locationId);
    guard++;
  }
  if (s.phase === "cleanup") {
    s = runCleanupPhase(s, rng);
  }
  // Cleanup Phase step 1 (Arena combat) can pause here waiting for the
  // winner to pick between the two revealed Arena Reward cards.
  if (s.phase === "arenaReward" && s.pendingArenaReward) {
    const winnerStrategy = strategyByPlayerId[s.pendingArenaReward.playerId];
    s = resolveArenaReward(s, chooseArenaReward(s, winnerStrategy), rng);
  }
  return { state: s, visitsByPlayer };
}

// --- The Final Battle ---------------------------------------------------------
// The Final Battle bot policy and driver (runFinalBattle) now live in
// ./finalBattleSim, shared with scripts/final-battle-sim.ts (the /testfinal
// harness). Only the pre-offer decline/accept scan (which has no equivalent
// there, since that harness starts already inside the fight) and the On
// Purchase free-attune helper (a normal-play mechanic, not Final-Battle-
// specific) stay here.

// "On Purchase: Attune 1 Lore card from your discard pile for free" (13
// core Implements, see turnEngine.ts) — same free-Attunement shape and
// worthwhile-check as Divine Reclamation (chooseDivineReclamationChoice,
// imported from ./finalBattleSim, shared with the Final Battle itself), so
// this reuses that choice function directly. The Rune Stone dig On Purchase
// variant needs no harness handling at all — it's fully automatic in the
// engine.
function resolveOnPurchaseIfPending(state: GameState): GameState {
  if (!state.pendingArtifactOnPurchase) return state;
  const player = state.players[state.pendingArtifactOnPurchase.playerId];
  const choice = chooseDivineReclamationChoice(player);
  return choice ? resolveOnPurchaseFreeLoreAttune(state, choice.discardIndex, choice.replaceIndex) : skipOnPurchaseFreeLoreAttune(state);
}

// Cleanup now checks the Rot Counter *first* (step 1, using the value
// carried over from the end of the previous Cleanup Phase) before this
// round's own +1 and Withering-Token conversion (steps 2 and 4 — step 3, a
// one-time Artifact equip for The Rot at Rot Counter milestones 3/6/9, sits
// between them but doesn't touch the counter) apply — see
// applyRotCleanupSteps in turnEngine.ts. That means the counter can already
// sit at 13+ by the time the Final Battle offer (step 11) is on the table
// this same Cleanup Phase, without the game having ended yet: nothing in
// the engine ever decreases rotCounter, so once it's >= 13 here, the *next*
// Cleanup Phase's step 1 is unconditionally going to end the game — no
// prediction needed, just a direct check. When true, initiating now
// (however undergeared) beats a guaranteed forced loss with zero attempt.
function rotWinsIfNobodyInitiates(state: GameState): boolean {
  return state.rotCounter >= 13;
}

// Resolves the Cleanup Phase 11 offer scan (docs/rules.md): every eligible
// player declines — buying more rounds to build Attack Strength — until
// rotWinsIfNobodyInitiates forces someone's hand (the Rot Counter is
// already at 13+, so declining further guarantees a loss with zero
// attempt). No longer accepts early just because Attack Strength looks
// "good enough" — every extra round spent building power before the
// Rot Counter forces the issue is a round better spent than fighting sooner.
// If everyone eligible this scan declines, cleanup finishes normally and
// runSimulation's round loop just keeps playing — meetsVictoryCondition
// stays true, so they're re-offered every future Cleanup phase until forced.
function resolveFinalBattleOffers(state: GameState): GameState {
  let s = state;
  while (s.phase === "finalBattleOffer" && s.pendingFinalBattleOffer) {
    if (rotWinsIfNobodyInitiates(s)) {
      return s;
    }
    s = declineFinalBattle(s);
  }
  return s;
}

// runFinalBattle (drives the whole Final Battle to its conclusion) and the
// FinalBattleCombatRecord type are imported from ./finalBattleSim.

export type SimMode = "full" | "ascensionOnly";

export interface SimResult {
  outcome: "gameWon" | "rotWins" | "roundCapReached" | "finalBattleEligible";
  round: number;
  eligiblePlayer: string | null; // who first met their Victory Condition and could start The Final Battle
  winner: string | null; // who actually defeated The Rot, once The Final Battle concludes (null if The Rot won it)
  finalState: GameState;
  finalBattleLog: FinalBattleCombatRecord[];
  history: {
    round: number;
    players: (ReturnType<typeof playerReport> & { strategy: Strategy; locations: string[] })[];
    rot: ReturnType<typeof rotReport>;
  }[];
}

export function runSimulation(
  playerCount: number,
  seed: number,
  roundCap: number,
  trackHistory: boolean,
  mode: SimMode,
  startingResources?: StartingResourceOverrides,
): SimResult {
  const rng = mulberry32(seed);
  const chosenCharacters: Character[] = buildAscensionRoster(playerCount);
  const strategies = assignStrategies(chosenCharacters);
  const strategyByPlayerId: Record<string, Strategy> = {};
  chosenCharacters.forEach((_, i) => {
    strategyByPlayerId[`p${i}`] = strategies[i];
  });

  let state = createGame(chosenCharacters, rng, startingResources);
  const history: SimResult["history"] = [];

  for (let round = 1; round <= roundCap; round++) {
    const roundResult = runRound(state, rng, strategyByPlayerId);
    state = roundResult.state;

    if (trackHistory) {
      history.push({
        round,
        players: state.playerOrder.map((id) => ({
          ...playerReport(state.players[id]),
          strategy: strategyByPlayerId[id],
          locations: roundResult.visitsByPlayer[id] ?? [],
        })),
        rot: rotReport(state),
      });
    }

    if (state.phase === "finalBattleOffer" && state.pendingFinalBattleOffer) {
      state = resolveFinalBattleOffers(state);
    }
    if (state.phase === "finalBattleOffer" && state.pendingFinalBattleOffer) {
      // eligiblePlayer names whoever's offer was actually accepted (always
      // forced now — see resolveFinalBattleOffers) — not necessarily the
      // first player who ever met their Victory Condition, since every
      // eligible player declines every offer until the Rot Counter forces
      // someone's hand.
      const eligiblePlayer = state.players[state.pendingFinalBattleOffer.playerId].character.name;

      // "ascensionOnly" mode is testing Ascension balance in isolation —
      // stop the moment someone's eligible rather than also playing out
      // (and having this result reflect) Final Battle balance too.
      if (mode === "ascensionOnly") {
        return {
          outcome: "finalBattleEligible",
          round,
          eligiblePlayer,
          winner: null,
          finalState: state,
          finalBattleLog: [],
          history,
        };
      }

      const { state: afterBattle, combatLog } = runFinalBattle(state, rng);
      const winnerEntry = afterBattle.finalRanking?.find((e) => e.isWinner) ?? null;
      const winner = winnerEntry ? afterBattle.players[winnerEntry.playerId].character.name : null;
      return {
        outcome: winner ? "gameWon" : "rotWins",
        round,
        eligiblePlayer,
        winner,
        finalState: afterBattle,
        finalBattleLog: combatLog,
        history,
      };
    }
    if (state.phase === "gameOver") {
      return { outcome: "rotWins", round, eligiblePlayer: null, winner: null, finalState: state, finalBattleLog: [], history };
    }
  }
  return {
    outcome: "roundCapReached",
    round: roundCap,
    eligiblePlayer: null,
    winner: null,
    finalState: state,
    finalBattleLog: [],
    history,
  };
}
