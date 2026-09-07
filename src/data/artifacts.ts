// Copyright © 2026 Steve Empey
import type { ArtifactCard } from "../types/game";

// Source: "WW Game" Drive folder, Withering Worship sheet, "Artifact Equipment" table.
// Re-pulled 2026-09-06 (later same day again): Gold Cost +1 on 25 non-Starter
// cards (Blighted Plate, Rotfang Blade, Withering Idol, Six-Eyed Totem, Blade
// of Absolution, Divining Rod, Eye of Providence, Radiant Vestments, Oracle's
// Lens, Oracle's Prism, Godslayer, Heartwood Fetish, Livingwood Armor, Staff
// of Sundering, Thornmail, Purification Totem, Artificer's Lens, Machine
// Carapace, Nullification Array, Probability Engine, Blightsteel Axe, Chaos
// Engine, Corrupted Warframe, Rotsteel Harness, Runebreaker Focus) — partially
// walking back the same-day cost rebalance above. Attunement Costs, Attack,
// and ability text are all unchanged from that prior pull. The sheet also
// prefixes Starter Set's `type` with "*" (a footnote marker, not a data
// value) — kept as plain "Starter Set" here since createGame/
// purchaseFromLibrary match on that exact string.
export const artifacts: ArtifactCard[] = [
  { name: "Cira", type: "Starter Set", slot: "Weapon", attack: 1, ability: "If you have no Lore cards Attuned, Attune the top card of your Lore deck.", goldCost: 0, attunementCost: 2 },
  { name: "Cira", type: "Starter Set", slot: "Armor", attack: 1, ability: "Robe of Many Pockets: Once per round, when you reveal a Lore card, you may discard it and reveal another Lore card.", goldCost: 0, attunementCost: 2 },
  { name: "Cira", type: "Starter Set", slot: "Implement", attack: 1, ability: "Astra's Hourglass: When Attuning a Lore card, you may instead choose a Lore card from your discard pile to Attune.", goldCost: 0, attunementCost: 2 },
  { name: "Kael", type: "Starter Set", slot: "Weapon", attack: 1, ability: "If you have no Lore cards Attuned, Attune the top card of your Lore deck.", goldCost: 0, attunementCost: 2 },
  { name: "Kael", type: "Starter Set", slot: "Armor", attack: 1, ability: "Rotcrab Carapace: After you reveal a Rot card, you may discard 1 Attuned Lore card to place that Rot card on the bottom of The Rot deck and reveal a new Rot card.", goldCost: 0, attunementCost: 1 },
  { name: "Kael", type: "Starter Set", slot: "Implement", attack: 1, ability: "Tidal Stone: Once per round, after spending Mana, you may move 1 Mana from one of your Mana Pools to the other.", goldCost: 0, attunementCost: 2 },
  { name: "Legos", type: "Starter Set", slot: "Weapon", attack: 1, ability: "If you have no Lore cards Attuned, Attune the top card of your Lore deck.", goldCost: 0, attunementCost: 2 },
  { name: "Legos", type: "Starter Set", slot: "Armor", attack: 1, ability: "Deadsteel Carapace: Gain +1 Attack for each Technology Artifact card you have Attuned.", goldCost: 0, attunementCost: 2 },
  { name: "Legos", type: "Starter Set", slot: "Implement", attack: 1, ability: "Gauntlet of Reclamation: When Attuning an Artifact card, you may instead choose an Artifact card from your discard pile to Attune.", goldCost: 0, attunementCost: 2 },
  { name: "Shar", type: "Starter Set", slot: "Weapon", attack: 1, ability: "If you have no Lore cards Attuned, Attune the top card of your Lore deck.", goldCost: 0, attunementCost: 2 },
  { name: "Shar", type: "Starter Set", slot: "Armor", attack: 1, ability: "Armor of Dawn: Once per round when attacking The Rot, you may reroll one Attack die. Place a Mana Token on this card to signify use.", goldCost: 0, attunementCost: 1 },
  { name: "Shar", type: "Starter Set", slot: "Implement", attack: 1, ability: "Sunstone: When you defeat an Agent of The Rot, remove 1 additional Withering Token.", goldCost: 0, attunementCost: 2 },
  { name: "Sylva", type: "Starter Set", slot: "Weapon", attack: 1, ability: "If you have no Lore cards Attuned, Attune the top card of your Lore deck.", goldCost: 0, attunementCost: 2 },
  { name: "Sylva", type: "Starter Set", slot: "Armor", attack: 1, ability: "Living Bark: The first Primal or Corrupted Artifact card you Attune each round costs 1 less Mana.", goldCost: 0, attunementCost: 1 },
  { name: "Sylva", type: "Starter Set", slot: "Implement", attack: 1, ability: "Staff of the Cycle: When you discard an Attuned Artifact card, you may instead remove it from the game and gain Gold equal to its Gold cost.", goldCost: 0, attunementCost: 2 },
  { name: "Taza", type: "Starter Set", slot: "Weapon", attack: 1, ability: "If you have no Lore cards Attuned, Attune the top card of your Lore deck.", goldCost: 0, attunementCost: 2 },
  { name: "Taza", type: "Starter Set", slot: "Armor", attack: 1, ability: "Shroud of Catafalco: When you Embrace The Rot, gain 1 Gold.", goldCost: 0, attunementCost: 1 },
  { name: "Taza", type: "Starter Set", slot: "Implement", attack: 1, ability: "Hand of Decay: Each Rot card in your player area reduces the Mana cost of your next Attunement by 1, to a minimum of 1.", goldCost: 0, attunementCost: 2 },
  { name: "Blighted Plate", type: "Corrupted", slot: "Armor", attack: 3, ability: "Gain +1 Attack if you have at least 3 Rot cards in your player area.", goldCost: 4, attunementCost: 2 },
  { name: "Rotfang Blade", type: "Corrupted", slot: "Weapon", attack: 2, ability: "Gain +1 Attack if you have at least 3 Rot cards in your player area.", goldCost: 3, attunementCost: 2 },
  { name: "Rotwoven Cloak", type: "Corrupted", slot: "Armor", attack: 2, ability: "When you Embrace The Rot, gain 1 Mana in either Mana Pool.", goldCost: 2, attunementCost: 2 },
  { name: "Withering Idol", type: "Corrupted", slot: "Implement", attack: 2, ability: "You may place 1 Withering Token in either of your Mana Pools to gain +3 Attack. On Purchase: Reveal cards from the top of the Artifact Deck until you reveal a Rune Stone. Place it in your Artifact discard pile and discard the other revealed cards.", goldCost: 2, attunementCost: 1 },
  { name: "Six-Eyed Totem", type: "Corrupted / Divine", slot: "Implement", attack: 2, ability: "If either Attack die shows a 5, gain +2 Attack. On Purchase: Attune 1 Lore card from your discard pile for free.", goldCost: 2, attunementCost: 1 },
  { name: "Astra's Staff", type: "Divine", slot: "Weapon", attack: 1, ability: "When Attuning a Lore card, reveal the top 2 Lore cards and choose 1 to Attune.", goldCost: 4, attunementCost: 3 },
  { name: "Blade of Absolution", type: "Divine", slot: "Weapon", attack: 3, ability: "After you win a combat in The Valley, if The Rot has 5 or more Artifacts, remove 1 Artifact from The Rot.", goldCost: 4, attunementCost: 3 },
  { name: "Divining Rod", type: "Divine", slot: "Implement", attack: 2, ability: "Reroll 1s and 2s when visiting The Wellspring. On Purchase: Reveal cards from the top of the Artifact Deck until you reveal a Rune Stone. Place it in your Artifact discard pile and discard the other revealed cards.", goldCost: 3, attunementCost: 2 },
  { name: "Eye of Providence", type: "Divine", slot: "Implement", attack: 1, ability: "Once per combat in The Valley, after revealing a Rot Combat card, you may discard it and reveal a new Rot card. On Purchase: Attune 1 Lore card from your discard pile for free.", goldCost: 4, attunementCost: 2 },
  { name: "Radiant Vestments", type: "Divine", slot: "Armor", attack: 2, ability: "When you remove a Withering Token from one of your Mana Pools, gain 1 Mana in that Pool.", goldCost: 3, attunementCost: 2 },
  { name: "Robes of Astra", type: "Divine", slot: "Armor", attack: 1, ability: "Once per round, you may use the ability of another character's Attuned Armor as if it were your own. Place a Mana Token on this card to signify use.", goldCost: 4, attunementCost: 3 },
  { name: "Sunfire Hammer", type: "Divine", slot: "Weapon", attack: 2, ability: "When you win combat against The Rot, remove 1 Withering Token from either Mana Pool.", goldCost: 2, attunementCost: 2 },
  { name: "Sunplate", type: "Divine", slot: "Armor", attack: 2, ability: "Once per round, after rolling your Attack dice, you may reroll one die showing a 1.", goldCost: 2, attunementCost: 2 },
  { name: "Catafalco's Longsword", type: "Divine / Corrupted", slot: "Weapon", attack: 2, ability: "Gain +1 additional Attack against Agents of The Rot.", goldCost: 3, attunementCost: 2 },
  { name: "Akara's Blade", type: "Divine / Primal", slot: "Weapon", attack: 2, ability: "After defeating an Agent of The Rot, gain 1 Mana.", goldCost: 3, attunementCost: 2 },
  { name: "Mesacopia's Sickle", type: "Divine / Primal", slot: "Weapon", attack: 1, ability: "Lore cards cost you 1 less Gold to purchase.", goldCost: 3, attunementCost: 2 },
  { name: "Neratha's Trident", type: "Divine / Primal", slot: "Weapon", attack: 2, ability: "When spending Mana, you may spend it from either Mana Pool.", goldCost: 3, attunementCost: 2 },
  { name: "Aegis of the Flame", type: "Divine / Technology", slot: "Armor", attack: 3, ability: "Ignore 1 Attack from Artifacts on The Rot.", goldCost: 3, attunementCost: 2 },
  { name: "Caltron's Mace", type: "Divine / Technology", slot: "Weapon", attack: 2, ability: "When you discard an Attuned Artifact card, gain 1 Gold.", goldCost: 3, attunementCost: 2 },
  { name: "Oracle's Lens", type: "Divine / Technology", slot: "Implement", attack: 1, ability: "When attacking The Rot, you may reroll 1 Attack die. On Purchase: Attune 1 Lore card from your discard pile for free.", goldCost: 3, attunementCost: 2 },
  { name: "Oracle's Prism", type: "Divine / Technology", slot: "Implement", attack: 1, ability: "When Attuning a Lore card, reveal the top 2 cards of your Lore Deck. Choose 1 to Attune and place the other in your Lore discard pile. On Purchase: Reveal cards from the top of the Artifact Deck until you reveal a Rune Stone. Place it in your Artifact discard pile and discard the other revealed cards.", goldCost: 4, attunementCost: 2 },
  { name: "Godslayer", type: "Divine / Technology / Primal / Corrupted", slot: "Weapon / Implement", attack: 4, ability: "When Attuned, choose whether this occupies your Weapon or Implement slot. Ignore up to 3 Attack from Artifacts on The Rot.", goldCost: 5, attunementCost: 3 },
  { name: "Barkskin Mantle", type: "Primal", slot: "Armor", attack: 2, ability: "The first Primal Artifact you Attune each round costs 1 less Mana.", goldCost: 2, attunementCost: 2 },
  { name: "Heartwood Fetish", type: "Primal", slot: "Implement", attack: 3, ability: "Gain +1 Attack for each Primal Artifact card you have Attuned. On Purchase: Attune 1 Lore card from your discard pile for free.", goldCost: 3, attunementCost: 2 },
  { name: "Livingwood Armor", type: "Primal", slot: "Armor", attack: 2, ability: "Once per round, when you spend Mana to Attune an Artifact, gain 1 Mana in your Lore Mana Pool.", goldCost: 4, attunementCost: 2 },
  { name: "Thornwood Spear", type: "Primal", slot: "Weapon", attack: 2, ability: "After winning combat against The Rot, gain 1 Mana in either Mana Pool.", goldCost: 2, attunementCost: 1 },
  { name: "Staff of Sundering", type: "Primal / Corrupted", slot: "Weapon", attack: 3, ability: "When you initiate combat in The Valley, if The Rot has 5 or more Artifacts, remove 1 Artifact from The Rot before resolving combat.", goldCost: 5, attunementCost: 3 },
  { name: "Thornmail", type: "Primal / Corrupted", slot: "Armor", attack: 3, ability: "After losing combat against The Rot, remove 1 Withering Token from either Mana Pool.", goldCost: 3, attunementCost: 2 },
  { name: "Purification Totem", type: "Primal / Divine", slot: "Implement", attack: 3, ability: "Once per combat you may remove 1 Withering Token from any player's board to gain +1 Attack. On Purchase: Reveal cards from the top of the Artifact Deck until you reveal a Rune Stone. Place it in your Artifact discard pile and discard the other revealed cards.", goldCost: 3, attunementCost: 1 },
  { name: "Arc Rifle", type: "Technology", slot: "Weapon", attack: 2, ability: "When attacking The Rot, ignore 1 Attack from Artifacts on The Rot.", goldCost: 2, attunementCost: 2 },
  { name: "Artificer's Lens", type: "Technology", slot: "Implement", attack: 1, ability: "When Attuning an Artifact card, reveal the top 2 cards of your Artifact Deck. Choose 1 to Attune and place the other in your Artifact discard pile. On Purchase: Attune 1 Lore card from your discard pile for free.", goldCost: 4, attunementCost: 2 },
  { name: "Machine Carapace", type: "Technology", slot: "Armor", attack: 3, ability: "Gain +1 Attack if you have at least 2 Technology Artifacts Attuned.", goldCost: 4, attunementCost: 2 },
  { name: "Nullification Array", type: "Technology", slot: "Implement", attack: 1, ability: "Ignore up to 3 Attack from cards Attuned to The Rot. On Purchase: Reveal cards from the top of the Artifact Deck until you reveal a Rune Stone. Place it in your Artifact discard pile and discard the other revealed cards.", goldCost: 4, attunementCost: 2 },
  { name: "Probability Engine", type: "Technology", slot: "Implement", attack: 1, ability: "After rolling your Attack dice, you may increase or decrease 1 die by 1. On Purchase: Attune 1 Lore card from your discard pile for free.", goldCost: 3, attunementCost: 2 },
  { name: "Salvaged Exosuit", type: "Technology", slot: "Armor", attack: 2, ability: "The first Technology Artifact you Attune each round costs 1 less Mana.", goldCost: 2, attunementCost: 2 },
  { name: "Blightsteel Axe", type: "Technology / Corrupted", slot: "Weapon", attack: 3, ability: "After you lose combat against The Rot, gain 1 Artifact Mana.", goldCost: 3, attunementCost: 2 },
  { name: "Chaos Engine", type: "Technology / Corrupted", slot: "Implement", attack: 2, ability: "After rolling your Attack dice, you may reroll both dice. You must use the new result. On Purchase: Reveal cards from the top of the Artifact Deck until you reveal a Rune Stone. Place it in your Artifact discard pile and discard the other revealed cards.", goldCost: 3, attunementCost: 1 },
  { name: "Corrupted Warframe", type: "Technology / Corrupted", slot: "Armor", attack: 3, ability: "Whenever you visit The Wellspring, gain 2 additional Mana.", goldCost: 4, attunementCost: 2 },
  { name: "Rotsteel Harness", type: "Technology / Corrupted", slot: "Armor", attack: 3, ability: "When you win combat against The Rot, gain 1 Gold if The Rot has at least 3 Artifacts.", goldCost: 4, attunementCost: 2 },
  { name: "Runebreaker Focus", type: "Technology / Divine", slot: "Implement", attack: 2, ability: "You may discard an Attuned Rune Stone to gain +4 Attack. On Purchase: Attune 1 Lore card from your discard pile for free.", goldCost: 3, attunementCost: 1 },
];
