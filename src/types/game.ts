// Core data shapes mirroring the Withering Worship rulebook and card sheet.
// Source: "WW Game" Drive folder — Withering Worship (doc) + Withering Worship (sheet).

export type ArtifactSlot = "Weapon" | "Armor" | "Implement" | "Rune Stone";

export type ArtifactAffinity =
  | "Divine"
  | "Primal"
  | "Technology"
  | "Corrupted"
  | "Starter Set";

export interface ArtifactCard {
  name: string;
  type: string; // e.g. "Divine", "Divine / Technology", "Starter Set"
  slot: ArtifactSlot | string; // some Godslayer-style cards list multiple slots
  attack: number;
  ability: string;
  goldCost: number;
  attunementCost: number;
}

export interface RuneStoneCard {
  name: string;
  type: string;
  attack: number;
  description: string;
  goldCost: number;
  attunementCost: number;
}

export interface LoreCard {
  name: string;
  type: string;
  vsAberration: number;
  vsConstruct: number;
  vsUndead: number;
  goldCost: number;
  attunementCost: number;
}

export type RotCreatureType = "Aberration" | "Construct" | "Undead";

export interface RotCombatCard {
  name: string;
  creatureType: RotCreatureType;
  attack: number;
  win: string;
  loss: string;
}

export interface RotScenarioCard {
  name: string;
  embrace: string;
  // Resist is a fixed rule (1 Withering Token in each Mana Pool), not printed per-card.
}

export interface Character {
  name: string;
  tokenColor: string;
  god: string;
  affinity: string;
  powerName: string;
  powerText: string;
  victoryCondition: string;
  canPlaySolo: boolean;
}

export type LocationId =
  | "wellspring"
  | "market"
  | "library"
  | "artificer"
  | "ancientShrine"
  | "exchange"
  | "valley"
  | "arena"
  | "warriorsGuild"
  | "scholarsGuild";

export interface ManaPools {
  artifact: number;
  lore: number;
}

export interface PlayerState {
  character: Character;
  gold: number;
  manaPools: ManaPools;
  withering: ManaPools;
  actionTokensRemaining: number;
  factionTrack: Record<string, number>;
  attunedWeapon?: ArtifactCard;
  attunedArmor?: ArtifactCard;
  attunedImplement?: ArtifactCard;
  attunedRuneStones: RuneStoneCard[];
  attunedLore: LoreCard[];
  artifactDeck: ArtifactCard[];
  artifactDiscard: ArtifactCard[];
  loreDeck: LoreCard[];
  loreDiscard: LoreCard[];
  rotCardsInPlayerArea: (RotCombatCard | RotScenarioCard)[];
}
