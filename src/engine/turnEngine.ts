// Copyright © 2026 Steve Empey
import { artifacts } from "../data/artifacts";
import { locations } from "../data/locations";
import { loreCards } from "../data/loreCards";
import { rotCombatCards, rotScenarioCards } from "../data/rotCards";
import { runeStonesAsArtifacts } from "../data/runeStones";
import type { ArtifactCard, Character, LocationId, LoreCard, RotCombatCard, RotCreatureType } from "../types/game";
import type {
  CharacterBoardSlotRef,
  EnginePlayer,
  FinalRankingEntry,
  GameState,
  ManaPools,
  PendingFactionPerk,
  PendingFinalBattleOutcome,
  PendingValleyOutcome,
  RotCard,
  WhisperedDeckChoice,
} from "./types";

// Rulebook: "3 Action Tokens per player when playing with 1 to 3 players.
// 2 Action Tokens per player when playing with 4, 5, or 6 players."
export function actionTokensForPlayerCount(playerCount: number): number {
  return playerCount <= 3 ? 3 : 2;
}

// Setup, "Distribute Gold, Mana, and Action Tokens based on the number of
// players" — Gold and Mana scale down as the table fills up; Solo Play (1
// player) is just that table's own row, not a separate override anymore.
// Mana is no longer a fixed multiple of Gold (4 players breaks that pattern:
// 2 Gold but only 2 total Mana), so each is its own table; Mana splits
// evenly across both Attunement Pools.
export const STARTING_GOLD_BY_PLAYER_COUNT: Record<number, number> = { 1: 6, 2: 5, 3: 4, 4: 2, 5: 1, 6: 1 };
export const STARTING_MANA_BY_PLAYER_COUNT: Record<number, number> = { 1: 12, 2: 10, 3: 8, 4: 2, 5: 2, 6: 2 };
function startingGoldForPlayerCount(playerCount: number): number {
  return STARTING_GOLD_BY_PLAYER_COUNT[playerCount];
}

// Lets a test harness (scripts/ascensionSim.ts's runSimulation, in turn used
// by scripts/playtest-sim.ts and src/TestAscensionPanel.tsx) start a
// simulated game off-curve from the rulebook's player-count tables above —
// e.g. to see how balance shifts with a richer or poorer opening hand — while
// real gameplay (GameBoard.tsx's createGame call) keeps using the tables via
// the defaults below when no override is passed. `mana` is the same total
// mana the STARTING_MANA_BY_PLAYER_COUNT table reports (split evenly across
// both Attunement Pools), not a per-pool amount.
export interface StartingResourceOverrides {
  gold?: number;
  mana?: number;
  actionTokens?: number;
}

const CORE_LOCATION_IDS: LocationId[] = locations
  .filter((l) => l.hasFactionTrack)
  .map((l) => l.id);

// Locations whose action needs player choices resolved before the turn can
// advance. Every other location auto-resolves as a no-op (not built yet).
// Warriors/Scholars Guild visits resolve through the same functions as their
// two underlying Locations (see requirePendingLocation's array form) — the
// Guild's own pendingAction.locationId just accepts both.
const LOCATIONS_REQUIRING_RESOLUTION = new Set<LocationId>([
  "wellspring",
  "market",
  "library",
  "exchange",
  "artificer",
  "ancientShrine",
  "valley",
  "arena",
  "warriorsGuild",
  "scholarsGuild",
]);

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function rollD6(rng: () => number): number {
  return Math.floor(rng() * 6) + 1;
}

// Shar's power, Cleansing Fire: "When attacking The Rot, you may reroll one
// die showing a 1 or 2." Always worth taking — a reroll can't do worse — so
// applied automatically rather than as a choice, mirroring the Wellspring
// Faction 1 reroll's precedent. Shared by Valley combat and the Final
// Battle, the two places a player rolls dice "attacking The Rot."
function rollAttackDice(character: Character, rng: () => number): [number, number] {
  const dice: [number, number] = [rollD6(rng), rollD6(rng)];
  if (character.name === "Shar, Warrior of the Light") {
    const lowIndex = dice[0] <= 2 ? 0 : dice[1] <= 2 ? 1 : -1;
    if (lowIndex !== -1) {
      dice[lowIndex] = rollD6(rng);
    }
  }
  return dice;
}

// Taza's power, Wield the Rot: "Once per combat, remove 1 Withering Token
// from The Rot to gain +2 Attack." Opt-in per-combat (like Rune of
// Prophecy below) rather than automatic — spends the shared board's
// Withering Token count, so whenever it's available it's a pure win for the
// whole table (one less token feeding the Rot Counter's later climb, see
// applyRotCleanupSteps), not just Taza's own Attack. Shared by the same 2
// combat contexts (Valley, Final Battle); "once per combat" falls out of
// chooseValleyLore/chooseFinalBattleLore only ever running once per combat
// themselves (a Rune of Fracture reroll pause resolves the same combat, not
// a new one; Press the Attack explicitly starts a fresh one).
function resolveWieldTheRot(
  player: EnginePlayer,
  witheringTokens: number,
  requested: boolean | undefined,
): { witheringTokens: number; bonus: number; note: string } {
  if (!requested) return { witheringTokens, bonus: 0, note: "" };
  if (player.character.name !== "Taza, the Shadow Knight") {
    throw new Error(`${player.character.name} doesn't have Wield the Rot.`);
  }
  if (witheringTokens < 1) {
    throw new Error("There are no Withering Tokens on The Rot to remove.");
  }
  return { witheringTokens: witheringTokens - 1, bonus: 2, note: ", removing 1 Withering Token from The Rot" };
}

export function createGame(
  characters: Character[],
  rng: () => number = Math.random,
  startingResources?: StartingResourceOverrides,
): GameState {
  if (characters.length < 1 || characters.length > 6) {
    throw new Error("Withering Worship supports 1-6 players.");
  }

  const tokenCount = startingResources?.actionTokens ?? actionTokensForPlayerCount(characters.length);
  const playerOrder = characters.map((_, i) => `p${i}`);
  const players: Record<string, EnginePlayer> = {};
  // Setup, "Distribute Gold, Mana, and Action Tokens based on the number of
  // players."
  const startingGold = startingResources?.gold ?? startingGoldForPlayerCount(characters.length);
  const startingManaPerPool = (startingResources?.mana ?? STARTING_MANA_BY_PLAYER_COUNT[characters.length]) / 2;

  // Setup step 2: each player's starting Artifact Deck is their
  // character-specific Starter Set Weapon/Armor/Implement; their starting
  // Lore Deck is 2 cards drawn from the shared "Divine Presence" Starter Set
  // pool (12 total — exactly enough for 6 players at 2 each).
  const starterLorePool = shuffle(
    loreCards.filter((c) => c.type === "Starter Set"),
    rng,
  );

  characters.forEach((character, i) => {
    const id = playerOrder[i];
    const factionTrack: Partial<Record<LocationId, number>> = {};
    CORE_LOCATION_IDS.forEach((loc) => {
      factionTrack[loc] = 0;
    });
    // Starter Set artifact cards are named by the character's short name
    // ("Shar"), while Character.name is the full display name ("Shar,
    // Warrior of the Light") — match on the part before the comma.
    const shortName = character.name.split(",")[0].trim();
    const startingArtifacts = artifacts.filter((a) => a.type === "Starter Set" && a.name === shortName);
    const startingLore = starterLorePool.splice(0, 2);
    players[id] = {
      id,
      character,
      actionTokensRemaining: tokenCount,
      gold: startingGold,
      manaPools: { artifact: startingManaPerPool, lore: startingManaPerPool },
      witheringTokens: { artifact: 0, lore: 0 },
      artifactDeck: shuffle(startingArtifacts, rng),
      artifactDiscard: [],
      loreDeck: shuffle(startingLore, rng),
      loreDiscard: [],
      equippedRuneStones: [],
      attunedLore: [],
      rotCardsInPlayerArea: [],
      factionTrack,
    };
  });

  // Rulebook: "The Artifact Deck contains: Weapons, Armor, Implements, Rune
  // Stones." Starter Set cards are character-specific starting equipment,
  // not part of the shared deck.
  const marketSource: ArtifactCard[] = [
    ...artifacts.filter((a) => a.type !== "Starter Set"),
    ...runeStonesAsArtifacts,
  ];
  const artifactDeck = shuffle(marketSource, rng);
  const artifactRow: (ArtifactCard | null)[] = [
    artifactDeck.shift() ?? null,
    artifactDeck.shift() ?? null,
    artifactDeck.shift() ?? null,
  ];

  // The shared Library supply excludes the Starter Set "Divine Presence"
  // cards, which are reserved for players' personal starting Lore Decks.
  const librarySource = loreCards.filter((c) => c.type !== "Starter Set");
  const loreDeck = shuffle(librarySource, rng);
  const loreRow: (LoreCard | null)[] = [loreDeck.shift() ?? null, loreDeck.shift() ?? null, loreDeck.shift() ?? null];

  // Setup step 6: "Shuffle the Rot Deck." The deck holds both Combat and
  // Scenario cards (see docs/rules.md, "Rot Cards").
  const rotDeck: RotCard[] = shuffle(
    [
      ...rotCombatCards.map((card): RotCard => ({ kind: "combat", card })),
      ...rotScenarioCards.map((card): RotCard => ({ kind: "scenario", card })),
    ],
    rng,
  );

  const initialState: GameState = {
    round: 1,
    playerOrder,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    players,
    locationTokens: {},
    pendingAction: null,
    pendingWellspringRoll: null,
    pendingReveal: null,
    pendingRotPeek: null,
    pendingArtifactPeek: null,
    pendingArenaPeek: null,
    pendingArenaReward: null,
    pendingFinalBattleOffer: null,
    pendingFinalBattleBoon: null,
    pendingFinalBattleCombat: null,
    pendingFinalBattleOutcome: null,
    finalBattleBoonClaimed: false,
    pendingFactionPerks: [],
    pendingValleyScry: null,
    pendingValleyEncounter: null,
    pendingValleyOutcome: null,
    pendingForesightChoice: null,
    pendingEmbraceStep: null,
    pendingDeepWatersClaim: null,
    artifactRowClaim: null,
    pendingActionCancel: null,
    pendingArtifactOnPurchase: null,
    finalRanking: null,
    pendingRuneStoneChoice: null,
    pendingValleyPremonition: null,
    pendingValleyAttackRoll: null,
    pendingFinalBattleAttackRoll: null,
    artifactDeck,
    artifactDiscard: [],
    artifactRow,
    loreDeck,
    loreDiscard: [],
    loreRow,
    rotArtifacts: [],
    rotDeck,
    rotDiscard: [],
    exchangeGold: 1, // Setup: "Place 1 Gold on location 'The Exchange.'"
    rotCounter: 0,
    rotGearMilestonesReached: [],
    witheringTokens: 0,
    finalBattleDefeatedPlayerIds: [],
    phase: "action",
    log: [`Round 1 begins. ${characters[0].name} is First Player.`],
  };

  return withDeepWatersOffer(initialState, 0);
}

function isWarriorsGuildUnlocked(player: EnginePlayer): boolean {
  return (player.factionTrack.market ?? 0) >= 3 && (player.factionTrack.artificer ?? 0) >= 3;
}

function isScholarsGuildUnlocked(player: EnginePlayer): boolean {
  return (player.factionTrack.library ?? 0) >= 3 && (player.factionTrack.ancientShrine ?? 0) >= 3;
}

export function isLocationAvailable(state: GameState, playerId: string, locationId: LocationId): boolean {
  const player = state.players[playerId];
  if (!player) return false;

  // "A player may have only 1 of their Action Tokens on any Location.
  // Multiple players may place Action Tokens on the same Location." Checked
  // live against locationTokens (reset every round in Cleanup) rather than a
  // separate "visited" flag, so Rune of Reversal — which withdraws a placed
  // token back to the player's board — correctly reopens that Location for
  // a later visit the same round.
  if ((state.locationTokens[locationId] ?? []).includes(playerId)) return false;

  if (locationId === "warriorsGuild") return isWarriorsGuildUnlocked(player);
  if (locationId === "scholarsGuild") return isScholarsGuildUnlocked(player);

  if (locationId === "arena") {
    // Solo Play rule: "The Arena is unavailable, you may not place an Action Token there."
    if (state.playerOrder.length === 1) return false;
    // Entering costs 1 Rot Card, or — Faction 2 benefit — 1 Gold instead.
    // Nothing to pay with either way means nothing to enter with.
    const canPayRotCard = player.rotCardsInPlayerArea.length > 0;
    const canPayGold = (player.factionTrack.arena ?? 0) >= 2 && player.gold >= 1;
    return canPayRotCard || canPayGold;
  }

  return true;
}

interface FactionMilestoneResult {
  factionTrack: Partial<Record<LocationId, number>>;
  manaPools: ManaPools;
  witheringTokens: ManaPools;
  gold: number;
  actionTokensGained: number;
  newPerks: PendingFactionPerk[];
  logLines: string[];
}

// Rulebook: "Most advances grant one time benefits" — applied the instant a
// Location's Faction track ticks up a level, separate from that Location's
// own per-visit action. Automatic benefits (Mana, Withering Tokens, Gold) are
// applied directly here; benefits needing a player choice (which Row cards
// to discard, which Location to bump) are returned as newPerks for the
// caller to queue onto GameState.pendingFactionPerks.
function applyFactionMilestone(
  characterName: string,
  locationId: LocationId,
  playerId: string,
  factionTrack: Partial<Record<LocationId, number>>,
  manaPools: ManaPools,
  witheringTokens: ManaPools,
  gold: number,
): FactionMilestoneResult {
  const current = factionTrack[locationId] ?? 0;
  const newLevel = Math.min(3, current + 1);
  const nextFactionTrack = { ...factionTrack, [locationId]: newLevel };

  if (current === newLevel) {
    // Already at Faction 3 — nothing further to grant.
    return { factionTrack: nextFactionTrack, manaPools, witheringTokens, gold, actionTokensGained: 0, newPerks: [], logLines: [] };
  }

  let nextManaPools = manaPools;
  let nextWitheringTokens = witheringTokens;
  let nextGold = gold;
  let actionTokensGained = 0;
  const newPerks: PendingFactionPerk[] = [];
  const logLines: string[] = [];

  if (locationId === "artificer" && newLevel === 1) {
    nextManaPools = { ...nextManaPools, artifact: nextManaPools.artifact + 4 };
    logLines.push(`${characterName} receives 4 Mana in their Artifact Attunement pool (Faction 1 benefit).`);
  }
  if (locationId === "ancientShrine" && newLevel === 1) {
    nextManaPools = { ...nextManaPools, lore: nextManaPools.lore + 4 };
    logLines.push(`${characterName} receives 4 Mana in their Lore Attunement pool (Faction 1 benefit).`);
  }
  if (locationId === "valley" && (newLevel === 1 || newLevel === 2)) {
    nextWitheringTokens = { artifact: nextWitheringTokens.artifact + 1, lore: nextWitheringTokens.lore + 1 };
    logLines.push(`${characterName} places a Withering Token in each of their Mana Pools (Valley Faction benefit).`);
  }
  if (locationId === "market" && newLevel === 1) {
    newPerks.push({ kind: "discardRefillRow", playerId, locationId: "market" });
  }
  if (locationId === "market" && newLevel === 2) {
    newPerks.push({ kind: "rotToMarketRow", playerId });
  }
  if (locationId === "library" && (newLevel === 1 || newLevel === 2)) {
    newPerks.push({ kind: "discardRefillRow", playerId, locationId: "library" });
  }
  if (locationId === "exchange" && (newLevel === 1 || newLevel === 2)) {
    newPerks.push({ kind: "exchangeFactionBump", playerId });
  }
  // Exchange Faction 3 and Arena Faction 2 are both passive, ongoing
  // benefits instead of one-time perks — see placeActionToken's Exchange
  // arrival handling, and payArenaEntryFee's "gold" kind, for where they
  // actually apply (every visit from here on, not just this one).

  // Warriors/Scholars Guild Faction 1: "Place a card from the [Artifact/
  // Lore] Row into your [Artifact/Lore] discard pile" — a free acquisition,
  // needs the player to pick which Row card (or decline), same shape as
  // Market/Library's discardRefillRow perk.
  if ((locationId === "warriorsGuild" || locationId === "scholarsGuild") && newLevel === 1) {
    newPerks.push({ kind: "guildFreeCard", playerId, locationId });
  }
  // Faction 2: "Add 3 Mana to your [Artifact/Lore] Mana Pool" — immediate,
  // automatic.
  if (locationId === "warriorsGuild" && newLevel === 2) {
    nextManaPools = { ...nextManaPools, artifact: nextManaPools.artifact + 3 };
    logLines.push(`${characterName} gains 3 Mana in their Artifact Attunement pool (Warriors Guild Faction 2 benefit).`);
  }
  if (locationId === "scholarsGuild" && newLevel === 2) {
    nextManaPools = { ...nextManaPools, lore: nextManaPools.lore + 3 };
    logLines.push(`${characterName} gains 3 Mana in their Lore Attunement pool (Scholars Guild Faction 2 benefit).`);
  }
  // Faction 3: "Recall one of your Action Tokens, you may immediately play
  // it again." Prototype simplification: this refunds the token that just
  // triggered the milestone (the one placed on the Guild itself), giving the
  // player 1 extra Action Token to spend this round — but it does NOT jump
  // the turn order, unlike the printed "immediately." nextActivePlayerIndex
  // always advances past the current player, so this player's bonus token
  // gets used on their *next* normal turn this round, not right away. A
  // true "interrupt turn order for an extra go now" implementation would
  // need a new pending-state field threaded through completeTurn — flagged
  // here as a real gap before this could ship, not silently glossed over.
  if ((locationId === "warriorsGuild" || locationId === "scholarsGuild") && newLevel === 3) {
    actionTokensGained += 1;
    logLines.push(`${characterName} recalls their Action Token, gaining 1 extra Action Token to spend this round (Faction 3 benefit).`);
  }

  return {
    factionTrack: nextFactionTrack,
    manaPools: nextManaPools,
    witheringTokens: nextWitheringTokens,
    gold: nextGold,
    actionTokensGained,
    newPerks,
    logLines,
  };
}

function assertNoPendingFactionPerk(state: GameState, playerId: string): void {
  if (state.pendingFactionPerks.some((p) => p.playerId === playerId)) {
    throw new Error("Resolve the pending Faction perk before continuing.");
  }
}

// Cleansing: "When a Withering Token is placed in one of your Mana Pools,
// you must spend 1 Mana from that Pool to remove the Withering Token before
// you may spend Mana from that Pool for any other purpose." Called by every
// function that spends Mana (Attuning, Exchange's Mana-for-Gold) — gaining
// Mana (Wellspring, Exchange's Gold-for-Mana) is unaffected.
function assertPoolNotTainted(player: EnginePlayer, pool: "artifact" | "lore"): void {
  if (player.witheringTokens[pool] > 0) {
    throw new Error(
      `${player.character.name} must cleanse the Withering Token in their ${pool === "artifact" ? "Artifact" : "Lore"} pool before spending Mana there.`,
    );
  }
}

// Cleansing's prerequisite step — spend 1 Mana from a pool to remove 1
// Withering Token from it. Not tied to any particular Location (the pools
// and tokens belong to the player, not a Location), just to the player's own
// turn — matching how the rest of the engine scopes actions, in the absence
// of a rulebook restriction narrower than that.
export function cleansePool(state: GameState, playerId: string, pool: "artifact" | "lore"): GameState {
  if (state.phase !== "action" || state.playerOrder[state.activePlayerIndex] !== playerId) {
    throw new Error("It is not this player's turn.");
  }
  const player = state.players[playerId];
  if (player.witheringTokens[pool] <= 0) {
    throw new Error(`${player.character.name} has no Withering Tokens in that pool to cleanse.`);
  }
  if (player.manaPools[pool] < 1) {
    throw new Error(`${player.character.name} doesn't have 1 Mana in that pool to cleanse with.`);
  }

  const updatedPlayer: EnginePlayer = {
    ...player,
    manaPools: { ...player.manaPools, [pool]: player.manaPools[pool] - 1 },
    witheringTokens: { ...player.witheringTokens, [pool]: player.witheringTokens[pool] - 1 },
  };

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    log: [
      ...state.log,
      `${player.character.name} spends 1 Mana to cleanse a Withering Token from their ${pool === "artifact" ? "Artifact" : "Lore"} pool.`,
    ],
  };
}

// A single id is the common case; an array lets a Guild visit ("The
// Warriors Guild allows the visitor to perform actions at both the Market
// and the Artificer as though they had placed their action token on both")
// satisfy the same check as its two underlying Locations — see the
// Artificer/Ancient Shrine call sites that accept ["artificer",
// "warriorsGuild"] / ["ancientShrine", "scholarsGuild"], and the matching
// inline checks in purchaseFromMarket/purchaseFromLibrary.
function requirePendingLocation(state: GameState, locationId: LocationId | LocationId[]): string {
  const ids = Array.isArray(locationId) ? locationId : [locationId];
  if (!state.pendingAction || !ids.includes(state.pendingAction.locationId)) {
    throw new Error(`${ids.join(" or ")} is not the pending action.`);
  }
  return state.pendingAction.playerId;
}

function nextActivePlayerIndex(state: GameState): number | null {
  const { playerOrder, players, activePlayerIndex } = state;
  for (let step = 1; step <= playerOrder.length; step++) {
    const idx = (activePlayerIndex + step) % playerOrder.length;
    if (players[playerOrder[idx]].actionTokensRemaining > 0) return idx;
  }
  return null;
}

// Kael's power, Deep Waters: "At the start of your turn, place one of your
// mana tokens on a face-up Artifact card." Not tied to any Location, so it's
// offered the instant it becomes Kael's turn — called from createGame (the
// very first turn) and completeTurn (every turn after). Declining is treated
// as valid (see resolveDeepWatersClaim) for the same reason as this
// codebase's other "place/choose" abilities: nothing forces the choice, and
// an empty Artifact Row would make a hard requirement awkward.
function withDeepWatersOffer(state: GameState, activePlayerIndex: number): GameState {
  const player = state.players[state.playerOrder[activePlayerIndex]];
  if (player.character.name !== "Kael, the Tidecaller") {
    return state;
  }
  return { ...state, pendingDeepWatersClaim: { playerId: player.id } };
}

// `rowIndex: null` declines. Replaces (doesn't stack with) any earlier claim
// — see ArtifactRowClaim. purchaseFromMarket enforces the discount/lock this
// creates.
export function resolveDeepWatersClaim(state: GameState, rowIndex: number | null): GameState {
  if (!state.pendingDeepWatersClaim) {
    throw new Error("There is no Deep Waters claim to resolve.");
  }
  const { playerId } = state.pendingDeepWatersClaim;
  const player = state.players[playerId];

  if (rowIndex === null) {
    return {
      ...state,
      pendingDeepWatersClaim: null,
      log: [...state.log, `${player.character.name} does not claim a card this turn (Deep Waters).`],
    };
  }
  const card = state.artifactRow[rowIndex];
  if (!card) {
    throw new Error("There is no card in that Artifact Row position.");
  }

  return {
    ...state,
    pendingDeepWatersClaim: null,
    artifactRowClaim: { rowIndex, playerId },
    log: [
      ...state.log,
      `${player.character.name} places a Mana Token on ${card.name} (Deep Waters) — 1 Gold cheaper for them, unpurchasable by others.`,
    ],
  };
}

// Clears any pending action/roll and hands the turn to the next player with
// Action Tokens remaining, or moves to the Cleanup Phase if none remain.
function completeTurn(state: GameState): GameState {
  let nextState: GameState = {
    ...state,
    pendingAction: null,
    pendingWellspringRoll: null,
    pendingReveal: null,
    pendingRotPeek: null,
    pendingArtifactPeek: null,
    pendingArenaPeek: null,
    pendingValleyScry: null,
    pendingValleyEncounter: null,
    pendingValleyOutcome: null,
    pendingForesightChoice: null,
    pendingEmbraceStep: null,
    pendingDeepWatersClaim: null,
    pendingActionCancel: null,
  };

  const nextIdx = nextActivePlayerIndex(nextState);
  if (nextIdx === null) {
    nextState = {
      ...nextState,
      phase: "cleanup",
      log: [...nextState.log, "All Action Tokens are placed. Proceed to the Cleanup Phase."],
    };
  } else {
    nextState = withDeepWatersOffer({ ...nextState, activePlayerIndex: nextIdx }, nextIdx);
  }

  return nextState;
}

// Rulebook: "Beginning with the First Player and proceeding clockwise, players
// take turns placing one Action Token and resolving the selected action. Play
// continues until all players have used their Action Tokens."
export function placeActionToken(
  state: GameState,
  playerId: string,
  locationId: LocationId,
  rng: () => number = Math.random,
): GameState {
  if (state.phase !== "action") {
    throw new Error("Cannot place a token outside the Action phase.");
  }
  if (state.playerOrder[state.activePlayerIndex] !== playerId) {
    throw new Error("It is not this player's turn.");
  }
  if (state.pendingDeepWatersClaim) {
    throw new Error("Resolve Kael's Deep Waters claim before placing an Action Token.");
  }
  if (state.pendingArtifactOnPurchase) {
    throw new Error("Resolve the On Purchase bonus before placing another Action Token.");
  }

  // Captured before any of this function's own effects apply — cancelLocationVisit
  // rolls back to this exact state if the player backs out before doing anything else.
  const preVisitState = state;

  const player = state.players[playerId];
  if (player.actionTokensRemaining <= 0) {
    throw new Error("This player has no Action Tokens remaining.");
  }
  if (!isLocationAvailable(state, playerId, locationId)) {
    throw new Error("That Location is not available right now.");
  }

  const locationDef = locations.find((l) => l.id === locationId)!;

  let updatedFactionTrack = player.factionTrack;
  let manaPools = player.manaPools;
  let witheringTokens = player.witheringTokens;
  let gold = player.gold;
  let actionTokensGained = 0;
  let newFactionPerks: PendingFactionPerk[] = [];
  const milestoneLogLines: string[] = [];
  if (locationDef.hasFactionTrack) {
    const milestone = applyFactionMilestone(
      player.character.name,
      locationId,
      playerId,
      player.factionTrack,
      player.manaPools,
      player.witheringTokens,
      player.gold,
    );
    updatedFactionTrack = milestone.factionTrack;
    manaPools = milestone.manaPools;
    witheringTokens = milestone.witheringTokens;
    gold = milestone.gold;
    actionTokensGained = milestone.actionTokensGained;
    newFactionPerks = milestone.newPerks;
    milestoneLogLines.push(...milestone.logLines);
  }

  const updatedPlayer: EnginePlayer = {
    ...player,
    actionTokensRemaining: player.actionTokensRemaining - 1 + actionTokensGained,
    factionTrack: updatedFactionTrack,
    manaPools,
    witheringTokens,
    gold,
  };

  const updatedLocationTokens = { ...state.locationTokens };
  updatedLocationTokens[locationId] = [...(updatedLocationTokens[locationId] ?? []), playerId];

  const factionLevel = updatedFactionTrack[locationId];
  const factionNote = locationDef.hasFactionTrack
    ? ` (Faction now ${factionLevel}${factionLevel === 3 ? " — max" : ""})`
    : "";

  const log = [
    ...state.log,
    `${player.character.name} places an Action Token on ${locationDef.name}.${factionNote}`,
    ...milestoneLogLines,
  ];

  let nextState: GameState = {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    locationTokens: updatedLocationTokens,
    pendingFactionPerks: [...state.pendingFactionPerks, ...newFactionPerks],
    log,
  };

  // Rulebook: "The first Character each round to visit The Exchange takes all
  // Gold on the Location." Automatic — not a choice, so it happens on arrival
  // rather than waiting for the Exchange panel's resolution.
  if (locationId === "exchange" && nextState.exchangeGold > 0) {
    const claimed = nextState.exchangeGold;
    const claimingPlayer = nextState.players[playerId];
    nextState = {
      ...nextState,
      players: {
        ...nextState.players,
        [playerId]: { ...claimingPlayer, gold: claimingPlayer.gold + claimed },
      },
      exchangeGold: 0,
      log: [...nextState.log, `${claimingPlayer.character.name} takes ${claimed} Gold from The Exchange.`],
    };
  }

  // Exchange Faction 3: "Whenever you place an Action Token on The Exchange,
  // add 1 Mana to each of your Mana Pools." Passive and ongoing — applies to
  // this same visit if it's the one that just reached level 3, and to every
  // visit after that (unlike Faction 1/2's one-time bump-elsewhere perk).
  if (locationId === "exchange" && (updatedFactionTrack.exchange ?? 0) >= 3) {
    const boostedPlayer = nextState.players[playerId];
    nextState = {
      ...nextState,
      players: {
        ...nextState.players,
        [playerId]: {
          ...boostedPlayer,
          manaPools: { artifact: boostedPlayer.manaPools.artifact + 1, lore: boostedPlayer.manaPools.lore + 1 },
        },
      },
      log: [...nextState.log, `${boostedPlayer.character.name} gains 1 Mana in each Mana Pool (Exchange Faction 3 benefit).`],
    };
  }

  // Rulebook: "Upon placing an Action Token on The Valley, remove 1 Withering
  // Token from the board, then reveal the top card of the Rot Deck." Both
  // automatic — the encounter is decided by the reveal, not the player. At
  // Faction 3, an optional peek (see peekValleyRotCard) happens first. Rune of
  // Premonition ("discard when revealing a Rot card...") needs that same
  // pre-reveal pause even without Faction 3, since it also has to happen
  // before the automatic reveal — see discardPremonition.
  if (locationId === "valley") {
    const witheringBefore = nextState.witheringTokens;
    const witheringAfter = Math.max(0, witheringBefore - 1);
    const witheringLog = [...nextState.log];
    if (witheringBefore > 0) {
      witheringLog.push(`${player.character.name} removes 1 Withering Token from The Rot (now ${witheringAfter}).`);
    }
    nextState = { ...nextState, witheringTokens: witheringAfter, log: witheringLog };

    const hasPremonition = updatedPlayer.equippedRuneStones.some((r) => r.name === "Rune of Premonition");
    if ((updatedFactionTrack.valley ?? 0) >= 3 || hasPremonition) {
      nextState = { ...nextState, pendingValleyScry: { stage: "offered" } };
    } else {
      nextState = revealValleyCard(nextState, playerId, rng);
      if (!nextState.pendingValleyEncounter && !nextState.pendingForesightChoice) {
        return completeTurn(nextState);
      }
    }
  }

  if (LOCATIONS_REQUIRING_RESOLUTION.has(locationId)) {
    // Stay on this player's turn until they resolve the Location's action.
    nextState = { ...nextState, pendingAction: { playerId, locationId } };
    return {
      ...nextState,
      pendingActionCancel: { preVisitState, arrivedFingerprint: stateFingerprint(nextState) },
    };
  }

  return completeTurn(nextState);
}

// A JSON snapshot of everything in GameState except pendingActionCancel
// itself (which would otherwise self-reference) — used to detect whether
// anything has changed since a Location visit began. Every field here is
// plain JSON-serializable data (no functions, dates, etc.), so this is a
// reliable full-state fingerprint without needing a deep-equality library.
function stateFingerprint(state: GameState): string {
  const { pendingActionCancel: _pendingActionCancel, ...comparable } = state;
  return JSON.stringify(comparable);
}

// Whether cancelLocationVisit would currently succeed — used by the UI to
// show/hide the "Back to Board" control without needing to attempt (and
// possibly fail) the cancel itself.
export function canCancelLocationVisit(state: GameState): boolean {
  const snapshot = state.pendingActionCancel;
  if (!snapshot || !state.pendingAction) return false;
  return stateFingerprint(state) === snapshot.arrivedFingerprint;
}

// "Return to the main board" — fully undoes a Location visit (refunding the
// Action Token and reverting every automatic on-arrival effect: Faction
// gain, Valley's reveal, Exchange's gold claim, any queued Faction perk) by
// rolling back to the state captured just before this visit began, rather
// than algebraically reversing each effect. Only available before the
// player has taken any further action at the Location — see
// canCancelLocationVisit.
export function cancelLocationVisit(state: GameState): GameState {
  const snapshot = state.pendingActionCancel;
  if (!snapshot || !state.pendingAction) {
    throw new Error("There is nothing to cancel right now.");
  }
  if (stateFingerprint(state) !== snapshot.arrivedFingerprint) {
    throw new Error("Already acted at this Location — it can no longer be canceled.");
  }
  const player = state.players[state.pendingAction.playerId];
  const locationDef = locations.find((l) => l.id === state.pendingAction!.locationId);
  return {
    ...snapshot.preVisitState,
    log: [
      ...snapshot.preVisitState.log,
      `${player.character.name} returns to the board without using ${locationDef?.name ?? "that Location"}.`,
    ],
  };
}

// --- The Wellspring -------------------------------------------------------

