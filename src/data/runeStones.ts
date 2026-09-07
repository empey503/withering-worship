import type { ArtifactCard, RuneStoneCard } from "../types/game";

// Source: "WW Game" Drive folder, Withering Worship sheet, "Rune Stone" table.
// Re-pulled 2026-09-06: many Rune Stones' text/costs changed to add or
// rework a "remove Withering Tokens from The Rot / a location / a player's
// pool" clause (Cleansing, Communion, Community, Convergence, Corruption,
// Culling, Decay, Defiance, Preservation, Prophecy, Renewal, Sacrifice,
// Time, Vengeance, Whispers) — several of these (Convergence, Corruption,
// Decay, Sacrifice, Vengeance) are now ENTIRELY DIFFERENT abilities, not
// just reworded. IMPORTANT — these are flavor-text-and-cost updates only:
// the engine implements each Rune Stone's ability as its own hand-written
// function (discardConvergence, discardCorruption, discardDecay,
// discardSacrifice, discardVengeance, etc. in turnEngine.ts), not by
// parsing `description`, so the ~15 changed stones now show new printed
// text the engine doesn't actually perform yet — several reference
// "Withering Tokens on a Location," a game concept that doesn't exist in
// GameState at all currently (only per-player Mana Pool tokens and the
// shared Rot board's witheringTokens count do). Flagged to the user; not
// implemented here since it needs real design decisions, not just typing.
export const runeStones: RuneStoneCard[] = [
  { name: "Rune of Abundance", type: "Primal / Divine", attack: 1, description: "Discard to gain 5 Mana, distributed between your Mana Pools as you choose.", goldCost: 2, attunementCost: 1 },
  { name: "Rune of Barter", type: "Primal", attack: 1, description: "At The Exchange, discard this Rune Stone to gain 5 Gold.", goldCost: 2, attunementCost: 1 },
  { name: "Rune of Cleansing", type: "Divine / Primal", attack: 1, description: "Discard to remove up to 3 Withering Tokens from any combination of locations, including The Rot.", goldCost: 2, attunementCost: 1 },
  { name: "Rune of Communion", type: "Divine", attack: 2, description: "Discard when Attuning a Lore card to use Withering Tokens from any location to pay its Mana cost.", goldCost: 2, attunementCost: 1 },
  { name: "Rune of Community", type: "Corrupted", attack: 1, description: "Discard to increase Faction by 1 on any track and remove up to 2 Withering Tokens from The Rot. Gain persistent Faction benefits, but not one-time benefits from this increase.", goldCost: 3, attunementCost: 2 },
  { name: "Rune of Convergence", type: "Technology / Divine", attack: 2, description: "Discard to remove up to 5 Withering Tokens from a single location, including The Rot. Remove this card from the game.", goldCost: 3, attunementCost: 2 },
  { name: "Rune of Corruption", type: "Corrupted", attack: 2, description: "Discard to remove up to 2 Withering Tokens from The Rot and place them in any player's Artifact Mana Pool.", goldCost: 2, attunementCost: 1 },
  { name: "Rune of Culling", type: "Divine", attack: 2, description: "Discard to remove a card from either of your discard piles from the game, gain 1 Gold, and remove up to 2 Withering Tokens from The Rot.", goldCost: 2, attunementCost: 2 },
  { name: "Rune of Decay", type: "Corrupted / Primal", attack: 1, description: "Discard to remove up to 2 Withering Tokens from The Rot and place them on any one location.", goldCost: 1, attunementCost: 2 },
  { name: "Rune of Defiance", type: "Corrupted", attack: 2, description: "Discard when taking The Valley action to remove up to 2 additional Withering Tokens from The Rot.", goldCost: 2, attunementCost: 1 },
  { name: "Rune of Delving", type: "Primal / Corrupted", attack: 1, description: "Discard to reveal cards from the Artifact Deck until you reveal a card of a Type you choose. Place that card in the Artifact Row, replacing and discarding a card currently there. Discard the other revealed cards.", goldCost: 3, attunementCost: 2 },
  { name: "Rune of Discovery", type: "Technology", attack: 1, description: "Discard to reveal the top 3 cards of the Artifact Deck. You may purchase 1 revealed card by paying its Gold cost. Discard the remaining cards.", goldCost: 3, attunementCost: 2 },
  { name: "Rune of Echoes", type: "Technology / Divine", attack: 2, description: "Discard to Attune a Rune Stone from your discard pile.", goldCost: 3, attunementCost: 2 },
  { name: "Rune of Excavation", type: "Technology / Primal", attack: 1, description: "Discard to reveal the top 3 cards of the Artifact Deck. Choose 1 to replace a card in the Artifact Row. Discard the remaining revealed cards.", goldCost: 2, attunementCost: 1 },
  { name: "Rune of Foresight", type: "Divine / Technology", attack: 2, description: "Discard to look at the top 3 cards of one of your personal decks and return them in any order.", goldCost: 1, attunementCost: 1 },
  { name: "Rune of Fortune", type: "Corrupted", attack: 1, description: "Discard when purchasing a card to reduce its Gold cost by 3.", goldCost: 1, attunementCost: 1 },
  { name: "Rune of Insight", type: "Primal", attack: 2, description: "Discard before revealing a card to Attune. Look at the top 3 cards, choose one to reveal, and place the others on the bottom in any order.", goldCost: 1, attunementCost: 1 },
  { name: "Rune of Plenty", type: "Primal", attack: 1, description: "Discard before using The Wellspring to double the Mana generated by your roll.", goldCost: 3, attunementCost: 1 },
  { name: "Rune of Premonition", type: "Divine / Corrupted", attack: 2, description: "Discard when revealing a Rot card. Look at the top 3 Rot cards, choose 1 to encounter, and discard the rest.", goldCost: 3, attunementCost: 2 },
  { name: "Rune of Preservation", type: "Primal", attack: 2, description: "When using an Attuned Lore card, you may discard this Rune Stone instead of discarding the Lore card and remove up to 2 Withering Tokens from The Rot.", goldCost: 2, attunementCost: 1 },
  { name: "Rune of Prophecy", type: "Divine / Primal", attack: 2, description: "Discard to add +20 to your Attack against a Rot encounter in The Valley and remove up to 3 Withering Tokens from The Rot. Remove this card from the game.", goldCost: 4, attunementCost: 1 },
  { name: "Rune of Prospecting", type: "Primal / Technology", attack: 1, description: "Discard to reveal the top 5 cards of the Artifact Deck. Choose 1 to place in the Artifact Row, replacing and discarding a card currently there. Discard the remaining revealed cards.", goldCost: 3, attunementCost: 2 },
  { name: "Rune of Recall", type: "Corrupted / Divine", attack: 2, description: "Discard to choose 1 card from either discard pile and place it on top of its deck.", goldCost: 2, attunementCost: 1 },
  { name: "Rune of Renewal", type: "Primal / Divine", attack: 1, description: "Discard to choose any card from one of your discard piles and Attune it for free, then remove up to 2 Withering Tokens from The Rot.", goldCost: 4, attunementCost: 2 },
  { name: "Rune of Resonance", type: "Technology", attack: 1, description: "Discard when Attuning a card to reduce its Mana cost by 3.", goldCost: 1, attunementCost: 1 },
  { name: "Rune of Revelation", type: "Technology / Divine", attack: 2, description: "Discard to refresh either the Artifact Row or Lore Row.", goldCost: 1, attunementCost: 1 },
  { name: "Rune of Reversal", type: "Technology / Corrupted", attack: 1, description: "Discard to return one of your placed Action Tokens to your Character board.", goldCost: 3, attunementCost: 3 },
  { name: "Rune of Sacrifice", type: "Corrupted / Divine", attack: 2, description: "Discard to remove an Artifact card from your discard pile from the game, then remove up to 2 Withering Tokens from The Rot.", goldCost: 1, attunementCost: 1 },
  { name: "Rune of Salvage", type: "Technology / Corrupted", attack: 2, description: "Discard to choose 1 Artifact card from the Artifact discard pile and place it in the Artifact Row, replacing and discarding a card currently there.", goldCost: 2, attunementCost: 1 },
  { name: "Rune of Seeking", type: "Technology / Divine", attack: 1, description: "Discard before revealing from one of your personal decks. Search that deck for any card, shuffle the deck, then reveal the chosen card.", goldCost: 3, attunementCost: 1 },
  { name: "Rune of Study", type: "Divine / Technology", attack: 1, description: "Discard to reveal the top 3 cards of the Lore Deck. Choose 1 to replace a card in the Lore Row. Discard the remaining revealed cards.", goldCost: 2, attunementCost: 1 },
  { name: "Rune of Teleportation", type: "Technology / Corrupted", attack: 1, description: "Discard after losing a battle in The Valley to ignore the loss condition on the Rot card.", goldCost: 1, attunementCost: 2 },
  { name: "Rune of Time", type: "Corrupted / Primal", attack: 2, description: "Discard after losing a battle in The Valley to rewind time, ignore the loss condition on the Rot card, and remove up to 2 Withering Tokens from The Rot.", goldCost: 3, attunementCost: 2 },
  { name: "Rune of Transmutation", type: "Technology / Primal", attack: 1, description: "Discard to move any amount of Mana from one Mana Pool to the other. For every 2 Mana moved, gain 1 additional Mana in the receiving pool.", goldCost: 3, attunementCost: 1 },
  { name: "Rune of Vengeance", type: "Corrupted", attack: 2, description: "Discard after losing a battle to remove up to 3 Withering Tokens from The Rot.", goldCost: 2, attunementCost: 1 },
  { name: "Rune of Whispers", type: "Divine", attack: 1, description: "Discard to look at the top card of The Rot deck. You may discard it. If you do, remove up to 2 Withering Tokens from The Rot.", goldCost: 2, attunementCost: 1 },
];

// Rune Stones are Artifact Deck cards per the rulebook ("The Artifact Deck
// contains: Weapons, Armor, Implements, Rune Stones") but use a different
// shape in the sheet (no `slot`, `description` instead of `ability`). This
// adapts them to ArtifactCard so they can join the shared Market deck.
export const runeStonesAsArtifacts: ArtifactCard[] = runeStones.map((r) => ({
  name: r.name,
  type: r.type,
  slot: "Rune Stone",
  attack: r.attack,
  ability: r.description,
  goldCost: r.goldCost,
  attunementCost: r.attunementCost,
}));
