// Copyright © 2026 Steve Empey
import type {
  ArtifactCard,
  Character,
  LocationId,
  LoreCard,
  RotCombatCard,
  RotScenarioCard,
} from "../types/game";

export interface ManaPools {
  artifact: number;
  lore: number;
}

export interface EnginePlayer {
  id: string;
  character: Character;
  actionTokensRemaining: number;
  gold: number;
  manaPools: ManaPools;
  // Withering Tokens sitting IN a Mana Pool (Valley/Scenario-driven). Distinct
  // from GameState.witheringTokens, the count waiting on the shared Rot board.
  // "Cleansing" (spending from a pool with a token here requires clearing it
  // first) is enforced — see assertPoolNotTainted/cleansePool in turnEngine.ts.
  witheringTokens: ManaPools;
  artifactDeck: ArtifactCard[]; // personal deck, drawn from at The Artificer
  artifactDiscard: ArtifactCard[];
  loreDeck: LoreCard[]; // personal deck, drawn from at The Ancient Shrine
  loreDiscard: LoreCard[];
  equippedWeapon?: ArtifactCard;
  equippedArmor?: ArtifactCard;
  equippedImplement?: ArtifactCard;
  equippedRuneStones: ArtifactCard[]; // up to 3
  attunedLore: LoreCard[]; // up to 3
  // Won Combat cards + Embraced Scenario cards, kept for a Victory Condition
  // count and to spend at The Arena (both not yet implemented). The two
  // kinds must stay distinguishable (see RotCard) — the UI shows them as
  // separate quantities rather than the individual cards.
  rotCardsInPlayerArea: RotCard[];
  // Only the 8 core Locations track Faction (Warriors/Scholars Guild don't).
  factionTrack: Partial<Record<LocationId, number>>;
}

// "arenaReward" sits between "cleanup" and the next round's "action": Cleanup
// Phase step 1 (Arena combat) can reveal a real choice — which Arena Reward
// card to keep — that needs player input, so runCleanupPhase pauses there
// instead of finishing the rest of Cleanup in one shot. See
// resolveArenaReward. "finalBattleOffer" and "finalBattle" are Cleanup step
// 6's own pause/branch — see PendingFinalBattleOffer and initiateFinalBattle.
export type GamePhase = "action" | "cleanup" | "arenaReward" | "finalBattleOffer" | "finalBattle" | "gameOver";

// Set while the active player has placed a token on a Location that needs
// choices resolved before the turn can advance.
export interface PendingAction {
  playerId: string;
  locationId: LocationId;
  usedRotPeek?: boolean; // Ancient Shrine Faction 1/2 perk, once per visit
  usedArtifactPeek?: boolean; // Artificer Faction 2 perk, once per visit
  arenaFeePaid?: boolean; // Arena: entry fee (1 Rot card) paid this visit
  usedArenaPeek?: boolean; // Arena Faction 1 perk, once per visit
  wellspringWitheringRemoved?: number; // Wellspring Faction 3 perk, up to 2 per visit
}

export interface PendingWellspringRoll {
  dice: [number, number] | null; // null when the Faction-2 flat-7 option was used
  total: number;
  usedFlatSeven: boolean;
  rerolled: boolean;
}

// The card currently revealed at The Artificer/Ancient Shrine, awaiting an
// Attune-or-discard decision.
export type PendingReveal = { kind: "artifact"; card: ArtifactCard } | { kind: "lore"; card: LoreCard };

// A card from the shared Rot Deck — Combat and Scenario cards have different
// shapes, so this tags which one a given slot holds.
export type RotCard = { kind: "combat"; card: RotCombatCard } | { kind: "scenario"; card: RotScenarioCard };

// The card just revealed at The Valley, awaiting a Lore choice (Combat) or an
// Embrace/Resist choice (Scenario).
export type PendingValleyEncounter = RotCard;

// Valley Faction 3: "Whenever you place an Action token on The Valley, you
// may reveal the top card of The Rot deck. You may then choose to place it
// back on top of The Rot deck or discard it." Happens before the normal,
// mandatory reveal — "offered" means the player hasn't decided whether to
// peek yet; "peeked" means they have, and are deciding keep-or-discard.
export type PendingValleyScry = { stage: "offered" } | { stage: "peeked"; card: RotCard };