// Faction 3: "When visiting The Wellspring, you may remove up to 2
// Withering Tokens from either of your Mana Pools." Available any time
// during the visit (not gated on having rolled); capped at 2 total per
// visit across both pools combined, tracked on pendingAction the same way
// as the Arena/Artificer/Ancient Shrine "once per visit" perks.
export function removeWitheringTokenAtWellspring(state: GameState, pool: "artifact" | "lore"): GameState {
  const playerId = requirePendingLocation(state, "wellspring");
  const player = state.players[playerId];
  const level = player.factionTrack.wellspring ?? 0;
  if (level < 3) {
    throw new Error("Faction 3 at The Wellspring is required to remove a Withering Token.");
  }
  const removedSoFar = state.pendingAction!.wellspringWitheringRemoved ?? 0;
  if (removedSoFar >= 2) {
    throw new Error(`${player.character.name} has already removed 2 Withering Tokens this visit.`);
  }
  if (player.witheringTokens[pool] <= 0) {
    throw new Error(`${player.character.name} has no Withering Tokens in that pool.`);
  }

  const updatedPlayer: EnginePlayer = {
    ...player,
    witheringTokens: { ...player.witheringTokens, [pool]: player.witheringTokens[pool] - 1 },
  };

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingAction: { ...state.pendingAction!, wellspringWitheringRemoved: removedSoFar + 1 },
    log: [
      ...state.log,
      `${player.character.name} removes 1 Withering Token from their ${pool === "artifact" ? "Artifact" : "Lore"} pool (Faction 3 benefit, ${removedSoFar + 1}/2 this visit).`,
    ],
  };
}

// Rulebook: "Roll 2d6 to generate Mana." Faction 1: "Reroll any 1s or 2s on
// your roll this turn" — applied automatically here, once per die, since
// it's a strictly-beneficial "may" that a rational player always takes.
// Faction 2: "You may choose to gather 7 mana instead of rolling."
// `discardPlentyIndex` is Rune of Plenty's "discard before using The
// Wellspring to double the Mana generated by your roll" — doubles `total`
// either way (rolled or flat 7); `dice` still reports the raw roll.
export function rollWellspring(
  state: GameState,
  options: { takeFlatSeven?: boolean; discardPlentyIndex?: number } = {},
  rng: () => number = Math.random,
): GameState {
  if (!state.pendingAction || state.pendingAction.locationId !== "wellspring") {
    throw new Error("The Wellspring is not the pending action.");
  }

  const { playerId } = state.pendingAction;
  let player = state.players[playerId];
  const factionLevel = player.factionTrack.wellspring ?? 0;

  let multiplier = 1;
  let plentyNote = "";
  if (options.discardPlentyIndex !== undefined) {
    const stone = player.equippedRuneStones[options.discardPlentyIndex];
    if (!stone || stone.name !== "Rune of Plenty") {
      throw new Error(`${player.character.name} doesn't have Rune of Plenty Attuned in that position.`);
    }
    player = {
      ...player,
      equippedRuneStones: player.equippedRuneStones.filter((_, i) => i !== options.discardPlentyIndex),
      artifactDiscard: [...player.artifactDiscard, stone],
    };
    multiplier = 2;
    plentyNote = " (Rune of Plenty: doubled)";
  }

  if (options.takeFlatSeven) {
    if (factionLevel < 2) {
      throw new Error("Faction 2 at The Wellspring is required to take a flat 7 Mana.");
    }
    const total = 7 * multiplier;
    return {
      ...state,
      players: { ...state.players, [playerId]: player },
      pendingWellspringRoll: { dice: null, total, usedFlatSeven: true, rerolled: false },
      log: [...state.log, `${player.character.name} takes ${total} Mana from The Wellspring (Faction 2 benefit)${plentyNote}.`],
    };
  }

  const initial: [number, number] = [rollD6(rng), rollD6(rng)];
  let dice = initial;
  let rerolled = false;
  if (factionLevel >= 1) {
    const reroll = (d: number) => (d <= 2 ? rollD6(rng) : d);
    dice = [reroll(initial[0]), reroll(initial[1])];
    rerolled = dice[0] !== initial[0] || dice[1] !== initial[1];
  }
  const rolledTotal = dice[0] + dice[1];
  const total = rolledTotal * multiplier;

  return {
    ...state,
    players: { ...state.players, [playerId]: player },
    pendingWellspringRoll: { dice, total, usedFlatSeven: false, rerolled },
    log: [
      ...state.log,
      `${player.character.name} rolls the Wellspring: ${dice[0]} + ${dice[1]} = ${rolledTotal}${
        multiplier > 1 ? ` ×2 = ${total}` : ""
      }.${rerolled ? " (1s and 2s rerolled — Faction 1 benefit)" : ""}${plentyNote}`,
    ],
  };
}

export function resolveWellspringAllocation(state: GameState, artifactMana: number, loreMana: number): GameState {
  if (!state.pendingAction || state.pendingAction.locationId !== "wellspring") {
    throw new Error("The Wellspring is not the pending action.");
  }
  const roll = state.pendingWellspringRoll;
  if (!roll) {
    throw new Error("Roll (or take 7) at The Wellspring before allocating Mana.");
  }
  if (artifactMana < 0 || loreMana < 0 || artifactMana + loreMana !== roll.total) {
    throw new Error(`Allocate exactly ${roll.total} Mana between your two pools.`);
  }

  const { playerId } = state.pendingAction;
  const player = state.players[playerId];
  const updatedPlayer: EnginePlayer = {
    ...player,
    manaPools: {
      artifact: player.manaPools.artifact + artifactMana,
      lore: player.manaPools.lore + loreMana,
    },
  };

  const nextState: GameState = {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    log: [
      ...state.log,
      `${player.character.name} places ${artifactMana} Mana in the Artifact pool and ${loreMana} in the Lore pool.`,
    ],
  };

  return completeTurn(nextState);
}

// --- The Market -------------------------------------------------------------

// The 2 "On Purchase:" clauses added to 13 core Implements in the 2026-09
// sheet update (src/data/artifacts.ts) — matched by exact substring against
// ArtifactCard.ability, the same text-dispatch pattern applyRotEffectText
// uses for Rot cards, rather than a per-card-name switch.
const ON_PURCHASE_RUNE_DIG =
  "On Purchase: Reveal cards from the top of the Artifact Deck until you reveal a Rune Stone. Place it in your Artifact discard pile and discard the other revealed cards.";
const ON_PURCHASE_FREE_LORE_ATTUNE = "On Purchase: Attune 1 Lore card from your discard pile for free.";

// Reveals cards from the shared Artifact Deck (reshuffling its discard pile
// in when it runs dry, same as everywhere else) until a Rune Stone turns
// up or the whole shared pool has been examined once (bounded by
// deck.length + discard.length so this can't loop forever if none remain
// anywhere in the game). Every non-Rune-Stone card revealed along the way
// goes to the shared discard pile immediately, so it's available to a
// mid-search reshuffle just like a real one would be.
function digForRuneStone(
  deck: ArtifactCard[],
  discard: ArtifactCard[],
  rng: () => number,
): { found: ArtifactCard | null; deck: ArtifactCard[]; discard: ArtifactCard[]; reshuffled: boolean } {
  let d = deck;
  let disc = discard;
  let reshuffled = false;
  const totalCards = d.length + disc.length;
  for (let i = 0; i < totalCards; i++) {
    if (d.length === 0) {
      if (disc.length === 0) break;
      d = shuffle(disc, rng);
      disc = [];
      reshuffled = true;
    }
    const [card, ...rest] = d;
    d = rest;
    if (card.slot === "Rune Stone") {
      return { found: card, deck: d, discard: disc, reshuffled };
    }
    disc = [...disc, card];
  }
  return { found: null, deck: d, discard: disc, reshuffled };
}

// `discardFortuneIndex` is Rune of Fortune's "discard when purchasing a card
// to reduce its Gold cost by 3", stackable with the character-power discounts.
export function purchaseFromMarket(
  state: GameState,
  rowIndex: number,
  discardFortuneIndex?: number,
  rng: () => number = Math.random,
): GameState {
  if (!state.pendingAction || (state.pendingAction.locationId !== "market" && state.pendingAction.locationId !== "warriorsGuild")) {
    throw new Error("The Market is not the pending action.");
  }
  if (rowIndex < 0 || rowIndex >= state.artifactRow.length) {
    throw new Error("Invalid Artifact Row position.");
  }

  const { playerId } = state.pendingAction;
  assertNoPendingFactionPerk(state, playerId);
  let player = state.players[playerId];
  const card = state.artifactRow[rowIndex];
  if (!card) {
    throw new Error("There is no card in that Artifact Row position.");
  }

  const claim = state.artifactRowClaim;
  if (claim && claim.rowIndex === rowIndex && claim.playerId !== playerId) {
    throw new Error(`${card.name} is claimed by another player (Deep Waters) and cannot be purchased.`);
  }
  // Kael's power, Deep Waters: 1 Gold cheaper on his own claimed card.
  const kaelDiscount = claim && claim.rowIndex === rowIndex && claim.playerId === playerId ? 1 : 0;
  // Sylva's power, Nature's Bounty: "Pay 1 less Gold when purchasing Primal or Corrupted Artifact cards."
  const sylvaDiscount = player.character.name === "Sylva, the Druidess" && /Primal|Corrupted/.test(card.type) ? 1 : 0;
  let fortuneDiscount = 0;
  if (discardFortuneIndex !== undefined) {
    const stone = player.equippedRuneStones[discardFortuneIndex];
    if (!stone || stone.name !== "Rune of Fortune") {
      throw new Error(`${player.character.name} doesn't have Rune of Fortune Attuned in that position.`);
    }
    player = {
      ...player,
      equippedRuneStones: player.equippedRuneStones.filter((_, i) => i !== discardFortuneIndex),
      artifactDiscard: [...player.artifactDiscard, stone],
    };
    fortuneDiscount = 3;
  }
  const cost = Math.max(0, card.goldCost - kaelDiscount - sylvaDiscount - fortuneDiscount);

  if (player.gold < cost) {
    throw new Error(`${player.character.name} cannot afford ${card.name}.`);
  }

  const updatedPlayer: EnginePlayer = {
    ...player,
    gold: player.gold - cost,
    artifactDiscard: [...player.artifactDiscard, card],
  };

  const { drawn, deck: artifactDeck, discard: artifactDiscard, reshuffled } = drawFromSharedDeck(
    state.artifactDeck,
    state.artifactDiscard,
    1,
    rng,
  );
  const nextCard = drawn[0] ?? null;
  const artifactRow = [...state.artifactRow];
  artifactRow[rowIndex] = nextCard;

  const discountNotes = [
    kaelDiscount > 0 ? "Deep Waters" : null,
    sylvaDiscount > 0 ? "Nature's Bounty" : null,
    fortuneDiscount > 0 ? "Rune of Fortune" : null,
  ].filter((n): n is string => !!n);
  const discountNote = discountNotes.length > 0 ? ` (${discountNotes.join(", ")} discount)` : "";
  const log = [
    ...state.log,
    `${player.character.name} buys ${card.name} for ${cost} Gold${discountNote}.` +
      (nextCard
        ? ` ${nextCard.name} refills the Artifact Row.` + (reshuffled ? " (The Artifact discard pile was shuffled into a new deck first.)" : "")
        : " The Artifact Deck and discard pile are both empty — that Row position stays empty."),
  ];

  let nextState: GameState = {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    artifactDiscard,
    artifactDeck,
    artifactRow,
    artifactRowClaim: claim && claim.rowIndex === rowIndex ? null : claim,
    log,
  };

  // "On Purchase:" bonus on 13 core Implements (src/data/artifacts.ts) —
  // the Rune Stone dig is fully automatic; the free Lore Attune needs a
  // real choice, so it pauses on pendingArtifactOnPurchase instead (see
  // resolveOnPurchaseFreeLoreAttune) whenever there's actually a card to
  // choose from.
  let onPurchasePauses = false;
  if (card.ability.includes(ON_PURCHASE_RUNE_DIG)) {
    const dig = digForRuneStone(nextState.artifactDeck, nextState.artifactDiscard, rng);
    const buyer = nextState.players[playerId];
    nextState = {
      ...nextState,
      artifactDeck: dig.deck,
      artifactDiscard: dig.discard,
      players: dig.found
        ? { ...nextState.players, [playerId]: { ...buyer, artifactDiscard: [...buyer.artifactDiscard, dig.found] } }
        : nextState.players,
      log: [
        ...nextState.log,
        dig.found
          ? `${card.name}'s On Purchase triggers: ${player.character.name} digs through the Artifact Deck and finds ${dig.found.name}, placing it in their Artifact discard pile.` +
            (dig.reshuffled ? " (The Artifact discard pile was shuffled into a new deck along the way.)" : "")
          : `${card.name}'s On Purchase triggers, but no Rune Stone remains anywhere in the Artifact Deck or discard pile.`,
      ],
    };
  } else if (card.ability.includes(ON_PURCHASE_FREE_LORE_ATTUNE)) {
    if (nextState.players[playerId].loreDiscard.length > 0) {
      onPurchasePauses = true;
      nextState = {
        ...nextState,
        pendingArtifactOnPurchase: { playerId },
        log: [...nextState.log, `${card.name}'s On Purchase triggers — ${player.character.name} may Attune 1 free Lore card from their discard pile.`],
      };
    } else {
      nextState = {
        ...nextState,
        log: [...nextState.log, `${card.name}'s On Purchase triggers, but ${player.character.name} has no Lore card in their discard pile.`],
      };
    }
  }

  // Warriors Guild: "perform actions at both the Market and the Artificer as
  // though they had placed their action token on both." The Market half is
  // just one purchase — don't end the turn yet, so the caller can still
  // reveal/Attune Artifacts; leaveArtificer/discardArtifactCard ends it.
  // An open On Purchase choice takes priority over both — the free-Lore
  // pause must resolve before continuing into the Artificer half too.
  if (onPurchasePauses) return nextState;
  return state.pendingAction.locationId === "warriorsGuild" ? nextState : completeTurn(nextState);
}

// Resolves the "Attune 1 Lore card from your discard pile for free" On
// Purchase bonus (see purchaseFromMarket) — mirrors equipLoreFree's
// fill-or-replace logic for the 3 Lore slots.
// Whether resolving/declining the On Purchase bonus should end the turn:
// the same "don't end it yet on Warriors Guild" call purchaseFromMarket
// itself makes, since pendingAction is untouched while this bonus is
// pending (a standalone Market visit ends here; the Guild's Market half
// still needs to continue into the Artificer).
function completeTurnAfterOnPurchase(state: GameState): GameState {
  return state.pendingAction?.locationId === "warriorsGuild" ? state : completeTurn(state);
}

export function resolveOnPurchaseFreeLoreAttune(state: GameState, discardIndex: number, replaceIndex?: number): GameState {
  const pending = state.pendingArtifactOnPurchase;
  if (!pending) throw new Error("There is no On Purchase bonus to resolve.");
  const player = state.players[pending.playerId];
  const card = player.loreDiscard[discardIndex];
  if (!card) throw new Error("Invalid Lore discard position.");
  const playerWithoutCard: EnginePlayer = { ...player, loreDiscard: player.loreDiscard.filter((_, i) => i !== discardIndex) };
  const { updatedPlayer, previous } = equipLoreFree(playerWithoutCard, card, replaceIndex);
  return completeTurnAfterOnPurchase({
    ...state,
    players: { ...state.players, [pending.playerId]: updatedPlayer },
    pendingArtifactOnPurchase: null,
    log: [
      ...state.log,
      `${player.character.name} Attunes ${card.name} for free (On Purchase bonus).` +
        (previous ? ` ${previous.name} moves to their Lore discard pile.` : ""),
    ],
  });
}

export function skipOnPurchaseFreeLoreAttune(state: GameState): GameState {
  const pending = state.pendingArtifactOnPurchase;
  if (!pending) throw new Error("There is no On Purchase bonus to resolve.");
  return completeTurnAfterOnPurchase({
    ...state,
    pendingArtifactOnPurchase: null,
    log: [...state.log, `${state.players[pending.playerId].character.name} declines the On Purchase bonus.`],
  });
}

export function skipMarket(state: GameState): GameState {
  if (!state.pendingAction || (state.pendingAction.locationId !== "market" && state.pendingAction.locationId !== "warriorsGuild")) {
    throw new Error("The Market is not the pending action.");
  }

  const { playerId } = state.pendingAction;
  assertNoPendingFactionPerk(state, playerId);
  const player = state.players[playerId];
  const log = [...state.log, `${player.character.name} browses the Market without buying anything.`];

  const nextState: GameState = { ...state, log };
  return state.pendingAction.locationId === "warriorsGuild" ? nextState : completeTurn(nextState);
}

// --- Library of Lore ---------------------------------------------------------

export function purchaseFromLibrary(
  state: GameState,
  rowIndex: number,
  discardFortuneIndex?: number,
  rng: () => number = Math.random,
): GameState {
  if (!state.pendingAction || (state.pendingAction.locationId !== "library" && state.pendingAction.locationId !== "scholarsGuild")) {
    throw new Error("Library of Lore is not the pending action.");
  }
  if (rowIndex < 0 || rowIndex >= state.loreRow.length) {
    throw new Error("Invalid Lore Row position.");
  }

  const { playerId } = state.pendingAction;
  assertNoPendingFactionPerk(state, playerId);
  let player = state.players[playerId];
  const card = state.loreRow[rowIndex];
  if (!card) {
    throw new Error("There is no card in that Lore Row position.");
  }
  let fortuneDiscount = 0;
  if (discardFortuneIndex !== undefined) {
    const stone = player.equippedRuneStones[discardFortuneIndex];
    if (!stone || stone.name !== "Rune of Fortune") {
      throw new Error(`${player.character.name} doesn't have Rune of Fortune Attuned in that position.`);
    }
    player = {
      ...player,
      equippedRuneStones: player.equippedRuneStones.filter((_, i) => i !== discardFortuneIndex),
      artifactDiscard: [...player.artifactDiscard, stone],
    };
    fortuneDiscount = 3;
  }
  const cost = Math.max(0, card.goldCost - fortuneDiscount);
  if (player.gold < cost) {
    throw new Error(`${player.character.name} cannot afford ${card.name}.`);
  }

  const updatedPlayer: EnginePlayer = {
    ...player,
    gold: player.gold - cost,
    loreDiscard: [...player.loreDiscard, card],
  };

  const { drawn, deck: loreDeck, discard: loreDiscard, reshuffled } = drawFromSharedDeck(state.loreDeck, state.loreDiscard, 1, rng);
  const nextCard = drawn[0] ?? null;
  const loreRow = [...state.loreRow];
  loreRow[rowIndex] = nextCard;

  const log = [
    ...state.log,
    `${player.character.name} buys ${card.name} for ${cost} Gold${fortuneDiscount > 0 ? " (Rune of Fortune discount)" : ""}.` +
      (nextCard
        ? ` ${nextCard.name} refills the Lore Row.` + (reshuffled ? " (The Lore discard pile was shuffled into a new deck first.)" : "")
        : " The Lore Deck and discard pile are both empty — that Row position stays empty."),
  ];

  const nextState: GameState = {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    loreDeck,
    loreDiscard,
    loreRow,
    log,
  };

  // Scholars Guild: same deferred-completion treatment as purchaseFromMarket
  // for the Warriors Guild — the Library half is just one purchase, and
  // leaveAncientShrine/discardLoreCard ends the turn once both halves are done.
  return state.pendingAction.locationId === "scholarsGuild" ? nextState : completeTurn(nextState);
}

export function skipLibrary(state: GameState): GameState {
  if (!state.pendingAction || (state.pendingAction.locationId !== "library" && state.pendingAction.locationId !== "scholarsGuild")) {
    throw new Error("Library of Lore is not the pending action.");
  }

  const { playerId } = state.pendingAction;
  assertNoPendingFactionPerk(state, playerId);
  const player = state.players[playerId];
  const log = [...state.log, `${player.character.name} browses the Library without buying anything.`];

  const nextState: GameState = { ...state, log };
  return state.pendingAction.locationId === "scholarsGuild" ? nextState : completeTurn(nextState);
}

// --- Market/Library Faction perk: discard/refill the Row -------------------

// Market Faction 1, Library Faction 1 and 2: "You may discard any or all
// cards in the Row and refill the empty position(s) from the Deck." A
// one-time choice queued by applyFactionMilestone the instant the track
// reaches that level. Pass an empty array to decline.
export function resolveRowRefillPerk(state: GameState, discardIndices: number[], rng: () => number = Math.random): GameState {
  const perk = state.pendingFactionPerks[0];
  if (!perk || perk.kind !== "discardRefillRow") {
    throw new Error("There is no Row refill perk to resolve right now.");
  }
  const { playerId, locationId } = perk;
  const player = state.players[playerId];
  const remainingPerks = state.pendingFactionPerks.slice(1);
  const uniqueIndices = [...new Set(discardIndices)];

  if (locationId === "market") {
    const artifactRow = [...state.artifactRow];
    let artifactDeck = [...state.artifactDeck];
    let artifactDiscard = [...state.artifactDiscard];
    let discardedCount = 0;
    for (const i of uniqueIndices) {
      if (i < 0 || i >= artifactRow.length) throw new Error("Invalid Artifact Row position.");
      const discarded = artifactRow[i];
      if (discarded) {
        discardedCount += 1;
        artifactDiscard = [...artifactDiscard, discarded];
        const draw = drawFromSharedDeck(artifactDeck, artifactDiscard, 1, rng);
        artifactRow[i] = draw.drawn[0] ?? null;
        artifactDeck = draw.deck;
        artifactDiscard = draw.discard;
      }
    }
    const log = [
      ...state.log,
      discardedCount > 0
        ? `${player.character.name} discards ${discardedCount} card(s) from the Artifact Row and refills from the deck (Faction 1 benefit).`
        : `${player.character.name} declines to refresh the Artifact Row (Faction 1 benefit).`,
    ];
    return { ...state, artifactRow, artifactDeck, artifactDiscard, pendingFactionPerks: remainingPerks, log };
  }

  const loreRow = [...state.loreRow];
  let loreDeck = [...state.loreDeck];
  let loreDiscard = [...state.loreDiscard];
  let discardedCount = 0;
  for (const i of uniqueIndices) {
    if (i < 0 || i >= loreRow.length) throw new Error("Invalid Lore Row position.");
    const discarded = loreRow[i];
    if (discarded) {
      discardedCount += 1;
      loreDiscard = [...loreDiscard, discarded];
      const draw = drawFromSharedDeck(loreDeck, loreDiscard, 1, rng);
      loreRow[i] = draw.drawn[0] ?? null;
      loreDeck = draw.deck;
      loreDiscard = draw.discard;
    }
  }
  const log = [
    ...state.log,
    discardedCount > 0
      ? `${player.character.name} discards ${discardedCount} card(s) from the Lore Row and refills from the deck (Faction benefit).`
      : `${player.character.name} declines to refresh the Lore Row (Faction benefit).`,
  ];
  return { ...state, loreRow, loreDeck, loreDiscard, pendingFactionPerks: remainingPerks, log };
}

// Market Faction 2: "You may move 1 Artifact card from The Rot Character Mat
// to The Artifact Row, replacing and discarding 1 Artifact card currently
// there." The replaced Row card goes to the shared Artifact discard pile
// (artifactDiscard on GameState), same as every other shared-deck discard.
export function resolveRotToMarketRowPerk(state: GameState, rotArtifactIndex: number, rowIndex: number): GameState {
  const perk = state.pendingFactionPerks[0];
  if (!perk || perk.kind !== "rotToMarketRow") {
    throw new Error("There is no Rot Character Mat perk to resolve right now.");
  }
  if (rotArtifactIndex < 0 || rotArtifactIndex >= state.rotArtifacts.length) {
    throw new Error("Invalid Rot Character Mat position.");
  }
  if (rowIndex < 0 || rowIndex >= state.artifactRow.length) {
    throw new Error("Invalid Artifact Row position.");
  }

  const player = state.players[perk.playerId];
  const rotArtifacts = [...state.rotArtifacts];
  const [moved] = rotArtifacts.splice(rotArtifactIndex, 1);
  const artifactRow = [...state.artifactRow];
  const replaced = artifactRow[rowIndex];
  artifactRow[rowIndex] = moved;
  const artifactDiscard = replaced ? [...state.artifactDiscard, replaced] : state.artifactDiscard;

  return {
    ...state,
    rotArtifacts,
    artifactRow,
    artifactDiscard,
    pendingFactionPerks: state.pendingFactionPerks.slice(1),
    log: [
      ...state.log,
      `${player.character.name} moves ${moved.name} from The Rot Character Mat to the Artifact Row` +
        (replaced ? `, discarding ${replaced.name} (Faction 2 benefit).` : " (Faction 2 benefit)."),
    ],
  };
}

export function skipRotToMarketRowPerk(state: GameState): GameState {
  const perk = state.pendingFactionPerks[0];
  if (!perk || perk.kind !== "rotToMarketRow") {
    throw new Error("There is no Rot Character Mat perk to resolve right now.");
  }
  const player = state.players[perk.playerId];
  return {
    ...state,
    pendingFactionPerks: state.pendingFactionPerks.slice(1),
    log: [...state.log, `${player.character.name} declines to move a card from The Rot Character Mat (Faction 2 benefit).`],
  };
}

// Warriors/Scholars Guild Faction 1: "Place a card from the [Artifact/Lore]
// Row into your [Artifact/Lore] discard pile" — free (no Gold cost), the
// player picks which face-up Row card. Refills that Row position the same
// reshuffle-aware way as a normal purchase (see drawFromSharedDeck).
export function resolveGuildFreeCardPerk(state: GameState, rowIndex: number, rng: () => number = Math.random): GameState {
  const perk = state.pendingFactionPerks[0];
  if (!perk || perk.kind !== "guildFreeCard") {
    throw new Error("There is no Guild Faction perk to resolve right now.");
  }
  const { playerId, locationId } = perk;
  const player = state.players[playerId];
  const remainingPerks = state.pendingFactionPerks.slice(1);

  if (locationId === "warriorsGuild") {
    if (rowIndex < 0 || rowIndex >= state.artifactRow.length) throw new Error("Invalid Artifact Row position.");
    const card = state.artifactRow[rowIndex];
    if (!card) throw new Error("There is no card in that Artifact Row position.");
    const updatedPlayer: EnginePlayer = { ...player, artifactDiscard: [...player.artifactDiscard, card] };
    const draw = drawFromSharedDeck(state.artifactDeck, state.artifactDiscard, 1, rng);
    const artifactRow = [...state.artifactRow];
    artifactRow[rowIndex] = draw.drawn[0] ?? null;
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      artifactRow,
      artifactDeck: draw.deck,
      artifactDiscard: draw.discard,
      pendingFactionPerks: remainingPerks,
      log: [
        ...state.log,
        `${player.character.name} takes ${card.name} from the Artifact Row for free (Warriors Guild Faction 1 benefit).` +
          (draw.reshuffled ? " (The Artifact discard pile was shuffled into a new deck first.)" : ""),
      ],
    };
  }

  if (rowIndex < 0 || rowIndex >= state.loreRow.length) throw new Error("Invalid Lore Row position.");
  const card = state.loreRow[rowIndex];
  if (!card) throw new Error("There is no card in that Lore Row position.");
  const updatedPlayer: EnginePlayer = { ...player, loreDiscard: [...player.loreDiscard, card] };
  const draw = drawFromSharedDeck(state.loreDeck, state.loreDiscard, 1, rng);
  const loreRow = [...state.loreRow];
  loreRow[rowIndex] = draw.drawn[0] ?? null;
  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    loreRow,
    loreDeck: draw.deck,
    loreDiscard: draw.discard,
    pendingFactionPerks: remainingPerks,
    log: [
      ...state.log,
      `${player.character.name} takes ${card.name} from the Lore Row for free (Scholars Guild Faction 1 benefit).` +
        (draw.reshuffled ? " (The Lore discard pile was shuffled into a new deck first.)" : ""),
    ],
  };
}

export function skipGuildFreeCardPerk(state: GameState): GameState {
  const perk = state.pendingFactionPerks[0];
  if (!perk || perk.kind !== "guildFreeCard") {
    throw new Error("There is no Guild Faction perk to resolve right now.");
  }
  const player = state.players[perk.playerId];
  const locationDef = locations.find((l) => l.id === perk.locationId)!;
  return {
    ...state,
    pendingFactionPerks: state.pendingFactionPerks.slice(1),
    log: [...state.log, `${player.character.name} declines the free card (${locationDef.name} Faction 1 benefit).`],
  };
}

// --- The Exchange -------------------------------------------------------------

function requirePendingExchange(state: GameState): string {
  const playerId = requirePendingLocation(state, "exchange");
  assertNoPendingFactionPerk(state, playerId);
  return playerId;
}

// Exchange Faction 1-3: "You may increase your Faction by 1 at any
// location." A one-time choice queued by applyFactionMilestone each of the
// three times this track ticks up — resolving it can itself trigger another
// Location's one-time benefit (including another one of these), which is why
// pendingFactionPerks is a queue rather than a single value.
export function resolveExchangeFactionBump(state: GameState, targetLocationId: LocationId): GameState {
  const perk = state.pendingFactionPerks[0];
  if (!perk || perk.kind !== "exchangeFactionBump") {
    throw new Error("There is no Exchange Faction perk to resolve right now.");
  }
  const locationDef = locations.find((l) => l.id === targetLocationId);
  if (!locationDef?.hasFactionTrack) {
    throw new Error("That Location doesn't have a Faction track.");
  }

  const player = state.players[perk.playerId];
  if ((player.factionTrack[targetLocationId] ?? 0) >= 3) {
    throw new Error(`${player.character.name} is already at Faction 3 there.`);
  }

  const milestone = applyFactionMilestone(
    player.character.name,
    targetLocationId,
    perk.playerId,
    player.factionTrack,
    player.manaPools,
    player.witheringTokens,
    player.gold,
  );
  const updatedPlayer: EnginePlayer = {
    ...player,
    factionTrack: milestone.factionTrack,
    manaPools: milestone.manaPools,
    witheringTokens: milestone.witheringTokens,
    gold: milestone.gold,
    actionTokensRemaining: player.actionTokensRemaining + milestone.actionTokensGained,
  };

  const log = [
    ...state.log,
    `${player.character.name} increases their ${locationDef.name} Faction to ${milestone.factionTrack[targetLocationId]} (Exchange benefit).`,
    ...milestone.logLines,
  ];

  return {
    ...state,
    players: { ...state.players, [perk.playerId]: updatedPlayer },
    pendingFactionPerks: [...state.pendingFactionPerks.slice(1), ...milestone.newPerks],
    log,
  };
}

export function skipExchangeFactionBump(state: GameState): GameState {
  const perk = state.pendingFactionPerks[0];
  if (!perk || perk.kind !== "exchangeFactionBump") {
    throw new Error("There is no Exchange Faction perk to resolve right now.");
  }
  const player = state.players[perk.playerId];
  return {
    ...state,
    pendingFactionPerks: state.pendingFactionPerks.slice(1),
    log: [...state.log, `${player.character.name} declines to increase Faction elsewhere (Exchange benefit).`],
  };
}

// Rulebook, exchange 1: "Pay 1 gold to distribute 2 mana across your Artifact
// and Lore pools." Repeatable — stays on the pending action so the player can
// exchange again.
export function exchangeGoldForMana(state: GameState, artifactMana: number, loreMana: number): GameState {
  const playerId = requirePendingExchange(state);
  if (artifactMana < 0 || loreMana < 0 || artifactMana + loreMana !== 2) {
    throw new Error("Distribute exactly 2 Mana between your two pools.");
  }
  const player = state.players[playerId];
  if (player.gold < 1) {
    throw new Error(`${player.character.name} doesn't have 1 Gold to spend.`);
  }

  const updatedPlayer: EnginePlayer = {
    ...player,
    gold: player.gold - 1,
    manaPools: {
      artifact: player.manaPools.artifact + artifactMana,
      lore: player.manaPools.lore + loreMana,
    },
  };

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    log: [
      ...state.log,
      `${player.character.name} pays 1 Gold for 2 Mana at The Exchange (${artifactMana} Artifact / ${loreMana} Lore).`,
    ],
  };
}

// Rulebook, exchange 4: "Pay 3 mana to receive 1 gold."
export function exchangeManaForGold(state: GameState, pool: "artifact" | "lore"): GameState {
  const playerId = requirePendingExchange(state);
  const player = state.players[playerId];
  assertPoolNotTainted(player, pool);
  if (player.manaPools[pool] < 3) {
    throw new Error(`${player.character.name} doesn't have 3 Mana in that pool.`);
  }

  const updatedPlayer: EnginePlayer = {
    ...player,
    gold: player.gold + 1,
    manaPools: { ...player.manaPools, [pool]: player.manaPools[pool] - 3 },
  };

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    log: [
      ...state.log,
      `${player.character.name} pays 3 ${pool === "artifact" ? "Artifact" : "Lore"} Mana for 1 Gold at The Exchange.`,
    ],
  };
}

