import type { RotCombatCard, RotScenarioCard } from "../types/game";

// Source: "WW Game" Drive folder, Withering Worship sheet, "Combat" and "Scenario" tables.
// Loss condition is universal across every Combat card (design update,
// superseding the per-card Loss text the sheet originally had): "Your Attack
// < The Rot's Attack: Equip The Rot with the highest-Gold-Cost Artifact from
// the Artifact Row" — see equipRotWithHighestGoldArtifact in turnEngine.ts,
// which this exact string already dispatches to. Win stays per-card.
const UNIVERSAL_LOSS = "Equip The Rot with the highest-Gold-Cost Artifact from the Artifact Row.";

export const rotCombatCards: RotCombatCard[] = [
  { name: "Acid Rain", creatureType: "Aberration", attack: 7, win: "Gain 1 Lore Mana.", loss: UNIVERSAL_LOSS },
  { name: "Vinewalker Toaster", creatureType: "Construct", attack: 7, win: "Gain 1 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Withered Pilgrim", creatureType: "Undead", attack: 7, win: "Gain 1 Lore Mana.", loss: UNIVERSAL_LOSS },
  { name: "Fungal Bloom", creatureType: "Aberration", attack: 7, win: "Advance The Rot Track by 1.", loss: UNIVERSAL_LOSS },
  { name: "Crawling Blight", creatureType: "Aberration", attack: 7, win: "Gain 1 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Corrupted Ancient Robot", creatureType: "Construct", attack: 7, win: "Gain 1 Artifact Mana.", loss: UNIVERSAL_LOSS },
  { name: "Vinewalker Motherboard", creatureType: "Construct", attack: 7, win: "Gain 1 Artifact Mana.", loss: UNIVERSAL_LOSS },
  { name: "Vinepuppet Zombie", creatureType: "Undead", attack: 7, win: "Gain 1 Lore Mana.", loss: UNIVERSAL_LOSS },
  { name: "Animated Corpse", creatureType: "Undead", attack: 7, win: "Gain 1 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Contagion Corpse", creatureType: "Undead", attack: 8, win: "Remove 1 Withering Token from either Mana Pool.", loss: UNIVERSAL_LOSS },
  { name: "Corrupted Eyestalk", creatureType: "Aberration", attack: 8, win: "Gain 1 Lore Mana.", loss: UNIVERSAL_LOSS },
  { name: "Grasping Roots", creatureType: "Aberration", attack: 8, win: "Each opponent places 1 Withering Token in their Artifact Attunement Pool.", loss: UNIVERSAL_LOSS },
  { name: "Rot Colossus", creatureType: "Construct", attack: 8, win: "Gain 2 Artifact Mana.", loss: UNIVERSAL_LOSS },
  { name: "Rot Lobster", creatureType: "Construct", attack: 8, win: "Gain 2 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Fungal Revenant", creatureType: "Undead", attack: 8, win: "Gain 2 Lore Mana.", loss: UNIVERSAL_LOSS },
  { name: "Vinewrought Skeleton", creatureType: "Undead", attack: 8, win: "Gain 1 Gold and 1 Lore Mana.", loss: UNIVERSAL_LOSS },
  { name: "Mutated Bunny", creatureType: "Aberration", attack: 9, win: "Gain 1 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Flesh-vine Hybrid", creatureType: "Aberration", attack: 9, win: "Gain 2 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Withered Vines", creatureType: "Aberration", attack: 9, win: "Each opponent places 1 Withering Token in their Lore Attunement Pool.", loss: UNIVERSAL_LOSS },
  { name: "Fungal Automaton", creatureType: "Construct", attack: 9, win: "Gain 2 Artifact Mana.", loss: UNIVERSAL_LOSS },
  { name: "Infested Excavation Rig", creatureType: "Construct", attack: 9, win: "Gain 2 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Vine-Strung Revenant", creatureType: "Undead", attack: 9, win: "Gain 2 Lore Mana.", loss: UNIVERSAL_LOSS },
  { name: "Spore-Risen Dead", creatureType: "Undead", attack: 9, win: "Gain 2 Mana, distributed between your Mana Pools as desired.", loss: UNIVERSAL_LOSS },
  { name: "Corrupted Farm Equipment", creatureType: "Construct", attack: 10, win: "Gain 1 Artifact Mana.", loss: UNIVERSAL_LOSS },
  { name: "Eyestalk Devourer", creatureType: "Aberration", attack: 10, win: "Gain 2 Mana, distributed between your Mana Pools as desired.", loss: UNIVERSAL_LOSS },
  { name: "Fungal Horror", creatureType: "Aberration", attack: 10, win: "Gain 2 Mana, distributed between your Mana Pools as desired.", loss: UNIVERSAL_LOSS },
  { name: "Vinewalker Drone", creatureType: "Construct", attack: 10, win: "Gain 2 Artifact Mana.", loss: UNIVERSAL_LOSS },
  { name: "Rot-Forged Sentinel", creatureType: "Construct", attack: 10, win: "Gain 2 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Reanimated Warrior", creatureType: "Undead", attack: 10, win: "Gain 2 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Blighted Knight", creatureType: "Undead", attack: 10, win: "Gain 2 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Rot-born Horror", creatureType: "Aberration", attack: 11, win: "Gain 2 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Shambling Eyestalks", creatureType: "Aberration", attack: 11, win: "Gain 2 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Corrupted Excavator", creatureType: "Construct", attack: 11, win: "Gain 2 Artifact Mana.", loss: UNIVERSAL_LOSS },
  { name: "Vinewalker Turret", creatureType: "Construct", attack: 11, win: "Gain 2 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Rot-Risen Warlord", creatureType: "Undead", attack: 11, win: "Gain 2 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Hollowed Warrior", creatureType: "Undead", attack: 11, win: "Gain 2 Lore Mana.", loss: UNIVERSAL_LOSS },
  { name: "Elite Flesh-vine Hybrid", creatureType: "Aberration", attack: 12, win: "Gain 3 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Elite Fungal Automaton", creatureType: "Construct", attack: 12, win: "Gain 3 Artifact Mana.", loss: UNIVERSAL_LOSS },
  { name: "Elite Vine-Strung Revenant", creatureType: "Undead", attack: 12, win: "Gain 3 Lore Mana.", loss: UNIVERSAL_LOSS },
  { name: "Elite Eyestalk Devourer", creatureType: "Aberration", attack: 13, win: "Gain 3 Mana, distributed between your Mana Pools as desired.", loss: UNIVERSAL_LOSS },
  { name: "Elite Vinewalker Drone", creatureType: "Construct", attack: 13, win: "Gain 3 Artifact Mana.", loss: UNIVERSAL_LOSS },
  { name: "Elite Reanimated Warrior", creatureType: "Undead", attack: 13, win: "Gain 3 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Elite Fungal Horror", creatureType: "Aberration", attack: 14, win: "Gain 3 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Elite Rot Colossus", creatureType: "Construct", attack: 14, win: "Gain 3 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Elite Blighted Knight", creatureType: "Undead", attack: 14, win: "Gain 3 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Elite Rot-born Horror", creatureType: "Aberration", attack: 15, win: "Gain 4 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Elite Rot Lobster", creatureType: "Construct", attack: 15, win: "Gain 4 Gold.", loss: UNIVERSAL_LOSS },
  { name: "Elite Rot-Risen Warlord", creatureType: "Undead", attack: 15, win: "Gain 4 Gold.", loss: UNIVERSAL_LOSS },
];