// Once a Combat's dice are rolled (or a Scenario's Embrace/Resist is chosen),
// the outcome is known but applying its effect may still need a choice from
// the player (which Mana Pool, how to split Mana) — resolved by
// finalizeValleyOutcome.
export interface PendingValleyOutcome {
  card: RotCard;
  outcome: "win" | "loss" | "embrace" | "resist";
  effectText: string | null; // null only for "resist" (a fixed rule, not card text)
  dice: [number, number] | null; // set for Combat only, when a Lore card was used
  loreCardName: string | null; // set for Combat only, when a Lore card was used
}

// One-time Faction benefits that need a player choice, queued the instant
// the relevant track ticks up to that level (see applyFactionMilestone in
// turnEngine.ts) — distinct from the Location's own per-visit action, and
// resolved before that action can be taken. A queue (not a single value)
// because resolving an exchangeFactionBump can itself trigger a new entry
// (e.g. bumping Market to Faction 1 queues a discardRefillRow).
export type PendingFactionPerk =
  | { kind: "discardRefillRow"; playerId: string; locationId: "market" | "library" }
  | { kind: "rotToMarketRow"; playerId: string }
  | { kind: "exchangeFactionBump"; playerId: string }
  | { kind: "guildFreeCard"; playerId: string; locationId: "warriorsGuild" | "scholarsGuild" };

export type WhisperedDeckChoice = "ownArtifact" | "ownLore" | "sharedArtifact" | "sharedLore";

// Arena Faction 1: "You may look at the top two cards of any deck and place
// the cards on the top or bottom as desired." Reuses the same 4-deck choice
// as Whispered Secrets. Unlike a simple reorder, each card's destination
// (top vs bottom) is independent — see resolveArenaPeek.
export interface PendingArenaPeek {
  deck: WhisperedDeckChoice;
  cards: (ArtifactCard | LoreCard)[];
}

// Arena Reward: the winner of Arena combat reveals the top card of each
// shared deck and picks one for free (the other goes to the bottom of its
// deck) — unless Faction 3, which takes both automatically with no pause
// (see resolveArenaCombatAndReward in turnEngine.ts).
export interface PendingArenaReward {
  playerId: string;
  artifactCard: ArtifactCard | null;
  loreCard: LoreCard | null;
}

// Cleanup Phase step 6: "Beginning with the First Player and proceeding
// clockwise, any player who has met their Character's Victory Condition may
// initiate The Final Battle." `scanIndex` is this offer's position in that
// clockwise scan (relative to firstPlayerIndex) — declining resumes the scan
// at scanIndex + 1, so the game doesn't need to re-derive where it left off.
export interface PendingFinalBattleOffer {
  playerId: string;
  scanIndex: number;
}

// "The first player to initiate The Final Battle receives a one-time boon
// from the gods. Before their first combat begins, that player may choose 1
// Artifact or Lore card from their Deck or Discard Pile and Attune it
// without paying its Mana cost." Set by initiateFinalBattle only the first
// time it's ever called in a game (see GameState.finalBattleBoonClaimed);
// blocks chooseFinalBattleLore until resolved/declined.
export interface PendingFinalBattleBoon {
  playerId: string;
}

// A single "card on your Character board" — the slot a Final Battle loss (or
// Press the Attack) removes from, permanently and outside any discard pile.
export type CharacterBoardSlotRef =
  | { kind: "weapon" }
  | { kind: "armor" }
  | { kind: "implement" }
  | { kind: "runeStone"; index: number }
  | { kind: "lore"; index: number };

// One Final Battle combat: 2 Combat cards revealed and combined into The
// Rot's base Attack (docs/rules.md, "The Final Battle" step 1-2), awaiting
// the current combatant's Lore choice (step 3.1-3.2).
export interface PendingFinalBattleCombat {
  playerId: string;
  rotCards: [RotCombatCard, RotCombatCard];
}

// Once Lore is chosen and the dice are rolled (step 3.2-3.4), the win/loss
// outcome is known but applying it still needs player choices, taken in
// order: which card to remove (win: from The Rot Character Mat, loss: from
// the player's own board — skipped if the board is already empty after the
// Lore discard), then the always-available Divine Reclamation (step 3.5),
// then — only after a win — Press the Attack (step 3.6). A loss (after
// Divine Reclamation) or a declined Press the Attack both move to the next
// combatant (step 3.7); see advanceToNextFinalBattleCombatant.
export interface PendingFinalBattleOutcome {
  playerId: string;
  rotCards: [RotCombatCard, RotCombatCard];
  loreCardNames: string[]; // every Attuned Lore card used (and discarded) in this combat
  dice: [number, number];
  playerAttack: number;
  rotAttack: number;
  outcome: "win" | "loss";
  stage: "removeCard" | "divineReclamation" | "pressTheAttack";
}