// Rulebook, exchange 2: "Select an Artifact Card from your discard pile and
// remove it from the game to receive half of its gold value rounded up,
// minimum of 1 gold."
export function exchangeArtifactCardForGold(state: GameState, discardIndex: number): GameState {
  const playerId = requirePendingExchange(state);
  const player = state.players[playerId];
  const card = player.artifactDiscard[discardIndex];
  if (!card) {
    throw new Error("There is no card in that discard pile position.");
  }

  const goldGained = Math.max(1, Math.ceil(card.goldCost / 2));
  const artifactDiscard = player.artifactDiscard.filter((_, i) => i !== discardIndex);
  const updatedPlayer: EnginePlayer = { ...player, gold: player.gold + goldGained, artifactDiscard };

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    log: [
      ...state.log,
      `${player.character.name} removes ${card.name} from the game for ${goldGained} Gold at The Exchange.`,
    ],
  };
}

// Rulebook, exchange 3: "Select a Lore Card from your discard pile and
// remove it from the game to receive half of its gold value rounded up,
// minimum of 1 gold."
export function exchangeLoreCardForGold(state: GameState, discardIndex: number): GameState {
  const playerId = requirePendingExchange(state);
  const player = state.players[playerId];
  const card = player.loreDiscard[discardIndex];
  if (!card) {
    throw new Error("There is no card in that discard pile position.");
  }

  const goldGained = Math.max(1, Math.ceil(card.goldCost / 2));
  const loreDiscard = player.loreDiscard.filter((_, i) => i !== discardIndex);
  const updatedPlayer: EnginePlayer = { ...player, gold: player.gold + goldGained, loreDiscard };

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    log: [
      ...state.log,
      `${player.character.name} removes ${card.name} from the game for ${goldGained} Gold at The Exchange.`,
    ],
  };
}

export function leaveExchange(state: GameState): GameState {
  requirePendingExchange(state);
  return completeTurn(state);
}

// --- The Artificer ------------------------------------------------------------

export type ArtifactSlotName = "Weapon" | "Armor" | "Implement" | "Rune Stone";

const ARTIFACT_SLOT_NAMES: ArtifactSlotName[] = ["Weapon", "Armor", "Implement", "Rune Stone"];

// A card's `slot` field is either a single slot ("Armor") or, for cards like
// Godslayer, several separated by "/" ("Weapon / Implement") — the rulebook:
// "When Attuned, choose whether this occupies your Weapon or Implement slot."
export function getArtifactSlots(card: ArtifactCard): ArtifactSlotName[] {
  return card.slot
    .split("/")
    .map((s) => s.trim())
    .filter((s): s is ArtifactSlotName => (ARTIFACT_SLOT_NAMES as string[]).includes(s));
}

// Rulebook: "Reveal the top card from your Artifact deck. Shuffle your
// Artifact discard pile if the deck is depleted."
export function revealArtifactCard(state: GameState, rng: () => number = Math.random): GameState {
  const playerId = requirePendingLocation(state, ["artificer", "warriorsGuild"]);
  if (state.pendingReveal) {
    throw new Error("Resolve the revealed card before revealing another.");
  }
  const player = state.players[playerId];

  let deck = player.artifactDeck;
  let discard = player.artifactDiscard;
  const log = [...state.log];

  if (deck.length === 0 && discard.length > 0) {
    deck = shuffle(discard, rng);
    discard = [];
    log.push(`${player.character.name} shuffles their Artifact discard pile into their Artifact deck.`);
  }

  if (deck.length === 0) {
    log.push(`${player.character.name} has no Artifact cards left to reveal.`);
    return { ...state, log };
  }

  const [card, ...rest] = deck;
  const updatedPlayer: EnginePlayer = { ...player, artifactDeck: rest, artifactDiscard: discard };
  log.push(`${player.character.name} reveals ${card.name} from their Artifact deck.`);

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingReveal: { kind: "artifact", card },
    log,
  };
}

// Shared by attuneArtifactCard and attuneArtifactFromDiscard (Legos's Grave
// Robber): resolves which slot the card occupies, checks the Rune Stone cap,
// Cleansing, and Mana, and returns the equipped-and-paid player. `chosenSlot`
// is required for a multi-slot card (Godslayer's "Weapon / Implement") and
// ignored otherwise.
// `discardResonanceIndex` is Rune of Resonance's "discard when Attuning a
// card to reduce its Mana cost by 3." `free` is the Final Battle initiator's
// boon (see resolveFinalBattleBoon) — skips the Mana cost entirely.
function attuneArtifactCardIntoSlot(
  player: EnginePlayer,
  card: ArtifactCard,
  chosenSlot?: ArtifactSlotName,
  discardResonanceIndex?: number,
  free?: boolean,
): { updatedPlayer: EnginePlayer; slot: ArtifactSlotName; previous?: ArtifactCard; cost: number; resonanceUsed: boolean } {
  const possibleSlots = getArtifactSlots(card);
  if (possibleSlots.length === 0) {
    throw new Error(`${card.name} has no valid Artifact slot.`);
  }
  let slot: ArtifactSlotName;
  if (possibleSlots.length === 1) {
    slot = possibleSlots[0];
  } else if (chosenSlot && possibleSlots.includes(chosenSlot)) {
    slot = chosenSlot;
  } else {
    throw new Error(`Choose a slot for ${card.name}: ${possibleSlots.join(" or ")}.`);
  }

  let workingPlayer = player;
  let cost = card.attunementCost;
  let resonanceUsed = false;
  if (discardResonanceIndex !== undefined) {
    const stone = player.equippedRuneStones[discardResonanceIndex];
    if (!stone || stone.name !== "Rune of Resonance") {
      throw new Error(`${player.character.name} doesn't have Rune of Resonance Attuned in that position.`);
    }
    workingPlayer = {
      ...player,
      equippedRuneStones: player.equippedRuneStones.filter((_, i) => i !== discardResonanceIndex),
      artifactDiscard: [...player.artifactDiscard, stone],
    };
    cost = Math.max(0, cost - 3);
    resonanceUsed = true;
  }

  if (slot === "Rune Stone" && workingPlayer.equippedRuneStones.length >= 3) {
    throw new Error(`${player.character.name} already has 3 Attuned Rune Stones.`);
  }
  if (free) {
    cost = 0;
  } else {
    assertPoolNotTainted(workingPlayer, "artifact");
    if (workingPlayer.manaPools.artifact < cost) {
      throw new Error(`${player.character.name} doesn't have enough Mana to Attune ${card.name}.`);
    }
  }

  const updatedPlayer: EnginePlayer = {
    ...workingPlayer,
    manaPools: { ...workingPlayer.manaPools, artifact: workingPlayer.manaPools.artifact - cost },
  };

  let previous: ArtifactCard | undefined;
  if (slot === "Weapon") {
    previous = workingPlayer.equippedWeapon;
    updatedPlayer.equippedWeapon = card;
  } else if (slot === "Armor") {
    previous = workingPlayer.equippedArmor;
    updatedPlayer.equippedArmor = card;
  } else if (slot === "Implement") {
    previous = workingPlayer.equippedImplement;
    updatedPlayer.equippedImplement = card;
  } else {
    updatedPlayer.equippedRuneStones = [...workingPlayer.equippedRuneStones, card];
  }
  if (previous) {
    updatedPlayer.artifactDiscard = [...updatedPlayer.artifactDiscard, previous];
  }

  return { updatedPlayer, slot, previous, cost, resonanceUsed };
}

// Rulebook: "Pay its mana value from your Artifact Attunement mana pool if
// able... place the item on your game board, moving any previous item in
// that slot to your Artifact discard pile." Confirmed by design: Attunement
// is if able AND desired — a player who can afford it may still decline
// (e.g. to avoid replacing a better item) and send the card to discard.
export function attuneArtifactCard(state: GameState, chosenSlot?: ArtifactSlotName, discardResonanceIndex?: number): GameState {
  const playerId = requirePendingLocation(state, ["artificer", "warriorsGuild"]);
  if (!state.pendingReveal || state.pendingReveal.kind !== "artifact") {
    throw new Error("There is no revealed Artifact card to Attune.");
  }
  const player = state.players[playerId];
  const card = state.pendingReveal.card;

  const { updatedPlayer, slot, previous, cost, resonanceUsed } = attuneArtifactCardIntoSlot(
    player,
    card,
    chosenSlot,
    discardResonanceIndex,
  );

  const log = [
    ...state.log,
    `${player.character.name} Attunes ${card.name} to their ${slot} slot for ${cost} Mana${
      resonanceUsed ? " (Rune of Resonance discount)" : ""
    }.` + (previous ? ` ${previous.name} moves to their Artifact discard pile.` : ""),
  ];

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingReveal: null,
    log,
  };
}

// Legos's power, Grave Robber: "When Attuning an Artifact card, you may
// instead choose an Artifact card from your discard pile to Attune." An
// alternative to the normal reveal-then-Attune loop, available whenever
// nothing is currently revealed — it replaces where the card comes from, not
// the Mana cost or slot rules.
export function attuneArtifactFromDiscard(
  state: GameState,
  discardIndex: number,
  chosenSlot?: ArtifactSlotName,
  discardResonanceIndex?: number,
): GameState {
  const playerId = requirePendingLocation(state, "artificer");
  const player = state.players[playerId];
  if (player.character.name !== "Legos, the Undead Cyborg") {
    throw new Error("Only Legos may Attune directly from the Artifact discard pile.");
  }
  if (state.pendingReveal) {
    throw new Error("Resolve the revealed card before Attuning from the discard pile.");
  }
  const card = player.artifactDiscard[discardIndex];
  if (!card) {
    throw new Error("Invalid Artifact discard position.");
  }

  const playerWithoutCard: EnginePlayer = {
    ...player,
    artifactDiscard: player.artifactDiscard.filter((_, i) => i !== discardIndex),
  };
  const { updatedPlayer, slot, previous, cost, resonanceUsed } = attuneArtifactCardIntoSlot(
    playerWithoutCard,
    card,
    chosenSlot,
    discardResonanceIndex,
  );

  const log = [
    ...state.log,
    `${player.character.name} Attunes ${card.name} from their Artifact discard pile to their ${slot} slot for ${cost} Mana (Grave Robber)${
      resonanceUsed ? ", Rune of Resonance discount" : ""
    }.` + (previous ? ` ${previous.name} moves to their Artifact discard pile.` : ""),
  ];

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    log,
  };
}

// Rulebook: "If you Attuned the Artifact, you may reveal the next card of
// your Artifact Deck and repeat this process. Otherwise, end the Attunement
// action." Declining (or being unable to afford) the revealed card ends the
// visit immediately — it doesn't offer another reveal.
export function discardArtifactCard(state: GameState): GameState {
  const playerId = requirePendingLocation(state, ["artificer", "warriorsGuild"]);
  if (!state.pendingReveal || state.pendingReveal.kind !== "artifact") {
    throw new Error("There is no revealed Artifact card to discard.");
  }
  const player = state.players[playerId];
  const card = state.pendingReveal.card;
  const updatedPlayer: EnginePlayer = { ...player, artifactDiscard: [...player.artifactDiscard, card] };

  return completeTurn({
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingReveal: null,
    log: [
      ...state.log,
      `${player.character.name} sends ${card.name} to their Artifact discard pile without Attuning it.`,
    ],
  });
}

export function leaveArtificer(state: GameState): GameState {
  requirePendingLocation(state, ["artificer", "warriorsGuild"]);
  if (state.pendingReveal) {
    throw new Error("Resolve the revealed card before leaving The Artificer.");
  }
  if (state.pendingArtifactPeek) {
    throw new Error("Resolve the Artifact deck peek before leaving The Artificer.");
  }
  return completeTurn(state);
}

// Artificer Faction 2: "You may look at the top two cards of your Artifact
// deck and place them back on top of your deck in any order." Persistent —
// usable once per visit, every visit, from the moment Faction 2 is reached.
// Unlike the Ancient Shrine's similar peek, nothing may be discarded here —
// reordering only.
export function peekArtifactDeck(state: GameState): GameState {
  const playerId = requirePendingLocation(state, "artificer");
  const player = state.players[playerId];
  const level = player.factionTrack.artificer ?? 0;
  if (level < 2) {
    throw new Error("Faction 2 at The Artificer is required to look at the top of the Artifact deck.");
  }
  if (state.pendingAction!.usedArtifactPeek) {
    throw new Error("Already used the Artifact deck peek this visit.");
  }
  if (state.pendingReveal) {
    throw new Error("Resolve the revealed Artifact card before peeking at your Artifact deck.");
  }
  if (state.pendingArtifactPeek) {
    throw new Error("Already peeking at the Artifact deck.");
  }

  const peeked = player.artifactDeck.slice(0, 2);
  const nextState: GameState = {
    ...state,
    pendingAction: { ...state.pendingAction!, usedArtifactPeek: true },
  };

  if (peeked.length === 0) {
    return {
      ...nextState,
      log: [...state.log, `${player.character.name}'s Artifact deck is empty — there's nothing to look at.`],
    };
  }

  return {
    ...nextState,
    pendingArtifactPeek: peeked,
    log: [...state.log, `${player.character.name} looks at the top ${peeked.length} card(s) of their Artifact deck.`],
  };
}

// `order` is a permutation of indices into the peeked cards (first = topmost
// on return). Every peeked card must be included — reordering only, no
// discard.
export function resolveArtifactPeek(state: GameState, order: number[]): GameState {
  const playerId = requirePendingLocation(state, "artificer");
  if (!state.pendingArtifactPeek) {
    throw new Error("There is no Artifact deck peek to resolve.");
  }
  const peeked = state.pendingArtifactPeek;
  const uniqueIndices = new Set(order);
  if (
    uniqueIndices.size !== peeked.length ||
    order.length !== peeked.length ||
    order.some((i) => i < 0 || i >= peeked.length)
  ) {
    throw new Error("Choose an order for all of the peeked cards.");
  }

  const player = state.players[playerId];
  const reordered = order.map((i) => peeked[i]);
  const remainder = player.artifactDeck.slice(peeked.length);
  const updatedPlayer: EnginePlayer = { ...player, artifactDeck: [...reordered, ...remainder] };

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingArtifactPeek: null,
    log: [
      ...state.log,
      `${player.character.name} returns ${reordered.map((c) => c.name).join(", ")} to the top of their Artifact deck in that order.`,
    ],
  };
}

// --- The Ancient Shrine -------------------------------------------------------

// Mirrors revealArtifactCard for the personal Lore deck.
export function revealLoreCard(state: GameState, rng: () => number = Math.random): GameState {
  const playerId = requirePendingLocation(state, ["ancientShrine", "scholarsGuild"]);
  if (state.pendingReveal) {
    throw new Error("Resolve the revealed card before revealing another.");
  }
  const player = state.players[playerId];

  let deck = player.loreDeck;
  let discard = player.loreDiscard;
  const log = [...state.log];

  if (deck.length === 0 && discard.length > 0) {
    deck = shuffle(discard, rng);
    discard = [];
    log.push(`${player.character.name} shuffles their Lore discard pile into their Lore deck.`);
  }

  if (deck.length === 0) {
    log.push(`${player.character.name} has no Lore cards left to reveal.`);
    return { ...state, log };
  }

  const [card, ...rest] = deck;
  const updatedPlayer: EnginePlayer = { ...player, loreDeck: rest, loreDiscard: discard };
  log.push(`${player.character.name} reveals ${card.name} from their Lore deck.`);

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingReveal: { kind: "lore", card },
    log,
  };
}

// Shared by attuneLoreCard and resolveFinalBattleBoon: resolves the 3-Lore-
// slot cap and Mana, and returns the equipped-and-paid player. There are 3
// Lore slots; below the cap, a new card just fills an open one. At the cap,
// `replaceIndex` (0-2) says which currently-Attuned card to bump to discard.
// `free` is the Final Battle initiator's boon — skips the Mana cost entirely.
function attuneLoreCardIntoSlot(
  player: EnginePlayer,
  card: LoreCard,
  replaceIndex?: number,
  discardResonanceIndex?: number,
  free?: boolean,
): { updatedPlayer: EnginePlayer; previous?: LoreCard; cost: number; resonanceUsed: boolean } {
  let workingPlayer = player;
  let cost = card.attunementCost;
  let resonanceUsed = false;
  if (discardResonanceIndex !== undefined) {
    const stone = player.equippedRuneStones[discardResonanceIndex];
    if (!stone || stone.name !== "Rune of Resonance") {
      throw new Error(`${player.character.name} doesn't have Rune of Resonance Attuned in that position.`);
    }
    workingPlayer = {
      ...player,
      equippedRuneStones: player.equippedRuneStones.filter((_, i) => i !== discardResonanceIndex),
      artifactDiscard: [...player.artifactDiscard, stone],
    };
    cost = Math.max(0, cost - 3);
    resonanceUsed = true;
  }

  if (free) {
    cost = 0;
  } else {
    assertPoolNotTainted(workingPlayer, "lore");
    if (workingPlayer.manaPools.lore < cost) {
      throw new Error(`${player.character.name} doesn't have enough Mana to Attune ${card.name}.`);
    }
  }

  let attunedLore: LoreCard[];
  let previous: LoreCard | undefined;
  if (workingPlayer.attunedLore.length < 3) {
    attunedLore = [...workingPlayer.attunedLore, card];
  } else {
    if (replaceIndex === undefined || replaceIndex < 0 || replaceIndex >= 3) {
      throw new Error(`Choose which of your 3 Attuned Lore cards to replace with ${card.name}.`);
    }
    previous = workingPlayer.attunedLore[replaceIndex];
    attunedLore = workingPlayer.attunedLore.map((c, i) => (i === replaceIndex ? card : c));
  }

  const updatedPlayer: EnginePlayer = {
    ...workingPlayer,
    manaPools: { ...workingPlayer.manaPools, lore: workingPlayer.manaPools.lore - cost },
    attunedLore,
    loreDiscard: previous ? [...workingPlayer.loreDiscard, previous] : workingPlayer.loreDiscard,
  };

  return { updatedPlayer, previous, cost, resonanceUsed };
}

// Rulebook: "place the Lore card on your Character board. If another Lore
// card occupies that slot, place the previous Lore card in your Lore discard
// pile."
export function attuneLoreCard(state: GameState, replaceIndex?: number, discardResonanceIndex?: number): GameState {
  const playerId = requirePendingLocation(state, ["ancientShrine", "scholarsGuild"]);
  if (!state.pendingReveal || state.pendingReveal.kind !== "lore") {
    throw new Error("There is no revealed Lore card to Attune.");
  }
  const player = state.players[playerId];
  const card = state.pendingReveal.card;

  const { updatedPlayer, previous, cost, resonanceUsed } = attuneLoreCardIntoSlot(
    player,
    card,
    replaceIndex,
    discardResonanceIndex,
  );

  const log = [
    ...state.log,
    `${player.character.name} Attunes ${card.name} for ${cost} Mana${resonanceUsed ? " (Rune of Resonance discount)" : ""}.` +
      (previous ? ` ${previous.name} moves to their Lore discard pile.` : ""),
  ];

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingReveal: null,
    log,
  };
}

// Rulebook: "If you Attuned the Lore card, you may reveal the next card of
// your Lore Deck and repeat this process. Otherwise, end the Attunement
// action." Declining (or being unable to afford) the revealed card ends the
// visit immediately — it doesn't offer another reveal.
export function discardLoreCard(state: GameState): GameState {
  const playerId = requirePendingLocation(state, ["ancientShrine", "scholarsGuild"]);
  if (!state.pendingReveal || state.pendingReveal.kind !== "lore") {
    throw new Error("There is no revealed Lore card to discard.");
  }
  const player = state.players[playerId];
  const card = state.pendingReveal.card;
  const updatedPlayer: EnginePlayer = { ...player, loreDiscard: [...player.loreDiscard, card] };

  return completeTurn({
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingReveal: null,
    log: [
      ...state.log,
      `${player.character.name} sends ${card.name} to their Lore discard pile without Attuning it.`,
    ],
  });
}

export function leaveAncientShrine(state: GameState): GameState {
  requirePendingLocation(state, ["ancientShrine", "scholarsGuild"]);
  if (state.pendingReveal) {
    throw new Error("Resolve the revealed card before leaving The Ancient Shrine.");
  }
  if (state.pendingRotPeek) {
    throw new Error("Resolve the Rot deck peek before leaving The Ancient Shrine.");
  }
  return completeTurn(state);
}

// --- Rune Stones --------------------------------------------------------------
//
// Rulebook: "Rune Stones have abilities that require them to be discarded...
// You may choose to discard a Rune Stone to resolve its ability when
// permitted by the card." Most of the 36 (src/data/runeStones.ts) are usable
// any time on the player's own turn — mirroring Cleansing's precedent (see
// cleansePool), not tied to any particular Location since a Rune Stone
// belongs to the player, not a Location. A handful are contextual to a
// specific Location/moment and are threaded as optional params into that
// action's existing function instead (Barter is the one exception below,
// since Exchange actions don't otherwise take a Rune Stone param elsewhere).
//
// Not implemented: Rune of Fracture ("discard after rolling your Attack dice
// to reroll 1 die"). Valley and Final Battle combat resolve the dice roll and
// the win/loss outcome atomically in one function call (chooseValleyLore/
// chooseFinalBattleLore) — adding a genuine pause between "roll" and
// "resolve" for this one card would mean restructuring both combat resolvers
// into a two-phase flow, risking regressions in already-verified combat
// logic. Flagged as a known gap (see README) rather than done unsafely.

function requireOwnActionTurn(state: GameState, playerId: string): EnginePlayer {
  if (state.phase !== "action" || state.playerOrder[state.activePlayerIndex] !== playerId) {
    throw new Error("It is not this player's turn.");
  }
  return state.players[playerId];
}

// Moves the Rune Stone at `index` to the player's Artifact discard pile (Rune
// Stones are Artifact-type cards per the rulebook) — a normal discard, not
// the permanent "removed from the game" of a Final Battle loss.
function discardRuneStoneFromPlayer(player: EnginePlayer, index: number): { updatedPlayer: EnginePlayer; card: ArtifactCard } {
  const card = player.equippedRuneStones[index];
  const updatedPlayer: EnginePlayer = {
    ...player,
    equippedRuneStones: player.equippedRuneStones.filter((_, i) => i !== index),
    artifactDiscard: [...player.artifactDiscard, card],
  };
  return { updatedPlayer, card };
}

// Shared prologue for every "anytime" Rune Stone ability: verify it's the
// player's own turn, verify they still have the named stone Attuned in that
// slot, and discard it.
function beginRuneStoneDiscard(
  state: GameState,
  playerId: string,
  index: number,
  expectedName: string,
): { state: GameState; player: EnginePlayer } {
  const player = requireOwnActionTurn(state, playerId);
  if (state.pendingRuneStoneChoice) {
    throw new Error("Resolve the current Rune Stone choice before discarding another.");
  }
  const card = player.equippedRuneStones[index];
  if (!card || card.name !== expectedName) {
    throw new Error(`${player.character.name} doesn't have ${expectedName} Attuned in that position.`);
  }
  const { updatedPlayer } = discardRuneStoneFromPlayer(player, index);
  const nextState: GameState = { ...state, players: { ...state.players, [playerId]: updatedPlayer } };
  return { state: nextState, player: updatedPlayer };
}

function takeFromOwnDiscard(
  player: EnginePlayer,
  deck: "artifact" | "lore",
  index: number,
): { updatedPlayer: EnginePlayer; card: ArtifactCard | LoreCard } {
  if (deck === "artifact") {
    const card = player.artifactDiscard[index];
    if (!card) throw new Error("Invalid Artifact discard pile position.");
    return { updatedPlayer: { ...player, artifactDiscard: player.artifactDiscard.filter((_, i) => i !== index) }, card };
  }
  const card = player.loreDiscard[index];
  if (!card) throw new Error("Invalid Lore discard pile position.");
  return { updatedPlayer: { ...player, loreDiscard: player.loreDiscard.filter((_, i) => i !== index) }, card };
}

// Equips an Artifact card with no Mana cost — shared by Rune of Renewal and
// Rune of Echoes, both of which Attune "for free" from a discard pile.
function equipArtifactFree(
  player: EnginePlayer,
  card: ArtifactCard,
  chosenSlot?: ArtifactSlotName,
): { updatedPlayer: EnginePlayer; slot: ArtifactSlotName; previous?: ArtifactCard } {
  const possibleSlots = getArtifactSlots(card);
  if (possibleSlots.length === 0) throw new Error(`${card.name} has no valid Artifact slot.`);
  let slot: ArtifactSlotName;
  if (possibleSlots.length === 1) {
    slot = possibleSlots[0];
  } else if (chosenSlot && possibleSlots.includes(chosenSlot)) {
    slot = chosenSlot;
  } else {
    throw new Error(`Choose a slot for ${card.name}: ${possibleSlots.join(" or ")}.`);
  }
  if (slot === "Rune Stone" && player.equippedRuneStones.length >= 3) {
    throw new Error(`${player.character.name} already has 3 Attuned Rune Stones.`);
  }
  const updatedPlayer: EnginePlayer = { ...player };
  let previous: ArtifactCard | undefined;
  if (slot === "Weapon") {
    previous = player.equippedWeapon;
    updatedPlayer.equippedWeapon = card;
  } else if (slot === "Armor") {
    previous = player.equippedArmor;
    updatedPlayer.equippedArmor = card;
  } else if (slot === "Implement") {
    previous = player.equippedImplement;
    updatedPlayer.equippedImplement = card;
  } else {
    updatedPlayer.equippedRuneStones = [...player.equippedRuneStones, card];
  }
  if (previous) updatedPlayer.artifactDiscard = [...updatedPlayer.artifactDiscard, previous];
  return { updatedPlayer, slot, previous };
}

// Lore counterpart of equipArtifactFree, for Rune of Renewal's Lore option.
function equipLoreFree(
  player: EnginePlayer,
  card: LoreCard,
  replaceIndex?: number,
): { updatedPlayer: EnginePlayer; previous?: LoreCard } {
  let attunedLore: LoreCard[];
  let previous: LoreCard | undefined;
  if (player.attunedLore.length < 3) {
    attunedLore = [...player.attunedLore, card];
  } else {
    if (replaceIndex === undefined || replaceIndex < 0 || replaceIndex >= 3) {
      throw new Error(`Choose which of your 3 Attuned Lore cards to replace with ${card.name}.`);
    }
    previous = player.attunedLore[replaceIndex];
    attunedLore = player.attunedLore.map((c, i) => (i === replaceIndex ? card : c));
  }
  const updatedPlayer: EnginePlayer = {
    ...player,
    attunedLore,
    loreDiscard: previous ? [...player.loreDiscard, previous] : player.loreDiscard,
  };
  return { updatedPlayer, previous };
}

// Draws up to `count` cards from a player's own Artifact or Lore deck,
// reshuffling their discard pile in first if there aren't enough left.
function drawPersonalDeck(
  player: EnginePlayer,
  deck: "artifact" | "lore",
  count: number,
  rng: () => number,
): { drawn: (ArtifactCard | LoreCard)[]; player: EnginePlayer; reshuffled: boolean } {
  let d: (ArtifactCard | LoreCard)[] = deck === "artifact" ? [...player.artifactDeck] : [...player.loreDeck];
  let disc: (ArtifactCard | LoreCard)[] = deck === "artifact" ? [...player.artifactDiscard] : [...player.loreDiscard];
  let reshuffled = false;
  if (d.length < count && disc.length > 0) {
    d = [...d, ...shuffle(disc, rng)];
    disc = [];
    reshuffled = true;
  }
  const drawn = d.slice(0, count);
  const remaining = d.slice(count);
  const updatedPlayer: EnginePlayer =
    deck === "artifact"
      ? { ...player, artifactDeck: remaining as ArtifactCard[], artifactDiscard: disc as ArtifactCard[] }
      : { ...player, loreDeck: remaining as LoreCard[], loreDiscard: disc as LoreCard[] };
  return { drawn, player: updatedPlayer, reshuffled };
}

// Rune of Abundance: "Discard to gain 5 Mana, distributed between your Mana
// Pools as you choose."
export function discardAbundance(state: GameState, playerId: string, index: number, artifactMana: number, loreMana: number): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Abundance");
  if (artifactMana < 0 || loreMana < 0 || artifactMana + loreMana !== 5) {
    throw new Error("Distribute exactly 5 Mana between your two pools.");
  }
  const updatedPlayer: EnginePlayer = {
    ...p1,
    manaPools: { artifact: p1.manaPools.artifact + artifactMana, lore: p1.manaPools.lore + loreMana },
  };
  return {
    ...s1,
    players: { ...s1.players, [playerId]: updatedPlayer },
    log: [...s1.log, `${p1.character.name} discards Rune of Abundance for 5 Mana (${artifactMana} Artifact / ${loreMana} Lore).`],
  };
}

// Rune of Cleansing: "Discard to remove up to 3 Withering Tokens from any
// combination of locations, including The Rot." Simplified to self + The
// Rot (not other players' pools) — draws from The Rot first, then the
// caster's own Artifact Pool, then their Lore Pool, since a pure cleanup
// effect has no reason to prefer one order and full any-player targeting
// isn't worth the UI complexity here. Distinct from the standing Cleansing
// rule (see cleansePool) — this is free, no Mana spent.
export function discardCleansingRune(state: GameState, playerId: string, index: number): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Cleansing");
  let budget = 3;
  const fromRot = Math.min(budget, s1.witheringTokens);
  budget -= fromRot;
  const fromArtifact = Math.min(budget, p1.witheringTokens.artifact);
  budget -= fromArtifact;
  const fromLore = Math.min(budget, p1.witheringTokens.lore);
  budget -= fromLore;
  const updatedPlayer: EnginePlayer = {
    ...p1,
    witheringTokens: { artifact: p1.witheringTokens.artifact - fromArtifact, lore: p1.witheringTokens.lore - fromLore },
  };
  return {
    ...s1,
    players: { ...s1.players, [playerId]: updatedPlayer },
    witheringTokens: s1.witheringTokens - fromRot,
    log: [
      ...s1.log,
      `${p1.character.name} discards Rune of Cleansing to remove ${3 - budget} Withering Token(s)` +
        ` (${fromRot} from The Rot, ${fromArtifact} from their Artifact Pool, ${fromLore} from their Lore Pool).`,
    ],
  };
}

// Rune of Community: "Discard to increase Faction by 1 on any track and
// remove up to 2 Withering Tokens from The Rot. Gain persistent Faction
// benefits, but not one-time benefits from this increase." Unlike a real
// visit (see applyFactionMilestone), this only bumps the track number
// itself — the ongoing per-visit perks a level unlocks (e.g. Artificer
// Faction 2's peek) apply automatically since they're just gated on the
// track value, but the one-time milestone rewards (bonus Mana/Gold, queued
// Row-refill choices, etc.) are deliberately skipped.
export function discardCommunity(state: GameState, playerId: string, index: number, targetLocationId: LocationId): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Community");
  const locationDef = locations.find((l) => l.id === targetLocationId);
  if (!locationDef?.hasFactionTrack) throw new Error("That Location doesn't have a Faction track.");
  const current = p1.factionTrack[targetLocationId] ?? 0;
  if (current >= 3) throw new Error(`${p1.character.name} is already at Faction 3 there.`);

  const newLevel = current + 1;
  const updatedPlayer: EnginePlayer = { ...p1, factionTrack: { ...p1.factionTrack, [targetLocationId]: newLevel } };
  const removed = Math.min(2, s1.witheringTokens);
  return {
    ...s1,
    players: { ...s1.players, [playerId]: updatedPlayer },
    witheringTokens: s1.witheringTokens - removed,
    log: [
      ...s1.log,
      `${p1.character.name} discards Rune of Community to increase their ${locationDef.name} Faction to ${newLevel} (persistent benefits only, no one-time reward)` +
        (removed > 0 ? ` and remove ${removed} Withering Token(s) from The Rot.` : "."),
    ],
  };
}

// Rune of Convergence: "Discard to remove up to 5 Withering Tokens from a
// single location, including The Rot. Remove this card from the game."
// Target is simplified to self + The Rot (not other players' pools) — a
// full any-player choice isn't worth the UI complexity for what's still
// fundamentally a cleanup effect, same call made for Rune of Cleansing
// below. "Remove this card from the game" (permanent, unlike a normal
// discard) means this doesn't use beginRuneStoneDiscard — mirrors Rune of
// Prophecy's identical phrasing/handling.
export function discardConvergence(state: GameState, playerId: string, index: number, target: "rot" | "artifact" | "lore"): GameState {
  const player = requireOwnActionTurn(state, playerId);
  const stone = player.equippedRuneStones[index];
  if (!stone || stone.name !== "Rune of Convergence") {
    throw new Error(`${player.character.name} doesn't have Rune of Convergence Attuned in that position.`);
  }
  const equippedRuneStones = player.equippedRuneStones.filter((_, i) => i !== index);

  if (target === "rot") {
    const removed = Math.min(5, state.witheringTokens);
    return {
      ...state,
      players: { ...state.players, [playerId]: { ...player, equippedRuneStones } },
      witheringTokens: state.witheringTokens - removed,
      log: [
        ...state.log,
        `${player.character.name} discards Rune of Convergence, removing it from the game, to remove ${removed} Withering Token(s) from The Rot.`,
      ],
    };
  }
  const removed = Math.min(5, player.witheringTokens[target]);
  const updatedPlayer: EnginePlayer = {
    ...player,
    equippedRuneStones,
    witheringTokens: { ...player.witheringTokens, [target]: player.witheringTokens[target] - removed },
  };
  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    log: [
      ...state.log,
      `${player.character.name} discards Rune of Convergence, removing it from the game, to remove ${removed} Withering Token(s) from their ${target === "artifact" ? "Artifact" : "Lore"} Pool.`,
    ],
  };
}

