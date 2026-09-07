import type { LocationId } from "../types/game";

export interface LocationDef {
  id: LocationId;
  name: string;
  summary: string;
  hasFactionTrack: boolean;
  // Benefit text at Faction levels 0-3. Only present when hasFactionTrack is true.
  factionBenefits?: [string, string, string, string];
}

// Source: docs/rules.md, "Playing the Game" section (one entry per Location).
export const locations: LocationDef[] = [
  {
    id: "wellspring",
    name: "The Wellspring",
    summary: "Roll 2d6 to generate Mana, distributed between your Artifact and Lore Attunement Pools.",
    hasFactionTrack: true,
    factionBenefits: [
      "Starting location.",
      "Reroll any 1s or 2s on your “generate mana” roll this turn.",
      "You may choose to gather 7 mana instead of rolling every time you visit the Wellspring.",
      "When visiting The Wellspring, you may remove up to 2 Withering Tokens from either of your Mana Pools.",
    ],
  },
  {
    id: "market",
    name: "The Market",
    summary: "Purchase one face-up Artifact card from the Artifact Row.",
    hasFactionTrack: true,
    factionBenefits: [
      "Starting location.",
      "You may discard any or all cards in The Artifact Row and refill the empty position(s) from the Artifact Deck.",
      "You may move 1 Artifact card from The Rot Character Mat to The Artifact Row, replacing and discarding 1 Artifact card currently there.",
      "You may visit The Warriors Guild location if you have 3 faction at both The Market and The Artificer.",
    ],
  },
  {
    id: "library",
    name: "Library of Lore",
    summary: "Purchase one face-up Lore card from the Lore Row.",
    hasFactionTrack: true,
    factionBenefits: [
      "Starting location.",
      "You may discard any or all cards in The Lore Row and refill the empty position(s) from the Lore Deck.",
      "You may discard any or all cards in The Lore Row and refill the empty position(s) from the Lore Deck.",
      "You may visit The Scholars Guild location if you have 3 faction at both The Library and The Ancient Shrine.",
    ],
  },
  {
    id: "artificer",
    name: "The Artificer",
    summary: "Attune Artifact cards from your Artifact deck onto your Player Board.",
    hasFactionTrack: true,
    factionBenefits: [
      "Starting location.",
      "You receive 4 Mana in your Artifact Attunement pool.",
      "You may look at the top two cards of your Artifact deck and place them back on top of your deck in any order.",
      "You may visit The Warriors Guild location if you have 3 faction at both The Artificer and the Market.",
    ],
  },
  {
    id: "ancientShrine",
    name: "The Ancient Shrine",
    summary: "Attune Lore cards from your Lore deck onto your Player Board.",
    hasFactionTrack: true,
    factionBenefits: [
      "Starting location.",
      "You receive 4 Mana in your Lore Attunement pool.",
      "Reveal the top 3 cards of The Rot deck. You may discard any of them, then return the remaining cards to the top of the deck in any order.",
      "You may visit The Scholars Guild location if you have 3 faction at both The Ancient Shrine and The Library.",
    ],
  },
  {
    id: "exchange",
    name: "The Exchange",
    summary: "Take the Gold on this location, then trade Gold and Mana as many times as you like.",
    hasFactionTrack: true,
    factionBenefits: [
      "Starting location.",
      "You may increase your Faction by 1 at any location.",
      "You may increase your Faction by 1 at any location.",
      "Whenever you place an Action Token on The Exchange, add 1 Mana to each of your Mana Pools.",
    ],
  },
  {
    id: "valley",
    name: "The Valley",
    summary: "Remove 1 Withering Token from the board, then reveal and resolve the top Rot card.",
    hasFactionTrack: true,
    factionBenefits: [
      "Starting location.",
      "Place a withering token in each of your mana pools.",
      "Place a withering token in each of your mana pools.",
      "Whenever you place an Action token on The Valley, you may reveal the top card of The Rot deck. You may then choose to place it back on top of The Rot deck or discard it.",
    ],
  },
  {
    id: "arena",
    name: "The Arena",
    summary: "Pay 1 Rot card to enter. Combat resolves at Cleanup; the winner claims an Artifact or Lore card free.",
    hasFactionTrack: true,
    factionBenefits: [
      "Starting location.",
      "You may look at the top two cards of any deck and place the cards on the top or bottom as desired.",
      "Whenever you place an Action Token on The Arena, you may choose to pay 1 Gold entry instead of 1 Rot Card.",
      "You receive both Artifact and Lore cards as rewards on every victory in the Arena.",
    ],
  },
  {
    id: "warriorsGuild",
    name: "The Warriors Guild",
    summary:
      "Perform the Market and Artificer actions as though you placed a token on both. Unlocks at 3 Faction at both The Market and The Artificer.",
    hasFactionTrack: true,
    factionBenefits: [
      "Starting location.",
      "Place a card from the Artifact Row into your Artifact discard pile.",
      "Add 3 Mana to your Artifact Mana Pool.",
      "Recall one of your Action Tokens, you may immediately play it again.",
    ],
  },
  {
    id: "scholarsGuild",
    name: "The Scholars Guild",
    summary:
      "Perform the Library and Ancient Shrine actions as though you placed a token on both. Unlocks at 3 Faction at both The Library and The Ancient Shrine.",
    hasFactionTrack: true,
    factionBenefits: [
      "Starting location.",
      "Place a card from the Lore Row into your Lore discard pile.",
      "Add 3 Mana to your Lore Mana Pool.",
      "Recall one of your Action Tokens, you may immediately play it again.",
    ],
  },
];