// Rune of Fracture: "Discard after rolling your Attack dice to reroll 1 die.
// You must use the new result." Opens this pause between "roll" and
// "resolve" only when the combatant holds the stone — everyone else's combat
// still resolves in one call (chooseValleyLore/chooseFinalBattleLore), as
// before. Kept alongside the still-set pendingValleyEncounter/
// pendingFinalBattleCombat rather than duplicating their fields — see
// resolveValleyAttackRoll/resolveFinalBattleAttackRoll in turnEngine.ts.
export interface PendingValleyAttackRoll {
  loreCardName: string;
  loreAttack: number;
  artifactAttack: number;
  powerBonus: number;
  // Rune of Prophecy's +20, already locked in (and the card already removed
  // from the game) by the time chooseValleyLore paused here for Rune of
  // Fracture — see chooseValleyLore's `prophecyIndex` parameter.
  prophecyBonus: number;
  dice: [number, number];
  rerolled: boolean;
}

export interface PendingFinalBattleAttackRoll {
  loreCardNames: string[]; // every Attuned Lore card used in this combat
  loreValue: number; // sum of each card's best-of-2-creature-type value
  gearAttack: number;
  powerBonus: number;
  dice: [number, number];
  rerolled: boolean;
}

// Cira's power, Foresight: "When revealing a Rot card, look at the top 2 Rot
// cards, choose 1 to encounter, and return the other to the top of The Rot
// deck." Replaces the normal single-card Valley reveal for her specifically
// — see revealValleyCard/chooseForesightEncounter in turnEngine.ts.
export type PendingForesightChoice = [RotCard, RotCard];

// Kael's power, Deep Waters: "At the start of your turn, place one of your
// mana tokens on a face-up Artifact card. That card costs you 1 less Gold
// and cannot be purchased by other players." Not tied to any Location, so
// it's offered (and gates placeActionToken) the instant it becomes Kael's
// turn — see completeTurn/createGame and resolveDeepWatersClaim.
export interface PendingDeepWatersClaim {
  playerId: string;
}

// The Artifact Row slot Kael's Deep Waters currently has a Mana Token on.
// Replaced (not stacked) by his next claim, and cleared whenever the Row is
// discarded/refilled at Cleanup Phase.
export interface ArtifactRowClaim {
  rowIndex: number;
  playerId: string;
}

// Intermediate state for the 2 complex Embrace effects that reveal hidden
// cards before the player can choose what to do with them (Forbidden
// Knowledge, Whispered Secrets). Corrupted Greed and Tainted Trade don't need
// this — everything relevant to them is already face-up.
export type PendingEmbraceStep =
  | { kind: "forbiddenKnowledge"; revealed: LoreCard[] }
  | { kind: "whisperedSecrets"; deck: WhisperedDeckChoice; revealed: (ArtifactCard | LoreCard)[] };

// Snapshot captured the instant a Location visit begins — after
// placeActionToken's automatic on-arrival effects (Faction gain, Valley's
// reveal, Exchange's gold claim, any queued Faction perk) but before the
// player has taken any further action there. Lets cancelLocationVisit fully
// undo the visit — refunding the Action Token and reverting every automatic
// effect at once, by rolling back to `preVisitState` wholesale rather than
// algebraically reversing each one — as long as nothing else has happened
// since. `arrivedFingerprint` is a snapshot of that "just arrived" state
// (see stateFingerprint in turnEngine.ts); if the current state no longer
// matches it, some further choice was made and the visit can no longer be
// canceled (see canCancelLocationVisit).
export interface PendingActionCancel {
  preVisitState: GameState;
  arrivedFingerprint: string;
}

// Fires when purchasing one of the 13 Implements with an "On Purchase:"
// clause added in the 2026-09 sheet update (src/data/artifacts.ts) — see
// purchaseFromMarket in turnEngine.ts. The "reveal until a Rune Stone"
// variant is fully automatic (no choice), so this only ever pauses for the
// "Attune 1 free Lore card from your discard pile" variant, which needs a
// real choice (which card, and which of 3 Attuned to replace if at cap).
export interface PendingArtifactOnPurchase {
  playerId: string;
}