// Rune of Corruption: "Discard to remove up to 2 Withering Tokens from The
// Rot and place them in any player's Artifact Mana Pool." No longer grants
// Mana for existing Withering Tokens — an aggressive/adversarial effect now
// (helps the shared clock, but can taint an opponent's pool), so unlike
// Cleansing/Convergence above this does target any player, chosen by
// `targetPlayerId`.
export function discardCorruption(state: GameState, playerId: string, index: number, targetPlayerId: string): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Corruption");
  if (!s1.players[targetPlayerId]) throw new Error("Invalid target player.");
  const removed = Math.min(2, s1.witheringTokens);
  const target = s1.players[targetPlayerId];
  const updatedTarget: EnginePlayer = { ...target, witheringTokens: { ...target.witheringTokens, artifact: target.witheringTokens.artifact + removed } };
  return {
    ...s1,
    players: { ...s1.players, [playerId]: p1, [targetPlayerId]: updatedTarget },
    witheringTokens: s1.witheringTokens - removed,
    log: [
      ...s1.log,
      `${p1.character.name} discards Rune of Corruption to remove ${removed} Withering Token(s) from The Rot and place them in ${target.character.name}'s Artifact Mana Pool.`,
    ],
  };
}

// Rune of Culling: "Discard to remove a card from either of your discard
// piles from the game, gain 1 Gold, and remove up to 2 Withering Tokens
// from The Rot."
export function discardCulling(state: GameState, playerId: string, index: number, deck: "artifact" | "lore", discardIndex: number): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Culling");
  const { updatedPlayer: p2, card } = takeFromOwnDiscard(p1, deck, discardIndex);
  const updatedPlayer: EnginePlayer = { ...p2, gold: p2.gold + 1 };
  const removed = Math.min(2, s1.witheringTokens);
  return {
    ...s1,
    players: { ...s1.players, [playerId]: updatedPlayer },
    witheringTokens: s1.witheringTokens - removed,
    log: [
      ...s1.log,
      `${p1.character.name} discards Rune of Culling to remove ${card.name} from their ${deck === "artifact" ? "Artifact" : "Lore"} discard pile from the game, gaining 1 Gold` +
        (removed > 0 ? ` and removing ${removed} Withering Token(s) from The Rot.` : "."),
    ],
  };
}

// Rune of Decay: "Discard to remove up to 2 Withering Tokens from The Rot
// and place them on any one location." Adversarial like Corruption above —
// targets any player's Artifact or Lore Pool, chosen via `targetPlayerId`/
// `targetPool`.
export function discardDecay(state: GameState, playerId: string, index: number, targetPlayerId: string, targetPool: "artifact" | "lore"): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Decay");
  if (!s1.players[targetPlayerId]) throw new Error("Invalid target player.");
  const removed = Math.min(2, s1.witheringTokens);
  const target = s1.players[targetPlayerId];
  const updatedTarget: EnginePlayer = {
    ...target,
    witheringTokens: { ...target.witheringTokens, [targetPool]: target.witheringTokens[targetPool] + removed },
  };
  return {
    ...s1,
    players: { ...s1.players, [playerId]: p1, [targetPlayerId]: updatedTarget },
    witheringTokens: s1.witheringTokens - removed,
    log: [
      ...s1.log,
      `${p1.character.name} discards Rune of Decay to remove ${removed} Withering Token(s) from The Rot and place them in ${target.character.name}'s ${targetPool === "artifact" ? "Artifact" : "Lore"} Mana Pool.`,
    ],
  };
}

// Rune of Defiance: "Discard when taking The Valley action to remove up to
// 2 additional Withering Tokens from The Rot."
export function discardDefiance(state: GameState, index: number): GameState {
  const playerId = requirePendingLocation(state, "valley");
  const player = state.players[playerId];
  const card = player.equippedRuneStones[index];
  if (!card || card.name !== "Rune of Defiance") {
    throw new Error(`${player.character.name} doesn't have Rune of Defiance Attuned in that position.`);
  }
  const { updatedPlayer } = discardRuneStoneFromPlayer(player, index);
  const witheringTokens = Math.max(0, state.witheringTokens - 2);
  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    witheringTokens,
    log: [...state.log, `${player.character.name} discards Rune of Defiance to remove up to 2 additional Withering Tokens from The Rot (now ${witheringTokens}).`],
  };
}

// Rune of Delving: "Discard to reveal cards from the Artifact Deck until you
// reveal a card of a Type you choose. Place that card in the Artifact Row,
// replacing and discarding a card currently there. Discard the other
// revealed cards." No pending choice needed — the search itself has no
// player decision, just the Type and destination Row slot, both given
// upfront. Reshuffles the shared Artifact discard pile in mid-search if the
// deck runs dry before a match (or the whole search) is found; capped at
// deck+discard's combined size so a Type that doesn't exist anywhere can't
// loop forever.
export function discardDelving(
  state: GameState,
  playerId: string,
  index: number,
  chosenType: string,
  rowIndex: number,
  rng: () => number = Math.random,
): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Delving");
  if (rowIndex < 0 || rowIndex >= s1.artifactRow.length) throw new Error("Invalid Artifact Row position.");

  let deck = [...s1.artifactDeck];
  let discard = [...s1.artifactDiscard];
  const passedOver: ArtifactCard[] = [];
  let found: ArtifactCard | null = null;
  const totalAvailable = deck.length + discard.length;
  for (let i = 0; i < totalAvailable; i++) {
    if (deck.length === 0) {
      if (discard.length === 0) break;
      deck = shuffle(discard, rng);
      discard = [];
    }
    const [next, ...rest] = deck;
    deck = rest;
    if (next.type.includes(chosenType)) {
      found = next;
      break;
    }
    passedOver.push(next);
  }

  const nextState: GameState = {
    ...s1,
    players: { ...s1.players, [playerId]: p1 },
    artifactDeck: deck,
    artifactDiscard: [...discard, ...passedOver],
  };
  if (!found) {
    return {
      ...nextState,
      log: [...nextState.log, `${p1.character.name} discards Rune of Delving but finds no ${chosenType} card. ${passedOver.length} revealed card(s) are discarded.`],
    };
  }
  const artifactRow = [...s1.artifactRow];
  const replaced = artifactRow[rowIndex];
  artifactRow[rowIndex] = found;
  return {
    ...nextState,
    artifactRow,
    artifactDiscard: replaced ? [...nextState.artifactDiscard, replaced] : nextState.artifactDiscard,
    log: [
      ...nextState.log,
      `${p1.character.name} discards Rune of Delving to find ${found.name} (${chosenType}), placing it in the Artifact Row` +
        (replaced ? `, discarding ${replaced.name}.` : ".") +
        ` ${passedOver.length} other revealed card(s) are discarded.`,
    ],
  };
}

// Rune of Echoes: "Discard to Attune a Rune Stone from your discard pile."
// Free, like Rune of Renewal — see equipArtifactFree.
export function discardEchoes(state: GameState, playerId: string, index: number, discardIndex: number): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Echoes");
  const card = p1.artifactDiscard[discardIndex];
  if (!card || card.slot !== "Rune Stone") {
    throw new Error("Choose a Rune Stone from the Artifact discard pile.");
  }
  const { updatedPlayer: p2 } = takeFromOwnDiscard(p1, "artifact", discardIndex);
  const { updatedPlayer } = equipArtifactFree(p2, card);
  return {
    ...s1,
    players: { ...s1.players, [playerId]: updatedPlayer },
    log: [...s1.log, `${p1.character.name} discards Rune of Echoes to Attune ${card.name} from their Artifact discard pile for free.`],
  };
}

// Shared by Excavation/Discovery/Prospecting/Study: reveal N cards from a
// shared deck, choose 1 to replace a Row card (Discovery: or buy it
// instead) — see resolveRevealForRow.
function beginRevealForRow(
  state: GameState,
  playerId: string,
  index: number,
  expectedName: string,
  deck: "artifact" | "lore",
  count: number,
  canBuy: boolean,
  rng: () => number,
): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, expectedName);
  if (deck === "artifact") {
    const { drawn: revealed, deck: artifactDeck, discard: artifactDiscard, reshuffled } = drawFromSharedDeck(
      s1.artifactDeck,
      s1.artifactDiscard,
      count,
      rng,
    );
    const nextState: GameState = { ...s1, players: { ...s1.players, [playerId]: p1 }, artifactDeck, artifactDiscard };
    if (revealed.length === 0) {
      return { ...nextState, log: [...nextState.log, `${p1.character.name} discards ${expectedName}, but the Artifact Deck and discard pile are both empty.`] };
    }
    return {
      ...nextState,
      pendingRuneStoneChoice: { kind: "revealForRow", index, deck, revealed, canBuy },
      log: [
        ...nextState.log,
        `${p1.character.name} discards ${expectedName} to reveal the top ${revealed.length} card(s) of the Artifact Deck: ${revealed.map((c) => c.name).join(", ")}.` +
          (reshuffled ? " (The Artifact discard pile was shuffled into a new deck first.)" : ""),
      ],
    };
  }
  const { drawn: revealed, deck: loreDeck, discard: loreDiscard, reshuffled } = drawFromSharedDeck(s1.loreDeck, s1.loreDiscard, count, rng);
  const nextState: GameState = { ...s1, players: { ...s1.players, [playerId]: p1 }, loreDeck, loreDiscard };
  if (revealed.length === 0) {
    return { ...nextState, log: [...nextState.log, `${p1.character.name} discards ${expectedName}, but the Lore Deck and discard pile are both empty.`] };
  }
  return {
    ...nextState,
    pendingRuneStoneChoice: { kind: "revealForRow", index, deck, revealed, canBuy },
    log: [
      ...nextState.log,
      `${p1.character.name} discards ${expectedName} to reveal the top ${revealed.length} card(s) of the Lore Deck: ${revealed.map((c) => c.name).join(", ")}.` +
        (reshuffled ? " (The Lore discard pile was shuffled into a new deck first.)" : ""),
    ],
  };
}

// Rune of Excavation: "Discard to reveal the top 3 cards of the Artifact
// Deck. Choose 1 to replace a card in the Artifact Row. Discard the
// remaining revealed cards."
export function discardExcavation(state: GameState, playerId: string, index: number, rng: () => number = Math.random): GameState {
  return beginRevealForRow(state, playerId, index, "Rune of Excavation", "artifact", 3, false, rng);
}

// Rune of Discovery: "Discard to reveal the top 3 cards of the Artifact Deck.
// You may purchase 1 revealed card by paying its Gold cost. Discard the
// remaining cards."
export function discardDiscovery(state: GameState, playerId: string, index: number, rng: () => number = Math.random): GameState {
  return beginRevealForRow(state, playerId, index, "Rune of Discovery", "artifact", 3, true, rng);
}

// Rune of Prospecting: "Discard to reveal the top 5 cards of the Artifact
// Deck. Choose 1 to place in the Artifact Row, replacing and discarding a
// card currently there. Discard the remaining revealed cards."
export function discardProspecting(state: GameState, playerId: string, index: number, rng: () => number = Math.random): GameState {
  return beginRevealForRow(state, playerId, index, "Rune of Prospecting", "artifact", 5, false, rng);
}

// Rune of Study: "Discard to reveal the top 3 cards of the Lore Deck. Choose
// 1 to replace a card in the Lore Row. Discard the remaining revealed
// cards."
export function discardStudy(state: GameState, playerId: string, index: number, rng: () => number = Math.random): GameState {
  return beginRevealForRow(state, playerId, index, "Rune of Study", "lore", 3, false, rng);
}

export function resolveRevealForRow(state: GameState, action: "replace" | "buy" | "discardAll", cardIndex?: number, rowIndex?: number): GameState {
  const choice = state.pendingRuneStoneChoice;
  if (!choice || choice.kind !== "revealForRow") throw new Error("There is no revealed cards choice to resolve.");
  const playerId = state.playerOrder[state.activePlayerIndex];
  const player = state.players[playerId];
  const { deck, revealed, canBuy } = choice;

  if (action === "discardAll") {
    const nextState = deck === "artifact" ? { ...state, artifactDiscard: [...state.artifactDiscard, ...(revealed as ArtifactCard[])] } : { ...state, loreDiscard: [...state.loreDiscard, ...(revealed as LoreCard[])] };
    return { ...nextState, pendingRuneStoneChoice: null, log: [...state.log, `${player.character.name} discards all ${revealed.length} revealed card(s).`] };
  }

  if (cardIndex === undefined || !revealed[cardIndex]) throw new Error("Invalid card selection.");
  const chosen = revealed[cardIndex];
  const rest = revealed.filter((_, i) => i !== cardIndex);

  if (action === "buy") {
    if (!canBuy || deck !== "artifact") throw new Error("This Rune Stone doesn't let you purchase a revealed card.");
    const card = chosen as ArtifactCard;
    if (player.gold < card.goldCost) throw new Error(`${player.character.name} cannot afford ${card.name}.`);
    const updatedPlayer: EnginePlayer = { ...player, gold: player.gold - card.goldCost, artifactDiscard: [...player.artifactDiscard, card] };
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      artifactDiscard: [...state.artifactDiscard, ...(rest as ArtifactCard[])],
      pendingRuneStoneChoice: null,
      log: [...state.log, `${player.character.name} purchases ${card.name} for ${card.goldCost} Gold. The rest are discarded.`],
    };
  }

  if (rowIndex === undefined) throw new Error("Choose a Row position to replace.");
  if (deck === "artifact") {
    if (rowIndex < 0 || rowIndex >= state.artifactRow.length) throw new Error("Invalid Artifact Row position.");
    const artifactRow = [...state.artifactRow];
    const replaced = artifactRow[rowIndex];
    artifactRow[rowIndex] = chosen as ArtifactCard;
    return {
      ...state,
      artifactRow,
      artifactDiscard: [...state.artifactDiscard, ...(rest as ArtifactCard[]), ...(replaced ? [replaced] : [])],
      pendingRuneStoneChoice: null,
      log: [...state.log, `${player.character.name} places ${chosen.name} in the Artifact Row` + (replaced ? `, discarding ${replaced.name}.` : ".") + " The rest are discarded."],
    };
  }
  if (rowIndex < 0 || rowIndex >= state.loreRow.length) throw new Error("Invalid Lore Row position.");
  const loreRow = [...state.loreRow];
  const replaced = loreRow[rowIndex];
  loreRow[rowIndex] = chosen as LoreCard;
  return {
    ...state,
    loreRow,
    loreDiscard: [...state.loreDiscard, ...(rest as LoreCard[]), ...(replaced ? [replaced] : [])],
    pendingRuneStoneChoice: null,
    log: [...state.log, `${player.character.name} places ${chosen.name} in the Lore Row` + (replaced ? `, discarding ${replaced.name}.` : ".") + " The rest are discarded."],
  };
}

// Rune of Foresight: "Discard to look at the top 3 cards of one of your
// personal decks and return them in any order."
export function discardForesightRune(state: GameState, playerId: string, index: number, deck: "artifact" | "lore", rng: () => number = Math.random): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Foresight");
  const { drawn, player: p2, reshuffled } = drawPersonalDeck(p1, deck, 3, rng);
  const deckName = deck === "artifact" ? "Artifact" : "Lore";
  const nextState: GameState = { ...s1, players: { ...s1.players, [playerId]: p2 } };
  if (drawn.length === 0) {
    return { ...nextState, log: [...nextState.log, `${p1.character.name} discards Rune of Foresight, but their ${deckName} deck is empty.`] };
  }
  return {
    ...nextState,
    pendingRuneStoneChoice: { kind: "reorderPersonalDeck", index, deck, revealed: drawn },
    log: [
      ...nextState.log,
      `${p1.character.name} discards Rune of Foresight to look at the top ${drawn.length} card(s) of their ${deckName} deck.${reshuffled ? " (Their discard pile was shuffled in first.)" : ""}`,
    ],
  };
}

export function resolveReorderPersonalDeck(state: GameState, order: number[]): GameState {
  const choice = state.pendingRuneStoneChoice;
  if (!choice || choice.kind !== "reorderPersonalDeck") throw new Error("There is no personal deck order to resolve.");
  const playerId = state.playerOrder[state.activePlayerIndex];
  const player = state.players[playerId];
  const { deck, revealed } = choice;
  const uniqueIndices = new Set(order);
  if (uniqueIndices.size !== revealed.length || order.length !== revealed.length || order.some((i) => i < 0 || i >= revealed.length)) {
    throw new Error("Choose an order for all of the revealed cards.");
  }
  const reordered = order.map((i) => revealed[i]);
  const updatedPlayer: EnginePlayer =
    deck === "artifact"
      ? { ...player, artifactDeck: [...(reordered as ArtifactCard[]), ...player.artifactDeck] }
      : { ...player, loreDeck: [...(reordered as LoreCard[]), ...player.loreDeck] };
  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingRuneStoneChoice: null,
    log: [...state.log, `${player.character.name} returns ${reordered.map((c) => c.name).join(", ")} to the top of their ${deck === "artifact" ? "Artifact" : "Lore"} deck in that order.`],
  };
}

// Rune of Insight: "Discard before revealing a card to Attune. Look at the
// top 3 cards, choose one to reveal, and place the others on the bottom in
// any order." Replaces the normal reveal at the Artificer/Ancient Shrine.
export function discardInsight(state: GameState, index: number, deck: "artifact" | "lore", rng: () => number = Math.random): GameState {
  const locationId = deck === "artifact" ? "artificer" : "ancientShrine";
  const playerId = requirePendingLocation(state, locationId);
  if (state.pendingReveal) throw new Error("Resolve the revealed card before using Rune of Insight.");
  const player0 = state.players[playerId];
  const card = player0.equippedRuneStones[index];
  if (!card || card.name !== "Rune of Insight") throw new Error(`${player0.character.name} doesn't have Rune of Insight Attuned in that position.`);
  const { updatedPlayer: p1 } = discardRuneStoneFromPlayer(player0, index);
  const { drawn, player: p2, reshuffled } = drawPersonalDeck(p1, deck, 3, rng);
  const deckName = deck === "artifact" ? "Artifact" : "Lore";
  const nextState: GameState = { ...state, players: { ...state.players, [playerId]: p2 } };
  if (drawn.length === 0) {
    return { ...nextState, log: [...nextState.log, `${p1.character.name} discards Rune of Insight, but their ${deckName} deck is empty.`] };
  }
  return {
    ...nextState,
    pendingRuneStoneChoice: { kind: "insightChoice", index, deck, revealed: drawn },
    log: [
      ...nextState.log,
      `${p1.character.name} discards Rune of Insight to look at the top ${drawn.length} card(s) of their ${deckName} deck.${reshuffled ? " (Their discard pile was shuffled in first.)" : ""}`,
    ],
  };
}

export function resolveInsightChoice(state: GameState, chosenIndex: number, bottomOrder: number[]): GameState {
  const choice = state.pendingRuneStoneChoice;
  if (!choice || choice.kind !== "insightChoice") throw new Error("There is no Insight choice to resolve.");
  const locationId = choice.deck === "artifact" ? "artificer" : "ancientShrine";
  const playerId = requirePendingLocation(state, locationId);
  const player = state.players[playerId];
  const { deck, revealed } = choice;
  const chosen = revealed[chosenIndex];
  if (!chosen) throw new Error("Invalid card selection.");
  const others = revealed.filter((_, i) => i !== chosenIndex);
  if (bottomOrder.length !== others.length || new Set(bottomOrder).size !== others.length || bottomOrder.some((i) => i < 0 || i >= others.length)) {
    throw new Error("Choose an order for the other cards.");
  }
  const orderedOthers = bottomOrder.map((i) => others[i]);
  const updatedPlayer: EnginePlayer =
    deck === "artifact"
      ? { ...player, artifactDeck: [...player.artifactDeck, ...(orderedOthers as ArtifactCard[])] }
      : { ...player, loreDeck: [...player.loreDeck, ...(orderedOthers as LoreCard[])] };
  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingRuneStoneChoice: null,
    pendingReveal: deck === "artifact" ? { kind: "artifact", card: chosen as ArtifactCard } : { kind: "lore", card: chosen as LoreCard },
    log: [
      ...state.log,
      `${player.character.name} reveals ${chosen.name} and places ${orderedOthers.map((c) => c.name).join(", ")} on the bottom of their ${deck === "artifact" ? "Artifact" : "Lore"} deck.`,
    ],
  };
}

// Rune of Prophecy's ability changed in a sheet update from a Lore Row swap
// (the old discardProphecy, removed) to "Discard to add +20 to your Attack
// against a Rot encounter in The Valley. Remove this card from the game" —
// see chooseValleyLore's and resolveValleyAttackRoll's `prophecyIndex`
// parameter, which now implements it inline alongside Rune of Fracture and
// Rune of Preservation rather than through a standalone discardX function,
// since (like those two) it only ever applies in the middle of resolving a
// Valley attack.

// Rune of Recall: "Discard to choose 1 card from either discard pile and
// place it on top of its deck." ("its deck" = that card's own personal deck.)
export function discardRecall(state: GameState, playerId: string, index: number, deck: "artifact" | "lore", discardIndex: number): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Recall");
  const { updatedPlayer: p2, card } = takeFromOwnDiscard(p1, deck, discardIndex);
  const updatedPlayer: EnginePlayer =
    deck === "artifact" ? { ...p2, artifactDeck: [card as ArtifactCard, ...p2.artifactDeck] } : { ...p2, loreDeck: [card as LoreCard, ...p2.loreDeck] };
  return {
    ...s1,
    players: { ...s1.players, [playerId]: updatedPlayer },
    log: [...s1.log, `${p1.character.name} discards Rune of Recall to place ${card.name} from their ${deck === "artifact" ? "Artifact" : "Lore"} discard pile on top of their ${deck === "artifact" ? "Artifact" : "Lore"} deck.`],
  };
}

// Rune of Reversal: "Discard to return one of your placed Action Tokens to
// your Character board." Only recovers the token — it doesn't undo whatever
// that visit already did (unlike "Back to Board", see cancelLocationVisit).
export function discardReversal(state: GameState, playerId: string, index: number, locationId: LocationId): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Reversal");
  const tokensThere = s1.locationTokens[locationId] ?? [];
  if (!tokensThere.includes(playerId)) {
    throw new Error(`${p1.character.name} doesn't have an Action Token on that Location.`);
  }
  const locationTokens = { ...s1.locationTokens, [locationId]: tokensThere.filter((id) => id !== playerId) };
  const updatedPlayer: EnginePlayer = { ...p1, actionTokensRemaining: p1.actionTokensRemaining + 1 };
  const locationName = locations.find((l) => l.id === locationId)?.name ?? locationId;
  return {
    ...s1,
    players: { ...s1.players, [playerId]: updatedPlayer },
    locationTokens,
    log: [...s1.log, `${p1.character.name} discards Rune of Reversal to return their Action Token from ${locationName} to their Character board.`],
  };
}

// Rune of Renewal: "Discard to choose any card from one of your discard
// piles and Attune it for free, then remove up to 2 Withering Tokens from
// The Rot."
export function discardRenewal(
  state: GameState,
  playerId: string,
  index: number,
  deck: "artifact" | "lore",
  discardIndex: number,
  chosenSlot?: ArtifactSlotName,
  replaceIndex?: number,
): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Renewal");
  const removed = Math.min(2, s1.witheringTokens);
  const witheringNote = removed > 0 ? ` ${removed} Withering Token(s) removed from The Rot.` : "";
  if (deck === "artifact") {
    const { updatedPlayer: p2, card } = takeFromOwnDiscard(p1, "artifact", discardIndex);
    const { updatedPlayer, slot, previous } = equipArtifactFree(p2, card as ArtifactCard, chosenSlot);
    return {
      ...s1,
      players: { ...s1.players, [playerId]: updatedPlayer },
      witheringTokens: s1.witheringTokens - removed,
      log: [
        ...s1.log,
        `${p1.character.name} discards Rune of Renewal to Attune ${card.name} from their Artifact discard pile for free, to their ${slot} slot.` +
          (previous ? ` ${previous.name} moves to their Artifact discard pile.` : "") +
          witheringNote,
      ],
    };
  }
  const { updatedPlayer: p2, card } = takeFromOwnDiscard(p1, "lore", discardIndex);
  const { updatedPlayer, previous } = equipLoreFree(p2, card as LoreCard, replaceIndex);
  return {
    ...s1,
    players: { ...s1.players, [playerId]: updatedPlayer },
    witheringTokens: s1.witheringTokens - removed,
    log: [
      ...s1.log,
      `${p1.character.name} discards Rune of Renewal to Attune ${card.name} from their Lore discard pile for free.` +
        (previous ? ` ${previous.name} moves to their Lore discard pile.` : "") +
        witheringNote,
    ],
  };
}

// Rune of Revelation: "Discard to refresh either the Artifact Row or Lore
// Row."
export function discardRevelation(
  state: GameState,
  playerId: string,
  index: number,
  whichRow: "artifact" | "lore",
  rng: () => number = Math.random,
): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Revelation");
  if (whichRow === "artifact") {
    const oldRow = s1.artifactRow.filter((c): c is ArtifactCard => c !== null);
    const draw = drawFromSharedDeck(s1.artifactDeck, [...s1.artifactDiscard, ...oldRow], 3, rng);
    return {
      ...s1,
      players: { ...s1.players, [playerId]: p1 },
      artifactRow: [draw.drawn[0] ?? null, draw.drawn[1] ?? null, draw.drawn[2] ?? null],
      artifactDeck: draw.deck,
      artifactDiscard: draw.discard,
      log: [...s1.log, `${p1.character.name} discards Rune of Revelation to refresh the Artifact Row.`],
    };
  }
  const oldRow = s1.loreRow.filter((c): c is LoreCard => c !== null);
  const draw = drawFromSharedDeck(s1.loreDeck, [...s1.loreDiscard, ...oldRow], 3, rng);
  return {
    ...s1,
    players: { ...s1.players, [playerId]: p1 },
    loreRow: [draw.drawn[0] ?? null, draw.drawn[1] ?? null, draw.drawn[2] ?? null],
    loreDeck: draw.deck,
    loreDiscard: draw.discard,
    log: [...s1.log, `${p1.character.name} discards Rune of Revelation to refresh the Lore Row.`],
  };
}

// Rune of Sacrifice: "Discard to remove an Artifact card from your discard
// pile from the game, then remove up to 2 Withering Tokens from The Rot."
// No longer grants Mana equal to the removed card's Attunement cost.
export function discardSacrifice(state: GameState, playerId: string, index: number, artifactDiscardIndex: number): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Sacrifice");
  const { updatedPlayer, card } = takeFromOwnDiscard(p1, "artifact", artifactDiscardIndex);
  const removed = Math.min(2, s1.witheringTokens);
  return {
    ...s1,
    players: { ...s1.players, [playerId]: updatedPlayer },
    witheringTokens: s1.witheringTokens - removed,
    log: [
      ...s1.log,
      `${p1.character.name} discards Rune of Sacrifice to remove ${card.name} from their Artifact discard pile from the game` +
        (removed > 0 ? `, removing ${removed} Withering Token(s) from The Rot.` : "."),
    ],
  };
}

// Rune of Salvage: "Discard to choose 1 Artifact card from the Artifact
// discard pile and place it in the Artifact Row, replacing and discarding a
// card currently there."
export function discardSalvage(state: GameState, playerId: string, index: number, artifactDiscardIndex: number, rowIndex: number): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Salvage");
  const { updatedPlayer, card } = takeFromOwnDiscard(p1, "artifact", artifactDiscardIndex);
  if (rowIndex < 0 || rowIndex >= s1.artifactRow.length) throw new Error("Invalid Artifact Row position.");
  const artifactRow = [...s1.artifactRow];
  const replaced = artifactRow[rowIndex];
  artifactRow[rowIndex] = card as ArtifactCard;
  return {
    ...s1,
    players: { ...s1.players, [playerId]: updatedPlayer },
    artifactRow,
    log: [...s1.log, `${p1.character.name} discards Rune of Salvage to place ${card.name} from their Artifact discard pile into the Artifact Row` + (replaced ? `, discarding ${replaced.name}.` : ".")],
  };
}

// Rune of Scavenging: "Discard to place 1 card from the Artifact Row on the
// bottom of the Artifact Deck, then refill the Artifact Row."
export function discardScavenging(state: GameState, playerId: string, index: number, rowIndex: number): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Scavenging");
  if (rowIndex < 0 || rowIndex >= s1.artifactRow.length) throw new Error("Invalid Artifact Row position.");
  const card = s1.artifactRow[rowIndex];
  if (!card) throw new Error("There is no card in that Artifact Row position.");
  const artifactDeck = [...s1.artifactDeck];
  const nextCard = artifactDeck.shift() ?? null;
  const artifactRow = [...s1.artifactRow];
  artifactRow[rowIndex] = nextCard;
  return {
    ...s1,
    players: { ...s1.players, [playerId]: p1 },
    artifactRow,
    artifactDeck: [...artifactDeck, card],
    log: [
      ...s1.log,
      `${p1.character.name} discards Rune of Scavenging to place ${card.name} on the bottom of the Artifact Deck.` +
        (nextCard ? ` ${nextCard.name} refills the Row.` : " The Artifact Deck is empty — that Row position stays empty."),
    ],
  };
}

// Rune of Seeking: "Discard before revealing from one of your personal
// decks. Search that deck for any card, shuffle the deck, then reveal the
// chosen card." Replaces the normal reveal at the Artificer/Ancient Shrine.
export function discardSeeking(state: GameState, index: number, deck: "artifact" | "lore"): GameState {
  const locationId = deck === "artifact" ? "artificer" : "ancientShrine";
  const playerId = requirePendingLocation(state, locationId);
  if (state.pendingReveal) throw new Error("Resolve the revealed card before using Rune of Seeking.");
  const player0 = state.players[playerId];
  const card = player0.equippedRuneStones[index];
  if (!card || card.name !== "Rune of Seeking") throw new Error(`${player0.character.name} doesn't have Rune of Seeking Attuned in that position.`);
  const { updatedPlayer: p1 } = discardRuneStoneFromPlayer(player0, index);
  const cards = deck === "artifact" ? p1.artifactDeck : p1.loreDeck;
  const deckName = deck === "artifact" ? "Artifact" : "Lore";
  if (cards.length === 0) {
    return { ...state, players: { ...state.players, [playerId]: p1 }, log: [...state.log, `${p1.character.name} discards Rune of Seeking, but their ${deckName} deck is empty.`] };
  }
  return {
    ...state,
    players: { ...state.players, [playerId]: p1 },
    pendingRuneStoneChoice: { kind: "seekChoice", index, deck, cards },
    log: [...state.log, `${p1.character.name} discards Rune of Seeking to search their ${deckName} deck for any card.`],
  };
}

export function resolveSeekChoice(state: GameState, cardIndex: number, rng: () => number = Math.random): GameState {
  const choice = state.pendingRuneStoneChoice;
  if (!choice || choice.kind !== "seekChoice") throw new Error("There is no Seeking choice to resolve.");
  const locationId = choice.deck === "artifact" ? "artificer" : "ancientShrine";
  const playerId = requirePendingLocation(state, locationId);
  const player = state.players[playerId];
  const { deck, cards } = choice;
  const chosen = cards[cardIndex];
  if (!chosen) throw new Error("Invalid card selection.");
  const rest = cards.filter((_, i) => i !== cardIndex);
  const shuffled = shuffle(rest, rng);
  const updatedPlayer: EnginePlayer =
    deck === "artifact" ? { ...player, artifactDeck: shuffled as ArtifactCard[] } : { ...player, loreDeck: shuffled as LoreCard[] };
  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingRuneStoneChoice: null,
    pendingReveal: deck === "artifact" ? { kind: "artifact", card: chosen as ArtifactCard } : { kind: "lore", card: chosen as LoreCard },
    log: [...state.log, `${player.character.name} finds ${chosen.name}, shuffles the rest back into their ${deck === "artifact" ? "Artifact" : "Lore"} deck, and reveals it.`],
  };
}