// Resist always yields the same result (see rulebook): 1 Withering Token in
// each Mana Pool. Only the Embrace outcome varies per card, so that's all
// that's stored here. Counts reflect how many copies appear in the deck.
const scenarioTemplate: { name: string; embrace: string; copies: number }[] = [
  { name: "Corrupted Greed", embrace: "Place 1 Artifact card from the Artifact Row in your Artifact Discard Pile and refill the empty position. Then place the highest-Gold-Cost Artifact from the Artifact Row on The Rot and refill the empty position.", copies: 6 },
  { name: "Forbidden Knowledge", embrace: "Reveal the top 3 Lore cards. Place 1 in your Lore Discard Pile and discard the others.", copies: 6 },
  { name: "Tainted Fortune", embrace: "Gain 3 Gold.", copies: 6 },
  { name: "Tainted Trade", embrace: "Exchange 1 Artifact card from your Artifact Deck or Artifact Discard Pile with 1 Artifact card from the Artifact Row.", copies: 6 },
  { name: "Underground Wellspring", embrace: "Gain 3 Mana, distributed between your Mana Pools as you choose.", copies: 6 },
  { name: "Whispered Secrets", embrace: "Look at the top 5 cards of any deck and place them back in any order.", copies: 6 },
];

export const rotScenarioCards: RotScenarioCard[] = scenarioTemplate.flatMap(
  ({ name, embrace, copies }) =>
    Array.from({ length: copies }, () => ({ name, embrace })),
);
