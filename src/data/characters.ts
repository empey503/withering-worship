// Copyright © 2026 Steve Empey
import type { Character } from "../types/game";

// Source: Withering Worship rulebook, "Player Characters" section.
export const characters: Character[] = [
  {
    name: "Shar, Warrior of the Light",
    tokenColor: "Yellow",
    god: "Akara, God of the Sun",
    affinity:
      "Divine items cost 1 less mana to Attune. Shar cannot Attune Corrupted Artifact cards.",
    powerName: "Cleansing Fire",
    powerText:
      "When attacking The Rot, you may reroll one die showing a 1 or 2.",
    victoryCondition:
      "Have 1 Attuned Lore card, at least 3 Rot cards, and access to The Warriors Guild.",
    canPlaySolo: true,
  },
  {
    name: "Cira, the Wizard",
    tokenColor: "Purple",
    god: "Astra, Goddess of Knowledge",
    affinity: "Divine & Technology items cost 1 less mana to Attune.",
    powerName: "Foresight",
    powerText:
      "When revealing a Rot card, look at the top 2 Rot cards, choose 1 to encounter, and return the other to the top of The Rot deck.",
    victoryCondition:
      "Have 1 Attuned Lore card, at least 3 Rot cards, and access to The Scholars Guild.",
    canPlaySolo: true,
  },
  {
    name: "Sylva, the Druidess",
    tokenColor: "Green",
    god: "Mesacopia, Goddess of Harvest, Abundance, Fertility, Growth, and Decay",
    affinity: "Primal & Corrupted items cost 1 less mana to Attune.",
    powerName: "Nature's Bounty",
    powerText:
      "Pay 1 less Gold when purchasing Primal or Corrupted Artifact cards.",
    victoryCondition:
      "Have 1 Attuned Lore card, at least 3 Rot cards, and 3 Faction at both The Wellspring and The Valley.",
    canPlaySolo: true,
  },
  {
    name: "Taza, the Shadow Knight",
    tokenColor: "Red",
    god: "Catafalco, God of Death",
    affinity: "Corrupted items cost 1 less mana to Attune.",
    powerName: "Wield the Rot",
    powerText:
      "Once per combat, remove 1 Withering Token from The Rot to gain +2 Attack.",
    victoryCondition:
      "Have 1 Attuned Lore card, at least 3 Rot cards, and 3 Faction at both The Arena and The Valley.",
    canPlaySolo: false, // excluded from solo play per rules
  },
  {
    name: "Legos, the Undead Cyborg",
    tokenColor: "Grey",
    god: "Caltron, Keeper of Ancient Technology",
    affinity: "Technology & Corrupted items cost 1 less mana to Attune.",
    powerName: "Grave Robber",
    powerText:
      "When Attuning an Artifact card, you may instead choose an Artifact card from your discard pile to Attune.",
    victoryCondition:
      "Have 1 Attuned Lore card, at least 3 Rot cards, and access to The Warriors Guild.",
    canPlaySolo: true,
  },
  {
    name: "Kael, the Tidecaller",
    tokenColor: "Blue",
    god: "Neratha, Goddess of Water and the Seas",
    affinity: "Primal items cost 1 less mana to Attune.",
    powerName: "Deep Waters",
    powerText:
      "At the start of your turn, place one of your mana tokens on a face-up Artifact card. That card costs you 1 less Gold and cannot be purchased by other players.",
    victoryCondition:
      "Have 1 Attuned Lore card, at least 3 Rot cards, and 3 Faction at both The Wellspring and The Exchange.",
    canPlaySolo: false, // excluded from solo play per rules
  },
];