// Rune of Transmutation: "Discard to move any amount of Mana from one Mana
// Pool to the other. For every 2 Mana moved, gain 1 additional Mana in the
// receiving pool."
export function discardTransmutation(state: GameState, playerId: string, index: number, fromPool: "artifact" | "lore", amount: number): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Transmutation");
  if (amount < 0 || amount > p1.manaPools[fromPool]) throw new Error(`${p1.character.name} doesn't have that much Mana in that pool.`);
  const toPool: "artifact" | "lore" = fromPool === "artifact" ? "lore" : "artifact";
  const bonus = Math.floor(amount / 2);
  const updatedPlayer: EnginePlayer = {
    ...p1,
    manaPools: { ...p1.manaPools, [fromPool]: p1.manaPools[fromPool] - amount, [toPool]: p1.manaPools[toPool] + amount + bonus },
  };
  return {
    ...s1,
    players: { ...s1.players, [playerId]: updatedPlayer },
    log: [
      ...s1.log,
      `${p1.character.name} discards Rune of Transmutation to move ${amount} Mana from their ${fromPool === "artifact" ? "Artifact" : "Lore"} pool to their ${toPool === "artifact" ? "Artifact" : "Lore"} pool, gaining ${bonus} bonus Mana.`,
    ],
  };
}

// Rune of Vengeance: "Discard after losing a battle to remove up to 3
// Withering Tokens from The Rot." Usable while the just-resolved outcome is
// a loss, in either combat system. Previously took 1 card from a personal
// discard pile and placed it on top of its deck — that mechanic is gone.
export function discardVengeance(state: GameState, index: number): GameState {
  let playerId: string;
  if (state.pendingValleyOutcome?.outcome === "loss") {
    playerId = requirePendingLocation(state, "valley");
  } else if (state.pendingFinalBattleOutcome?.outcome === "loss") {
    playerId = state.pendingFinalBattleOutcome.playerId;
  } else {
    throw new Error("Rune of Vengeance can only be discarded right after losing a battle.");
  }
  const player = state.players[playerId];
  const card = player.equippedRuneStones[index];
  if (!card || card.name !== "Rune of Vengeance") throw new Error(`${player.character.name} doesn't have Rune of Vengeance Attuned in that position.`);
  const { updatedPlayer } = discardRuneStoneFromPlayer(player, index);
  const removed = Math.min(3, state.witheringTokens);
  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    witheringTokens: state.witheringTokens - removed,
    log: [...state.log, `${player.character.name} discards Rune of Vengeance to remove ${removed} Withering Token(s) from The Rot.`],
  };
}

// Rune of Teleportation: "Discard after losing a battle in The Valley to
// ignore the loss condition on the Rot card." Rune of Time: same, plus
// "remove up to 2 Withering Tokens from The Rot" — the two were previously
// mechanically identical ("rewind time" was flavor text only), but Time's
// sheet entry now adds the extra clause Teleportation doesn't have. Unlike
// Rune of Vengeance just above, this doesn't supplement
// finalizeValleyOutcome — it replaces it: the Loss effect text never
// applies, and the Rot card goes straight to the shared discard as though
// nothing happened. Scoped to Valley only, matching the card text exactly —
// neither card mentions the Final Battle's own (differently shaped) Loss.
export function discardIgnoreValleyLoss(state: GameState, index: number): GameState {
  const playerId = requirePendingLocation(state, "valley");
  const resolution = state.pendingValleyOutcome;
  if (!resolution || resolution.outcome !== "loss") {
    throw new Error("There is no Valley combat Loss to ignore.");
  }
  const player = state.players[playerId];
  const stone = player.equippedRuneStones[index];
  if (!stone || (stone.name !== "Rune of Teleportation" && stone.name !== "Rune of Time")) {
    throw new Error(`${player.character.name} doesn't have Rune of Teleportation or Rune of Time Attuned in that position.`);
  }
  const { updatedPlayer } = discardRuneStoneFromPlayer(player, index);
  const removed = stone.name === "Rune of Time" ? Math.min(2, state.witheringTokens) : 0;
  return completeTurn({
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    witheringTokens: state.witheringTokens - removed,
    rotDiscard: [...state.rotDiscard, resolution.card],
    pendingValleyOutcome: null,
    log: [
      ...state.log,
      `${player.character.name} discards ${stone.name} to ignore the Loss condition on ${resolution.card.card.name}.` +
        (removed > 0 ? ` ${removed} Withering Token(s) removed from The Rot.` : ""),
    ],
  });
}

// Rune of Whispers: "Discard to look at the top card of The Rot deck. You
// may discard it."
export function discardWhispers(state: GameState, playerId: string, index: number, rng: () => number = Math.random): GameState {
  const { state: s1, player: p1 } = beginRuneStoneDiscard(state, playerId, index, "Rune of Whispers");
  const { drawn, deck, discard, reshuffled } = drawRotCards(s1.rotDeck, s1.rotDiscard, 1, rng);
  const nextState: GameState = { ...s1, rotDeck: deck, rotDiscard: discard };
  if (drawn.length === 0) {
    return { ...nextState, log: [...nextState.log, `${p1.character.name} discards Rune of Whispers, but The Rot deck and discard pile are both empty.`] };
  }
  return {
    ...nextState,
    pendingRuneStoneChoice: { kind: "whispersPeek", index, card: drawn[0] },
    log: [
      ...nextState.log,
      `${p1.character.name} discards Rune of Whispers to look at the top card of The Rot deck.${reshuffled ? " (The Rot discard pile was shuffled into a new deck first.)" : ""}`,
    ],
  };
}

export function resolveWhispersPeek(state: GameState, discard: boolean): GameState {
  const choice = state.pendingRuneStoneChoice;
  if (!choice || choice.kind !== "whispersPeek") throw new Error("There is no Whispers peek to resolve.");
  const playerId = state.playerOrder[state.activePlayerIndex];
  const player = state.players[playerId];
  const cardName = choice.card.card.name;
  if (discard) {
    const removed = Math.min(2, state.witheringTokens);
    return {
      ...state,
      rotDiscard: [...state.rotDiscard, choice.card],
      pendingRuneStoneChoice: null,
      witheringTokens: state.witheringTokens - removed,
      log: [
        ...state.log,
        `${player.character.name} discards ${cardName} from The Rot deck.` +
          (removed > 0 ? ` ${removed} Withering Token(s) removed from The Rot.` : ""),
      ],
    };
  }
  return { ...state, rotDeck: [choice.card, ...state.rotDeck], pendingRuneStoneChoice: null, log: [...state.log, `${player.character.name} leaves ${cardName} on top of The Rot deck.`] };
}

// Rune of Barter: "At The Exchange, discard this Rune Stone to gain 5 Gold."
export function discardBarter(state: GameState, index: number): GameState {
  const playerId = requirePendingExchange(state);
  const player = state.players[playerId];
  const card = player.equippedRuneStones[index];
  if (!card || card.name !== "Rune of Barter") throw new Error(`${player.character.name} doesn't have Rune of Barter Attuned in that position.`);
  const { updatedPlayer: p1 } = discardRuneStoneFromPlayer(player, index);
  const updatedPlayer: EnginePlayer = { ...p1, gold: p1.gold + 5 };
  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    log: [...state.log, `${player.character.name} discards Rune of Barter for 5 Gold at The Exchange.`],
  };
}

// Rune of Communion: "Discard when Attuning a Lore card to use Withering
// Tokens from any location to pay its Mana cost." Previously just split
// clean Mana across both pools; now a Withering Token (from the caster's
// own Artifact/Lore Pool, or The Rot's shared board) can also cover part of
// the cost 1-for-1, consumed as it's spent — and unlike a normal payment,
// this deliberately skips assertPoolNotTainted, since bypassing that block
// is the whole point of the upgraded ability. "Any location" is simplified
// to self + The Rot (not other players' pools), matching Cleansing/
// Convergence above.
export function attuneLoreCardWithCommunion(
  state: GameState,
  communionIndex: number,
  payment: { artifactMana: number; loreMana: number; witheringArtifact?: number; witheringLore?: number; witheringRot?: number },
  replaceIndex?: number,
): GameState {
  const playerId = requirePendingLocation(state, "ancientShrine");
  if (!state.pendingReveal || state.pendingReveal.kind !== "lore") throw new Error("There is no revealed Lore card to Attune.");
  const player = state.players[playerId];
  const stone = player.equippedRuneStones[communionIndex];
  if (!stone || stone.name !== "Rune of Communion") throw new Error(`${player.character.name} doesn't have Rune of Communion Attuned in that position.`);
  const card = state.pendingReveal.card;

  const { artifactMana, loreMana } = payment;
  const witheringArtifact = payment.witheringArtifact ?? 0;
  const witheringLore = payment.witheringLore ?? 0;
  const witheringRot = payment.witheringRot ?? 0;
  const total = artifactMana + loreMana + witheringArtifact + witheringLore + witheringRot;
  if (artifactMana < 0 || loreMana < 0 || witheringArtifact < 0 || witheringLore < 0 || witheringRot < 0 || total !== card.attunementCost) {
    throw new Error(`Cover exactly ${card.attunementCost} Mana for ${card.name}.`);
  }
  if (player.manaPools.artifact < artifactMana || player.manaPools.lore < loreMana) {
    throw new Error(`${player.character.name} doesn't have enough Mana across both pools to Attune ${card.name}.`);
  }
  if (player.witheringTokens.artifact < witheringArtifact || player.witheringTokens.lore < witheringLore) {
    throw new Error(`${player.character.name} doesn't have that many Withering Tokens in their Mana Pools.`);
  }
  if (state.witheringTokens < witheringRot) {
    throw new Error("The Rot doesn't have that many Withering Tokens.");
  }
  const { updatedPlayer: withoutStone } = discardRuneStoneFromPlayer(player, communionIndex);

  let attunedLore: LoreCard[];
  let previous: LoreCard | undefined;
  if (withoutStone.attunedLore.length < 3) {
    attunedLore = [...withoutStone.attunedLore, card];
  } else {
    if (replaceIndex === undefined || replaceIndex < 0 || replaceIndex >= 3) {
      throw new Error(`Choose which of your 3 Attuned Lore cards to replace with ${card.name}.`);
    }
    previous = withoutStone.attunedLore[replaceIndex];
    attunedLore = withoutStone.attunedLore.map((c, i) => (i === replaceIndex ? card : c));
  }

  const updatedPlayer: EnginePlayer = {
    ...withoutStone,
    manaPools: { artifact: withoutStone.manaPools.artifact - artifactMana, lore: withoutStone.manaPools.lore - loreMana },
    witheringTokens: {
      artifact: withoutStone.witheringTokens.artifact - witheringArtifact,
      lore: withoutStone.witheringTokens.lore - witheringLore,
    },
    attunedLore,
    loreDiscard: previous ? [...withoutStone.loreDiscard, previous] : withoutStone.loreDiscard,
  };

  const paymentParts: string[] = [];
  if (artifactMana > 0) paymentParts.push(`${artifactMana} Artifact Mana`);
  if (loreMana > 0) paymentParts.push(`${loreMana} Lore Mana`);
  if (witheringArtifact > 0) paymentParts.push(`${witheringArtifact} Withering Token(s) from their Artifact Pool`);
  if (witheringLore > 0) paymentParts.push(`${witheringLore} Withering Token(s) from their Lore Pool`);
  if (witheringRot > 0) paymentParts.push(`${witheringRot} Withering Token(s) from The Rot`);

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    witheringTokens: state.witheringTokens - witheringRot,
    pendingReveal: null,
    log: [
      ...state.log,
      `${player.character.name} discards Rune of Communion to Attune ${card.name} for ${card.attunementCost} Mana (${paymentParts.join(", ") || "free"}).` +
        (previous ? ` ${previous.name} moves to their Lore discard pile.` : ""),
    ],
  };
}

// Rune of Premonition: "Discard when revealing a Rot card. Look at the top 3
// Rot cards, choose 1 to encounter, and discard the rest." Only available
// during the pre-reveal pause placeActionToken opens for it (see
// pendingValleyScry) — mutually exclusive with the Faction 3 Scry from that
// same pause.
export function discardPremonition(state: GameState, index: number, rng: () => number = Math.random): GameState {
  if (!state.pendingValleyScry || state.pendingValleyScry.stage !== "offered") {
    throw new Error("Rune of Premonition can only be discarded when revealing a Rot card at The Valley.");
  }
  const playerId = requirePendingLocation(state, "valley");
  const player = state.players[playerId];
  const card = player.equippedRuneStones[index];
  if (!card || card.name !== "Rune of Premonition") throw new Error(`${player.character.name} doesn't have Rune of Premonition Attuned in that position.`);
  const { updatedPlayer: p1 } = discardRuneStoneFromPlayer(player, index);
  const { drawn, deck, discard, reshuffled } = drawRotCards(state.rotDeck, state.rotDiscard, 3, rng);
  const nextState: GameState = { ...state, players: { ...state.players, [playerId]: p1 }, rotDeck: deck, rotDiscard: discard };
  if (drawn.length === 0) {
    return { ...nextState, pendingValleyScry: null, log: [...nextState.log, `${p1.character.name} discards Rune of Premonition, but The Rot deck and discard pile are both empty.`] };
  }
  return {
    ...nextState,
    pendingValleyScry: null,
    pendingValleyPremonition: { runeStoneIndex: index, revealed: drawn },
    log: [
      ...nextState.log,
      `${p1.character.name} discards Rune of Premonition to look at the top ${drawn.length} card(s) of The Rot deck: ${drawn.map((c) => c.card.name).join(", ")}.${reshuffled ? " (The Rot discard pile was shuffled into a new deck first.)" : ""}`,
    ],
  };
}

export function resolveValleyPremonition(state: GameState, chosenIndex: number): GameState {
  const playerId = requirePendingLocation(state, "valley");
  const premonition = state.pendingValleyPremonition;
  if (!premonition) throw new Error("There is no Premonition reveal to resolve.");
  const player = state.players[playerId];
  const chosen = premonition.revealed[chosenIndex];
  if (!chosen) throw new Error("Invalid card selection.");
  const rest = premonition.revealed.filter((_, i) => i !== chosenIndex);
  return {
    ...state,
    pendingValleyPremonition: null,
    pendingValleyEncounter: chosen,
    rotDiscard: [...state.rotDiscard, ...rest],
    log: [...state.log, `${player.character.name} chooses to encounter ${chosen.card.name}. The other ${rest.length} card(s) are discarded.`],
  };
}

// Draws up to `count` cards from the top of a deck, reshuffling the discard
// pile into a fresh deck if it runs out mid-draw. Shared by any feature that
// consumes the Rot Deck (currently just the Ancient Shrine's peek).
function drawRotCards(
  deck: RotCard[],
  discard: RotCard[],
  count: number,
  rng: () => number,
): { drawn: RotCard[]; deck: RotCard[]; discard: RotCard[]; reshuffled: boolean } {
  let remainingDeck = [...deck];
  let remainingDiscard = [...discard];
  let reshuffled = false;
  const drawn: RotCard[] = [];

  for (let i = 0; i < count; i++) {
    if (remainingDeck.length === 0) {
      if (remainingDiscard.length === 0) break;
      remainingDeck = shuffle(remainingDiscard, rng);
      remainingDiscard = [];
      reshuffled = true;
    }
    drawn.push(remainingDeck.shift()!);
  }

  return { drawn, deck: remainingDeck, discard: remainingDiscard, reshuffled };
}

// Same pattern as drawRotCards, generalized for the shared Artifact/Lore
// decks (Market/Library supply, artifactDiscard/loreDiscard on GameState).
// Baseline rule: every deck reshuffles its discard pile back in when it runs
// out mid-draw — this keeps every shared-deck-consuming effect (Market/
// Library refill, Cleanup Phase Row refresh, Arena Reward, the various
// reveal-from-deck Rune Stones, and Forbidden Knowledge) working as intended
// for the life of the game instead of silently degrading once the deck
// empties.
function drawFromSharedDeck<T>(
  deck: T[],
  discard: T[],
  count: number,
  rng: () => number,
): { drawn: T[]; deck: T[]; discard: T[]; reshuffled: boolean } {
  let remainingDeck = [...deck];
  let remainingDiscard = [...discard];
  let reshuffled = false;
  const drawn: T[] = [];

  for (let i = 0; i < count; i++) {
    if (remainingDeck.length === 0) {
      if (remainingDiscard.length === 0) break;
      remainingDeck = shuffle(remainingDiscard, rng);
      remainingDiscard = [];
      reshuffled = true;
    }
    drawn.push(remainingDeck.shift()!);
  }

  return { drawn, deck: remainingDeck, discard: remainingDiscard, reshuffled };
}

// Ancient Shrine Faction 2: "Reveal the top 3 cards of The Rot deck. You may
// discard any of them, then return the remaining cards to the top of the
// deck in any order." Usable once per visit — resolved via resolveRotPeek.
// Faction 1 is now a one-time Mana grant instead (see applyFactionMilestone),
// mirroring The Artificer's own Faction 1 (Mana)/Faction 2 (deck peek) split.
export function peekRotDeck(state: GameState, rng: () => number = Math.random): GameState {
  const playerId = requirePendingLocation(state, "ancientShrine");
  const player = state.players[playerId];
  const level = player.factionTrack.ancientShrine ?? 0;
  if (level < 2) {
    throw new Error("Faction 2 at The Ancient Shrine is required to peek at The Rot deck.");
  }
  if (state.pendingAction!.usedRotPeek) {
    throw new Error("Already used the Rot deck peek this visit.");
  }
  if (state.pendingReveal) {
    throw new Error("Resolve the revealed Lore card before peeking at The Rot deck.");
  }
  if (state.pendingRotPeek) {
    throw new Error("Already peeking at The Rot deck.");
  }

  const { drawn, deck, discard, reshuffled } = drawRotCards(state.rotDeck, state.rotDiscard, 3, rng);
  const nextState: GameState = {
    ...state,
    rotDeck: deck,
    rotDiscard: discard,
    pendingAction: { ...state.pendingAction!, usedRotPeek: true },
  };

  if (drawn.length === 0) {
    return {
      ...nextState,
      log: [...state.log, "The Rot deck and discard pile are both empty — there's nothing to peek at."],
    };
  }

  return {
    ...nextState,
    pendingRotPeek: drawn,
    log: [
      ...state.log,
      `${player.character.name} reveals the top ${drawn.length} card(s) of The Rot deck.` +
        (reshuffled ? " (The Rot discard pile was shuffled into a new deck first.)" : ""),
    ],
  };
}

// `keepOrder` lists indices into the peeked cards, in the order they should
// return to the top of the deck (first = topmost). Any peeked card whose
// index isn't listed is discarded.
export function resolveRotPeek(state: GameState, keepOrder: number[]): GameState {
  const playerId = requirePendingLocation(state, "ancientShrine");
  if (!state.pendingRotPeek) {
    throw new Error("There is no Rot deck peek to resolve.");
  }
  const peeked = state.pendingRotPeek;
  const uniqueIndices = new Set(keepOrder);
  if (uniqueIndices.size !== keepOrder.length || keepOrder.some((i) => i < 0 || i >= peeked.length)) {
    throw new Error("Invalid selection of Rot cards to keep.");
  }

  const kept = keepOrder.map((i) => peeked[i]);
  const discarded = peeked.filter((_, i) => !uniqueIndices.has(i));
  const player = state.players[playerId];

  const log = [...state.log];
  log.push(
    discarded.length > 0
      ? `${player.character.name} discards ${discarded.map((c) => c.card.name).join(", ")} from the Rot deck peek.`
      : `${player.character.name} keeps all of the peeked Rot cards.`,
  );
  if (kept.length > 0) {
    log.push(`${kept.map((c) => c.card.name).join(", ")} return to the top of The Rot deck.`);
  }

  return {
    ...state,
    rotDeck: [...kept, ...state.rotDeck],
    rotDiscard: [...state.rotDiscard, ...discarded],
    pendingRotPeek: null,
    log,
  };
}

// --- The Valley ----------------------------------------------------------------

// Draws the top card of the Rot Deck for a Valley encounter (or logs that
// there's nothing left, if both the deck and discard are empty). Shared by
// the mandatory reveal in placeActionToken and by skipValleyScry/
// resolveValleyScry, which run this same reveal once the optional Faction 3
// peek is resolved. Cira's power, Foresight ("When revealing a Rot card,
// look at the top 2 Rot cards, choose 1 to encounter, and return the other
// to the top of The Rot deck") replaces the draw with 2 cards and a pending
// choice for her — see chooseForesightEncounter — unless only 1 card is left
// to draw, in which case there's no real choice and it's used directly.
function revealValleyCard(state: GameState, playerId: string, rng: () => number): GameState {
  const player = state.players[playerId];
  const hasForesight = player.character.name === "Cira, the Wizard";
  const { drawn, deck, discard, reshuffled } = drawRotCards(state.rotDeck, state.rotDiscard, hasForesight ? 2 : 1, rng);
  const nextState: GameState = { ...state, rotDeck: deck, rotDiscard: discard };
  const reshuffleNote = reshuffled ? " (The Rot discard pile was shuffled into a new deck first.)" : "";

  if (drawn.length === 0) {
    return {
      ...nextState,
      log: [...nextState.log, "The Rot deck and discard pile are both empty — there's nothing to encounter."],
    };
  }

  if (hasForesight && drawn.length === 2) {
    return {
      ...nextState,
      pendingForesightChoice: [drawn[0], drawn[1]],
      log: [
        ...nextState.log,
        `${player.character.name}'s Foresight reveals the top 2 cards of The Rot deck: ${drawn[0].card.name}, ${drawn[1].card.name}.${reshuffleNote}`,
      ],
    };
  }

  const encounter = drawn[0];
  return {
    ...nextState,
    pendingValleyEncounter: encounter,
    log: [
      ...nextState.log,
      `${player.character.name} reveals ${encounter.card.name} from The Rot deck.${reshuffleNote}`,
    ],
  };
}

// `chosenIndex` picks which of the 2 Foresight cards to encounter — the
// other returns to the top of The Rot deck.
export function chooseForesightEncounter(state: GameState, chosenIndex: 0 | 1): GameState {
  const playerId = requirePendingLocation(state, "valley");
  const choice = state.pendingForesightChoice;
  if (!choice) {
    throw new Error("There is no Foresight choice to resolve.");
  }
  const player = state.players[playerId];
  const encounter = choice[chosenIndex];
  const returned = choice[chosenIndex === 0 ? 1 : 0];

  return {
    ...state,
    rotDeck: [returned, ...state.rotDeck],
    pendingForesightChoice: null,
    pendingValleyEncounter: encounter,
    log: [
      ...state.log,
      `${player.character.name} chooses to encounter ${encounter.card.name}, returning ${returned.card.name} to the top of The Rot deck.`,
    ],
  };
}

// If the reveal came up empty, ends the turn immediately (nothing to
// resolve); otherwise leaves pendingValleyEncounter or pendingForesightChoice
// set for the player to act on next.
function finishValleyReveal(state: GameState, playerId: string, rng: () => number): GameState {
  const revealed = revealValleyCard(state, playerId, rng);
  return revealed.pendingValleyEncounter || revealed.pendingForesightChoice ? revealed : completeTurn(revealed);
}

// Valley Faction 3: "Whenever you place an Action token on The Valley, you
// may reveal the top card of The Rot deck." Draws it into pendingValleyScry
// without discarding or keeping it yet — resolveValleyScry makes that call.
export function peekValleyRotCard(state: GameState, rng: () => number = Math.random): GameState {
  const playerId = requirePendingLocation(state, "valley");
  if (!state.pendingValleyScry || state.pendingValleyScry.stage !== "offered") {
    throw new Error("There is no Rot deck peek available right now.");
  }
  const player = state.players[playerId];
  // The "offered" pause is also reached by holding Rune of Premonition (see
  // placeActionToken) without Faction 3 — this peek stays Faction-3-only.
  if ((player.factionTrack.valley ?? 0) < 3) {
    throw new Error("Faction 3 at The Valley is required to peek at The Rot deck.");
  }
  const { drawn, deck, discard, reshuffled } = drawRotCards(state.rotDeck, state.rotDiscard, 1, rng);

  if (drawn.length === 0) {
    return finishValleyReveal(
      {
        ...state,
        rotDeck: deck,
        rotDiscard: discard,
        pendingValleyScry: null,
        log: [...state.log, "The Rot deck and discard pile are both empty — there's nothing to peek at."],
      },
      playerId,
      rng,
    );
  }

  const card = drawn[0];
  return {
    ...state,
    rotDeck: deck,
    rotDiscard: discard,
    pendingValleyScry: { stage: "peeked", card },
    log: [
      ...state.log,
      `${player.character.name} peeks at the top of The Rot deck: ${card.card.name}.` +
        (reshuffled ? " (The Rot discard pile was shuffled into a new deck first.)" : ""),
    ],
  };
}

// "You may then choose to place it back on top of The Rot deck or discard
// it." Either way, the normal mandatory reveal follows immediately — drawing
// the peeked card again if it was kept, or the next one down if discarded.
export function resolveValleyScry(
  state: GameState,
  choice: "keep" | "discard",
  rng: () => number = Math.random,
): GameState {
  const playerId = requirePendingLocation(state, "valley");
  if (!state.pendingValleyScry || state.pendingValleyScry.stage !== "peeked") {
    throw new Error("There is no peeked Rot card to resolve.");
  }
  const { card } = state.pendingValleyScry;
  const player = state.players[playerId];

  const nextState: GameState =
    choice === "keep"
      ? {
          ...state,
          rotDeck: [card, ...state.rotDeck],
          pendingValleyScry: null,
          log: [...state.log, `${player.character.name} returns ${card.card.name} to the top of The Rot deck.`],
        }
      : {
          ...state,
          rotDiscard: [...state.rotDiscard, card],
          pendingValleyScry: null,
          log: [...state.log, `${player.character.name} discards ${card.card.name} from The Rot deck.`],
        };

  return finishValleyReveal(nextState, playerId, rng);
}

// The player may decline the Faction 3 peek entirely.
export function skipValleyScry(state: GameState, rng: () => number = Math.random): GameState {
  const playerId = requirePendingLocation(state, "valley");
  if (!state.pendingValleyScry || state.pendingValleyScry.stage !== "offered") {
    throw new Error("There is no Rot deck peek available right now.");
  }
  const player = state.players[playerId];
  const nextState: GameState = {
    ...state,
    pendingValleyScry: null,
    log: [...state.log, `${player.character.name} does not peek at The Rot deck.`],
  };
  return finishValleyReveal(nextState, playerId, rng);
}

// The 4 Scenario Embrace effects that need Row/deck interaction beyond the
// shared regex resolver below. Named so both detectRotEffectChoice and
// finalizeValleyOutcome can match on them exactly. Tainted Fortune ("Gain 3
// Gold.") and Underground Wellspring ("Gain 3 Mana, distributed...") aren't
// among them — they match the same patterns Combat cards use.
const CORRUPTED_GREED_TEXT =
  "Place 1 Artifact card from the Artifact Row in your Artifact Discard Pile and refill the empty position. Then place the highest-Gold-Cost Artifact from the Artifact Row on The Rot and refill the empty position.";
const FORBIDDEN_KNOWLEDGE_TEXT =
  "Reveal the top 3 Lore cards. Place 1 in your Lore Discard Pile and discard the others.";
const TAINTED_TRADE_TEXT =
  "Exchange 1 Artifact card from your Artifact Deck or Artifact Discard Pile with 1 Artifact card from the Artifact Row.";
const WHISPERED_SECRETS_TEXT = "Look at the top 5 cards of any deck and place them back in any order.";

// Recognizes the handful of choice-requiring effect-text shapes that appear
// on Rot cards, so the UI can render the right picker before calling
// finalizeValleyOutcome (or, for the 2 reveal-first effects, the dedicated
// reveal functions below). Exported so the UI doesn't have to duplicate the
// regexes.
export function detectRotEffectChoice(
  text: string,
):
  | { kind: "pool" }
  | { kind: "manaSplit"; total: number }
  | { kind: "corruptedGreed" }
  | { kind: "forbiddenKnowledge" }
  | { kind: "taintedTrade" }
  | { kind: "whisperedSecrets" }
  | null {
  if (text === CORRUPTED_GREED_TEXT) return { kind: "corruptedGreed" };
  if (text === FORBIDDEN_KNOWLEDGE_TEXT) return { kind: "forbiddenKnowledge" };
  if (text === TAINTED_TRADE_TEXT) return { kind: "taintedTrade" };
  if (text === WHISPERED_SECRETS_TEXT) return { kind: "whisperedSecrets" };
  if (/\beither Mana Pool\b/.test(text)) return { kind: "pool" };
  const dist = text.match(/^Gain (\d+) Mana, distributed between your Mana Pools as (?:desired|you choose)\.$/);
  if (dist) return { kind: "manaSplit", total: Number(dist[1]) };
  return null;
}

// "Equip The Rot with the highest-Gold-Cost Artifact from the Artifact Row."
// The Valley Board has 7 Artifact slots; a full board or an empty Row is a
// no-op.
function equipRotWithHighestGoldArtifact(state: GameState, rng: () => number = Math.random): GameState {
  let bestGold = -1;
  let bestIndices: number[] = [];
  state.artifactRow.forEach((card, i) => {
    if (!card) return;
    if (card.goldCost > bestGold) {
      bestGold = card.goldCost;
      bestIndices = [i];
    } else if (card.goldCost === bestGold) {
      bestIndices.push(i);
    }
  });

  if (bestIndices.length === 0) {
    return { ...state, log: [...state.log, "The Artifact Row is empty — there's nothing to equip The Rot with."] };
  }
  if (state.rotArtifacts.length >= 7) {
    return { ...state, log: [...state.log, "The Rot already has 7 Artifacts equipped — nothing changes."] };
  }

  // "If multiple Artifact cards are tied for the highest Gold Cost, choose
  // one at random."
  const bestIndex = bestIndices.length === 1 ? bestIndices[0] : bestIndices[Math.floor(rng() * bestIndices.length)];
  const card = state.artifactRow[bestIndex]!;
  const { drawn, deck: artifactDeck, discard: artifactDiscard, reshuffled } = drawFromSharedDeck(state.artifactDeck, state.artifactDiscard, 1, rng);
  const nextCard = drawn[0] ?? null;
  const artifactRow = [...state.artifactRow];
  artifactRow[bestIndex] = nextCard;

  return {
    ...state,
    artifactDeck,
    artifactDiscard,
    artifactRow,
    rotArtifacts: [...state.rotArtifacts, card],
    log: [
      ...state.log,
      `The Rot is equipped with ${card.name} (${card.goldCost} Gold) from the Artifact Row.` +
        (nextCard
          ? ` ${nextCard.name} refills the Row.` + (reshuffled ? " (The Artifact discard pile was shuffled into a new deck first.)" : "")
          : " The Artifact Deck and discard pile are both empty — that Row position stays empty."),
    ],
  };
}