// Rulebook: "Rune Stones have abilities that require them to be discarded...
// You may choose to discard a Rune Stone to resolve its ability when
// permitted by the card." Most of the 36 Rune Stones (src/data/runeStones.ts)
// are usable any time on the player's own turn and resolve through these
// pending-choice shapes when they reveal cards the player must then pick
// from (a plain Mana split, discard-pile pick, or Faction choice is instead a
// single direct function call — see the "Rune Stones" section of
// turnEngine.ts). A handful are contextual to a specific Location/moment
// (Barter, Communion, Defiance, Fortune, Plenty, Preservation, Resonance,
// Vengeance) and are threaded as optional params into that action's existing
// function instead of using a pending choice at all. `index` is always the
// discarding stone's position in `equippedRuneStones`, kept so the resolver
// can remove the right slot and name it in the log even when several stones
// share a `kind`.
export type PendingRuneStoneChoice =
  // Excavation/Prospecting/Study/Discovery: reveal N cards from a shared
  // deck, choose 1 to replace a Row card (Discovery: or buy it instead).
  | { kind: "revealForRow"; index: number; deck: "artifact" | "lore"; revealed: (ArtifactCard | LoreCard)[]; canBuy: boolean }
  // Foresight: look at the top 3 of one of your own personal decks, return
  // them to the top in any order (no discard).
  | { kind: "reorderPersonalDeck"; index: number; deck: "artifact" | "lore"; revealed: (ArtifactCard | LoreCard)[] }
  // Insight: replaces the Artificer/Ancient Shrine reveal — look at the top 3
  // of your own personal deck, choose 1 to become the revealed card, return
  // the other 2 to the bottom in any order.
  | { kind: "insightChoice"; index: number; deck: "artifact" | "lore"; revealed: (ArtifactCard | LoreCard)[] }
  // Seeking: replaces the Artificer/Ancient Shrine reveal — search your own
  // personal deck for any card, shuffle the rest, reveal the chosen card.
  | { kind: "seekChoice"; index: number; deck: "artifact" | "lore"; cards: (ArtifactCard | LoreCard)[] }
  // Whispers: look at the top card of the shared Rot deck, may discard it.
  | { kind: "whispersPeek"; index: number; card: RotCard };

// Premonition: "Discard when revealing a Rot card. Look at the top 3 Rot
// cards, choose 1 to encounter, and discard the rest." Offered as an
// alternative pre-reveal pause at Valley arrival, alongside (and independent
// of) the Faction 3 Scry — see placeActionToken/discardPremonition.
export type PendingValleyPremonition = { runeStoneIndex: number; revealed: RotCard[] };

// Rulebook, "Final Ranking": "The player with the highest Gold count wins."
// Each player's end-of-game Gold (their running total, `baseGold`) is topped
// up with Gold Awards (`goldAwards`) to get `finalGold`, and all players —
// not just whoever dealt the killing blow — are ranked by that. Ties break
// on total Lore cards (Deck + Discard + Attuned), then total Artifact cards
// (Deck + Discard + Attuned); still-tied players share a rank, and the next
// distinct rank skips ahead by the tied group's size (standard competition
// ranking, e.g. 1, 2, 2, 4). Computed once, whenever the game reaches
// "gameOver" (Rot defeated or Rot wins — a Rot win just means no player's
// goldAwards.dealtKillingBlow is true).
export interface FinalRankingGoldAwards {
  initiatedFinalBattle: boolean; // 10 Gold
  dealtKillingBlow: boolean; // 10 Gold
  warriorsGuildUnlocked: boolean; // 5 Gold
  scholarsGuildUnlocked: boolean; // 5 Gold
  attunedArtifactCount: number; // 1 Gold each
  manaBonus: number; // 1 Gold per 3 Mana across both Pools
}

export interface FinalRankingEntry {
  playerId: string;
  rank: number;
  baseGold: number;
  finalGold: number;
  goldAwards: FinalRankingGoldAwards;
  totalLoreCards: number;
  totalArtifactCards: number;
  // Dealt the killing blow to The Rot — kept distinct from `rank`/`finalGold`
  // since the Gold Award for it doesn't guarantee the highest final Gold.
  isWinner: boolean;
}