// Applies one Win/Loss/Embrace effect string. Covers every distinct pattern
// in src/data/rotCards.ts's Combat table plus the 2 Scenario Embrace effects
// that don't need Row/deck interaction (see UNIMPLEMENTED_EMBRACE_TEXTS).
// Throws if the text needs a choice (see detectRotEffectChoice) that `opts`
// doesn't supply.
function applyRotEffectText(
  state: GameState,
  playerId: string,
  text: string,
  opts: { pool?: "artifact" | "lore"; manaSplit?: { artifact: number; lore: number } } = {},
  rng: () => number = Math.random,
): GameState {
  const player = state.players[playerId];

  const advanceMatch = text.match(/^Advance The Rot Track by (\d+)\.$/);
  if (advanceMatch) {
    const n = Number(advanceMatch[1]);
    const rotCounter = state.rotCounter + n;
    return { ...state, rotCounter, log: [...state.log, `The Rot Track advances by ${n} (Rot Counter now ${rotCounter}).`] };
  }

  if (text === "Equip The Rot with the highest-Gold-Cost Artifact from the Artifact Row.") {
    return equipRotWithHighestGoldArtifact(state, rng);
  }

  const goldAndLoreMatch = text.match(/^Gain (\d+) Gold and (\d+) Lore Mana\.$/);
  if (goldAndLoreMatch) {
    const g = Number(goldAndLoreMatch[1]);
    const lm = Number(goldAndLoreMatch[2]);
    const updatedPlayer: EnginePlayer = {
      ...player,
      gold: player.gold + g,
      manaPools: { ...player.manaPools, lore: player.manaPools.lore + lm },
    };
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      log: [...state.log, `${player.character.name} gains ${g} Gold and ${lm} Lore Mana.`],
    };
  }

  const goldMatch = text.match(/^Gain (\d+) Gold\.$/);
  if (goldMatch) {
    const n = Number(goldMatch[1]);
    const updatedPlayer: EnginePlayer = { ...player, gold: player.gold + n };
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      log: [...state.log, `${player.character.name} gains ${n} Gold.`],
    };
  }

  const artifactManaMatch = text.match(/^Gain (\d+) Artifact Mana\.$/);
  if (artifactManaMatch) {
    const n = Number(artifactManaMatch[1]);
    const updatedPlayer: EnginePlayer = {
      ...player,
      manaPools: { ...player.manaPools, artifact: player.manaPools.artifact + n },
    };
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      log: [...state.log, `${player.character.name} gains ${n} Artifact Mana.`],
    };
  }

  const loreManaMatch = text.match(/^Gain (\d+) Lore Mana\.$/);
  if (loreManaMatch) {
    const n = Number(loreManaMatch[1]);
    const updatedPlayer: EnginePlayer = {
      ...player,
      manaPools: { ...player.manaPools, lore: player.manaPools.lore + n },
    };
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      log: [...state.log, `${player.character.name} gains ${n} Lore Mana.`],
    };
  }

  const distMatch = text.match(/^Gain (\d+) Mana, distributed between your Mana Pools as (?:desired|you choose)\.$/);
  if (distMatch) {
    const total = Number(distMatch[1]);
    if (!opts.manaSplit) {
      throw new Error(`Choose how to distribute ${total} Mana between your two pools.`);
    }
    const { artifact, lore } = opts.manaSplit;
    if (artifact < 0 || lore < 0 || artifact + lore !== total) {
      throw new Error(`Distribute exactly ${total} Mana between your two pools.`);
    }
    const updatedPlayer: EnginePlayer = {
      ...player,
      manaPools: { artifact: player.manaPools.artifact + artifact, lore: player.manaPools.lore + lore },
    };
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      log: [...state.log, `${player.character.name} gains ${total} Mana (${artifact} Artifact / ${lore} Lore).`],
    };
  }

  const removeEitherMatch = text.match(/^Remove (\d+) Withering Tokens? from either Mana Pool\.$/);
  if (removeEitherMatch) {
    const n = Number(removeEitherMatch[1]);
    if (!opts.pool) throw new Error("Choose which Mana Pool to remove a Withering Token from.");
    const current = player.witheringTokens[opts.pool];
    const removed = Math.min(current, n);
    const updatedPlayer: EnginePlayer = {
      ...player,
      witheringTokens: { ...player.witheringTokens, [opts.pool]: current - removed },
    };
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      log: [
        ...state.log,
        `${player.character.name} removes ${removed} Withering Token(s) from their ${opts.pool === "artifact" ? "Artifact" : "Lore"} pool.`,
      ],
    };
  }

  const placeEitherMatch = text.match(/^Place (\d+) Withering Tokens? in either Mana Pool\.$/);
  if (placeEitherMatch) {
    const n = Number(placeEitherMatch[1]);
    if (!opts.pool) throw new Error("Choose which Mana Pool to place a Withering Token in.");
    const updatedPlayer: EnginePlayer = {
      ...player,
      witheringTokens: { ...player.witheringTokens, [opts.pool]: player.witheringTokens[opts.pool] + n },
    };
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      log: [
        ...state.log,
        `${player.character.name} places ${n} Withering Token(s) in their ${opts.pool === "artifact" ? "Artifact" : "Lore"} pool.`,
      ],
    };
  }

  const placeFixedMatch = text.match(/^Place (\d+) Withering Tokens? in your (Artifact|Lore) Attunement Pool\.$/);
  if (placeFixedMatch) {
    const n = Number(placeFixedMatch[1]);
    const pool = placeFixedMatch[2] === "Artifact" ? "artifact" : "lore";
    const updatedPlayer: EnginePlayer = {
      ...player,
      witheringTokens: { ...player.witheringTokens, [pool]: player.witheringTokens[pool] + n },
    };
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      log: [...state.log, `${player.character.name} places ${n} Withering Token(s) in their ${placeFixedMatch[2]} pool.`],
    };
  }

  const placeEachMatch = text.match(/^Place (\d+) Withering Tokens? in each(?: of your)? Mana Pools?\.$/);
  if (placeEachMatch) {
    const n = Number(placeEachMatch[1]);
    const updatedPlayer: EnginePlayer = {
      ...player,
      witheringTokens: { artifact: player.witheringTokens.artifact + n, lore: player.witheringTokens.lore + n },
    };
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      log: [...state.log, `${player.character.name} places ${n} Withering Token(s) in each Mana Pool.`],
    };
  }

  const opponentMatch = text.match(
    /^Each opponent places (\d+) Withering Tokens? in their (Artifact|Lore) Attunement Pool\.$/,
  );
  if (opponentMatch) {
    const n = Number(opponentMatch[1]);
    const pool = opponentMatch[2] === "Artifact" ? "artifact" : "lore";
    const players = { ...state.players };
    for (const id of state.playerOrder) {
      if (id === playerId) continue;
      const opponent = players[id];
      players[id] = { ...opponent, witheringTokens: { ...opponent.witheringTokens, [pool]: opponent.witheringTokens[pool] + n } };
    }
    return {
      ...state,
      players,
      log: [...state.log, `Each opponent places ${n} Withering Token(s) in their ${opponentMatch[2]} pool.`],
    };
  }

  // Shouldn't happen given the enumerated vocabulary above, but fail safe
  // rather than silently do nothing.
  return { ...state, log: [...state.log, `(No effect applied — "${text}" isn't a recognized Rot effect.)`] };
}

// Rulebook: "Choose one of your attuned Lore cards and place it in your Lore
// discard pile to initiate the attack... If you do not have a Lore card
// attuned, trigger the Loss condition." Pass `loreIndex: null` for the
// no-Lore-attuned case. Rolls immediately and determines Win/Loss, but
// doesn't apply the effect yet — call finalizeValleyOutcome for that (a
// choice may still be needed, e.g. which Mana Pool).
// `preserveWithRuneStoneIndex` is Rune of Preservation's "when using an
// Attuned Lore card, you may discard this Rune Stone instead of discarding
// the Lore card" — the Lore card still contributes its value to the attack
// and stays Attuned; the Rune Stone is discarded in its place.
// `prophecyIndex` is Rune of Prophecy's "Discard to add +20 to your Attack
// against a Rot encounter in The Valley. Remove this card from the game" —
// unlike every other Rune Stone discard, it's removed outright rather than
// going to the Artifact discard pile (so Rune of Renewal/Recall/Salvage/
// Echoes can never bring it back).
export function chooseValleyLore(
  state: GameState,
  loreIndex: number | null,
  rng: () => number = Math.random,
  preserveWithRuneStoneIndex?: number,
  prophecyIndex?: number,
  useWieldTheRot?: boolean,
): GameState {
  const playerId = requirePendingLocation(state, "valley");
  if (!state.pendingValleyEncounter || state.pendingValleyEncounter.kind !== "combat") {
    throw new Error("There is no Rot Combat card to fight.");
  }
  if (state.pendingValleyOutcome) {
    throw new Error("Resolve the current outcome before fighting again.");
  }
  const encounter = state.pendingValleyEncounter;
  const combatCard = encounter.card;
  const player = state.players[playerId];

  if (loreIndex === null) {
    if (player.attunedLore.length > 0) {
      throw new Error("Choose one of your Attuned Lore cards to fight with.");
    }
    return {
      ...state,
      pendingValleyEncounter: null,
      pendingValleyOutcome: { card: encounter, outcome: "loss", effectText: combatCard.loss, dice: null, loreCardName: null },
      log: [...state.log, `${player.character.name} has no Lore Attuned — the Loss condition triggers automatically.`],
    };
  }

  const loreCard = player.attunedLore[loreIndex];
  if (!loreCard) {
    throw new Error("Invalid Lore card selection.");
  }

  let attunedLore = player.attunedLore;
  let loreDiscard = player.loreDiscard;
  let equippedRuneStones = player.equippedRuneStones;
  let artifactDiscard = player.artifactDiscard;
  let witheringTokens = state.witheringTokens;
  let preservedNote = ", discarding it";
  if (preserveWithRuneStoneIndex !== undefined) {
    const stone = player.equippedRuneStones[preserveWithRuneStoneIndex];
    if (!stone || stone.name !== "Rune of Preservation") {
      throw new Error(`${player.character.name} doesn't have Rune of Preservation Attuned in that position.`);
    }
    equippedRuneStones = player.equippedRuneStones.filter((_, i) => i !== preserveWithRuneStoneIndex);
    artifactDiscard = [...player.artifactDiscard, stone];
    const removed = Math.min(2, witheringTokens);
    witheringTokens -= removed;
    preservedNote =
      `, discarding Rune of Preservation instead of ${loreCard.name}` +
      (removed > 0 ? ` and removing ${removed} Withering Token(s) from The Rot` : "");
  } else {
    attunedLore = player.attunedLore.filter((_, i) => i !== loreIndex);
    loreDiscard = [...player.loreDiscard, loreCard];
  }

  const loreAttackField: "vsAberration" | "vsConstruct" | "vsUndead" =
    combatCard.creatureType === "Aberration"
      ? "vsAberration"
      : combatCard.creatureType === "Construct"
        ? "vsConstruct"
        : "vsUndead";
  const loreAttack = loreCard[loreAttackField];

  const artifactAttack = equippedArtifactAttackTotal(player);

  let prophecyBonus = 0;
  let prophecyNote = "";
  if (prophecyIndex !== undefined) {
    if (prophecyIndex === preserveWithRuneStoneIndex) {
      throw new Error(`${player.character.name} can't use the same Rune Stone position for two effects.`);
    }
    const stone = player.equippedRuneStones[prophecyIndex];
    if (!stone || stone.name !== "Rune of Prophecy") {
      throw new Error(`${player.character.name} doesn't have Rune of Prophecy Attuned in that position.`);
    }
    // "Remove this card from the game" — filtered by reference, not index, so
    // this is safe to combine with the Preservation branch above regardless
    // of which index is smaller.
    equippedRuneStones = equippedRuneStones.filter((r) => r !== stone);
    prophecyBonus = 20;
    const removed = Math.min(3, witheringTokens);
    witheringTokens -= removed;
    prophecyNote =
      ", removing Rune of Prophecy from the game for +20 Attack" +
      (removed > 0 ? ` and removing ${removed} Withering Token(s) from The Rot` : "");
  }

  const wield = resolveWieldTheRot(player, witheringTokens, useWieldTheRot);
  witheringTokens = wield.witheringTokens;
  const powerBonus = wield.bonus;
  const wieldNote = wield.note;

  const dice = rollAttackDice(player.character, rng);
  const updatedPlayer: EnginePlayer = { ...player, attunedLore, loreDiscard, equippedRuneStones, artifactDiscard };

  // Rune of Fracture: "Discard after rolling your Attack dice to reroll 1
  // die." Only pause for a combatant who actually holds the stone —
  // everyone else resolves in this one call, as before.
  if (updatedPlayer.equippedRuneStones.some((r) => r.name === "Rune of Fracture")) {
    return {
      ...state,
      witheringTokens,
      players: { ...state.players, [playerId]: updatedPlayer },
      pendingValleyAttackRoll: { loreCardName: loreCard.name, loreAttack, artifactAttack, powerBonus, prophecyBonus, dice, rerolled: false },
      log: [
        ...state.log,
        `${player.character.name} initiates the attack with ${loreCard.name}${preservedNote}${prophecyNote}${wieldNote}.`,
        `Attack dice: ${dice[0]} + ${dice[1]}. Rune of Fracture may reroll one die before resolving.`,
      ],
    };
  }

  const playerAttack = dice[0] + dice[1] + loreAttack + artifactAttack + powerBonus + prophecyBonus;
  const rotArtifactAttack = state.rotArtifacts.reduce((sum, c) => sum + c.attack, 0);
  const rotAttack = combatCard.attack + rotArtifactAttack;
  const won = playerAttack >= rotAttack;

  return {
    ...state,
    witheringTokens,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingValleyEncounter: null,
    pendingValleyOutcome: {
      card: encounter,
      outcome: won ? "win" : "loss",
      effectText: won ? combatCard.win : combatCard.loss,
      dice,
      loreCardName: loreCard.name,
    },
    log: [
      ...state.log,
      `${player.character.name} initiates the attack with ${loreCard.name}${preservedNote}${prophecyNote}${wieldNote}.`,
      `Attack: 2d6 (${dice[0]}+${dice[1]}) + ${loreAttack} Lore + ${artifactAttack} Artifact` +
        (powerBonus > 0 ? ` + ${powerBonus} Wield the Rot` : "") +
        (prophecyBonus > 0 ? ` + ${prophecyBonus} Rune of Prophecy` : "") +
        ` = ${playerAttack}. ` +
        `The Rot's Attack: ${combatCard.attack} + ${rotArtifactAttack} from its Artifacts = ${rotAttack}.`,
      won ? `${player.character.name} wins the combat!` : `${player.character.name} loses the combat.`,
    ],
  };
}

// Resolves a paused Valley Attack roll (see chooseValleyLore's Rune of
// Fracture branch): optionally discard Fracture to reroll one die, then
// compute the win/loss outcome exactly as chooseValleyLore would have.
export function resolveValleyAttackRoll(
  state: GameState,
  fractureIndex?: number,
  rerollDieIndex?: 0 | 1,
  rng: () => number = Math.random,
): GameState {
  const playerId = requirePendingLocation(state, "valley");
  const pending = state.pendingValleyAttackRoll;
  if (!pending) throw new Error("There is no Attack roll to resolve.");
  if (!state.pendingValleyEncounter || state.pendingValleyEncounter.kind !== "combat") {
    throw new Error("There is no Rot Combat card to fight.");
  }
  const combatCard = state.pendingValleyEncounter.card;
  const player = state.players[playerId];

  let dice = pending.dice;
  let updatedPlayer = player;
  let rerollNote = "";
  if (fractureIndex !== undefined) {
    const stone = player.equippedRuneStones[fractureIndex];
    if (!stone || stone.name !== "Rune of Fracture") {
      throw new Error(`${player.character.name} doesn't have Rune of Fracture Attuned in that position.`);
    }
    if (rerollDieIndex === undefined) throw new Error("Choose which die to reroll.");
    const { updatedPlayer: withoutStone } = discardRuneStoneFromPlayer(player, fractureIndex);
    updatedPlayer = withoutStone;
    const newDie = rollD6(rng);
    dice = rerollDieIndex === 0 ? [newDie, dice[1]] : [dice[0], newDie];
    rerollNote = ` (Rune of Fracture rerolls die ${rerollDieIndex + 1}: now ${dice[0]} + ${dice[1]})`;
  }

  const playerAttack = dice[0] + dice[1] + pending.loreAttack + pending.artifactAttack + pending.powerBonus + pending.prophecyBonus;
  const rotArtifactAttack = state.rotArtifacts.reduce((sum, c) => sum + c.attack, 0);
  const rotAttack = combatCard.attack + rotArtifactAttack;
  const won = playerAttack >= rotAttack;

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingValleyEncounter: null,
    pendingValleyAttackRoll: null,
    pendingValleyOutcome: {
      card: state.pendingValleyEncounter,
      outcome: won ? "win" : "loss",
      effectText: won ? combatCard.win : combatCard.loss,
      dice,
      loreCardName: pending.loreCardName,
    },
    log: [
      ...state.log,
      `Attack: 2d6 (${dice[0]}+${dice[1]}) + ${pending.loreAttack} Lore + ${pending.artifactAttack} Artifact` +
        (pending.powerBonus > 0 ? ` + ${pending.powerBonus} Wield the Rot` : "") +
        (pending.prophecyBonus > 0 ? ` + ${pending.prophecyBonus} Rune of Prophecy` : "") +
        ` = ${playerAttack}${rerollNote}. ` +
        `The Rot's Attack: ${combatCard.attack} + ${rotArtifactAttack} from its Artifacts = ${rotAttack}.`,
      won ? `${player.character.name} wins the combat!` : `${player.character.name} loses the combat.`,
    ],
  };
}

// Rulebook: "Choose to Embrace The Rot or Resist The Rot." Determines the
// outcome; call finalizeValleyOutcome to actually apply it.
export function chooseValleyScenario(state: GameState, choice: "embrace" | "resist"): GameState {
  const playerId = requirePendingLocation(state, "valley");
  if (!state.pendingValleyEncounter || state.pendingValleyEncounter.kind !== "scenario") {
    throw new Error("There is no Rot Scenario card to resolve.");
  }
  if (state.pendingValleyOutcome) {
    throw new Error("Resolve the current outcome before choosing again.");
  }
  const encounter = state.pendingValleyEncounter;
  const player = state.players[playerId];

  if (choice === "resist") {
    return {
      ...state,
      pendingValleyEncounter: null,
      pendingValleyOutcome: { card: encounter, outcome: "resist", effectText: null, dice: null, loreCardName: null },
      log: [...state.log, `${player.character.name} Resists The Rot.`],
    };
  }

  return {
    ...state,
    pendingValleyEncounter: null,
    pendingValleyOutcome: {
      card: encounter,
      outcome: "embrace",
      effectText: encounter.card.embrace,
      dice: null,
      loreCardName: null,
    },
    log: [...state.log, `${player.character.name} Embraces The Rot.`],
  };
}

// Shared ending for a "win" or "loss"/"embrace" resolution once its effect
// (if any) has been applied: places the Rot card in the player's area and,
// for Embrace, adds 2 Withering Tokens to the shared board — the Rot
// Counter itself only moves at Cleanup Phase (see applyRotCleanupSteps),
// converting complete Withering-Token sets, so Embrace's clock pressure is
// now indirect and diluted by player count rather than a guaranteed
// immediate +1. Does not call completeTurn — some callers (the 2
// reveal-first Embrace effects) still need pendingEmbraceStep cleared
// alongside it.
function finishValleyResolution(state: GameState, playerId: string, resolution: PendingValleyOutcome): GameState {
  const player = state.players[playerId];
  const updatedPlayer: EnginePlayer = {
    ...player,
    rotCardsInPlayerArea: [...player.rotCardsInPlayerArea, resolution.card],
  };
  const witheringTokens = resolution.outcome === "embrace" ? state.witheringTokens + 2 : state.witheringTokens;
  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    witheringTokens,
    pendingValleyOutcome: null,
    log: [
      ...state.log,
      `${resolution.card.card.name} is placed in ${player.character.name}'s player area.` +
        (resolution.outcome === "embrace" ? ` 2 Withering Tokens are added to The Rot (now ${witheringTokens}).` : ""),
    ],
  };
}

// Corrupted Greed: "Place 1 Artifact card from the Artifact Row in your
// Artifact Discard Pile and refill the empty position. Then place the
// highest-Gold-Cost Artifact from the Artifact Row on The Rot and refill the
// empty position." The first part is the player's choice; the second reuses
// the same "highest-Gold-Cost" logic as the Combat Loss effect.
function resolveCorruptedGreed(
  state: GameState,
  playerId: string,
  resolution: PendingValleyOutcome,
  rowIndex: number | undefined,
  rng: () => number = Math.random,
): GameState {
  if (rowIndex === undefined) {
    throw new Error("Choose an Artifact Row card to discard for Corrupted Greed.");
  }
  const chosen = state.artifactRow[rowIndex];
  if (!chosen) {
    throw new Error("There is no card in that Artifact Row position.");
  }

  const player = state.players[playerId];
  const { drawn, deck: artifactDeck, discard: artifactDiscard, reshuffled } = drawFromSharedDeck(state.artifactDeck, state.artifactDiscard, 1, rng);
  const nextCard = drawn[0] ?? null;
  const artifactRow = [...state.artifactRow];
  artifactRow[rowIndex] = nextCard;

  const updatedPlayer: EnginePlayer = { ...player, artifactDiscard: [...player.artifactDiscard, chosen] };

  let nextState: GameState = {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    artifactDeck,
    artifactDiscard,
    artifactRow,
    log: [
      ...state.log,
      `${player.character.name} discards ${chosen.name} from the Artifact Row for Corrupted Greed.` +
        (nextCard
          ? ` ${nextCard.name} refills the Row.` + (reshuffled ? " (The Artifact discard pile was shuffled into a new deck first.)" : "")
          : " The Artifact Deck and discard pile are both empty — that Row position stays empty."),
    ],
  };

  nextState = equipRotWithHighestGoldArtifact(nextState, rng);
  return finishValleyResolution(nextState, playerId, resolution);
}

// Tainted Trade: "Exchange 1 Artifact card from your Artifact Deck or
// Artifact Discard Pile with 1 Artifact card from the Artifact Row." Both the
// offered card and the Row target are the player's choice; the Row's
// outgoing card goes to the player's discard (mirroring how a purchase
// works).
function resolveTaintedTrade(
  state: GameState,
  playerId: string,
  resolution: PendingValleyOutcome,
  tradeSource: { from: "deck" | "discard"; index: number } | undefined,
  tradeRowIndex: number | undefined,
): GameState {
  if (!tradeSource || tradeRowIndex === undefined) {
    throw new Error("Choose a card to trade in and an Artifact Row position to trade for.");
  }
  const player = state.players[playerId];
  const source = tradeSource.from === "deck" ? player.artifactDeck : player.artifactDiscard;
  const offeredCard = source[tradeSource.index];
  if (!offeredCard) {
    throw new Error("Invalid card selection.");
  }
  const rowCard = state.artifactRow[tradeRowIndex];
  if (!rowCard) {
    throw new Error("There is no card in that Artifact Row position.");
  }

  const updatedPlayer: EnginePlayer = {
    ...player,
    artifactDeck:
      tradeSource.from === "deck" ? player.artifactDeck.filter((_, i) => i !== tradeSource.index) : player.artifactDeck,
    artifactDiscard: [
      ...(tradeSource.from === "discard" ? player.artifactDiscard.filter((_, i) => i !== tradeSource.index) : player.artifactDiscard),
      rowCard,
    ],
  };

  const artifactRow = [...state.artifactRow];
  artifactRow[tradeRowIndex] = offeredCard;

  const nextState: GameState = {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    artifactRow,
    log: [...state.log, `${player.character.name} trades ${offeredCard.name} for ${rowCard.name} from the Artifact Row.`],
  };

  return finishValleyResolution(nextState, playerId, resolution);
}

// Forbidden Knowledge: "Reveal the top 3 Lore cards. Place 1 in your Lore
// Discard Pile and discard the others." Reveals from the shared Library
// supply, reshuffling the shared Lore discard pile in first if it runs
// short — same as every other shared-deck draw.
export function revealForbiddenKnowledge(state: GameState, rng: () => number = Math.random): GameState {
  const playerId = requirePendingLocation(state, "valley");
  const resolution = state.pendingValleyOutcome;
  if (!resolution || resolution.effectText !== FORBIDDEN_KNOWLEDGE_TEXT) {
    throw new Error("Forbidden Knowledge is not the pending Embrace effect.");
  }
  if (state.pendingEmbraceStep) {
    throw new Error("Already revealing cards for this effect.");
  }

  const { drawn: revealed, deck: loreDeck, discard: loreDiscard, reshuffled } = drawFromSharedDeck(
    state.loreDeck,
    state.loreDiscard,
    3,
    rng,
  );
  const player = state.players[playerId];

  return {
    ...state,
    loreDeck,
    loreDiscard,
    pendingEmbraceStep: { kind: "forbiddenKnowledge", revealed },
    log: [
      ...state.log,
      `${player.character.name} reveals ${revealed.length} card(s) from the top of the Lore Deck.` +
        (reshuffled ? " (The Lore discard pile was shuffled into a new deck first.)" : ""),
    ],
  };
}

export function chooseForbiddenKnowledge(state: GameState, keepIndex: number): GameState {
  const playerId = requirePendingLocation(state, "valley");
  const resolution = state.pendingValleyOutcome;
  const step = state.pendingEmbraceStep;
  if (!resolution || !step || step.kind !== "forbiddenKnowledge") {
    throw new Error("There is no Forbidden Knowledge reveal to resolve.");
  }
  const kept = step.revealed[keepIndex];
  if (!kept) {
    throw new Error("Invalid card selection.");
  }

  const player = state.players[playerId];
  const discarded = step.revealed.filter((_, i) => i !== keepIndex);
  const discardedNames = discarded.map((c) => c.name);
  const updatedPlayer: EnginePlayer = { ...player, loreDiscard: [...player.loreDiscard, kept] };

  const nextState: GameState = {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    // The 2 unchosen reveals go to the shared Lore discard pile, not
    // player's personal one — they never left the shared Library supply.
    loreDiscard: [...state.loreDiscard, ...discarded],
    pendingEmbraceStep: null,
    log: [
      ...state.log,
      `${player.character.name} keeps ${kept.name} in their Lore discard pile.` +
        (discardedNames.length > 0 ? ` ${discardedNames.join(", ")} ${discardedNames.length > 1 ? "are" : "is"} discarded.` : ""),
    ],
  };

  return completeTurn(finishValleyResolution(nextState, playerId, resolution));
}

function whisperedDeckLabel(deck: WhisperedDeckChoice): string {
  switch (deck) {
    case "ownArtifact":
      return "their own Artifact Deck";
    case "ownLore":
      return "their own Lore Deck";
    case "sharedArtifact":
      return "the shared Artifact Deck";
    case "sharedLore":
      return "the shared Lore Deck";
  }
}

// Whispered Secrets: "Look at the top 5 cards of any deck and place them back
// in any order." The player picks which of the 4 decks to look at; personal
// decks reshuffle their discard pile in if they run short, matching
// revealArtifactCard/revealLoreCard's behavior at The Artificer/Ancient
// Shrine. The shared decks don't need that here — every card looked at gets
// placed straight back, so there's nothing to lose and no reason to draw
// beyond what's actually on top.
export function chooseWhisperedSecretsDeck(
  state: GameState,
  deckChoice: WhisperedDeckChoice,
  rng: () => number = Math.random,
): GameState {
  const playerId = requirePendingLocation(state, "valley");
  const resolution = state.pendingValleyOutcome;
  if (!resolution || resolution.effectText !== WHISPERED_SECRETS_TEXT) {
    throw new Error("Whispered Secrets is not the pending Embrace effect.");
  }
  if (state.pendingEmbraceStep) {
    throw new Error("Already revealing cards for this effect.");
  }

  const player = state.players[playerId];
  const log = [...state.log];
  let nextState: GameState = state;
  let revealed: (ArtifactCard | LoreCard)[];

  if (deckChoice === "ownArtifact") {
    let deck = [...player.artifactDeck];
    let discard = player.artifactDiscard;
    if (deck.length < 5 && discard.length > 0) {
      deck = [...deck, ...shuffle(discard, rng)];
      discard = [];
      log.push(`${player.character.name} shuffles their Artifact discard pile into their deck.`);
    }
    revealed = deck.slice(0, 5);
    const updatedPlayer: EnginePlayer = { ...player, artifactDeck: deck.slice(5), artifactDiscard: discard };
    nextState = { ...state, players: { ...state.players, [playerId]: updatedPlayer } };
  } else if (deckChoice === "ownLore") {
    let deck = [...player.loreDeck];
    let discard = player.loreDiscard;
    if (deck.length < 5 && discard.length > 0) {
      deck = [...deck, ...shuffle(discard, rng)];
      discard = [];
      log.push(`${player.character.name} shuffles their Lore discard pile into their deck.`);
    }
    revealed = deck.slice(0, 5);
    const updatedPlayer: EnginePlayer = { ...player, loreDeck: deck.slice(5), loreDiscard: discard };
    nextState = { ...state, players: { ...state.players, [playerId]: updatedPlayer } };
  } else if (deckChoice === "sharedArtifact") {
    revealed = state.artifactDeck.slice(0, 5);
    nextState = { ...state, artifactDeck: state.artifactDeck.slice(5) };
  } else {
    revealed = state.loreDeck.slice(0, 5);
    nextState = { ...state, loreDeck: state.loreDeck.slice(5) };
  }

  log.push(`${player.character.name} looks at the top ${revealed.length} card(s) of ${whisperedDeckLabel(deckChoice)}.`);

  return { ...nextState, pendingEmbraceStep: { kind: "whisperedSecrets", deck: deckChoice, revealed }, log };
}

export function resolveWhisperedSecrets(state: GameState, order: number[]): GameState {
  const playerId = requirePendingLocation(state, "valley");
  const resolution = state.pendingValleyOutcome;
  const step = state.pendingEmbraceStep;
  if (!resolution || !step || step.kind !== "whisperedSecrets") {
    throw new Error("There is no Whispered Secrets reveal to resolve.");
  }
  const { revealed, deck } = step;
  const unique = new Set(order);
  if (unique.size !== revealed.length || order.length !== revealed.length || order.some((i) => i < 0 || i >= revealed.length)) {
    throw new Error("Order must include every revealed card exactly once.");
  }
  const ordered = order.map((i) => revealed[i]);

  const player = state.players[playerId];
  let nextState: GameState;
  if (deck === "ownArtifact") {
    const updatedPlayer: EnginePlayer = { ...player, artifactDeck: [...(ordered as ArtifactCard[]), ...player.artifactDeck] };
    nextState = { ...state, players: { ...state.players, [playerId]: updatedPlayer } };
  } else if (deck === "ownLore") {
    const updatedPlayer: EnginePlayer = { ...player, loreDeck: [...(ordered as LoreCard[]), ...player.loreDeck] };
    nextState = { ...state, players: { ...state.players, [playerId]: updatedPlayer } };
  } else if (deck === "sharedArtifact") {
    nextState = { ...state, artifactDeck: [...(ordered as ArtifactCard[]), ...state.artifactDeck] };
  } else {
    nextState = { ...state, loreDeck: [...(ordered as LoreCard[]), ...state.loreDeck] };
  }

  nextState = {
    ...nextState,
    pendingEmbraceStep: null,
    log: [...nextState.log, `${player.character.name} returns the cards to the top of ${whisperedDeckLabel(deck)} in the chosen order.`],
  };

  return completeTurn(finishValleyResolution(nextState, playerId, resolution));
}

// Applies the outcome from chooseValleyLore/chooseValleyScenario: resolves
// the effect text (throwing if `choice` is still missing a required Mana
// Pool/split, or if the effect is Corrupted Greed/Tainted Trade and their
// choices are missing — see detectRotEffectChoice), places the Rot card in
// the player's area (win/embrace) or the shared discard (loss/resist), and
// ends the turn. Forbidden Knowledge and Whispered Secrets aren't handled
// here — they reveal hidden cards first, so use their dedicated functions
// above instead.
export function finalizeValleyOutcome(
  state: GameState,
  choice: {
    pool?: "artifact" | "lore";
    manaSplit?: { artifact: number; lore: number };
    rowIndex?: number; // Corrupted Greed
    tradeSource?: { from: "deck" | "discard"; index: number }; // Tainted Trade
    tradeRowIndex?: number; // Tainted Trade
  } = {},
  rng: () => number = Math.random,
): GameState {
  const playerId = requirePendingLocation(state, "valley");
  const resolution = state.pendingValleyOutcome;
  if (!resolution) {
    throw new Error("There is no Rot outcome to finalize.");
  }

  if (resolution.outcome === "resist") {
    // Rulebook: "Each time you Resist The Rot, place 1 Withering Token in
    // each of your Attunement Pools."
    const player = state.players[playerId];
    const updatedPlayer: EnginePlayer = {
      ...player,
      witheringTokens: { artifact: player.witheringTokens.artifact + 1, lore: player.witheringTokens.lore + 1 },
    };
    return completeTurn({
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      rotDiscard: [...state.rotDiscard, resolution.card],
      pendingValleyOutcome: null,
      log: [...state.log, `${player.character.name} places 1 Withering Token in each Mana Pool.`],
    });
  }

  if (resolution.effectText === CORRUPTED_GREED_TEXT) {
    return completeTurn(resolveCorruptedGreed(state, playerId, resolution, choice.rowIndex, rng));
  }
  if (resolution.effectText === TAINTED_TRADE_TEXT) {
    return completeTurn(resolveTaintedTrade(state, playerId, resolution, choice.tradeSource, choice.tradeRowIndex));
  }
  if (resolution.effectText === FORBIDDEN_KNOWLEDGE_TEXT || resolution.effectText === WHISPERED_SECRETS_TEXT) {
    throw new Error("Reveal the cards for this Embrace effect before finalizing.");
  }

  const nextState = resolution.effectText ? applyRotEffectText(state, playerId, resolution.effectText, choice, rng) : state;

  if (resolution.outcome === "win" || resolution.outcome === "embrace") {
    return completeTurn(finishValleyResolution(nextState, playerId, resolution));
  }
  return completeTurn({ ...nextState, rotDiscard: [...nextState.rotDiscard, resolution.card], pendingValleyOutcome: null });
}

// --- The Arena -----------------------------------------------------------

function equippedArtifactAttackTotal(player: EnginePlayer): number {
  return (
    (player.equippedWeapon?.attack ?? 0) +
    (player.equippedArmor?.attack ?? 0) +
    (player.equippedImplement?.attack ?? 0) +
    player.equippedRuneStones.reduce((sum, c) => sum + c.attack, 0)
  );
}

// Rulebook, entering The Arena: "Pay 1 Rot Card by placing it in the discard
// pile." The specific card doesn't matter — the player area only tracks
// counts by kind (see EnginePlayer.rotCardsInPlayerArea) — so the player
// picks which *kind* to spend; an arbitrary card of that kind is removed and
// returned to the shared Rot discard. Arena Faction 2: "you may choose to
// pay 1 Gold entry instead of 1 Rot Card" — kind "gold" here, gated on that
// Faction level.
export function payArenaEntryFee(state: GameState, kind: "combat" | "scenario" | "gold"): GameState {
  const playerId = requirePendingLocation(state, "arena");
  if (state.pendingAction!.arenaFeePaid) {
    throw new Error("The Arena entry fee has already been paid this visit.");
  }
  const player = state.players[playerId];

  if (kind === "gold") {
    if ((player.factionTrack.arena ?? 0) < 2) {
      throw new Error(`${player.character.name} needs Arena Faction 2 to pay the entry fee with Gold.`);
    }
    if (player.gold < 1) {
      throw new Error(`${player.character.name} doesn't have 1 Gold to pay the Arena entry fee.`);
    }
    const updatedPlayer: EnginePlayer = { ...player, gold: player.gold - 1 };
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      pendingAction: { ...state.pendingAction!, arenaFeePaid: true },
      log: [...state.log, `${player.character.name} pays 1 Gold to enter The Arena (Faction 2 benefit).`],
    };
  }

  const idx = player.rotCardsInPlayerArea.findIndex((c) => c.kind === kind);
  if (idx === -1) {
    throw new Error(`${player.character.name} has no ${kind} Rot card to pay with.`);
  }
  const card = player.rotCardsInPlayerArea[idx];
  const updatedPlayer: EnginePlayer = {
    ...player,
    rotCardsInPlayerArea: player.rotCardsInPlayerArea.filter((_, i) => i !== idx),
  };

  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    rotDiscard: [...state.rotDiscard, card],
    pendingAction: { ...state.pendingAction!, arenaFeePaid: true },
    log: [...state.log, `${player.character.name} pays ${card.card.name} to enter The Arena.`],
  };
}

// Arena Faction 1: "You may look at the top two cards of any deck and place
// the cards on the top or bottom as desired." Persistent — usable once per
// visit, every visit, from the moment Faction 1 is reached. Reuses the same
// 4-deck choice as Whispered Secrets (own/shared Artifact or Lore deck).
export function peekArenaDeck(
  state: GameState,
  deckChoice: WhisperedDeckChoice,
  rng: () => number = Math.random,
): GameState {
  const playerId = requirePendingLocation(state, "arena");
  const player = state.players[playerId];
  const level = player.factionTrack.arena ?? 0;
  if (level < 1) {
    throw new Error("Faction 1 at The Arena is required to look at the top of a deck.");
  }
  if (!state.pendingAction!.arenaFeePaid) {
    throw new Error("Pay the Arena entry fee first.");
  }
  if (state.pendingAction!.usedArenaPeek) {
    throw new Error("Already used the deck peek this visit.");
  }
  if (state.pendingArenaPeek) {
    throw new Error("Already peeking at a deck.");
  }

  const log = [...state.log];
  let nextState: GameState = {
    ...state,
    pendingAction: { ...state.pendingAction!, usedArenaPeek: true },
  };
  let cards: (ArtifactCard | LoreCard)[];

  if (deckChoice === "ownArtifact") {
    let deck = [...player.artifactDeck];
    let discard = player.artifactDiscard;
    if (deck.length < 2 && discard.length > 0) {
      deck = [...deck, ...shuffle(discard, rng)];
      discard = [];
      log.push(`${player.character.name} shuffles their Artifact discard pile into their deck.`);
    }
    cards = deck.slice(0, 2);
    const updatedPlayer: EnginePlayer = { ...player, artifactDeck: deck.slice(2), artifactDiscard: discard };
    nextState = { ...nextState, players: { ...nextState.players, [playerId]: updatedPlayer } };
  } else if (deckChoice === "ownLore") {
    let deck = [...player.loreDeck];
    let discard = player.loreDiscard;
    if (deck.length < 2 && discard.length > 0) {
      deck = [...deck, ...shuffle(discard, rng)];
      discard = [];
      log.push(`${player.character.name} shuffles their Lore discard pile into their deck.`);
    }
    cards = deck.slice(0, 2);
    const updatedPlayer: EnginePlayer = { ...player, loreDeck: deck.slice(2), loreDiscard: discard };
    nextState = { ...nextState, players: { ...nextState.players, [playerId]: updatedPlayer } };
  } else if (deckChoice === "sharedArtifact") {
    cards = state.artifactDeck.slice(0, 2);
    nextState = { ...nextState, artifactDeck: state.artifactDeck.slice(2) };
  } else {
    cards = state.loreDeck.slice(0, 2);
    nextState = { ...nextState, loreDeck: state.loreDeck.slice(2) };
  }

  if (cards.length === 0) {
    return {
      ...nextState,
      log: [...log, `${player.character.name} finds ${whisperedDeckLabel(deckChoice)} empty — there's nothing to look at.`],
    };
  }

  return {
    ...nextState,
    pendingArenaPeek: { deck: deckChoice, cards },
    log: [...log, `${player.character.name} looks at the top ${cards.length} card(s) of ${whisperedDeckLabel(deckChoice)}.`],
  };
}

// `topIndices`/`bottomIndices` partition the peeked cards' indices between
// the top and bottom of the deck ("place the cards on the top or bottom as
// desired") — the order within each list is the order they're placed (first
// listed ends up closest to that end of the deck). Every peeked card must
// appear in exactly one of the two lists.
export function resolveArenaPeek(state: GameState, topIndices: number[], bottomIndices: number[]): GameState {
  const playerId = requirePendingLocation(state, "arena");
  const step = state.pendingArenaPeek;
  if (!step) {
    throw new Error("There is no deck peek to resolve.");
  }
  const { deck, cards } = step;
  const combined = [...topIndices, ...bottomIndices];
  const unique = new Set(combined);
  if (unique.size !== cards.length || combined.length !== cards.length || combined.some((i) => i < 0 || i >= cards.length)) {
    throw new Error("Every peeked card must go to the top or bottom exactly once.");
  }

  const topCards = topIndices.map((i) => cards[i]);
  const bottomCards = bottomIndices.map((i) => cards[i]);
  const player = state.players[playerId];

  let nextState: GameState;
  if (deck === "ownArtifact") {
    const updatedPlayer: EnginePlayer = {
      ...player,
      artifactDeck: [...(topCards as ArtifactCard[]), ...player.artifactDeck, ...(bottomCards as ArtifactCard[])],
    };
    nextState = { ...state, players: { ...state.players, [playerId]: updatedPlayer } };
  } else if (deck === "ownLore") {
    const updatedPlayer: EnginePlayer = {
      ...player,
      loreDeck: [...(topCards as LoreCard[]), ...player.loreDeck, ...(bottomCards as LoreCard[])],
    };
    nextState = { ...state, players: { ...state.players, [playerId]: updatedPlayer } };
  } else if (deck === "sharedArtifact") {
    nextState = {
      ...state,
      artifactDeck: [...(topCards as ArtifactCard[]), ...state.artifactDeck, ...(bottomCards as ArtifactCard[])],
    };
  } else {
    nextState = {
      ...state,
      loreDeck: [...(topCards as LoreCard[]), ...state.loreDeck, ...(bottomCards as LoreCard[])],
    };
  }

  return {
    ...nextState,
    pendingArenaPeek: null,
    log: [
      ...state.log,
      `${player.character.name} returns ${cards.length} card(s) to ${whisperedDeckLabel(deck)}` +
        (topCards.length > 0 && bottomCards.length > 0
          ? ` (${topCards.length} to the top, ${bottomCards.length} to the bottom).`
          : topCards.length > 0
            ? " (all to the top)."
            : " (all to the bottom)."),
    ],
  };
}

export function leaveArena(state: GameState): GameState {
  requirePendingLocation(state, "arena");
  if (!state.pendingAction!.arenaFeePaid) {
    throw new Error("Pay the Arena entry fee before leaving.");
  }
  if (state.pendingArenaPeek) {
    throw new Error("Resolve the deck peek before leaving The Arena.");
  }
  return completeTurn(state);
}

// Cleanup Phase step 1: "Resolve Arena combat if any Action Tokens are on The
// Arena." Rulebook: "Roll 2d6 + the Attack values of all attuned Weapons,
// Armor, Implements, and Runestones. Lore cards do not factor into Arena
// combats... If tied for the highest Attack, only the tied Characters reroll
// their 2d6 and recalculate their Attack. Continue until there is one
// winner... If only one Character enters the Arena, they receive the Arena
// Reward without resolving combat." Also resolves the Arena Reward — unless
// Faction 3 (take both automatically) or only one card was available either
// way, choosing between the two revealed cards is a real player decision, so
// this pauses the game in the "arenaReward" phase rather than picking for
// them (see resolveArenaReward).
function resolveArenaCombatAndReward(state: GameState, rng: () => number): GameState {
  // isLocationAvailable now enforces "a player may have only 1 of their
  // Action Tokens on any Location," so a repeat Arena entrant per round
  // shouldn't be reachable through normal play — but combat is per-
  // Character, not per-token, and the tie-break loop below keys its dice
  // totals by player ID: an un-deduplicated repeat entrant would collide
  // with themselves in that Map and "tie" forever, never terminating. Kept
  // as a defensive dedupe (e.g. against a future Rune Stone or other effect
  // that grants an extra Arena placement) rather than trusting the caller.
  const entrants = [...new Set(state.locationTokens.arena ?? [])];
  const log = [...state.log];

  if (entrants.length === 0) {
    return { ...state, log: [...log, "No Action Tokens on The Arena — no combat to resolve."] };
  }

  let winnerId: string;
  if (entrants.length === 1) {
    winnerId = entrants[0];
    log.push(`${state.players[winnerId].character.name} is the only Character in The Arena and wins without combat.`);
  } else {
    const gearAttack = new Map(entrants.map((id) => [id, equippedArtifactAttackTotal(state.players[id])]));
    let contenders = entrants;
    let round = 1;
    for (;;) {
      const totals = new Map(
        contenders.map((id) => {
          const dice: [number, number] = [rollD6(rng), rollD6(rng)];
          const gear = gearAttack.get(id) ?? 0;
          const total = dice[0] + dice[1] + gear;
          log.push(
            `${state.players[id].character.name} rolls ${dice[0]} + ${dice[1]} + ${gear} Attack = ${total} in Arena combat` +
              (round > 1 ? ` (reroll ${round}).` : "."),
          );
          return [id, total] as const;
        }),
      );
      const highest = Math.max(...totals.values());
      const tied = contenders.filter((id) => totals.get(id) === highest);
      if (tied.length === 1) {
        winnerId = tied[0];
        break;
      }
      log.push(`${tied.map((id) => state.players[id].character.name).join(", ")} tie at ${highest} Attack and reroll.`);
      contenders = tied;
      round += 1;
    }
    log.push(`${state.players[winnerId].character.name} wins Arena combat.`);
  }

  // Arena Reward: "The winner reveals the top card of the Artifact Deck and
  // the top card of the Lore Deck." Reshuffles each shared discard pile in
  // first if its deck is dry.
  const artifactDraw = drawFromSharedDeck(state.artifactDeck, state.artifactDiscard, 1, rng);
  const loreDraw = drawFromSharedDeck(state.loreDeck, state.loreDiscard, 1, rng);
  const artifactCard = artifactDraw.drawn[0] ?? null;
  const loreCard = loreDraw.drawn[0] ?? null;
  const artifactDeck = artifactDraw.deck;
  const artifactDiscard = artifactDraw.discard;
  const loreDeck = loreDraw.deck;
  const loreDiscard = loreDraw.discard;
  const nextState: GameState = { ...state, artifactDeck, artifactDiscard, loreDeck, loreDiscard, log };

  if (!artifactCard && !loreCard) {
    return { ...nextState, log: [...nextState.log, "The Artifact and Lore decks and discard piles are all empty — there is no Arena Reward."] };
  }

  const winner = state.players[winnerId];
  const doubleReward = (winner.factionTrack.arena ?? 0) >= 3;

  if (doubleReward || !artifactCard || !loreCard) {
    // Faction 3 takes both automatically; otherwise, if only one card was
    // revealed, there's no real choice either way — resolve immediately.
    let updatedPlayer = winner;
    const lines: string[] = [];
    if (artifactCard) {
      updatedPlayer = { ...updatedPlayer, artifactDiscard: [...updatedPlayer.artifactDiscard, artifactCard] };
      lines.push(
        doubleReward
          ? `${winner.character.name} claims ${artifactCard.name} as the Arena Reward (Faction 3 benefit).`
          : `${winner.character.name} claims ${artifactCard.name} as the Arena Reward.`,
      );
    }
    if (loreCard) {
      updatedPlayer = { ...updatedPlayer, loreDiscard: [...updatedPlayer.loreDiscard, loreCard] };
      lines.push(
        doubleReward
          ? `${winner.character.name} claims ${loreCard.name} as the Arena Reward (Faction 3 benefit).`
          : `${winner.character.name} claims ${loreCard.name} as the Arena Reward.`,
      );
    }
    return {
      ...nextState,
      players: { ...nextState.players, [winnerId]: updatedPlayer },
      log: [...nextState.log, ...lines],
    };
  }

  // Faction < 3 with both cards available: the winner chooses one, and the
  // rest of Cleanup Phase waits for that choice (see runCleanupPhase).
  return {
    ...nextState,
    phase: "arenaReward",
    pendingArenaReward: { playerId: winnerId, artifactCard, loreCard },
    log: [
      ...nextState.log,
      `${winner.character.name} reveals ${artifactCard.name} and ${loreCard.name} for the Arena Reward and must choose one.`,
    ],
  };
}

// Resolves the Arena Reward choice from resolveArenaCombatAndReward, then
// runs the rest of Cleanup Phase (which was paused waiting for it).
export function resolveArenaReward(state: GameState, choice: "artifact" | "lore", rng: () => number = Math.random): GameState {
  if (state.phase !== "arenaReward" || !state.pendingArenaReward) {
    throw new Error("There is no Arena Reward to resolve.");
  }
  const { playerId, artifactCard, loreCard } = state.pendingArenaReward;
  const player = state.players[playerId];

  const keptArtifact = choice === "artifact" ? artifactCard : null;
  const keptLore = choice === "lore" ? loreCard : null;
  if (choice === "artifact" && !artifactCard) throw new Error("There is no Artifact card to choose.");
  if (choice === "lore" && !loreCard) throw new Error("There is no Lore card to choose.");

  const updatedPlayer: EnginePlayer = {
    ...player,
    artifactDiscard: keptArtifact ? [...player.artifactDiscard, keptArtifact] : player.artifactDiscard,
    loreDiscard: keptLore ? [...player.loreDiscard, keptLore] : player.loreDiscard,
  };

  const nextState: GameState = {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    // The card not chosen returns to the bottom of its own shared deck.
    artifactDeck: keptArtifact ? state.artifactDeck : [...state.artifactDeck, artifactCard!],
    loreDeck: keptLore ? state.loreDeck : [...state.loreDeck, loreCard!],
    pendingArenaReward: null,
    phase: "cleanup",
    log: [
      ...state.log,
      `${player.character.name} claims ${(keptArtifact ?? keptLore)!.name} as the Arena Reward. ` +
        `${(keptArtifact ? loreCard : artifactCard)!.name} returns to the bottom of its deck.`,
    ],
  };

  return finishCleanupPhaseAfterArena(nextState, rng);
}

// --- Final Battle -----------------------------------------------------------

// Every character's printed text follows one of two templates: "...and
// access to The (Warriors|Scholars) Guild." or "...and 3 Faction at both The
// X and The Y." Parsed at runtime (rather than hand-mapped per character) so
// src/data/characters.ts stays the single source of truth.
function locationIdByDisplayName(name: string): LocationId {
  const trimmed = name.trim();
  const loc = locations.find((l) => l.name === `The ${trimmed}`);
  if (!loc) {
    throw new Error(`Unrecognized Location name "${trimmed}" in a Victory Condition.`);
  }
  return loc.id;
}

// Every character's printed Victory Condition text starts "Have 1 Attuned
// Lore card, at least 3 Rot cards, and..." — those two are checked here
// before the character-specific clause; offerFinalBattle re-checks the
// Attuned-Lore count too, since a player can drop to 0 again after
// qualifying and needs to be re-verified before actually initiating.
export function meetsVictoryCondition(player: EnginePlayer): boolean {
  if (player.attunedLore.length < 1) return false;
  if (player.rotCardsInPlayerArea.length < 3) return false;

  const text = player.character.victoryCondition;
  const guildMatch = text.match(/access to The (Warriors|Scholars) Guild/);
  if (guildMatch) {
    return guildMatch[1] === "Warriors" ? isWarriorsGuildUnlocked(player) : isScholarsGuildUnlocked(player);
  }
  const factionMatch = text.match(/3 Faction at both The (.+?) and The (.+?)\./);
  if (factionMatch) {
    const locA = locationIdByDisplayName(factionMatch[1]);
    const locB = locationIdByDisplayName(factionMatch[2]);
    return (player.factionTrack[locA] ?? 0) >= 3 && (player.factionTrack[locB] ?? 0) >= 3;
  }
  throw new Error(`Unrecognized Victory Condition text: "${text}"`);
}

// Final Battle Combat step 5, "Trophy: Place both Rot Combat cards in your
// player area." Applied the instant a combat resolves (win or loss) —
// unlike a normal Rot Combat encounter (see the Valley), the 2 cards fought
// in the Final Battle never return to The Rot's shared deck/discard; they
// permanently join the combatant's own rotCardsInPlayerArea instead (the
// same pile the Victory Condition and Arena entry fee draw from). Because
// of that, the Next Combatant/Press the Attack transitions no longer push
// these cards into state.rotDiscard themselves — Trophy already placed them.
function applyTrophy(player: EnginePlayer, rotCards: [RotCombatCard, RotCombatCard]): EnginePlayer {
  return {
    ...player,
    rotCardsInPlayerArea: [
      ...player.rotCardsInPlayerArea,
      { kind: "combat" as const, card: rotCards[0] },
      { kind: "combat" as const, card: rotCards[1] },
    ],
  };
}

function characterBoardIsEmpty(player: EnginePlayer): boolean {
  return (
    !player.equippedWeapon &&
    !player.equippedArmor &&
    !player.equippedImplement &&
    player.equippedRuneStones.length === 0 &&
    player.attunedLore.length === 0
  );
}

// Latches finalBattleDefeatedPlayerIds the instant a player's board first
// goes empty (see the GameState field's own comment for why this must be
// permanent rather than re-derived live from characterBoardIsEmpty).
// Idempotent — safe to call every combat even for a player already marked.
function markDefeatedIfBoardEmpty(state: GameState, playerId: string, player: EnginePlayer): string[] {
  if (!characterBoardIsEmpty(player) || state.finalBattleDefeatedPlayerIds.includes(playerId)) {
    return state.finalBattleDefeatedPlayerIds;
  }
  return [...state.finalBattleDefeatedPlayerIds, playerId];
}

// Cleanup Phase step 6: "Beginning with the First Player and proceeding
// clockwise, any player who has met their Character's Victory Condition may
// initiate The Final Battle." `fromStep` resumes a scan a prior decline left
// off at (see declineFinalBattle) — steps are relative to firstPlayerIndex,
// wrapping once around the table.
function offerFinalBattle(state: GameState, fromStep: number): GameState {
  for (let step = fromStep; step < state.playerOrder.length; step++) {
    const idx = (state.firstPlayerIndex + step) % state.playerOrder.length;
    const id = state.playerOrder[idx];
    const player = state.players[id];
    if (meetsVictoryCondition(player) && player.attunedLore.length >= 1) {
      return {
        ...state,
        phase: "finalBattleOffer",
        pendingFinalBattleOffer: { playerId: id, scanIndex: step },
        log: [...state.log, `${player.character.name} has met their Victory Condition and may initiate The Final Battle.`],
      };
    }
  }
  return state;
}

// Reveals Rot cards one at a time (reshuffling the discard in if the deck
// runs dry, same as everywhere else) until 2 Combat cards are found,
// discarding any Scenario cards along the way "without effect."
// `cards: null` means the shared Rot Combat card supply is exhausted — see
// applyTrophy: fought Combat cards permanently leave this shared deck/
// discard for the winning combatant's own player area instead of cycling
// back, so (unlike everywhere else a Rot deck reshuffles) this pool can run
// out of Combat cards entirely if the Final Battle runs long enough. When
// that happens, every call site treats it as The Rot having nothing left to
// fight with — see finalBattleWinByExhaustion.
function drawTwoFinalBattleCombatCards(
  rotDeck: RotCard[],
  rotDiscard: RotCard[],
  rng: () => number,
): { cards: [RotCombatCard, RotCombatCard] | null; deck: RotCard[]; discard: RotCard[]; log: string[] } {
  let deck = rotDeck;
  let discard = rotDiscard;
  const log: string[] = [];
  const combatCards: RotCombatCard[] = [];

  // Bounded by the pool's starting size rather than an arbitrary constant:
  // every draw either finds a Combat card (progress toward the 2 needed) or
  // sends a Scenario card back to discard (no net change in pool size), so
  // more draws than there are cards in the pool can only mean the pool has
  // no Combat cards left at all. Scenario cards alone would otherwise cycle
  // deck<->discard forever and never trip the both-empty check below.
  const maxAttempts = rotDeck.length + rotDiscard.length + 1;
  let attempts = 0;

  while (combatCards.length < 2) {
    attempts++;
    if (attempts > maxAttempts) {
      return { cards: null, deck, discard, log };
    }
    const { drawn, deck: nextDeck, discard: nextDiscard, reshuffled } = drawRotCards(deck, discard, 1, rng);
    deck = nextDeck;
    discard = nextDiscard;
    if (drawn.length === 0) {
      return { cards: null, deck, discard, log };
    }
    if (reshuffled) log.push("The Rot discard pile is shuffled into a new deck.");
    const card = drawn[0];
    if (card.kind === "combat") {
      combatCards.push(card.card);
    } else {
      discard = [...discard, card];
      log.push(`${card.card.name} is discarded without effect.`);
    }
  }

  return { cards: combatCards as [RotCombatCard, RotCombatCard], deck, discard, log };
}

// The Rot's Combat card supply ran out mid-Final-Battle (see
// drawTwoFinalBattleCombatCards) — treated the same as removing its last
// Artifact: The Rot has nothing left to fight with, so whoever the game was
// drawing cards for when the supply ran dry wins.
function finalBattleWinByExhaustion(
  state: GameState,
  winnerId: string,
  deck: RotCard[],
  discard: RotCard[],
  drawLog: string[],
): GameState {
  const player = state.players[winnerId];
  const nextState: GameState = {
    ...state,
    rotDeck: deck,
    rotDiscard: discard,
    pendingFinalBattleCombat: null,
    pendingFinalBattleOutcome: null,
    phase: "gameOver",
    log: [
      ...state.log,
      ...drawLog,
      `The Rot has no Combat cards left to fight with — its arsenal is spent. ${player.character.name} wins the game!`,
    ],
  };
  return { ...nextState, finalRanking: computeFinalRanking(nextState, winnerId) };
}

export function initiateFinalBattle(state: GameState, rng: () => number = Math.random): GameState {
  if (state.phase !== "finalBattleOffer" || !state.pendingFinalBattleOffer) {
    throw new Error("There is no Final Battle offer to accept right now.");
  }
  const { playerId } = state.pendingFinalBattleOffer;
  const player = state.players[playerId];
  const { cards, deck, discard, log } = drawTwoFinalBattleCombatCards(state.rotDeck, state.rotDiscard, rng);
  if (!cards) {
    return finalBattleWinByExhaustion(state, playerId, deck, discard, log);
  }

  // "The first player to initiate The Final Battle receives a one-time boon
  // from the gods... Attune it without paying its Mana cost." Only ever
  // offered once per game — finalBattleBoonClaimed stays false here (so the
  // pause below can still be resolved/declined) and only flips to true once
  // resolveFinalBattleBoon/declineFinalBattleBoon actually runs, unless the
  // player has nothing in any personal pile to Attune, in which case the
  // boon fizzles immediately and the flag is set right away.
  let pendingFinalBattleBoon: GameState["pendingFinalBattleBoon"] = null;
  let finalBattleBoonClaimed = state.finalBattleBoonClaimed;
  const boonLog: string[] = [];
  if (!finalBattleBoonClaimed) {
    const hasBoonCandidate =
      player.artifactDeck.length > 0 ||
      player.artifactDiscard.length > 0 ||
      player.loreDeck.length > 0 ||
      player.loreDiscard.length > 0;
    if (hasBoonCandidate) {
      pendingFinalBattleBoon = { playerId };
      boonLog.push(
        `${player.character.name} is the first to initiate The Final Battle and receives a boon from the gods — they may Attune 1 Artifact or Lore card from their Deck or Discard Pile without paying its Mana cost before this combat begins.`,
      );
    } else {
      finalBattleBoonClaimed = true;
      boonLog.push(
        `${player.character.name} is the first to initiate The Final Battle, but has no card left in any Deck or Discard Pile to claim the gods' boon.`,
      );
    }
  }

  return {
    ...state,
    rotDeck: deck,
    rotDiscard: discard,
    pendingFinalBattleOffer: null,
    pendingFinalBattleBoon,
    pendingFinalBattleCombat: { playerId, rotCards: cards },
    phase: "finalBattle",
    finalBattleBoonClaimed,
    log: [
      ...state.log,
      `${player.character.name} initiates The Final Battle!`,
      ...log,
      `${player.character.name} faces ${cards[0].name} and ${cards[1].name}.`,
      ...boonLog,
    ],
  };
}

export function declineFinalBattle(state: GameState): GameState {
  if (state.phase !== "finalBattleOffer" || !state.pendingFinalBattleOffer) {
    throw new Error("There is no Final Battle offer to decline right now.");
  }
  const { playerId, scanIndex } = state.pendingFinalBattleOffer;
  const declined: GameState = {
    ...state,
    phase: "cleanup",
    pendingFinalBattleOffer: null,
    log: [...state.log, `${state.players[playerId].character.name} declines to initiate The Final Battle.`],
  };
  const afterOffer = offerFinalBattle(declined, scanIndex + 1);
  if (afterOffer.phase === "finalBattleOffer") {
    return afterOffer;
  }
  return finishCleanupPhaseAfterVictoryCheck(afterOffer);
}

export interface FinalBattleBoonChoice {
  source: "deck" | "discard";
  deck: "artifact" | "lore";
  index: number;
  chosenSlot?: ArtifactSlotName; // only meaningful for a multi-slot Artifact (e.g. Godslayer)
  replaceIndex?: number; // only meaningful for Lore at the 3-card cap
}

// Resolves the first initiator's boon (see initiateFinalBattle) — picks the
// card straight out of the named personal pile, reshuffling the remainder
// back into the deck when picked from there (same as Rune of Seeking), then
// Attunes it via the shared *IntoSlot helpers with `free: true` so the usual
// Mana-cost check never runs.
export function resolveFinalBattleBoon(
  state: GameState,
  choice: FinalBattleBoonChoice,
  rng: () => number = Math.random,
): GameState {
  if (state.phase !== "finalBattle" || !state.pendingFinalBattleBoon) {
    throw new Error("There is no Final Battle boon to claim right now.");
  }
  const { playerId } = state.pendingFinalBattleBoon;
  const player = state.players[playerId];
  const { source, deck, index } = choice;
  const pileLabel = source === "deck" ? "deck" : "discard pile";

  if (deck === "artifact") {
    const pile = source === "deck" ? player.artifactDeck : player.artifactDiscard;
    const card = pile[index];
    if (!card) throw new Error("Invalid Artifact card selection.");
    const playerWithoutCard: EnginePlayer =
      source === "deck"
        ? { ...player, artifactDeck: shuffle(pile.filter((_, i) => i !== index), rng) }
        : { ...player, artifactDiscard: pile.filter((_, i) => i !== index) };
    const { updatedPlayer, slot, previous } = attuneArtifactCardIntoSlot(
      playerWithoutCard,
      card,
      choice.chosenSlot,
      undefined,
      true,
    );
    return {
      ...state,
      players: { ...state.players, [playerId]: updatedPlayer },
      pendingFinalBattleBoon: null,
      finalBattleBoonClaimed: true,
      log: [
        ...state.log,
        `${player.character.name} calls upon the gods' boon, Attuning ${card.name} from their Artifact ${pileLabel} to their ${slot} slot without paying its Mana cost.` +
          (previous ? ` ${previous.name} moves to their Artifact discard pile.` : ""),
      ],
    };
  }

  const pile = source === "deck" ? player.loreDeck : player.loreDiscard;
  const card = pile[index];
  if (!card) throw new Error("Invalid Lore card selection.");
  const playerWithoutCard: EnginePlayer =
    source === "deck"
      ? { ...player, loreDeck: shuffle(pile.filter((_, i) => i !== index), rng) }
      : { ...player, loreDiscard: pile.filter((_, i) => i !== index) };
  const { updatedPlayer, previous } = attuneLoreCardIntoSlot(playerWithoutCard, card, choice.replaceIndex, undefined, true);
  return {
    ...state,
    players: { ...state.players, [playerId]: updatedPlayer },
    pendingFinalBattleBoon: null,
    finalBattleBoonClaimed: true,
    log: [
      ...state.log,
      `${player.character.name} calls upon the gods' boon, Attuning ${card.name} from their Lore ${pileLabel} without paying its Mana cost.` +
        (previous ? ` ${previous.name} moves to their Lore discard pile.` : ""),
    ],
  };
}

export function declineFinalBattleBoon(state: GameState): GameState {
  if (state.phase !== "finalBattle" || !state.pendingFinalBattleBoon) {
    throw new Error("There is no Final Battle boon to decline right now.");
  }
  const { playerId } = state.pendingFinalBattleBoon;
  return {
    ...state,
    pendingFinalBattleBoon: null,
    finalBattleBoonClaimed: true,
    log: [...state.log, `${state.players[playerId].character.name} declines the gods' boon.`],
  };
}