export interface GameState {
  round: number;
  playerOrder: string[]; // seating order, clockwise
  firstPlayerIndex: number; // index into playerOrder
  activePlayerIndex: number; // index into playerOrder — whose turn it is
  players: Record<string, EnginePlayer>;
  locationTokens: Partial<Record<LocationId, string[]>>; // player ids placed this round
  pendingAction: PendingAction | null;
  pendingWellspringRoll: PendingWellspringRoll | null;
  pendingReveal: PendingReveal | null;
  pendingRotPeek: RotCard[] | null; // Ancient Shrine's "reveal top 3" perk, awaiting keep/discard choices
  pendingArtifactPeek: ArtifactCard[] | null; // Artificer's "look at top 2" perk, awaiting reorder
  pendingFactionPerks: PendingFactionPerk[];
  pendingArenaPeek: PendingArenaPeek | null;
  pendingArenaReward: PendingArenaReward | null;
  pendingFinalBattleOffer: PendingFinalBattleOffer | null;
  pendingFinalBattleBoon: PendingFinalBattleBoon | null;
  pendingFinalBattleCombat: PendingFinalBattleCombat | null;
  pendingFinalBattleOutcome: PendingFinalBattleOutcome | null;
  // Whether any player has ever been offered the "first initiator" boon —
  // set true the first time initiateFinalBattle runs, regardless of whether
  // that player had anything to Attune or chose to Decline. Never resets.
  finalBattleBoonClaimed: boolean;
  // Who actually started The Final Battle — set once, by initiateFinalBattle
  // (there is exactly one initiator per game). Worth its own 10-Gold Final
  // Ranking award, distinct from the first-initiator boon above.
  finalBattleInitiatorId: string | null;
  pendingValleyScry: PendingValleyScry | null;
  pendingValleyEncounter: PendingValleyEncounter | null;
  pendingValleyOutcome: PendingValleyOutcome | null;
  pendingForesightChoice: PendingForesightChoice | null; // Cira's power
  pendingEmbraceStep: PendingEmbraceStep | null;
  pendingDeepWatersClaim: PendingDeepWatersClaim | null; // Kael's power
  artifactRowClaim: ArtifactRowClaim | null; // Kael's power
  pendingActionCancel: PendingActionCancel | null;
  pendingArtifactOnPurchase: PendingArtifactOnPurchase | null;
  finalRanking: FinalRankingEntry[] | null; // set once, when phase becomes "gameOver"
  pendingRuneStoneChoice: PendingRuneStoneChoice | null;
  pendingValleyPremonition: PendingValleyPremonition | null;
  pendingValleyAttackRoll: PendingValleyAttackRoll | null; // Rune of Fracture
  pendingFinalBattleAttackRoll: PendingFinalBattleAttackRoll | null; // Rune of Fracture
  artifactDeck: ArtifactCard[]; // shared Market supply (shuffled draw pile)
  artifactDiscard: ArtifactCard[]; // shared Artifact discard pile, reshuffled into artifactDeck when depleted
  artifactRow: (ArtifactCard | null)[]; // 3 face-up slots
  loreDeck: LoreCard[]; // shared Library supply (shuffled draw pile)
  loreDiscard: LoreCard[]; // shared Lore discard pile, reshuffled into loreDeck when depleted
  loreRow: (LoreCard | null)[]; // 3 face-up slots
  rotDeck: RotCard[]; // shared Rot Deck (shuffled draw pile)
  rotDiscard: RotCard[]; // shared Rot discard pile, reshuffled into rotDeck when depleted
  rotArtifacts: ArtifactCard[]; // Artifacts equipped onto The Rot itself, up to 7 (add to its Attack)
  exchangeGold: number; // Gold sitting on The Exchange, claimed by the first visitor each round
  rotCounter: number;
  // Cleanup Phase, "The Rot" step 3: which of the Rot Counter 3/6/9
  // milestones have already equipped The Rot with an Artifact — checked
  // with >= rather than exact equality (see applyRotCleanupSteps), since
  // step 4's Withering-Token conversion can jump the counter past a
  // milestone in the same Cleanup Phase a later round's step 2 would
  // otherwise never land on exactly.
  rotGearMilestonesReached: number[];
  witheringTokens: number; // Withering Tokens waiting on the shared Rot board (see EnginePlayer for per-player tokens)
  // Final Battle, "If you have no cards remaining on your Character board,
  // you are defeated and take no further turns." Latched permanently the
  // instant a player's board first goes empty (see removeOwnBoardCard/
  // chooseFinalBattleLore's skipRemoval in turnEngine.ts) — checked instead
  // of live-deriving "board empty" wherever a "who can still fight" check
  // happens, since Divine Reclamation (which runs unconditionally after
  // every combat, win or loss) can otherwise hand a defeated player a free
  // Lore card and un-defeat them, letting one player who can never actually
  // be removed from the fight win by default.
  finalBattleDefeatedPlayerIds: string[];
  phase: GamePhase;
  log: string[];
}