// "Choose Lore" + "Calculate Your/The Rot's Attack" (Final Battle Combat
// steps 1-4, short of the removal choice). Choose 1 or 2 Attuned Lore cards
// per attack and total the best applicable value of each — any other
// Attuned Lore stays Attuned, untouched, for a future combat. Each card's
// Attack value is creature-type-dependent (vsAberration/vsConstruct/
// vsUndead, same as Valley combat, with the better of the 2 revealed Rot
// cards' types applying).
//
// Rune of Preservation ("discard this Rune Stone instead of discarding the
// Lore card") discards the Rune instead of ONE of the chosen cards —
// `preserveLoreIndex` names which of `loreIndices` that is (defaults to the
// sole entry when only 1 card was chosen, so the single-card call site
// doesn't need to pass it). The other chosen card, if any, still discards
// normally.
export function chooseFinalBattleLore(
  state: GameState,
  loreIndices: number[],
  rng: () => number = Math.random,
  preserveWithRuneStoneIndex?: number,
  preserveLoreIndex?: number,
  useWieldTheRot?: boolean,
): GameState {
  if (state.phase !== "finalBattle" || !state.pendingFinalBattleCombat) {
    throw new Error("There is no Final Battle combat to resolve.");
  }
  if (state.pendingFinalBattleBoon) {
    throw new Error("Resolve the Final Battle boon before attacking.");
  }
  const { playerId, rotCards } = state.pendingFinalBattleCombat;
  const player = state.players[playerId];
  if (player.attunedLore.length === 0) {
    throw new Error(`${player.character.name} has no Attuned Lore to attack with.`);
  }
  if (loreIndices.length < 1 || loreIndices.length > 2) {
    throw new Error("Choose 1 or 2 Attuned Lore cards to attack with.");
  }
  if (new Set(loreIndices).size !== loreIndices.length) {
    throw new Error("Choose 2 different Attuned Lore cards.");
  }
  const loreCards = loreIndices.map((i) => player.attunedLore[i]);
  if (loreCards.some((c) => !c)) {
    throw new Error("Invalid Lore card selection.");
  }

  let equippedRuneStones = player.equippedRuneStones;
  let artifactDiscard = player.artifactDiscard;
  let witheringTokens = state.witheringTokens;
  let preservedNote = "";
  let resolvedPreserveLoreIndex: number | undefined;
  if (preserveWithRuneStoneIndex !== undefined) {
    const stone = player.equippedRuneStones[preserveWithRuneStoneIndex];
    if (!stone || stone.name !== "Rune of Preservation") {
      throw new Error(`${player.character.name} doesn't have Rune of Preservation Attuned in that position.`);
    }
    resolvedPreserveLoreIndex = preserveLoreIndex ?? (loreIndices.length === 1 ? loreIndices[0] : undefined);
    if (resolvedPreserveLoreIndex === undefined || !loreIndices.includes(resolvedPreserveLoreIndex)) {
      throw new Error("Choose which of the attacking Lore cards to preserve.");
    }
    equippedRuneStones = player.equippedRuneStones.filter((_, i) => i !== preserveWithRuneStoneIndex);
    artifactDiscard = [...player.artifactDiscard, stone];
    const removed = Math.min(2, witheringTokens);
    witheringTokens -= removed;
    const preservedCard = player.attunedLore[resolvedPreserveLoreIndex];
    preservedNote =
      `, discarding Rune of Preservation instead of ${preservedCard.name}` +
      (removed > 0 ? ` and removing ${removed} Withering Token(s) from The Rot` : "");
  }

  const loreValueFor = (card: LoreCard, type: RotCreatureType) =>
    type === "Aberration" ? card.vsAberration : type === "Construct" ? card.vsConstruct : card.vsUndead;
  const bestValueFor = (card: LoreCard) =>
    Math.max(loreValueFor(card, rotCards[0].creatureType), loreValueFor(card, rotCards[1].creatureType));

  const loreCardNames = loreCards.map((c) => c.name);
  const loreBreakdown = loreCards.map((c) => `${c.name} (+${bestValueFor(c)})`).join(" + ");
  const totalLoreValue = loreCards.reduce((sum, c) => sum + bestValueFor(c), 0);

  const discardIndices = loreIndices.filter((i) => i !== resolvedPreserveLoreIndex);
  const attunedLore = player.attunedLore.filter((_, i) => !discardIndices.includes(i));
  const loreDiscard = [...player.loreDiscard, ...discardIndices.map((i) => player.attunedLore[i])];
  const updatedPlayer: EnginePlayer = { ...player, attunedLore, loreDiscard, equippedRuneStones, artifactDiscard };

  const gearAttack = equippedArtifactAttackTotal(player);
  const wield = resolveWieldTheRot(player, witheringTokens, useWieldTheRot);
  witheringTokens = wield.witheringTokens;
  const powerBonus = wield.bonus;
  const wieldNote = wield.note;
  const dice = rollAttackDice(player.character, rng);

  // Rune of Fracture: "Discard after rolling your Attack dice to reroll 1
  // die." Only pause for a combatant who actually holds the stone —
  // everyone else resolves in this one call, as before. pendingFinalBattleCombat
  // is deliberately left set so rotCards/playerId survive the pause.
  if (updatedPlayer.equippedRuneStones.some((r) => r.name === "Rune of Fracture")) {
    return {
      ...state,
      witheringTokens,
      players: { ...state.players, [playerId]: updatedPlayer },
      pendingFinalBattleAttackRoll: { loreCardNames, loreValue: totalLoreValue, gearAttack, powerBonus, dice, rerolled: false },
      log: [
        ...state.log,
        `${player.character.name} attacks with ${loreBreakdown}${preservedNote}${wieldNote}.`,
        `Attack dice: ${dice[0]} + ${dice[1]}. Rune of Fracture may reroll one die before resolving.`,
      ],
    };
  }

  const playerAttack = dice[0] + dice[1] + totalLoreValue + gearAttack + powerBonus;
  const rotAttack = rotCards[0].attack + rotCards[1].attack + state.rotArtifacts.reduce((sum, c) => sum + c.attack, 0);
  const outcome: "win" | "loss" = playerAttack >= rotAttack ? "win" : "loss";

  // If The Rot has no Artifacts to remove on a win, or the Lore discard
  // already emptied the player's board on a loss, there's nothing to
  // remove either way — skip straight to Divine Reclamation rather than
  // stranding pendingFinalBattleOutcome at "removeCard" with no valid
  // choice to make (removeRotArtifact has no index to accept when
  // rotArtifacts is empty). Only the loss side is an actual defeat.
  const rotHasNoArtifactsToRemove = outcome === "win" && state.rotArtifacts.length === 0;
  const playerBoardEmptyOnLoss = outcome === "loss" && characterBoardIsEmpty(updatedPlayer);
  const skipRemoval = rotHasNoArtifactsToRemove || playerBoardEmptyOnLoss;

  const trophyPlayer = applyTrophy(updatedPlayer, rotCards);
  const finalBattleDefeatedPlayerIds = playerBoardEmptyOnLoss
    ? markDefeatedIfBoardEmpty(state, playerId, trophyPlayer)
    : state.finalBattleDefeatedPlayerIds;

  const log = [
    ...state.log,
    `${player.character.name} attacks with ${loreBreakdown}${preservedNote}${wieldNote}: ${dice[0]} + ${dice[1]} + ${totalLoreValue} Lore + ${gearAttack} Gear` +
      (powerBonus > 0 ? ` + ${powerBonus} Wield the Rot` : "") +
      ` = ${playerAttack} Attack, vs The Rot's ${rotAttack} (${rotCards[0].name} + ${rotCards[1].name}).`,
    outcome === "win" ? `${player.character.name} wins the exchange!` : `${player.character.name} is overpowered.`,
    `${player.character.name} adds ${rotCards[0].name} and ${rotCards[1].name} to their player area (Trophy).`,
    ...(rotHasNoArtifactsToRemove ? ["The Rot has no Artifacts to remove — the fight continues."] : []),
    ...(playerBoardEmptyOnLoss ? [`${player.character.name} has no cards left to remove.`] : []),
  ];

  return {
    ...state,
    witheringTokens,
    players: { ...state.players, [playerId]: trophyPlayer },
    pendingFinalBattleCombat: null,
    finalBattleDefeatedPlayerIds,
    pendingFinalBattleOutcome: {
      playerId,
      rotCards,
      loreCardNames,
      dice,
      playerAttack,
      rotAttack,
      outcome,
      stage: skipRemoval ? "divineReclamation" : "removeCard",
    },
    log,
  };
}

// Resolves a paused Final Battle Attack roll (see chooseFinalBattleLore's
// Rune of Fracture branch): optionally discard Fracture to reroll one die,
// then compute the win/loss outcome exactly as chooseFinalBattleLore would
// have.
export function resolveFinalBattleAttackRoll(
  state: GameState,
  fractureIndex?: number,
  rerollDieIndex?: 0 | 1,
  rng: () => number = Math.random,
): GameState {
  if (state.phase !== "finalBattle" || !state.pendingFinalBattleCombat) {
    throw new Error("There is no Final Battle combat to resolve.");
  }
  const pending = state.pendingFinalBattleAttackRoll;
  if (!pending) throw new Error("There is no Attack roll to resolve.");
  const { playerId, rotCards } = state.pendingFinalBattleCombat;
  const player = state.players[playerId];

  let dice = pending.dice;
  let updatedPlayer = player;
  let rerollNote = "";
  if (fractureIndex !== undefined) {
    const stone = player.equippedRuneStones[fractureIndex];
    if (!stone || stone.name !== "Rune of Fracture") {
      throw new Error(`${player.character.name} doesn't have Rune of Fracture Attuned in that position.`);
    }
    if (rerollDieIndex === undefined) throw new Error("Choose which die to reroll.");
    const { updatedPlayer: withoutStone } = discardRuneStoneFromPlayer(player, fractureIndex);
    updatedPlayer = withoutStone;
    const newDie = rollD6(rng);
    dice = rerollDieIndex === 0 ? [newDie, dice[1]] : [dice[0], newDie];
    rerollNote = ` (Rune of Fracture rerolls die ${rerollDieIndex + 1}: now ${dice[0]} + ${dice[1]})`;
  }

  const playerAttack = dice[0] + dice[1] + pending.loreValue + pending.gearAttack + pending.powerBonus;
  const rotAttack = rotCards[0].attack + rotCards[1].attack + state.rotArtifacts.reduce((sum, c) => sum + c.attack, 0);
  const outcome: "win" | "loss" = playerAttack >= rotAttack ? "win" : "loss";
  const rotHasNoArtifactsToRemove = outcome === "win" && state.rotArtifacts.length === 0;
  const playerBoardEmptyOnLoss = outcome === "loss" && characterBoardIsEmpty(updatedPlayer);
  const skipRemoval = rotHasNoArtifactsToRemove || playerBoardEmptyOnLoss;

  const trophyPlayer = applyTrophy(updatedPlayer, rotCards);
  const finalBattleDefeatedPlayerIds = playerBoardEmptyOnLoss
    ? markDefeatedIfBoardEmpty(state, playerId, trophyPlayer)
    : state.finalBattleDefeatedPlayerIds;

  const log = [
    ...state.log,
    `${player.character.name} attacks with ${pending.loreCardNames.join(", ")}: ${dice[0]} + ${dice[1]} + ${pending.loreValue} Lore + ${pending.gearAttack} Gear` +
      (pending.powerBonus > 0 ? ` + ${pending.powerBonus} Wield the Rot` : "") +
      ` = ${playerAttack} Attack${rerollNote}, vs The Rot's ${rotAttack} (${rotCards[0].name} + ${rotCards[1].name}).`,
    outcome === "win" ? `${player.character.name} wins the exchange!` : `${player.character.name} is overpowered.`,
    `${player.character.name} adds ${rotCards[0].name} and ${rotCards[1].name} to their player area (Trophy).`,
    ...(rotHasNoArtifactsToRemove ? ["The Rot has no Artifacts to remove — the fight continues."] : []),
    ...(playerBoardEmptyOnLoss ? [`${player.character.name} has no cards left to remove.`] : []),
  ];

  return {
    ...state,
    players: { ...state.players, [playerId]: trophyPlayer },
    pendingFinalBattleCombat: null,
    pendingFinalBattleAttackRoll: null,
    finalBattleDefeatedPlayerIds,
    pendingFinalBattleOutcome: {
      playerId,
      rotCards,
      loreCardNames: pending.loreCardNames,
      dice,
      playerAttack,
      rotAttack,
      outcome,
      stage: skipRemoval ? "divineReclamation" : "removeCard",
    },
    log,
  };
}

// Win margin (Your Attack - The Rot's Attack) determines how many Rot
// Artifacts a win earns: 0-4 over -> 1, 5-9 -> 2, 10+ -> 3.
export function rotArtifactsEarnedForMargin(margin: number): number {
  if (margin >= 10) return 3;
  if (margin >= 5) return 2;
  return 1;
}

// Win path: "Choose N Artifact cards on The Rot Character Mat and remove
// them from the game" (N per rotArtifactsEarnedForMargin's win-margin
// table). If you remove the last Artifact card, you defeat The Rot and win
// the game. Capped at however many Rot Artifacts actually remain —
// `rotArtifactIndices` accepts exactly `min(earned, rotArtifacts.length)`
// indices.
export function removeRotArtifact(state: GameState, rotArtifactIndices: number[]): GameState {
  const resolution = state.pendingFinalBattleOutcome;
  if (state.phase !== "finalBattle" || !resolution || resolution.stage !== "removeCard" || resolution.outcome !== "win") {
    throw new Error("There is no Rot Artifact to remove right now.");
  }
  const earned = rotArtifactsEarnedForMargin(resolution.playerAttack - resolution.rotAttack);
  const expectedCount = Math.min(earned, state.rotArtifacts.length);
  if (rotArtifactIndices.length !== expectedCount) {
    throw new Error(`Choose ${expectedCount} Artifact card${expectedCount === 1 ? "" : "s"} to remove.`);
  }
  if (new Set(rotArtifactIndices).size !== rotArtifactIndices.length) {
    throw new Error("Choose different Artifact cards.");
  }
  if (rotArtifactIndices.some((i) => i < 0 || i >= state.rotArtifacts.length)) {
    throw new Error("Invalid Rot Character Mat position.");
  }
  const removed = rotArtifactIndices.map((i) => state.rotArtifacts[i]);
  const rotArtifacts = state.rotArtifacts.filter((_, i) => !rotArtifactIndices.includes(i));
  const player = state.players[resolution.playerId];
  const log = [...state.log, `${player.character.name} removes ${removed.map((c) => c.name).join(" and ")} from The Rot Character Mat.`];

  if (rotArtifacts.length === 0) {
    const nextState: GameState = {
      ...state,
      rotArtifacts,
      pendingFinalBattleCombat: null,
      pendingFinalBattleOutcome: null,
      phase: "gameOver",
      log: [...log, `${player.character.name} removes the last Artifact from The Rot and defeats it! ${player.character.name} wins the game!`],
    };
    return { ...nextState, finalRanking: computeFinalRanking(nextState, resolution.playerId) };
  }

  return { ...state, rotArtifacts, pendingFinalBattleOutcome: { ...resolution, stage: "divineReclamation" }, log };
}

// Loss path: "Choose 1 card on your Character board and remove it from the
// game. If you have no cards remaining on your Character board, you are
// defeated and take no further turns" — latched permanently into
// finalBattleDefeatedPlayerIds the instant this empties their board (see
// markDefeatedIfBoardEmpty), since Divine Reclamation runs unconditionally
// right after this (win or loss) and could otherwise hand this player a
// free Lore card and undo the defeat.
export function removeOwnBoardCard(state: GameState, ref: CharacterBoardSlotRef): GameState {
  const resolution = state.pendingFinalBattleOutcome;
  if (state.phase !== "finalBattle" || !resolution || resolution.stage !== "removeCard" || resolution.outcome !== "loss") {
    throw new Error("There is no card to remove right now.");
  }
  const player = state.players[resolution.playerId];
  let updatedPlayer: EnginePlayer = player;
  let removedName: string;

  if (ref.kind === "weapon") {
    if (!player.equippedWeapon) throw new Error("No Weapon equipped.");
    removedName = player.equippedWeapon.name;
    updatedPlayer = { ...player, equippedWeapon: undefined };
  } else if (ref.kind === "armor") {
    if (!player.equippedArmor) throw new Error("No Armor equipped.");
    removedName = player.equippedArmor.name;
    updatedPlayer = { ...player, equippedArmor: undefined };
  } else if (ref.kind === "implement") {
    if (!player.equippedImplement) throw new Error("No Implement equipped.");
    removedName = player.equippedImplement.name;
    updatedPlayer = { ...player, equippedImplement: undefined };
  } else if (ref.kind === "runeStone") {
    const stone = player.equippedRuneStones[ref.index];
    if (!stone) throw new Error("Invalid Rune Stone position.");
    removedName = stone.name;
    updatedPlayer = { ...player, equippedRuneStones: player.equippedRuneStones.filter((_, i) => i !== ref.index) };
  } else {
    const lore = player.attunedLore[ref.index];
    if (!lore) throw new Error("Invalid Lore position.");
    removedName = lore.name;
    updatedPlayer = { ...player, attunedLore: player.attunedLore.filter((_, i) => i !== ref.index) };
  }

  const log = [...state.log, `${player.character.name} permanently loses ${removedName}.`];
  if (characterBoardIsEmpty(updatedPlayer)) {
    log.push(`${player.character.name} has no cards left and is defeated.`);
  }

  return {
    ...state,
    players: { ...state.players, [resolution.playerId]: updatedPlayer },
    finalBattleDefeatedPlayerIds: markDefeatedIfBoardEmpty(state, resolution.playerId, updatedPlayer),
    pendingFinalBattleOutcome: { ...resolution, stage: "divineReclamation" },
    log,
  };
}

// "Divine Reclamation: Place your discarded Lore cards in your discard pile
// without shuffling." The Lore cards discarded by this combat's Use Lore
// step already went straight into loreDiscard (see chooseFinalBattleLore/
// resolveFinalBattleAttackRoll) — this line doesn't move anything further
// (notably, it does NOT touch the player's Lore deck, unlike an earlier
// draft of this rule). "Choose 1 Lore card from your discard pile and
// Attune it without paying its cost." Applies after every combat regardless
// of win/loss (optional — pass `null` to skip); mirrors attuneLoreCard's
// fill-or-replace logic for the 3 slots.
export function resolveDivineReclamation(
  state: GameState,
  choice: { discardIndex: number; replaceIndex?: number } | null,
  rng: () => number = Math.random,
): GameState {
  const resolution = state.pendingFinalBattleOutcome;
  if (state.phase !== "finalBattle" || !resolution || resolution.stage !== "divineReclamation") {
    throw new Error("There is no Divine Reclamation to resolve right now.");
  }
  const player = state.players[resolution.playerId];
  let updatedPlayer = player;
  const log = [...state.log];

  if (choice) {
    const card = player.loreDiscard[choice.discardIndex];
    if (!card) throw new Error("Invalid Lore discard position.");
    let loreDiscard = player.loreDiscard.filter((_, i) => i !== choice.discardIndex);
    let attunedLore: LoreCard[];
    if (player.attunedLore.length < 3) {
      attunedLore = [...player.attunedLore, card];
    } else {
      if (choice.replaceIndex === undefined || choice.replaceIndex < 0 || choice.replaceIndex >= 3) {
        throw new Error("Choose which of your 3 Attuned Lore cards to replace.");
      }
      const previous = player.attunedLore[choice.replaceIndex];
      attunedLore = player.attunedLore.map((c, i) => (i === choice.replaceIndex ? card : c));
      loreDiscard = [...loreDiscard, previous];
    }
    updatedPlayer = { ...player, attunedLore, loreDiscard };
    log.push(`${player.character.name} is blessed by ${player.character.god} — Divine Reclamation Attunes ${card.name} for free.`);
  }

  const nextState: GameState = { ...state, players: { ...state.players, [resolution.playerId]: updatedPlayer }, log };

  if (resolution.outcome === "win") {
    return { ...nextState, pendingFinalBattleOutcome: { ...resolution, stage: "pressTheAttack" } };
  }
  return advanceToNextFinalBattleCombatant(nextState, resolution, rng);
}

// "After winning combat, you may remove 1 Lore card from the game to
// immediately attack The Rot again, returning to Step 1. You may not remove
// your last Lore card this way." Pass `null` to decline.
//
// The card removed here always comes from loreDiscard, not attunedLore: by
// this stage, Divine Reclamation has left the player with (at most) 1
// Attuned Lore card — the very card the next combat's "Use Lore" step needs
// (chooseFinalBattleLore throws if attunedLore is empty). Removing from
// discard instead lets this ability pay for another attack out of the
// player's broader Lore collection without disarming the attack it's paying
// for. "Your last Lore card" is checked across both piles combined, since
// discard is where a spare would actually be sitting.
export function resolvePressTheAttack(
  state: GameState,
  removeDiscardIndex: number | null,
  rng: () => number = Math.random,
): GameState {
  const resolution = state.pendingFinalBattleOutcome;
  if (state.phase !== "finalBattle" || !resolution || resolution.stage !== "pressTheAttack") {
    throw new Error("There is no Press the Attack decision right now.");
  }
  const player = state.players[resolution.playerId];

  if (removeDiscardIndex === null) {
    return advanceToNextFinalBattleCombatant(state, resolution, rng);
  }

  if (player.attunedLore.length === 0) {
    throw new Error(`${player.character.name} has no Attuned Lore left to fight with — cannot Press the Attack.`);
  }
  const loreCard = player.loreDiscard[removeDiscardIndex];
  if (!loreCard) throw new Error("Invalid Lore card selection.");
  if (player.attunedLore.length + player.loreDiscard.length <= 1) {
    throw new Error("Cannot remove your last Lore card to Press the Attack.");
  }

  const updatedPlayer: EnginePlayer = {
    ...player,
    loreDiscard: player.loreDiscard.filter((_, i) => i !== removeDiscardIndex),
  };
  // The just-fought Rot cards already went to this player's own area via
  // Trophy at combat resolution — they don't return to state.rotDiscard.
  const stateWithSacrifice: GameState = { ...state, players: { ...state.players, [resolution.playerId]: updatedPlayer } };
  const { cards, deck, discard, log } = drawTwoFinalBattleCombatCards(state.rotDeck, state.rotDiscard, rng);
  if (!cards) {
    return finalBattleWinByExhaustion(stateWithSacrifice, resolution.playerId, deck, discard, [
      `${player.character.name} removes ${loreCard.name} from the game to Press the Attack.`,
      ...log,
    ]);
  }

  return {
    ...stateWithSacrifice,
    rotDeck: deck,
    rotDiscard: discard,
    pendingFinalBattleOutcome: null,
    pendingFinalBattleCombat: { playerId: resolution.playerId, rotCards: cards },
    log: [
      ...state.log,
      `${player.character.name} removes ${loreCard.name} from the game to Press the Attack.`,
      ...log,
      `${player.character.name} presses the attack — 2 new Rot cards are revealed: ${cards[0].name}, ${cards[1].name}.`,
    ],
  };
}

// "The next player clockwise who has not been defeated and has at least 1
// Lore card Attuned begins a new combat." The just-fought Rot cards already
// went to the previous combatant's own player area via Trophy at combat
// resolution, so they don't return to state.rotDiscard here. If a full
// clockwise scan finds no one able to fight, that's not a case the
// rulebook's two stated endings (Rot defeated / all players defeated) name
// directly, but it's functionally the same dead end — treated as a Rot win.
function advanceToNextFinalBattleCombatant(
  state: GameState,
  resolution: PendingFinalBattleOutcome,
  rng: () => number,
): GameState {
  const clearedState: GameState = { ...state, pendingFinalBattleOutcome: null };

  const fromIndex = state.playerOrder.indexOf(resolution.playerId);
  let nextPlayerId: string | null = null;
  for (let step = 1; step <= state.playerOrder.length; step++) {
    const idx = (fromIndex + step) % state.playerOrder.length;
    const candidateId = state.playerOrder[idx];
    const candidate = state.players[candidateId];
    if (!state.finalBattleDefeatedPlayerIds.includes(candidateId) && candidate.attunedLore.length >= 1) {
      nextPlayerId = candidateId;
      break;
    }
  }

  if (!nextPlayerId) {
    const nextState: GameState = {
      ...clearedState,
      pendingFinalBattleCombat: null,
      phase: "gameOver",
      log: [...clearedState.log, "No Character remains able to fight The Rot — The Rot wins the game."],
    };
    return { ...nextState, finalRanking: computeFinalRanking(nextState, null) };
  }

  const { cards, deck, discard, log } = drawTwoFinalBattleCombatCards(clearedState.rotDeck, clearedState.rotDiscard, rng);
  if (!cards) {
    return finalBattleWinByExhaustion(clearedState, nextPlayerId, deck, discard, log);
  }

  return {
    ...clearedState,
    rotDeck: deck,
    rotDiscard: discard,
    pendingFinalBattleCombat: { playerId: nextPlayerId, rotCards: cards },
    log: [
      ...clearedState.log,
      ...log,
      `${state.players[nextPlayerId].character.name} steps up to fight The Rot: ${cards[0].name}, ${cards[1].name} revealed.`,
    ],
  };
}

// Rulebook, "Final Ranking": computed once whenever the game reaches
// "gameOver". `winnerId` is the player who removed the last Rot Artifact, or
// null for a Rot win (the rulebook only describes ranking for a win — a Rot
// win just ranks everyone by the same Gold-value/Lore-count rule, with no
// `isWinner` entry). A fully defeated Final Battle combatant's board is
// empty, so their Gold value is naturally 0 — no separate "defeated" case
// needed, the sort already puts them last.
function computeFinalRanking(state: GameState, winnerId: string | null): FinalRankingEntry[] {
  const attunedGoldValue = (player: EnginePlayer): number =>
    (player.equippedWeapon?.goldCost ?? 0) +
    (player.equippedArmor?.goldCost ?? 0) +
    (player.equippedImplement?.goldCost ?? 0) +
    player.equippedRuneStones.reduce((sum, c) => sum + c.goldCost, 0) +
    player.attunedLore.reduce((sum, c) => sum + c.goldCost, 0);

  const others = state.playerOrder.filter((id) => id !== winnerId);
  const sorted = [...others].sort((a, b) => {
    const goldDiff = attunedGoldValue(state.players[b]) - attunedGoldValue(state.players[a]);
    if (goldDiff !== 0) return goldDiff;
    return state.players[b].loreDeck.length - state.players[a].loreDeck.length;
  });

  const entries: FinalRankingEntry[] = [];
  if (winnerId) {
    const player = state.players[winnerId];
    entries.push({
      playerId: winnerId,
      rank: 1,
      attunedGoldValue: attunedGoldValue(player),
      loreDeckCount: player.loreDeck.length,
      isWinner: true,
    });
  }

  const startRank = winnerId ? 2 : 1;
  sorted.forEach((id, i) => {
    const player = state.players[id];
    const goldValue = attunedGoldValue(player);
    const loreDeckCount = player.loreDeck.length;
    let rank = startRank + i;
    if (i > 0) {
      const prev = entries[entries.length - 1];
      if (prev.attunedGoldValue === goldValue && prev.loreDeckCount === loreDeckCount) {
        rank = prev.rank;
      }
    }
    entries.push({ playerId: id, rank, attunedGoldValue: goldValue, loreDeckCount, isWinner: false });
  });

  return entries;
}

// --- Cleanup Phase -----------------------------------------------------------

// Runs the Cleanup Phase sequence from docs/rules.md, in 3 groups: The Rot
// (steps 1-5, run first — can end the game outright before Arena combat or
// anything else runs), The Game Board (steps 6-9 — step 6, Arena combat, can
// pause the game in the "arenaReward" phase if the winner needs to make a
// real choice, see resolveArenaCombatAndReward/resolveArenaReward), and
// Player Boards (steps 10-13 — step 11's Victory Condition check can pause it
// in "finalBattleOffer", and initiating branches into "finalBattle", see
// offerFinalBattle/initiateFinalBattle). Card-use tokens (step 10) aren't a
// system this prototype has yet, so that step is logged as pending rather
// than silently skipped.
export function runCleanupPhase(state: GameState, rng: () => number = Math.random): GameState {
  if (state.phase !== "cleanup") {
    throw new Error("Cleanup can only run during the Cleanup Phase.");
  }
  const afterRot = applyRotCleanupSteps({ ...state, log: [...state.log, "— Cleanup Phase —"] }, rng);
  if (afterRot.phase === "gameOver") {
    return afterRot;
  }
  const afterArena = resolveArenaCombatAndReward(afterRot, rng);
  if (afterArena.phase === "arenaReward") {
    return afterArena;
  }
  return finishCleanupPhaseAfterArena(afterArena, rng);
}

// Steps 1-5 ("The Rot"): a guaranteed +1 to the Rot Counter every round,
// then (new) a one-time Artifact equip at the 3/6/9 milestones, then
// converting complete sets of Withering Tokens (one set = player count)
// into further +1s each — any remainder short of a full set stays on The
// Rot rather than being wiped, and accumulates with the fresh tokens step 5
// places. Example (docs/rules.md): a 3-player game with 7 Withering Tokens
// converts 2 sets (+2 Rot Counter, 1 token left over), then step 5 adds 3
// more for 4 total heading into next round.
function applyRotCleanupSteps(state: GameState, rng: () => number): GameState {
  const log = [...state.log];
  const playerCount = state.playerOrder.length;

  // 1. Victory check — using the Rot Counter as it stood at the end of the
  // *previous* Cleanup Phase, before this round's own increase/conversion
  // below. This means the counter can run past 13 internally during steps
  // 2-4 without ending the game immediately — that's only caught here, at
  // the start of the *next* Cleanup Phase — giving players one more full
  // round after crossing the threshold before the game actually ends.
  if (state.rotCounter >= 13) {
    log.push("The Rot Counter has reached 13. The Rot has consumed the players — The Rot wins the game.");
    const nextState: GameState = { ...state, locationTokens: {}, phase: "gameOver", log };
    return { ...nextState, finalRanking: computeFinalRanking(nextState, null) };
  }

  // 2. Increase the Rot Counter by 1.
  let rotCounter = state.rotCounter + 1;
  log.push(`The Rot Counter increases by 1 (now ${rotCounter}).`);

  // 3. "At Rot Counter 3, 6, and 9, place the highest Gold Cost Artifact
  // card from the Market Row on The Rot Character Mat." Checked with >=
  // rather than exact equality, and tracked per-milestone in
  // rotGearMilestonesReached, so a milestone already passed by an earlier
  // round's step 4 conversion (which can jump the counter by more than 1)
  // still fires exactly once instead of being silently skipped. Reuses
  // equipRotWithHighestGoldArtifact (the same "highest-Gold-Cost Artifact
  // from the Artifact Row" action a lost Valley Combat triggers), which
  // already handles the empty-Row and 9-Artifact-cap cases and now also
  // breaks Gold Cost ties at random, per this rule's own text.
  let midState: GameState = { ...state, rotCounter, log };
  const rotGearMilestonesReached = [...state.rotGearMilestonesReached];
  for (const milestone of [3, 6, 9]) {
    if (rotCounter >= milestone && !rotGearMilestonesReached.includes(milestone)) {
      rotGearMilestonesReached.push(milestone);
      midState = equipRotWithHighestGoldArtifact(
        { ...midState, log: [...midState.log, `The Rot Counter has reached ${milestone} — The Rot claims an Artifact from the Market Row.`] },
        rng,
      );
    }
  }
  midState = { ...midState, rotGearMilestonesReached };

  // 4. Remove 1 Withering Token per player from The Rot to increase the Rot
  // Counter by 1. Repeat as able.
  let witheringTokens = midState.witheringTokens;
  let setsConverted = 0;
  while (witheringTokens >= playerCount) {
    witheringTokens -= playerCount;
    rotCounter += 1;
    setsConverted += 1;
  }
  let finalLog = midState.log;
  if (setsConverted > 0) {
    finalLog = [
      ...finalLog,
      `${setsConverted} set(s) of ${playerCount} Withering Token(s) removed from The Rot; Rot Counter increases to ${rotCounter}` +
        (witheringTokens > 0 ? ` (${witheringTokens} Withering Token(s) left over).` : "."),
    ];
  }

  // 5. Place 1 Withering Token per player on The Rot (added on top of any
  // leftover from step 4, not a reset).
  witheringTokens += playerCount;
  finalLog = [...finalLog, `${playerCount} Withering Token(s) placed on The Rot (now ${witheringTokens}).`];

  return { ...midState, rotCounter, witheringTokens, log: finalLog };
}

// Steps 6-10 ("The Game Board" cont'd + "Player Boards" through the Final
// Battle check), run either directly from runCleanupPhase or after
// resolveArenaReward answers the one choice step 5 can raise.
function finishCleanupPhaseAfterArena(state: GameState, rng: () => number = Math.random): GameState {
  const log = [...state.log];

  // 6. Return all Action Tokens to their players.
  const tokenCount = actionTokensForPlayerCount(state.playerOrder.length);
  const players: GameState["players"] = {};
  for (const id of state.playerOrder) {
    players[id] = { ...state.players[id], actionTokensRemaining: tokenCount };
  }
  log.push("Action Tokens returned to all players.");

  // 7. Place 1 Gold on The Exchange.
  const exchangeGold = state.exchangeGold + 1;
  log.push(`1 Gold placed on The Exchange (now ${exchangeGold}).`);

  // 8. Discard all face-up cards in the Artifact Row and Lore Row into the
  // shared discard piles, then deal three new cards to each Row (reshuffling
  // that discard pile in if the shared deck runs short — this is the single
  // biggest source of shared-deck churn, since it happens every round
  // regardless of what players bought).
  const artifactRowDiscarded = state.artifactRow.filter((c): c is ArtifactCard => c !== null);
  const artifactDraw = drawFromSharedDeck(state.artifactDeck, [...state.artifactDiscard, ...artifactRowDiscarded], 3, rng);
  const artifactDeck = artifactDraw.deck;
  const artifactDiscard = artifactDraw.discard;
  const artifactRow: GameState["artifactRow"] = [artifactDraw.drawn[0] ?? null, artifactDraw.drawn[1] ?? null, artifactDraw.drawn[2] ?? null];
  log.push(
    `The Artifact Row is discarded (${artifactRowDiscarded.length} card(s)) and refilled` +
      (artifactRow.every((c) => c === null) ? " — the Artifact Deck and discard pile are both empty." : "."),
  );

  const loreRowDiscarded = state.loreRow.filter((c): c is LoreCard => c !== null);
  const loreDraw = drawFromSharedDeck(state.loreDeck, [...state.loreDiscard, ...loreRowDiscarded], 3, rng);
  const loreDeck = loreDraw.deck;
  const loreDiscard = loreDraw.discard;
  const loreRow: GameState["loreRow"] = [loreDraw.drawn[0] ?? null, loreDraw.drawn[1] ?? null, loreDraw.drawn[2] ?? null];
  log.push(
    `The Lore Row is discarded (${loreRowDiscarded.length} card(s)) and refilled` +
      (loreRow.every((c) => c === null) ? " — the Lore Deck and discard pile are both empty." : "."),
  );

  // 9. Card-use tokens.
  log.push("Removing card-use tokens isn't implemented yet — no changes made.");

  // The whole Row is redealt regardless of what was claimed — any Deep
  // Waters claim on it is now stale.
  const beforeOffer: GameState = {
    ...state,
    players,
    exchangeGold,
    artifactDeck,
    artifactDiscard,
    artifactRow,
    loreDeck,
    loreDiscard,
    loreRow,
    artifactRowClaim: null,
    log,
  };

  // 10. Victory Condition check / Final Battle trigger.
  const afterOffer = offerFinalBattle(beforeOffer, 0);
  if (afterOffer.phase === "finalBattleOffer") {
    return afterOffer;
  }
  return finishCleanupPhaseAfterVictoryCheck(afterOffer);
}

// Steps 11-12 ("Player Boards" cont'd) — run once no player initiates The
// Final Battle (or after everyone eligible has declined).
function finishCleanupPhaseAfterVictoryCheck(state: GameState): GameState {
  const log = [...state.log];

  // 11. Pass the First Player marker clockwise.
  const firstPlayerIndex = (state.firstPlayerIndex + 1) % state.playerOrder.length;
  log.push(`The First Player marker passes to ${state.players[state.playerOrder[firstPlayerIndex]].character.name}.`);

  // 12. Begin a new round.
  const round = state.round + 1;
  log.push(`Round ${round} begins.`);

  return withDeepWatersOffer(
    {
      ...state,
      round,
      locationTokens: {},
      firstPlayerIndex,
      activePlayerIndex: firstPlayerIndex,
      phase: "action",
      log,
    },
    firstPlayerIndex,
  );
}
