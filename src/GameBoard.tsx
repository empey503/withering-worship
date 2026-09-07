import { useState } from "react";
import { characters } from "./data/characters";
import { locations } from "./data/locations";
import {
  attuneArtifactCard,
  attuneArtifactFromDiscard,
  attuneLoreCard,
  cancelLocationVisit,
  canCancelLocationVisit,
  chooseForbiddenKnowledge,
  chooseForesightEncounter,
  chooseValleyLore,
  chooseValleyScenario,
  chooseFinalBattleLore,
  chooseWhisperedSecretsDeck,
  cleansePool,
  createGame,
  declineFinalBattle,
  declineFinalBattleBoon,
  detectRotEffectChoice,
  discardAbundance,
  discardArtifactCard,
  discardBarter,
  discardCleansingRune,
  discardCommunity,
  discardConvergence,
  discardCorruption,
  discardCulling,
  discardDecay,
  discardDefiance,
  discardDelving,
  discardDiscovery,
  discardEchoes,
  discardExcavation,
  discardForesightRune,
  discardInsight,
  discardLoreCard,
  discardPremonition,
  discardProspecting,
  discardRecall,
  discardRenewal,
  discardReversal,
  discardRevelation,
  discardSacrifice,
  discardSalvage,
  discardScavenging,
  discardSeeking,
  discardStudy,
  discardTransmutation,
  discardVengeance,
  discardWhispers,
  attuneLoreCardWithCommunion,
  exchangeArtifactCardForGold,
  exchangeLoreCardForGold,
  exchangeGoldForMana,
  exchangeManaForGold,
  finalizeValleyOutcome,
  getArtifactSlots,
  initiateFinalBattle,
  isLocationAvailable,
  leaveAncientShrine,
  leaveArena,
  leaveArtificer,
  leaveExchange,
  payArenaEntryFee,
  peekArenaDeck,
  peekArtifactDeck,
  peekValleyRotCard,
  placeActionToken,
  purchaseFromLibrary,
  purchaseFromMarket,
  resolveOnPurchaseFreeLoreAttune,
  skipOnPurchaseFreeLoreAttune,
  removeOwnBoardCard,
  removeRotArtifact,
  removeWitheringTokenAtWellspring,
  resolveArenaPeek,
  resolveArenaReward,
  resolveArtifactPeek,
  resolveDeepWatersClaim,
  resolveDivineReclamation,
  resolveExchangeFactionBump,
  resolveGuildFreeCardPerk,
  resolveInsightChoice,
  resolvePressTheAttack,
  resolveReorderPersonalDeck,
  resolveRevealForRow,
  resolveRotToMarketRowPerk,
  resolveRowRefillPerk,
  resolveSeekChoice,
  resolveFinalBattleAttackRoll,
  resolveFinalBattleBoon,
  resolveValleyAttackRoll,
  resolveValleyPremonition,
  resolveValleyScry,
  resolveWellspringAllocation,
  resolveWhisperedSecrets,
  resolveWhispersPeek,
  revealArtifactCard,
  peekRotDeck,
  resolveRotPeek,
  revealForbiddenKnowledge,
  revealLoreCard,
  rollWellspring,
  rotArtifactsEarnedForMargin,
  runCleanupPhase,
  skipExchangeFactionBump,
  skipGuildFreeCardPerk,
  skipLibrary,
  skipRotToMarketRowPerk,
  skipValleyScry,
  skipMarket,
} from "./engine/turnEngine";
import type { GameState, PendingRuneStoneChoice } from "./engine/types";
import type { ArtifactCard, Character, LocationId, LoreCard } from "./types/game";

function PlayerSetup({ onStart }: { onStart: (chars: Character[]) => void }) {
  const [playerCount, setPlayerCount] = useState(3);
  const eligibleForCount = playerCount === 1 ? characters.filter((c) => c.canPlaySolo) : characters;
  const [selected, setSelected] = useState<string[]>(
    eligibleForCount.slice(0, playerCount).map((c) => c.name),
  );

  function handleCountChange(count: number) {
    setPlayerCount(count);
    const pool = count === 1 ? characters.filter((c) => c.canPlaySolo) : characters;
    setSelected(pool.slice(0, count).map((c) => c.name));
  }

  function handleCharacterChange(slot: number, name: string) {
    const next = [...selected];
    next[slot] = name;
    setSelected(next);
  }

  const pool = playerCount === 1 ? characters.filter((c) => c.canPlaySolo) : characters;

  return (
    <section>
      <h2>Start a Game</h2>
      <div className="setup-row">
        <label>
          Players:{" "}
          <select value={playerCount} onChange={(e) => handleCountChange(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {playerCount === 1 && (
        <p className="meta">Solo Play: Kael and Taza are unavailable as your Character.</p>
      )}
      <div className="setup-row">
        {selected.map((name, i) => (
          <label key={i}>
            Player {i + 1}:{" "}
            <select value={name} onChange={(e) => handleCharacterChange(i, e.target.value)}>
              {pool.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button
        onClick={() => {
          const chosen = selected.map((name) => characters.find((c) => c.name === name)!);
          onStart(chosen);
        }}
      >
        Start Game
      </button>
    </section>
  );
}

function WellspringPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const { playerId } = state.pendingAction!;
  const player = state.players[playerId];
  const factionLevel = player.factionTrack.wellspring ?? 0;
  const roll = state.pendingWellspringRoll;
  const [artifactMana, setArtifactMana] = useState(0);

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  const wellspringWitheringRemoved = state.pendingAction?.wellspringWitheringRemoved ?? 0;
  const wellspringWitheringCapped = wellspringWitheringRemoved >= 2;
  const witheringControls =
    factionLevel >= 3 && (player.witheringTokens.artifact > 0 || player.witheringTokens.lore > 0) ? (
      <div className="exchange-section">
        <p className="meta">
          Withering Tokens: {player.witheringTokens.artifact} Artifact / {player.witheringTokens.lore} Lore ·
          removed {wellspringWitheringRemoved}/2 this visit
        </p>
        <div className="setup-row">
          <button
            disabled={player.witheringTokens.artifact <= 0 || wellspringWitheringCapped}
            onClick={() => attempt(() => removeWitheringTokenAtWellspring(state, "artifact"))}
          >
            Remove from Artifact Pool
          </button>
          <button
            disabled={player.witheringTokens.lore <= 0 || wellspringWitheringCapped}
            onClick={() => attempt(() => removeWitheringTokenAtWellspring(state, "lore"))}
          >
            Remove from Lore Pool
          </button>
        </div>
      </div>
    ) : null;

  const plentyIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Plenty");

  if (!roll) {
    return (
      <section className="panel">
        <h3>The Wellspring — {player.character.name}</h3>
        <p className="meta">
          Faction {factionLevel}
          {factionLevel >= 1 ? " — 1s and 2s reroll automatically." : ""}
        </p>
        <div className="setup-row">
          <button onClick={() => attempt(() => rollWellspring(state))}>Roll 2d6</button>
          {factionLevel >= 2 && (
            <button onClick={() => attempt(() => rollWellspring(state, { takeFlatSeven: true }))}>
              Take 7 Mana
            </button>
          )}
        </div>
        {plentyIndex >= 0 && (
          <div className="setup-row">
            <button onClick={() => attempt(() => rollWellspring(state, { discardPlentyIndex: plentyIndex }))}>
              Roll 2d6 (discard Rune of Plenty to double)
            </button>
            {factionLevel >= 2 && (
              <button
                onClick={() => attempt(() => rollWellspring(state, { takeFlatSeven: true, discardPlentyIndex: plentyIndex }))}
              >
                Take 7 Mana (discard Rune of Plenty to double)
              </button>
            )}
          </div>
        )}
        {witheringControls}
      </section>
    );
  }

  const loreMana = roll.total - artifactMana;

  return (
    <section className="panel">
      <h3>The Wellspring — {player.character.name}</h3>
      <p className="meta">
        {roll.usedFlatSeven
          ? "Took a flat 7 Mana (Faction 2)."
          : `Rolled ${roll.dice![0]} + ${roll.dice![1]} = ${roll.total}${roll.rerolled ? " (rerolled)" : ""}.`}
      </p>
      <div className="setup-row">
        <label>
          Artifact Pool:{" "}
          <input
            type="number"
            min={0}
            max={roll.total}
            value={artifactMana}
            onChange={(e) => {
              const v = Math.max(0, Math.min(roll.total, Number(e.target.value) || 0));
              setArtifactMana(v);
            }}
          />
        </label>
        <span className="meta">Lore Pool: {loreMana}</span>
      </div>
      <button onClick={() => attempt(() => resolveWellspringAllocation(state, artifactMana, loreMana))}>
        Confirm
      </button>
      {witheringControls}
    </section>
  );
}

// Shared by Market/Library/Exchange: any Faction milestone perk that needs a
// player choice (see PendingFactionPerk in engine/types.ts) can be pending
// while any of those three Locations' panel is showing — including a perk
// for a *different* Location than the one the player is currently at, since
// resolveExchangeFactionBump can cascade into a new Market/Library perk
// without leaving The Exchange. Always resolved before that Location's own
// action becomes available again (see assertNoPendingFactionPerk).
function PendingFactionPerkPanel({
  state,
  setState,
  headerName,
}: {
  state: GameState;
  setState: (s: GameState) => void;
  headerName: string;
}) {
  const perk = state.pendingFactionPerks[0];
  const [refillSelection, setRefillSelection] = useState<number[]>([]);
  const [rotIndex, setRotIndex] = useState<number | null>(null);

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  if (!perk) return null;

  if (perk.kind === "discardRefillRow") {
    const row = perk.locationId === "market" ? state.artifactRow : state.loreRow;
    const rowLabel = perk.locationId === "market" ? "Artifact" : "Lore";
    return (
      <section className="panel">
        <h3>{headerName}</h3>
        <p className="meta">
          Faction benefit — you may discard any or all cards in the {rowLabel} Row and refill from the deck.
        </p>
        <div className="card-grid">
          {row.map((card, i) =>
            card ? (
              <div className={`card${refillSelection.includes(i) ? " selected" : ""}`} key={i}>
                <h3>{card.name}</h3>
                <p className="meta">Gold {card.goldCost}</p>
                <button
                  onClick={() =>
                    setRefillSelection((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))
                  }
                >
                  {refillSelection.includes(i) ? "Keep instead" : "Discard this"}
                </button>
              </div>
            ) : (
              <div className="card" key={i}>
                <p className="meta">(empty)</p>
              </div>
            ),
          )}
        </div>
        <button onClick={() => attempt(() => resolveRowRefillPerk(state, refillSelection))}>Confirm</button>
      </section>
    );
  }

  if (perk.kind === "rotToMarketRow") {
    return (
      <section className="panel">
        <h3>{headerName}</h3>
        <p className="meta">
          Faction benefit — you may move 1 Artifact card from The Rot Character Mat to the Artifact Row.
        </p>
        {state.rotArtifacts.length === 0 ? (
          <p className="meta">The Rot Character Mat is empty.</p>
        ) : (
          <>
            <p className="meta">Choose a card from The Rot Character Mat:</p>
            <div className="card-grid">
              {state.rotArtifacts.map((card, i) => (
                <div className={`card${rotIndex === i ? " selected" : ""}`} key={i}>
                  <h3>{card.name}</h3>
                  <p className="meta">Gold {card.goldCost}</p>
                  <button onClick={() => setRotIndex(i)}>Choose this</button>
                </div>
              ))}
            </div>
            {rotIndex !== null && (
              <>
                <p className="meta">Replace which Artifact Row slot?</p>
                <div className="card-grid">
                  {state.artifactRow.map((card, i) => (
                    <div className="card" key={i}>
                      <h3>{card ? card.name : "(empty)"}</h3>
                      <button onClick={() => attempt(() => resolveRotToMarketRowPerk(state, rotIndex, i))}>
                        Replace this slot
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <button className="secondary" onClick={() => attempt(() => skipRotToMarketRowPerk(state))}>
          Decline
        </button>
      </section>
    );
  }

  if (perk.kind === "guildFreeCard") {
    const row = perk.locationId === "warriorsGuild" ? state.artifactRow : state.loreRow;
    const rowLabel = perk.locationId === "warriorsGuild" ? "Artifact" : "Lore";
    return (
      <section className="panel">
        <h3>{headerName}</h3>
        <p className="meta">Faction benefit — place a card from the {rowLabel} Row into your {rowLabel} discard pile for free.</p>
        <div className="card-grid">
          {row.map((card, i) =>
            card ? (
              <div className="card" key={i}>
                <h3>{card.name}</h3>
                <p className="meta">Gold {card.goldCost}</p>
                <button onClick={() => attempt(() => resolveGuildFreeCardPerk(state, i))}>Take this</button>
              </div>
            ) : (
              <div className="card" key={i}>
                <p className="meta">(empty)</p>
              </div>
            ),
          )}
        </div>
        <button className="secondary" onClick={() => attempt(() => skipGuildFreeCardPerk(state))}>
          Decline
        </button>
      </section>
    );
  }

  const player = state.players[perk.playerId];
  return (
    <section className="panel">
      <h3>{headerName}</h3>
      <p className="meta">Faction benefit — you may increase your Faction by 1 at any Location.</p>
      <div className="location-grid">
        {locations
          .filter((l) => l.hasFactionTrack)
          .map((loc) => {
            const level = player.factionTrack[loc.id] ?? 0;
            return (
              <button
                key={loc.id}
                className="location-card"
                disabled={level >= 3}
                onClick={() => attempt(() => resolveExchangeFactionBump(state, loc.id))}
              >
                <strong>{loc.name}</strong>
                <span className="meta">
                  Faction {level}
                  {level >= 3 ? " — max" : ""}
                </span>
              </button>
            );
          })}
      </div>
      <button className="secondary" onClick={() => attempt(() => skipExchangeFactionBump(state))}>
        Decline
      </button>
    </section>
  );
}

// "On Purchase: Attune 1 Lore card from your discard pile for free" — the
// only On Purchase variant that needs a real choice (see purchaseFromMarket
// in turnEngine.ts; the Rune Stone dig variant is fully automatic).
function OnPurchaseFreeLoreAttunePanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const { playerId } = state.pendingArtifactOnPurchase!;
  const player = state.players[playerId];
  const atCap = player.attunedLore.length >= 3;

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <section className="panel">
      <h3>On Purchase Bonus — {player.character.name}</h3>
      <p>Attune 1 Lore card from your discard pile for free.</p>
      <div className="card-grid">
        {player.loreDiscard.map((card, i) => (
          <div className="card" key={i}>
            <h3>{card.name}</h3>
            <p className="meta">
              vs Aberration {card.vsAberration} · vs Construct {card.vsConstruct} · vs Undead {card.vsUndead}
            </p>
            <div className="setup-row">
              {atCap ? (
                player.attunedLore.map((c, replaceIndex) => (
                  <button key={replaceIndex} onClick={() => attempt(() => resolveOnPurchaseFreeLoreAttune(state, i, replaceIndex))}>
                    Replace {c.name}
                  </button>
                ))
              ) : (
                <button onClick={() => attempt(() => resolveOnPurchaseFreeLoreAttune(state, i))}>Attune</button>
              )}
            </div>
          </div>
        ))}
      </div>
      <button className="secondary" onClick={() => attempt(() => skipOnPurchaseFreeLoreAttune(state))}>
        Decline
      </button>
    </section>
  );
}

function MarketPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const { playerId } = state.pendingAction!;
  const player = state.players[playerId];
  const fortuneIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Fortune");

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  if (state.pendingArtifactOnPurchase) {
    return <OnPurchaseFreeLoreAttunePanel state={state} setState={setState} />;
  }

  if (state.pendingFactionPerks.some((p) => p.playerId === playerId)) {
    return (
      <PendingFactionPerkPanel state={state} setState={setState} headerName={`The Market — ${player.character.name}`} />
    );
  }

  return (
    <section className="panel">
      <h3>
        The Market — {player.character.name} ({player.gold} Gold)
      </h3>
      <div className="card-grid">
        {state.artifactRow.map((card, i) =>
          card ? (
            <div className="card" key={i}>
              <h3>{card.name}</h3>
              <p className="meta">
                {card.type} · {card.slot} · Attack {card.attack}
              </p>
              <p>{card.ability}</p>
              <p className="meta">
                Gold {card.goldCost} · Attune {card.attunementCost}
              </p>
              <button
                disabled={player.gold < card.goldCost}
                onClick={() => attempt(() => purchaseFromMarket(state, i))}
              >
                Buy for {card.goldCost} Gold
              </button>
              {fortuneIndex >= 0 && (
                <button
                  disabled={player.gold < Math.max(0, card.goldCost - 3)}
                  onClick={() => attempt(() => purchaseFromMarket(state, i, fortuneIndex))}
                >
                  Buy for {Math.max(0, card.goldCost - 3)} Gold (discard Rune of Fortune)
                </button>
              )}
            </div>
          ) : (
            <div className="card" key={i}>
              <p className="meta">(empty — the Artifact Deck and discard pile are both depleted)</p>
            </div>
          ),
        )}
      </div>
      <button className="secondary" onClick={() => attempt(() => skipMarket(state))}>
        Leave without buying
      </button>
    </section>
  );
}

function LibraryPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const { playerId } = state.pendingAction!;
  const player = state.players[playerId];
  const fortuneIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Fortune");

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  if (state.pendingFactionPerks.some((p) => p.playerId === playerId)) {
    return (
      <PendingFactionPerkPanel
        state={state}
        setState={setState}
        headerName={`Library of Lore — ${player.character.name}`}
      />
    );
  }

  return (
    <section className="panel">
      <h3>
        Library of Lore — {player.character.name} ({player.gold} Gold)
      </h3>
      <div className="card-grid">
        {state.loreRow.map((card, i) =>
          card ? (
            <div className="card" key={i}>
              <h3>{card.name}</h3>
              <p className="meta">{card.type}</p>
              <p>
                vs Aberration {card.vsAberration} · vs Construct {card.vsConstruct} · vs Undead {card.vsUndead}
              </p>
              <p className="meta">
                Gold {card.goldCost} · Attune {card.attunementCost}
              </p>
              <button
                disabled={player.gold < card.goldCost}
                onClick={() => attempt(() => purchaseFromLibrary(state, i))}
              >
                Buy for {card.goldCost} Gold
              </button>
              {fortuneIndex >= 0 && (
                <button
                  disabled={player.gold < Math.max(0, card.goldCost - 3)}
                  onClick={() => attempt(() => purchaseFromLibrary(state, i, fortuneIndex))}
                >
                  Buy for {Math.max(0, card.goldCost - 3)} Gold (discard Rune of Fortune)
                </button>
              )}
            </div>
          ) : (
            <div className="card" key={i}>
              <p className="meta">(empty — the Lore Deck and discard pile are both depleted)</p>
            </div>
          ),
        )}
      </div>
      <button className="secondary" onClick={() => attempt(() => skipLibrary(state))}>
        Leave without buying
      </button>
    </section>
  );
}

function ExchangePanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const { playerId } = state.pendingAction!;
  const player = state.players[playerId];
  const [artifactMana, setArtifactMana] = useState(0);
  const loreMana = 2 - artifactMana;

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  if (state.pendingFactionPerks.some((p) => p.playerId === playerId)) {
    return (
      <PendingFactionPerkPanel
        state={state}
        setState={setState}
        headerName={`The Exchange — ${player.character.name}`}
      />
    );
  }

  return (
    <section className="panel">
      <h3>
        The Exchange — {player.character.name} ({player.gold} Gold · {player.manaPools.artifact}/
        {player.manaPools.lore} Mana)
      </h3>

      {(player.witheringTokens.artifact > 0 || player.witheringTokens.lore > 0) && (
        <div className="exchange-section">
          <p className="meta">
            A Withering Token taints a Mana pool — spend 1 Mana from it to cleanse before spending Mana there for
            anything else.
          </p>
          <div className="setup-row">
            {player.witheringTokens.artifact > 0 && (
              <button
                className="secondary"
                disabled={player.manaPools.artifact < 1}
                onClick={() => attempt(() => cleansePool(state, playerId, "artifact"))}
              >
                Cleanse Artifact Pool ({player.witheringTokens.artifact} remaining)
              </button>
            )}
            {player.witheringTokens.lore > 0 && (
              <button
                className="secondary"
                disabled={player.manaPools.lore < 1}
                onClick={() => attempt(() => cleansePool(state, playerId, "lore"))}
              >
                Cleanse Lore Pool ({player.witheringTokens.lore} remaining)
              </button>
            )}
          </div>
        </div>
      )}

      {player.equippedRuneStones.map((stone, i) =>
        stone.name === "Rune of Barter" ? (
          <div className="exchange-section" key={i}>
            <button onClick={() => attempt(() => discardBarter(state, i))}>Discard Rune of Barter for 5 Gold</button>
          </div>
        ) : null,
      )}

      <div className="exchange-section">
        <p className="meta">Pay 1 Gold to distribute 2 Mana across your pools.</p>
        <div className="setup-row">
          <label>
            Artifact:{" "}
            <input
              type="number"
              min={0}
              max={2}
              value={artifactMana}
              onChange={(e) => setArtifactMana(Math.max(0, Math.min(2, Number(e.target.value) || 0)))}
            />
          </label>
          <span className="meta">Lore: {loreMana}</span>
          <button
            disabled={player.gold < 1}
            onClick={() => attempt(() => exchangeGoldForMana(state, artifactMana, loreMana))}
          >
            Exchange
          </button>
        </div>
      </div>

      <div className="exchange-section">
        <p className="meta">Pay 3 Mana from one pool to gain 1 Gold.</p>
        <div className="setup-row">
          <button
            disabled={player.manaPools.artifact < 3 || player.witheringTokens.artifact > 0}
            onClick={() => attempt(() => exchangeManaForGold(state, "artifact"))}
          >
            3 Artifact Mana → 1 Gold
          </button>
          <button
            disabled={player.manaPools.lore < 3 || player.witheringTokens.lore > 0}
            onClick={() => attempt(() => exchangeManaForGold(state, "lore"))}
          >
            3 Lore Mana → 1 Gold
          </button>
        </div>
      </div>

      <div className="exchange-section">
        <p className="meta">Remove an Artifact card from your discard pile for half its Gold value (min 1).</p>
        {player.artifactDiscard.length === 0 ? (
          <p className="meta">Your Artifact discard pile is empty.</p>
        ) : (
          <div className="card-grid">
            {player.artifactDiscard.map((card, i) => (
              <div className="card" key={i}>
                <h3>{card.name}</h3>
                <p className="meta">Gold {card.goldCost}</p>
                <button onClick={() => attempt(() => exchangeArtifactCardForGold(state, i))}>
                  Remove for {Math.max(1, Math.ceil(card.goldCost / 2))} Gold
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="exchange-section">
        <p className="meta">Remove a Lore card from your discard pile for half its Gold value (min 1).</p>
        {player.loreDiscard.length === 0 ? (
          <p className="meta">Your Lore discard pile is empty.</p>
        ) : (
          <div className="card-grid">
            {player.loreDiscard.map((card, i) => (
              <div className="card" key={i}>
                <h3>{card.name}</h3>
                <p className="meta">Gold {card.goldCost}</p>
                <button onClick={() => attempt(() => exchangeLoreCardForGold(state, i))}>
                  Remove for {Math.max(1, Math.ceil(card.goldCost / 2))} Gold
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="secondary" onClick={() => attempt(() => leaveExchange(state))}>
        Leave The Exchange
      </button>
    </section>
  );
}

function ArtifactPeekPicker({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const peeked = state.pendingArtifactPeek!;
  const [order, setOrder] = useState<number[]>([]);

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <>
      <p className="meta">Click each card in the order it should return to the top (topmost first).</p>
      <div className="card-grid">
        {peeked.map((card, i) => {
          const position = order.indexOf(i);
          return (
            <div className="card" key={i}>
              <h3>{card.name}</h3>
              <p className="meta">
                {card.type} · {card.slot} · Attack {card.attack}
              </p>
              <button
                onClick={() =>
                  setOrder((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))
                }
              >
                {position === -1 ? "Add to order" : `Position ${position + 1} (click to undo)`}
              </button>
            </div>
          );
        })}
      </div>
      <button disabled={order.length !== peeked.length} onClick={() => attempt(() => resolveArtifactPeek(state, order))}>
        Confirm Order
      </button>
    </>
  );
}

function ArtificerPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const { playerId, usedArtifactPeek } = state.pendingAction!;
  const player = state.players[playerId];
  const reveal = state.pendingReveal?.kind === "artifact" ? state.pendingReveal.card : null;
  const artifactPeekLevel = player.factionTrack.artificer ?? 0;
  const insightIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Insight");
  const seekingIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Seeking");
  const resonanceIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Resonance");

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <section className="panel">
      <h3>
        The Artificer — {player.character.name} ({player.manaPools.artifact} Artifact Mana)
      </h3>
      <p className="meta">
        Weapon: {player.equippedWeapon?.name ?? "none"} · Armor: {player.equippedArmor?.name ?? "none"} ·
        Implement: {player.equippedImplement?.name ?? "none"}
      </p>
      <p className="meta">
        Rune Stones ({player.equippedRuneStones.length}/3):{" "}
        {player.equippedRuneStones.length > 0 ? player.equippedRuneStones.map((c) => c.name).join(", ") : "none"}
      </p>
      <p className="meta">
        Artifact deck: {player.artifactDeck.length} · discard: {player.artifactDiscard.length}
      </p>

      {player.witheringTokens.artifact > 0 && (
        <div className="exchange-section">
          <p className="meta">
            A Withering Token taints your Artifact pool — spend 1 Mana to cleanse it before spending Mana there for
            anything else.
          </p>
          <button
            className="secondary"
            disabled={player.manaPools.artifact < 1}
            onClick={() => attempt(() => cleansePool(state, playerId, "artifact"))}
          >
            Cleanse Withering Token ({player.witheringTokens.artifact} remaining)
          </button>
        </div>
      )}

      {state.pendingArtifactPeek ? (
        <ArtifactPeekPicker state={state} setState={setState} />
      ) : (
        <>
          {artifactPeekLevel >= 2 && !usedArtifactPeek && !reveal && (
            <button className="secondary" onClick={() => attempt(() => peekArtifactDeck(state))}>
              Look at Top 2 Artifact Cards (Faction 2 perk)
            </button>
          )}

          {!reveal && player.character.name === "Legos, the Undead Cyborg" && player.artifactDiscard.length > 0 && (
            <div className="exchange-section">
              <p className="meta">Grave Robber — Attune directly from your Artifact discard pile.</p>
              <div className="card-grid">
                {player.artifactDiscard.map((card, i) => {
                  const discardSlots = getArtifactSlots(card);
                  const discardAffordable =
                    player.manaPools.artifact >= card.attunementCost && player.witheringTokens.artifact === 0;
                  return (
                    <div className="card" key={i}>
                      <h3>{card.name}</h3>
                      <p className="meta">
                        {card.type} · {card.slot} · Attack {card.attack}
                      </p>
                      <p className="meta">Attune {card.attunementCost} Mana</p>
                      <div className="setup-row">
                        {discardSlots.length > 1 ? (
                          discardSlots.map((slot) => (
                            <button
                              key={slot}
                              disabled={!discardAffordable}
                              onClick={() => attempt(() => attuneArtifactFromDiscard(state, i, slot))}
                            >
                              Attune as {slot}
                            </button>
                          ))
                        ) : (
                          <button
                            disabled={!discardAffordable}
                            onClick={() => attempt(() => attuneArtifactFromDiscard(state, i))}
                          >
                            Attune
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {reveal ? (
            (() => {
              const slots = getArtifactSlots(reveal);
              const affordable = player.manaPools.artifact >= reveal.attunementCost && player.witheringTokens.artifact === 0;
              const runeStonesFull =
                slots.length === 1 && slots[0] === "Rune Stone" && player.equippedRuneStones.length >= 3;
              return (
                <div className="card-grid">
                  <div className="card">
                    <h3>{reveal.name}</h3>
                    <p className="meta">
                      {reveal.type} · {reveal.slot} · Attack {reveal.attack}
                    </p>
                    <p>{reveal.ability}</p>
                    <p className="meta">Attune {reveal.attunementCost} Mana</p>
                    {runeStonesFull && <p className="meta">You already have 3 Attuned Rune Stones.</p>}
                    <div className="setup-row">
                      {slots.length > 1 ? (
                        slots.map((slot) => (
                          <button
                            key={slot}
                            disabled={!affordable}
                            onClick={() => attempt(() => attuneArtifactCard(state, slot))}
                          >
                            Attune as {slot}
                          </button>
                        ))
                      ) : (
                        <button
                          disabled={!affordable || runeStonesFull}
                          onClick={() => attempt(() => attuneArtifactCard(state))}
                        >
                          Attune
                        </button>
                      )}
                      {resonanceIndex >= 0 && slots.length === 1 && (
                        <button
                          disabled={runeStonesFull}
                          onClick={() => attempt(() => attuneArtifactCard(state, undefined, resonanceIndex))}
                        >
                          Attune (discard Rune of Resonance for -3 Mana)
                        </button>
                      )}
                      <button className="secondary" onClick={() => attempt(() => discardArtifactCard(state))}>
                        Discard
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="setup-row">
              <button onClick={() => attempt(() => revealArtifactCard(state))}>Reveal Next Card</button>
              {insightIndex >= 0 && (
                <button className="secondary" onClick={() => attempt(() => discardInsight(state, insightIndex, "artifact"))}>
                  Discard Rune of Insight (look at 3, choose 1)
                </button>
              )}
              {seekingIndex >= 0 && (
                <button className="secondary" onClick={() => attempt(() => discardSeeking(state, seekingIndex, "artifact"))}>
                  Discard Rune of Seeking (search deck for any card)
                </button>
              )}
            </div>
          )}

          <div>
            <button className="secondary" disabled={!!reveal} onClick={() => attempt(() => leaveArtificer(state))}>
              Leave The Artificer
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function RotPeekPicker({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const peeked = state.pendingRotPeek!;
  const [keepOrder, setKeepOrder] = useState<number[]>([]);

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  function toggleKeep(index: number) {
    setKeepOrder((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]));
  }

  return (
    <>
      <p className="meta">Choose which cards return to the top of The Rot deck, and in what order. The rest are discarded.</p>
      <div className="card-grid">
        {peeked.map((rc, i) => {
          const position = keepOrder.indexOf(i);
          return (
            <div className="card" key={i}>
              <h3>{rc.card.name}</h3>
              {rc.kind === "combat" ? (
                <>
                  <p className="meta">
                    {rc.card.creatureType} · Attack {rc.card.attack}
                  </p>
                  <p>Win: {rc.card.win}</p>
                  <p>Loss: {rc.card.loss}</p>
                </>
              ) : (
                <>
                  <p className="meta">Scenario</p>
                  <p>Embrace: {rc.card.embrace}</p>
                </>
              )}
              <button onClick={() => toggleKeep(i)}>
                {position === -1 ? "Keep on top" : `Kept — position ${position + 1} (click to undo)`}
              </button>
            </div>
          );
        })}
      </div>
      <button onClick={() => attempt(() => resolveRotPeek(state, keepOrder))}>Confirm</button>
    </>
  );
}

function AncientShrinePanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const { playerId, usedRotPeek } = state.pendingAction!;
  const player = state.players[playerId];
  const reveal = state.pendingReveal?.kind === "lore" ? state.pendingReveal.card : null;
  const rotPeekLevel = player.factionTrack.ancientShrine ?? 0;
  const insightIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Insight");
  const seekingIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Seeking");
  const resonanceIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Resonance");
  const communionIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Communion");
  const [communionArtifactMana, setCommunionArtifactMana] = useState(0);
  const [communionWitheringArtifact, setCommunionWitheringArtifact] = useState(0);
  const [communionWitheringLore, setCommunionWitheringLore] = useState(0);
  const [communionWitheringRot, setCommunionWitheringRot] = useState(0);

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <section className="panel">
      <h3>
        The Ancient Shrine — {player.character.name} ({player.manaPools.lore} Lore Mana)
      </h3>
      <p className="meta">
        Attuned Lore ({player.attunedLore.length}/3):{" "}
        {player.attunedLore.length > 0 ? player.attunedLore.map((c) => c.name).join(", ") : "none"}
      </p>
      <p className="meta">
        Lore deck: {player.loreDeck.length} · discard: {player.loreDiscard.length}
      </p>

      {player.witheringTokens.lore > 0 && (
        <div className="exchange-section">
          <p className="meta">
            A Withering Token taints your Lore pool — spend 1 Mana to cleanse it before spending Mana there for
            anything else.
          </p>
          <button
            className="secondary"
            disabled={player.manaPools.lore < 1}
            onClick={() => attempt(() => cleansePool(state, playerId, "lore"))}
          >
            Cleanse Withering Token ({player.witheringTokens.lore} remaining)
          </button>
        </div>
      )}

      {state.pendingRotPeek ? (
        <RotPeekPicker state={state} setState={setState} />
      ) : (
        <>
          {rotPeekLevel >= 2 && !usedRotPeek && !reveal && (
            <button className="secondary" onClick={() => attempt(() => peekRotDeck(state))}>
              Peek Top 3 Rot Cards (Faction {rotPeekLevel} perk)
            </button>
          )}

          {reveal ? (
            (() => {
              const affordable = player.manaPools.lore >= reveal.attunementCost && player.witheringTokens.lore === 0;
              const atCap = player.attunedLore.length >= 3;
              return (
                <div className="card-grid">
                  <div className="card">
                    <h3>{reveal.name}</h3>
                    <p className="meta">{reveal.type}</p>
                    <p>
                      vs Aberration {reveal.vsAberration} · vs Construct {reveal.vsConstruct} · vs Undead {reveal.vsUndead}
                    </p>
                    <p className="meta">Attune {reveal.attunementCost} Mana</p>
                    {atCap && (
                      <p className="meta">
                        You already have 3 Attuned Lore cards — choose one to replace, or discard.
                      </p>
                    )}
                    <div className="setup-row">
                      {atCap ? (
                        player.attunedLore.map((c, i) => (
                          <button
                            key={i}
                            disabled={!affordable}
                            onClick={() => attempt(() => attuneLoreCard(state, i))}
                          >
                            Replace {c.name}
                          </button>
                        ))
                      ) : (
                        <button disabled={!affordable} onClick={() => attempt(() => attuneLoreCard(state))}>
                          Attune
                        </button>
                      )}
                      {resonanceIndex >= 0 && (
                        <button onClick={() => attempt(() => attuneLoreCard(state, atCap ? 0 : undefined, resonanceIndex))}>
                          Attune (discard Rune of Resonance for -3 Mana)
                        </button>
                      )}
                      <button className="secondary" onClick={() => attempt(() => discardLoreCard(state))}>
                        Discard
                      </button>
                    </div>
                    {communionIndex >= 0 &&
                      (() => {
                        const loreMana = Math.max(
                          0,
                          reveal.attunementCost - communionArtifactMana - communionWitheringArtifact - communionWitheringLore - communionWitheringRot,
                        );
                        const covered =
                          communionArtifactMana + loreMana + communionWitheringArtifact + communionWitheringLore + communionWitheringRot ===
                          reveal.attunementCost;
                        return (
                          <div className="exchange-section">
                            <p className="meta">
                              Rune of Communion — cover {reveal.attunementCost} Mana from either pool, or Withering Tokens from any
                              location ({player.manaPools.artifact} Artifact / {player.manaPools.lore} Lore Mana available;{" "}
                              {player.witheringTokens.artifact} / {player.witheringTokens.lore} / {state.witheringTokens} Withering Tokens on
                              their Artifact Pool / Lore Pool / The Rot):
                            </p>
                            <label>
                              Artifact Mana:{" "}
                              <input
                                type="number"
                                min={0}
                                max={reveal.attunementCost}
                                value={communionArtifactMana}
                                onChange={(e) => setCommunionArtifactMana(Math.max(0, Number(e.target.value) || 0))}
                              />
                            </label>
                            <label>
                              {" "}
                              Withering from their Artifact Pool:{" "}
                              <input
                                type="number"
                                min={0}
                                max={player.witheringTokens.artifact}
                                value={communionWitheringArtifact}
                                onChange={(e) => setCommunionWitheringArtifact(Math.max(0, Number(e.target.value) || 0))}
                              />
                            </label>
                            <label>
                              {" "}
                              Withering from their Lore Pool:{" "}
                              <input
                                type="number"
                                min={0}
                                max={player.witheringTokens.lore}
                                value={communionWitheringLore}
                                onChange={(e) => setCommunionWitheringLore(Math.max(0, Number(e.target.value) || 0))}
                              />
                            </label>
                            <label>
                              {" "}
                              Withering from The Rot:{" "}
                              <input
                                type="number"
                                min={0}
                                max={state.witheringTokens}
                                value={communionWitheringRot}
                                onChange={(e) => setCommunionWitheringRot(Math.max(0, Number(e.target.value) || 0))}
                              />
                            </label>
                            <span className="meta"> Lore Mana (remainder): {loreMana}</span>
                            <button
                              disabled={!covered}
                              onClick={() =>
                                attempt(() =>
                                  attuneLoreCardWithCommunion(
                                    state,
                                    communionIndex,
                                    {
                                      artifactMana: communionArtifactMana,
                                      loreMana,
                                      witheringArtifact: communionWitheringArtifact,
                                      witheringLore: communionWitheringLore,
                                      witheringRot: communionWitheringRot,
                                    },
                                    atCap ? 0 : undefined,
                                  ),
                                )
                              }
                            >
                              Attune with Communion
                            </button>
                          </div>
                        );
                      })()}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="setup-row">
              <button onClick={() => attempt(() => revealLoreCard(state))}>Reveal Next Card</button>
              {insightIndex >= 0 && (
                <button className="secondary" onClick={() => attempt(() => discardInsight(state, insightIndex, "lore"))}>
                  Discard Rune of Insight (look at 3, choose 1)
                </button>
              )}
              {seekingIndex >= 0 && (
                <button className="secondary" onClick={() => attempt(() => discardSeeking(state, seekingIndex, "lore"))}>
                  Discard Rune of Seeking (search deck for any card)
                </button>
              )}
            </div>
          )}

          <div>
            <button
              className="secondary"
              disabled={!!reveal}
              onClick={() => attempt(() => leaveAncientShrine(state))}
            >
              Leave The Ancient Shrine
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// "The Warriors Guild allows the visitor to perform actions at both the
// Market and the Artificer as though they had placed their action token on
// both." purchaseFromMarket/skipMarket defer completeTurn while
// pendingAction.locationId is "warriorsGuild" (see turnEngine.ts) instead of
// ending the turn after the Market half, so the engine supports exactly the
// two-phase flow this panel walks through: Market half first (tracked with
// local state, since nothing in GameState itself distinguishes "already
// bought/skipped this visit" — the engine only refuses a *second* Guild
// visit this round, not a second purchase within one), then the Artificer
// half via the real ArtificerPanel (unchanged — it already accepts
// "warriorsGuild" as a valid pendingAction.locationId, and its own "Leave"
// button is what finally ends the turn).
function WarriorsGuildPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const { playerId } = state.pendingAction!;
  const player = state.players[playerId];
  const fortuneIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Fortune");
  const [marketDone, setMarketDone] = useState(false);

  function attemptMarket(fn: () => GameState) {
    try {
      setState(fn());
      setMarketDone(true);
    } catch (err) {
      console.error(err);
    }
  }

  if (state.pendingArtifactOnPurchase) {
    return <OnPurchaseFreeLoreAttunePanel state={state} setState={setState} />;
  }

  if (state.pendingFactionPerks.some((p) => p.playerId === playerId)) {
    return (
      <PendingFactionPerkPanel
        state={state}
        setState={setState}
        headerName={`The Warriors Guild — ${player.character.name}`}
      />
    );
  }

  if (marketDone) {
    return <ArtificerPanel state={state} setState={setState} />;
  }

  return (
    <section className="panel">
      <h3>
        The Warriors Guild — {player.character.name} ({player.gold} Gold)
      </h3>
      <p className="meta">Market half — purchase one card, or skip straight to Attuning at the Artificer.</p>
      <div className="card-grid">
        {state.artifactRow.map((card, i) =>
          card ? (
            <div className="card" key={i}>
              <h3>{card.name}</h3>
              <p className="meta">
                {card.type} · {card.slot} · Attack {card.attack}
              </p>
              <p>{card.ability}</p>
              <p className="meta">
                Gold {card.goldCost} · Attune {card.attunementCost}
              </p>
              <button
                disabled={player.gold < card.goldCost}
                onClick={() => attemptMarket(() => purchaseFromMarket(state, i))}
              >
                Buy for {card.goldCost} Gold
              </button>
              {fortuneIndex >= 0 && (
                <button
                  disabled={player.gold < Math.max(0, card.goldCost - 3)}
                  onClick={() => attemptMarket(() => purchaseFromMarket(state, i, fortuneIndex))}
                >
                  Buy for {Math.max(0, card.goldCost - 3)} Gold (discard Rune of Fortune)
                </button>
              )}
            </div>
          ) : (
            <div className="card" key={i}>
              <p className="meta">(empty — the Artifact Deck and discard pile are both depleted)</p>
            </div>
          ),
        )}
      </div>
      <button className="secondary" onClick={() => attemptMarket(() => skipMarket(state))}>
        Skip to Attuning
      </button>
    </section>
  );
}

// Same two-phase pattern as WarriorsGuildPanel, for Library + Ancient Shrine.
function ScholarsGuildPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const { playerId } = state.pendingAction!;
  const player = state.players[playerId];
  const fortuneIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Fortune");
  const [libraryDone, setLibraryDone] = useState(false);

  function attemptLibrary(fn: () => GameState) {
    try {
      setState(fn());
      setLibraryDone(true);
    } catch (err) {
      console.error(err);
    }
  }

  if (state.pendingFactionPerks.some((p) => p.playerId === playerId)) {
    return (
      <PendingFactionPerkPanel
        state={state}
        setState={setState}
        headerName={`The Scholars Guild — ${player.character.name}`}
      />
    );
  }

  if (libraryDone) {
    return <AncientShrinePanel state={state} setState={setState} />;
  }

  return (
    <section className="panel">
      <h3>
        The Scholars Guild — {player.character.name} ({player.gold} Gold)
      </h3>
      <p className="meta">Library half — purchase one card, or skip straight to Attuning at the Ancient Shrine.</p>
      <div className="card-grid">
        {state.loreRow.map((card, i) =>
          card ? (
            <div className="card" key={i}>
              <h3>{card.name}</h3>
              <p className="meta">{card.type}</p>
              <p>
                vs Aberration {card.vsAberration} · vs Construct {card.vsConstruct} · vs Undead {card.vsUndead}
              </p>
              <p className="meta">
                Gold {card.goldCost} · Attune {card.attunementCost}
              </p>
              <button
                disabled={player.gold < card.goldCost}
                onClick={() => attemptLibrary(() => purchaseFromLibrary(state, i))}
              >
                Buy for {card.goldCost} Gold
              </button>
              {fortuneIndex >= 0 && (
                <button
                  disabled={player.gold < Math.max(0, card.goldCost - 3)}
                  onClick={() => attemptLibrary(() => purchaseFromLibrary(state, i, fortuneIndex))}
                >
                  Buy for {Math.max(0, card.goldCost - 3)} Gold (discard Rune of Fortune)
                </button>
              )}
            </div>
          ) : (
            <div className="card" key={i}>
              <p className="meta">(empty — the Lore Deck and discard pile are both depleted)</p>
            </div>
          ),
        )}
      </div>
      <button className="secondary" onClick={() => attemptLibrary(() => skipLibrary(state))}>
        Skip to Attuning
      </button>
    </section>
  );
}

function ValleyPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const { playerId } = state.pendingAction!;
  const player = state.players[playerId];
  const encounter = state.pendingValleyEncounter;
  const outcome = state.pendingValleyOutcome;
  const step = state.pendingEmbraceStep;
  const [artifactSplit, setArtifactSplit] = useState(0);
  const [tradeSource, setTradeSource] = useState<{ from: "deck" | "discard"; index: number } | null>(null);
  const [tradeRowIndex, setTradeRowIndex] = useState<number | null>(null);
  const [whisperedOrder, setWhisperedOrder] = useState<number[]>([]);
  const premonitionIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Premonition");
  const defianceIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Defiance");
  const preservationIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Preservation");
  const prophecyIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Prophecy");
  const vengeanceIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Vengeance");
  const fractureIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Fracture");

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  const premonition = state.pendingValleyPremonition;
  if (premonition) {
    return (
      <section className="panel">
        <h3>The Valley — {player.character.name}</h3>
        <p className="meta">Rune of Premonition — choose which Rot card to encounter. The others are discarded.</p>
        <div className="card-grid">
          {premonition.revealed.map((rc, i) => (
            <div className="card" key={i}>
              <h3>{rc.card.name}</h3>
              <p className="meta">
                {rc.kind === "combat" ? `${rc.card.creatureType} · Attack ${rc.card.attack}` : "Scenario"}
              </p>
              <button onClick={() => attempt(() => resolveValleyPremonition(state, i))}>Encounter this</button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const scry = state.pendingValleyScry;
  if (scry) {
    return (
      <section className="panel">
        <h3>The Valley — {player.character.name}</h3>
        {scry.stage === "offered" ? (
          <>
            {(player.factionTrack.valley ?? 0) >= 3 && (
              <p className="meta">Faction 3 — you may peek at the top of The Rot deck before it's revealed.</p>
            )}
            <div className="setup-row">
              {(player.factionTrack.valley ?? 0) >= 3 && (
                <button onClick={() => attempt(() => peekValleyRotCard(state))}>Peek Top Card</button>
              )}
              {premonitionIndex >= 0 && (
                <button onClick={() => attempt(() => discardPremonition(state, premonitionIndex))}>
                  Discard Rune of Premonition (look at 3, choose 1)
                </button>
              )}
              <button className="secondary" onClick={() => attempt(() => skipValleyScry(state))}>
                Don't Peek
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="card-grid">
              <div className="card">
                <h3>{scry.card.card.name}</h3>
                <p className="meta">
                  {scry.card.kind === "combat" ? `${scry.card.card.creatureType} · Attack ${scry.card.card.attack}` : "Scenario"}
                </p>
              </div>
            </div>
            <div className="setup-row">
              <button onClick={() => attempt(() => resolveValleyScry(state, "keep"))}>Keep on Top</button>
              <button className="secondary" onClick={() => attempt(() => resolveValleyScry(state, "discard"))}>
                Discard
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  const foresight = state.pendingForesightChoice;
  if (foresight) {
    return (
      <section className="panel">
        <h3>The Valley — {player.character.name}</h3>
        <p className="meta">Foresight — choose which Rot card to encounter. The other returns to the top of the deck.</p>
        <div className="card-grid">
          {foresight.map((rc, i) => (
            <div className="card" key={i}>
              <h3>{rc.card.name}</h3>
              <p className="meta">
                {rc.kind === "combat" ? `${rc.card.creatureType} · Attack ${rc.card.attack}` : "Scenario"}
              </p>
              <button onClick={() => attempt(() => chooseForesightEncounter(state, i as 0 | 1))}>
                Encounter this
              </button>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const attackRoll = state.pendingValleyAttackRoll;
  if (attackRoll) {
    return (
      <section className="panel">
        <h3>The Valley — {player.character.name}</h3>
        <p>
          {attackRoll.loreCardName}: {attackRoll.dice[0]} + {attackRoll.dice[1]}
        </p>
        {fractureIndex >= 0 && (
          <div className="setup-row">
            <button onClick={() => attempt(() => resolveValleyAttackRoll(state, fractureIndex, 0))}>
              Discard Rune of Fracture — reroll die 1 ({attackRoll.dice[0]})
            </button>
            <button onClick={() => attempt(() => resolveValleyAttackRoll(state, fractureIndex, 1))}>
              Discard Rune of Fracture — reroll die 2 ({attackRoll.dice[1]})
            </button>
          </div>
        )}
        <button onClick={() => attempt(() => resolveValleyAttackRoll(state))}>Resolve</button>
      </section>
    );
  }

  if (outcome) {
    const choiceKind = outcome.effectText ? detectRotEffectChoice(outcome.effectText) : null;
    const outcomeLabel =
      outcome.outcome === "win"
        ? "Victory!"
        : outcome.outcome === "loss"
          ? "Defeat."
          : outcome.outcome === "embrace"
            ? "Embraced The Rot."
            : "Resisted The Rot.";

    return (
      <section className="panel">
        <h3>The Valley — {player.character.name}</h3>
        <p className="meta">
          {outcome.card.card.name} — {outcomeLabel}
        </p>
        {outcome.dice && (
          <p className="meta">
            Rolled {outcome.dice[0]} + {outcome.dice[1]} using {outcome.loreCardName}.
          </p>
        )}
        {outcome.effectText && <p>{outcome.effectText}</p>}

        {choiceKind?.kind === "corruptedGreed" && (
          <div className="card-grid">
            {state.artifactRow.map((card, i) =>
              card ? (
                <div className="card" key={i}>
                  <h3>{card.name}</h3>
                  <p className="meta">Gold {card.goldCost}</p>
                  <button onClick={() => attempt(() => finalizeValleyOutcome(state, { rowIndex: i }))}>
                    Discard this
                  </button>
                </div>
              ) : (
                <div className="card" key={i}>
                  <p className="meta">(empty)</p>
                </div>
              ),
            )}
          </div>
        )}

        {choiceKind?.kind === "taintedTrade" && (
          <>
            <p className="meta">Choose a card to offer, and an Artifact Row slot to trade it for.</p>
            <div className="card-grid">
              {player.artifactDeck.map((card, i) => (
                <div className={`card${tradeSource?.from === "deck" && tradeSource.index === i ? " selected" : ""}`} key={`deck-${i}`}>
                  <h3>{card.name}</h3>
                  <p className="meta">From your Artifact deck · Gold {card.goldCost}</p>
                  <button onClick={() => setTradeSource({ from: "deck", index: i })}>Offer this</button>
                </div>
              ))}
              {player.artifactDiscard.map((card, i) => (
                <div
                  className={`card${tradeSource?.from === "discard" && tradeSource.index === i ? " selected" : ""}`}
                  key={`discard-${i}`}
                >
                  <h3>{card.name}</h3>
                  <p className="meta">From your Artifact discard · Gold {card.goldCost}</p>
                  <button onClick={() => setTradeSource({ from: "discard", index: i })}>Offer this</button>
                </div>
              ))}
            </div>
            <p className="meta">Trade for:</p>
            <div className="card-grid">
              {state.artifactRow.map((card, i) =>
                card ? (
                  <div className={`card${tradeRowIndex === i ? " selected" : ""}`} key={i}>
                    <h3>{card.name}</h3>
                    <p className="meta">Gold {card.goldCost}</p>
                    <button onClick={() => setTradeRowIndex(i)}>Trade for this</button>
                  </div>
                ) : (
                  <div className="card" key={i}>
                    <p className="meta">(empty)</p>
                  </div>
                ),
              )}
            </div>
            <button
              disabled={!tradeSource || tradeRowIndex === null}
              onClick={() =>
                attempt(() =>
                  finalizeValleyOutcome(state, {
                    tradeSource: tradeSource ?? undefined,
                    tradeRowIndex: tradeRowIndex ?? undefined,
                  }),
                )
              }
            >
              Confirm Trade
            </button>
          </>
        )}

        {choiceKind?.kind === "forbiddenKnowledge" &&
          (!step ? (
            <button onClick={() => attempt(() => revealForbiddenKnowledge(state))}>Reveal Top 3 Lore Cards</button>
          ) : step.kind === "forbiddenKnowledge" ? (
            <div className="card-grid">
              {step.revealed.map((card, i) => (
                <div className="card" key={i}>
                  <h3>{card.name}</h3>
                  <p className="meta">
                    vs Aberration {card.vsAberration} · vs Construct {card.vsConstruct} · vs Undead {card.vsUndead}
                  </p>
                  <button onClick={() => attempt(() => chooseForbiddenKnowledge(state, i))}>
                    Keep in Lore discard
                  </button>
                </div>
              ))}
            </div>
          ) : null)}

        {choiceKind?.kind === "whisperedSecrets" &&
          (!step ? (
            <div className="setup-row">
              <button onClick={() => attempt(() => chooseWhisperedSecretsDeck(state, "ownArtifact"))}>
                Your Artifact Deck
              </button>
              <button onClick={() => attempt(() => chooseWhisperedSecretsDeck(state, "ownLore"))}>
                Your Lore Deck
              </button>
              <button onClick={() => attempt(() => chooseWhisperedSecretsDeck(state, "sharedArtifact"))}>
                Shared Artifact Deck
              </button>
              <button onClick={() => attempt(() => chooseWhisperedSecretsDeck(state, "sharedLore"))}>
                Shared Lore Deck
              </button>
            </div>
          ) : step.kind === "whisperedSecrets" ? (
            <>
              <p className="meta">Click each card in the order it should return to the top (topmost first).</p>
              <div className="card-grid">
                {step.revealed.map((card, i) => {
                  const position = whisperedOrder.indexOf(i);
                  return (
                    <div className="card" key={i}>
                      <h3>{card.name}</h3>
                      <button
                        onClick={() =>
                          setWhisperedOrder((prev) =>
                            prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i],
                          )
                        }
                      >
                        {position === -1 ? "Add to order" : `Position ${position + 1} (click to undo)`}
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                disabled={whisperedOrder.length !== step.revealed.length}
                onClick={() => attempt(() => resolveWhisperedSecrets(state, whisperedOrder))}
              >
                Confirm Order
              </button>
            </>
          ) : null)}

        {choiceKind?.kind === "pool" && (
          <div className="setup-row">
            <button onClick={() => attempt(() => finalizeValleyOutcome(state, { pool: "artifact" }))}>
              Artifact Pool
            </button>
            <button onClick={() => attempt(() => finalizeValleyOutcome(state, { pool: "lore" }))}>Lore Pool</button>
          </div>
        )}
        {choiceKind?.kind === "manaSplit" && (
          <div className="setup-row">
            <label>
              Artifact:{" "}
              <input
                type="number"
                min={0}
                max={choiceKind.total}
                value={artifactSplit}
                onChange={(e) =>
                  setArtifactSplit(Math.max(0, Math.min(choiceKind.total, Number(e.target.value) || 0)))
                }
              />
            </label>
            <span className="meta">Lore: {choiceKind.total - artifactSplit}</span>
            <button
              onClick={() =>
                attempt(() =>
                  finalizeValleyOutcome(state, {
                    manaSplit: { artifact: artifactSplit, lore: choiceKind.total - artifactSplit },
                  }),
                )
              }
            >
              Confirm
            </button>
          </div>
        )}
        {!choiceKind && <button onClick={() => attempt(() => finalizeValleyOutcome(state))}>Continue</button>}
        {outcome.outcome === "loss" && vengeanceIndex >= 0 && (
          <div className="exchange-section">
            <p className="meta">
              Rune of Vengeance — remove up to 3 Withering Tokens from The Rot ({state.witheringTokens} currently there).
            </p>
            <button onClick={() => attempt(() => discardVengeance(state, vengeanceIndex))}>Discard Rune of Vengeance</button>
          </div>
        )}
      </section>
    );
  }

  if (!encounter) {
    return (
      <section className="panel">
        <h3>The Valley — {player.character.name}</h3>
        {defianceIndex >= 0 && (
          <button className="secondary" onClick={() => attempt(() => discardDefiance(state, defianceIndex))}>
            Discard Rune of Defiance (remove 1 additional Withering Token)
          </button>
        )}
      </section>
    );
  }

  if (encounter.kind === "combat") {
    const card = encounter.card;
    const field: "vsAberration" | "vsConstruct" | "vsUndead" =
      card.creatureType === "Aberration" ? "vsAberration" : card.creatureType === "Construct" ? "vsConstruct" : "vsUndead";
    return (
      <section className="panel">
        <h3>The Valley — {player.character.name}</h3>
        <div className="card-grid">
          <div className="card">
            <h3>{card.name}</h3>
            <p className="meta">
              {card.creatureType} · Attack {card.attack}
            </p>
            <p>Win: {card.win}</p>
            <p>Loss: {card.loss}</p>
          </div>
        </div>
        {player.attunedLore.length === 0 ? (
          <>
            <p className="meta">No Lore Attuned — the Loss condition triggers automatically.</p>
            <button onClick={() => attempt(() => chooseValleyLore(state, null))}>Resolve Automatic Loss</button>
          </>
        ) : (
          <div className="setup-row">
            {player.attunedLore.map((lore, i) => (
              <button key={i} onClick={() => attempt(() => chooseValleyLore(state, i))}>
                Fight with {lore.name} (+{lore[field]})
              </button>
            ))}
            {preservationIndex >= 0 &&
              player.attunedLore.map((lore, i) => (
                <button key={`preserve-${i}`} onClick={() => attempt(() => chooseValleyLore(state, i, Math.random, preservationIndex))}>
                  Fight with {lore.name} (discard Rune of Preservation instead of {lore.name})
                </button>
              ))}
            {prophecyIndex >= 0 &&
              player.attunedLore.map((lore, i) => (
                <button key={`prophecy-${i}`} onClick={() => attempt(() => chooseValleyLore(state, i, Math.random, undefined, prophecyIndex))}>
                  Fight with {lore.name} (remove Rune of Prophecy from the game for +20 Attack)
                </button>
              ))}
            {player.character.name === "Taza, the Shadow Knight" &&
              state.witheringTokens >= 1 &&
              player.attunedLore.map((lore, i) => (
                <button
                  key={`wield-${i}`}
                  onClick={() => attempt(() => chooseValleyLore(state, i, Math.random, undefined, undefined, true))}
                >
                  Fight with {lore.name} (Wield the Rot: remove 1 Withering Token from The Rot for +2 Attack)
                </button>
              ))}
          </div>
        )}
      </section>
    );
  }

  const card = encounter.card;
  return (
    <section className="panel">
      <h3>The Valley — {player.character.name}</h3>
      <div className="card-grid">
        <div className="card">
          <h3>{card.name}</h3>
          <p className="meta">Scenario</p>
          <p>Embrace: {card.embrace}</p>
          <p className="meta">Resist: Place 1 Withering Token in each Mana Pool.</p>
        </div>
      </div>
      <div className="setup-row">
        <button onClick={() => attempt(() => chooseValleyScenario(state, "embrace"))}>Embrace The Rot</button>
        <button onClick={() => attempt(() => chooseValleyScenario(state, "resist"))}>Resist The Rot</button>
      </div>
    </section>
  );
}

function ArenaPeekPicker({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const peek = state.pendingArenaPeek!;
  const [destinations, setDestinations] = useState<("top" | "bottom" | null)[]>(peek.cards.map(() => null));

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  function setDestination(i: number, dest: "top" | "bottom") {
    setDestinations((prev) => prev.map((d, idx) => (idx === i ? dest : d)));
  }

  const allChosen = destinations.every((d) => d !== null);

  function confirm() {
    const topIndices = destinations.map((d, i) => (d === "top" ? i : -1)).filter((i) => i !== -1);
    const bottomIndices = destinations.map((d, i) => (d === "bottom" ? i : -1)).filter((i) => i !== -1);
    attempt(() => resolveArenaPeek(state, topIndices, bottomIndices));
  }

  return (
    <>
      <p className="meta">Choose whether each card returns to the top or bottom of the deck.</p>
      <div className="card-grid">
        {peek.cards.map((card, i) => (
          <div className="card" key={i}>
            <h3>{card.name}</h3>
            <div className="setup-row">
              <button
                className={destinations[i] === "top" ? undefined : "secondary"}
                onClick={() => setDestination(i, "top")}
              >
                Top
              </button>
              <button
                className={destinations[i] === "bottom" ? undefined : "secondary"}
                onClick={() => setDestination(i, "bottom")}
              >
                Bottom
              </button>
            </div>
          </div>
        ))}
      </div>
      <button disabled={!allChosen} onClick={confirm}>
        Confirm
      </button>
    </>
  );
}

function ArenaPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const { playerId, arenaFeePaid, usedArenaPeek } = state.pendingAction!;
  const player = state.players[playerId];
  const level = player.factionTrack.arena ?? 0;
  const combatCount = player.rotCardsInPlayerArea.filter((c) => c.kind === "combat").length;
  const scenarioCount = player.rotCardsInPlayerArea.filter((c) => c.kind === "scenario").length;

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <section className="panel">
      <h3>The Arena — {player.character.name}</h3>

      {!arenaFeePaid ? (
        <>
          <p className="meta">
            Pay 1 Rot Card to enter The Arena
            {level >= 2 ? ", or 1 Gold instead (Faction 2 benefit)." : "."}
          </p>
          <div className="setup-row">
            <button disabled={combatCount === 0} onClick={() => attempt(() => payArenaEntryFee(state, "combat"))}>
              Pay with a Combat card ({combatCount} available)
            </button>
            <button disabled={scenarioCount === 0} onClick={() => attempt(() => payArenaEntryFee(state, "scenario"))}>
              Pay with a Scenario card ({scenarioCount} available)
            </button>
            {level >= 2 && (
              <button disabled={player.gold < 1} onClick={() => attempt(() => payArenaEntryFee(state, "gold"))}>
                Pay 1 Gold ({player.gold} available)
              </button>
            )}
          </div>
        </>
      ) : state.pendingArenaPeek ? (
        <ArenaPeekPicker state={state} setState={setState} />
      ) : (
        <>
          <p className="meta">
            Entry fee paid. Combat resolves for everyone in The Arena at the start of the Cleanup Phase.
          </p>
          {level >= 1 && !usedArenaPeek && (
            <div className="setup-row">
              <button className="secondary" onClick={() => attempt(() => peekArenaDeck(state, "sharedArtifact"))}>
                Peek Shared Artifact Deck
              </button>
              <button className="secondary" onClick={() => attempt(() => peekArenaDeck(state, "sharedLore"))}>
                Peek Shared Lore Deck
              </button>
              <button className="secondary" onClick={() => attempt(() => peekArenaDeck(state, "ownArtifact"))}>
                Peek Your Artifact Deck
              </button>
              <button className="secondary" onClick={() => attempt(() => peekArenaDeck(state, "ownLore"))}>
                Peek Your Lore Deck
              </button>
            </div>
          )}
          <button onClick={() => attempt(() => leaveArena(state))}>Leave The Arena</button>
        </>
      )}
    </section>
  );
}

function ArenaRewardPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const reward = state.pendingArenaReward!;
  const player = state.players[reward.playerId];

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <section className="panel">
      <h3>Arena Reward — {player.character.name}</h3>
      <p className="meta">Choose one card to keep for free. The other returns to the bottom of its deck.</p>
      <div className="card-grid">
        {reward.artifactCard && (
          <div className="card">
            <h3>{reward.artifactCard.name}</h3>
            <p className="meta">
              {reward.artifactCard.type} · {reward.artifactCard.slot} · Attack {reward.artifactCard.attack}
            </p>
            <p>{reward.artifactCard.ability}</p>
            <button onClick={() => attempt(() => resolveArenaReward(state, "artifact"))}>Take this</button>
          </div>
        )}
        {reward.loreCard && (
          <div className="card">
            <h3>{reward.loreCard.name}</h3>
            <p className="meta">{reward.loreCard.type}</p>
            <p>
              vs Aberration {reward.loreCard.vsAberration} · vs Construct {reward.loreCard.vsConstruct} · vs Undead{" "}
              {reward.loreCard.vsUndead}
            </p>
            <button onClick={() => attempt(() => resolveArenaReward(state, "lore"))}>Take this</button>
          </div>
        )}
      </div>
    </section>
  );
}

function FinalBattleOfferPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const offer = state.pendingFinalBattleOffer!;
  const player = state.players[offer.playerId];

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <section className="panel">
      <h3>The Final Battle — {player.character.name}</h3>
      <p className="meta">Victory Condition met: {player.character.victoryCondition}</p>
      <p>{player.character.name} may initiate The Final Battle and confront The Rot.</p>
      <div className="setup-row">
        <button onClick={() => attempt(() => initiateFinalBattle(state))}>Initiate The Final Battle</button>
        <button className="secondary" onClick={() => attempt(() => declineFinalBattle(state))}>
          Decline
        </button>
      </div>
    </section>
  );
}

function FinalBattleVengeance({
  state,
  setState,
  playerId,
}: {
  state: GameState;
  setState: (s: GameState) => void;
  playerId: string;
}) {
  const player = state.players[playerId];
  const vengeanceIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Vengeance");

  if (vengeanceIndex < 0) return null;

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="exchange-section">
      <p className="meta">Rune of Vengeance — remove up to 3 Withering Tokens from The Rot ({state.witheringTokens} currently there).</p>
      <button onClick={() => attempt(() => discardVengeance(state, vengeanceIndex))}>Discard Rune of Vengeance</button>
    </div>
  );
}

// "The first player to initiate The Final Battle receives a one-time boon
// from the gods... choose 1 Artifact or Lore card from their Deck or
// Discard Pile and Attune it without paying its Mana cost." Rendered ahead
// of the normal combat UI (see FinalBattlePanel) since it must resolve
// before the first Lore choice — see the guard in chooseFinalBattleLore.
function FinalBattleBoonPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const boon = state.pendingFinalBattleBoon!;
  const player = state.players[boon.playerId];

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  const artifactGroups: { label: string; source: "deck" | "discard"; cards: (typeof player.artifactDeck) }[] = [
    { label: "Artifact Deck", source: "deck", cards: player.artifactDeck },
    { label: "Artifact Discard", source: "discard", cards: player.artifactDiscard },
  ];
  const loreGroups: { label: string; source: "deck" | "discard"; cards: (typeof player.loreDeck) }[] = [
    { label: "Lore Deck", source: "deck", cards: player.loreDeck },
    { label: "Lore Discard", source: "discard", cards: player.loreDiscard },
  ];
  const atLoreCap = player.attunedLore.length >= 3;

  return (
    <section className="panel">
      <h3>A Boon From The Gods — {player.character.name}</h3>
      <p>
        {player.character.name} is the first to initiate The Final Battle. Before combat begins, they may Attune 1
        Artifact or Lore card from any Deck or Discard Pile without paying its Mana cost.
      </p>

      {artifactGroups.map(
        ({ label, source, cards }) =>
          cards.length > 0 && (
            <div className="exchange-section" key={label}>
              <p className="meta">{label}</p>
              <div className="card-grid">
                {cards.map((card, i) => {
                  const slots = getArtifactSlots(card);
                  const runeStonesFull =
                    slots.length === 1 && slots[0] === "Rune Stone" && player.equippedRuneStones.length >= 3;
                  return (
                    <div className="card" key={i}>
                      <h3>{card.name}</h3>
                      <p className="meta">
                        {card.type} · {card.slot} · Attack {card.attack}
                      </p>
                      <p className="meta">Attune free (gods' boon)</p>
                      {runeStonesFull && slots.length === 1 && <p className="meta">You already have 3 Attuned Rune Stones.</p>}
                      <div className="setup-row">
                        {slots.length > 1 ? (
                          slots.map((slot) => (
                            <button
                              key={slot}
                              onClick={() =>
                                attempt(() => resolveFinalBattleBoon(state, { source, deck: "artifact", index: i, chosenSlot: slot }))
                              }
                            >
                              Attune as {slot}
                            </button>
                          ))
                        ) : (
                          <button
                            disabled={runeStonesFull}
                            onClick={() => attempt(() => resolveFinalBattleBoon(state, { source, deck: "artifact", index: i }))}
                          >
                            Attune
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ),
      )}

      {loreGroups.map(
        ({ label, source, cards }) =>
          cards.length > 0 && (
            <div className="exchange-section" key={label}>
              <p className="meta">{label}</p>
              <div className="card-grid">
                {cards.map((card, i) => (
                  <div className="card" key={i}>
                    <h3>{card.name}</h3>
                    <p className="meta">
                      vs Aberration {card.vsAberration} · vs Construct {card.vsConstruct} · vs Undead {card.vsUndead}
                    </p>
                    <p className="meta">Attune free (gods' boon)</p>
                    {atLoreCap && <p className="meta">You already have 3 Attuned Lore cards — choose one to replace.</p>}
                    <div className="setup-row">
                      {atLoreCap ? (
                        player.attunedLore.map((c, replaceIndex) => (
                          <button
                            key={replaceIndex}
                            onClick={() =>
                              attempt(() => resolveFinalBattleBoon(state, { source, deck: "lore", index: i, replaceIndex }))
                            }
                          >
                            Replace {c.name}
                          </button>
                        ))
                      ) : (
                        <button onClick={() => attempt(() => resolveFinalBattleBoon(state, { source, deck: "lore", index: i }))}>
                          Attune
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ),
      )}

      <button className="secondary" onClick={() => attempt(() => declineFinalBattleBoon(state))}>
        Decline the boon
      </button>
    </section>
  );
}

// Final Battle Combat step 1, "Choose Lore": pick 1 or 2 Attuned Lore cards
// to attack with (their values total together) — any others stay Attuned
// for a later combat.
function FinalBattleCombatChoicePanel({
  state,
  attempt,
}: {
  state: GameState;
  attempt: (fn: () => GameState) => void;
}) {
  const combat = state.pendingFinalBattleCombat!;
  const player = state.players[combat.playerId];
  const [selected, setSelected] = useState<number[]>([]);
  const [preserveIndex, setPreserveIndex] = useState<number | null>(null);
  const [wieldTheRot, setWieldTheRot] = useState(false);

  const rotBase = combat.rotCards[0].attack + combat.rotCards[1].attack;
  const rotArtifactBonus = state.rotArtifacts.reduce((sum, c) => sum + c.attack, 0);
  const rotAttack = rotBase + rotArtifactBonus;
  const vsValue = (lore: (typeof player.attunedLore)[number], type: "Aberration" | "Construct" | "Undead") =>
    type === "Aberration" ? lore.vsAberration : type === "Construct" ? lore.vsConstruct : lore.vsUndead;
  const bestFor = (lore: (typeof player.attunedLore)[number]) =>
    Math.max(vsValue(lore, combat.rotCards[0].creatureType), vsValue(lore, combat.rotCards[1].creatureType));
  const preservationIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Preservation");
  const canWieldTheRot = player.character.name === "Taza, the Shadow Knight" && state.witheringTokens >= 1;

  function toggle(i: number) {
    setSelected((prev) => {
      if (prev.includes(i)) {
        const next = prev.filter((x) => x !== i);
        if (preserveIndex === i) setPreserveIndex(null);
        return next;
      }
      if (prev.length >= 2) return prev;
      return [...prev, i];
    });
  }

  const totalLoreValue = selected.reduce((sum, i) => sum + bestFor(player.attunedLore[i]), 0);

  function attack() {
    attempt(() =>
      chooseFinalBattleLore(
        state,
        selected,
        Math.random,
        preserveIndex !== null ? preservationIndex : undefined,
        preserveIndex !== null ? preserveIndex : undefined,
        wieldTheRot,
      ),
    );
  }

  return (
    <section className="panel">
      <h3>The Final Battle — {player.character.name}</h3>
      <div className="card-grid">
        {combat.rotCards.map((card, i) => (
          <div className="card" key={i}>
            <h3>{card.name}</h3>
            <p className="meta">
              {card.creatureType} · Attack {card.attack}
            </p>
          </div>
        ))}
      </div>
      <p className="meta">
        The Rot's Attack: {rotBase} (combined) + {rotArtifactBonus} (Rot Character Mat) = {rotAttack}
      </p>
      {player.attunedLore.length === 0 ? (
        <p className="meta">No Attuned Lore remains — {player.character.name} cannot fight.</p>
      ) : (
        <>
          <p className="meta">Choose 1 or 2 Attuned Lore cards — their values total together.</p>
          <div className="setup-row">
            {player.attunedLore.map((lore, i) => (
              <label key={i} className="choice-row">
                <input
                  type="checkbox"
                  checked={selected.includes(i)}
                  disabled={!selected.includes(i) && selected.length >= 2}
                  onChange={() => toggle(i)}
                />
                {lore.name} (+{bestFor(lore)})
              </label>
            ))}
          </div>
          {preservationIndex >= 0 && selected.length > 0 && (
            <div className="setup-row">
              <label className="choice-row">
                <input
                  type="checkbox"
                  checked={preserveIndex !== null}
                  onChange={(e) => setPreserveIndex(e.target.checked ? selected[0] : null)}
                />
                Discard Rune of Preservation instead of{" "}
                {preserveIndex !== null && (
                  <select value={preserveIndex} onChange={(e) => setPreserveIndex(Number(e.target.value))}>
                    {selected.map((i) => (
                      <option key={i} value={i}>
                        {player.attunedLore[i].name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            </div>
          )}
          {canWieldTheRot && (
            <div className="setup-row">
              <label className="choice-row">
                <input type="checkbox" checked={wieldTheRot} onChange={(e) => setWieldTheRot(e.target.checked)} />
                Wield the Rot: remove 1 Withering Token from The Rot for +2 Attack
              </label>
            </div>
          )}
          <button disabled={selected.length === 0} onClick={attack}>
            {selected.length === 0
              ? "Choose at least 1 Lore card"
              : `Attack with ${selected.map((i) => player.attunedLore[i].name).join(" + ")} (+${totalLoreValue} Lore)`}
          </button>
        </>
      )}
    </section>
  );
}

// Combat step 4's win case, "Resolve Combat": choose as many Artifact cards
// on The Rot Character Mat to remove as the win margin earns (0-4 over ->
// 1, 5-9 -> 2, 10+ -> 3), capped at however many remain.
function RemoveRotArtifactsPanel({ state, attempt }: { state: GameState; attempt: (fn: () => GameState) => void }) {
  const [selected, setSelected] = useState<number[]>([]);
  const outcome = state.pendingFinalBattleOutcome!;
  const margin = outcome.playerAttack - outcome.rotAttack;
  const earned = rotArtifactsEarnedForMargin(margin);
  const needed = Math.min(earned, state.rotArtifacts.length);

  function toggle(i: number) {
    setSelected((prev) => {
      if (prev.includes(i)) return prev.filter((x) => x !== i);
      if (prev.length >= needed) return prev;
      return [...prev, i];
    });
  }

  return (
    <>
      <p className="meta">
        Won by {margin} — choose {needed} Artifact{needed === 1 ? "" : "s"} to remove from The Rot Character Mat.
      </p>
      <div className="card-grid">
        {state.rotArtifacts.map((card, i) => (
          <div className="card" key={i}>
            <h3>{card.name}</h3>
            <p className="meta">Attack {card.attack}</p>
            <label className="choice-row">
              <input
                type="checkbox"
                checked={selected.includes(i)}
                disabled={!selected.includes(i) && selected.length >= needed}
                onChange={() => toggle(i)}
              />
              Remove this
            </label>
          </div>
        ))}
      </div>
      <button disabled={selected.length !== needed} onClick={() => attempt(() => removeRotArtifact(state, selected))}>
        Remove selected
      </button>
    </>
  );
}

function FinalBattlePanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const combat = state.pendingFinalBattleCombat;
  const outcome = state.pendingFinalBattleOutcome;
  const attackRoll = state.pendingFinalBattleAttackRoll;

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  // The first initiator's boon (see FinalBattleBoonPanel) must resolve before
  // any combat UI, including the Rune of Fracture pause below.
  if (state.pendingFinalBattleBoon) {
    return <FinalBattleBoonPanel state={state} setState={setState} />;
  }

  // pendingFinalBattleCombat is deliberately left set during this pause (see
  // chooseFinalBattleLore's Rune of Fracture branch), so this must be checked
  // before the `combat` branch below or it would re-show the Lore picker.
  if (attackRoll && combat) {
    const player = state.players[combat.playerId];
    const fractureIndex = player.equippedRuneStones.findIndex((r) => r.name === "Rune of Fracture");
    return (
      <section className="panel">
        <h3>The Final Battle — {player.character.name}</h3>
        <p>
          {attackRoll.loreCardNames.join(", ")}: {attackRoll.dice[0]} + {attackRoll.dice[1]}
        </p>
        {fractureIndex >= 0 && (
          <div className="setup-row">
            <button onClick={() => attempt(() => resolveFinalBattleAttackRoll(state, fractureIndex, 0))}>
              Discard Rune of Fracture — reroll die 1 ({attackRoll.dice[0]})
            </button>
            <button onClick={() => attempt(() => resolveFinalBattleAttackRoll(state, fractureIndex, 1))}>
              Discard Rune of Fracture — reroll die 2 ({attackRoll.dice[1]})
            </button>
          </div>
        )}
        <button onClick={() => attempt(() => resolveFinalBattleAttackRoll(state))}>Resolve</button>
      </section>
    );
  }

  if (combat) {
    return (
      <FinalBattleCombatChoicePanel
        key={`${combat.playerId}-${combat.rotCards[0].name}-${combat.rotCards[1].name}`}
        state={state}
        attempt={attempt}
      />
    );
  }

  if (!outcome) return null;

  const player = state.players[outcome.playerId];

  return (
    <section className="panel">
      <h3>The Final Battle — {player.character.name}</h3>
      <p className="meta">
        {outcome.loreCardNames.join(", ")}: {outcome.dice[0]} + {outcome.dice[1]} → {outcome.playerAttack} Attack vs The Rot's{" "}
        {outcome.rotAttack} — {outcome.outcome === "win" ? "Victory!" : "Defeat."}
      </p>

      {outcome.stage === "removeCard" && outcome.outcome === "win" && (
        <RemoveRotArtifactsPanel state={state} attempt={attempt} />
      )}

      {outcome.stage === "removeCard" && outcome.outcome === "loss" && (
        <>
          <p className="meta">Choose 1 card on your Character board to lose permanently.</p>
          <div className="setup-row">
            {player.equippedWeapon && (
              <button onClick={() => attempt(() => removeOwnBoardCard(state, { kind: "weapon" }))}>
                Lose Weapon: {player.equippedWeapon.name}
              </button>
            )}
            {player.equippedArmor && (
              <button onClick={() => attempt(() => removeOwnBoardCard(state, { kind: "armor" }))}>
                Lose Armor: {player.equippedArmor.name}
              </button>
            )}
            {player.equippedImplement && (
              <button onClick={() => attempt(() => removeOwnBoardCard(state, { kind: "implement" }))}>
                Lose Implement: {player.equippedImplement.name}
              </button>
            )}
            {player.equippedRuneStones.map((stone, i) => (
              <button key={i} onClick={() => attempt(() => removeOwnBoardCard(state, { kind: "runeStone", index: i }))}>
                Lose Rune Stone: {stone.name}
              </button>
            ))}
            {player.attunedLore.map((lore, i) => (
              <button key={i} onClick={() => attempt(() => removeOwnBoardCard(state, { kind: "lore", index: i }))}>
                Lose Lore: {lore.name}
              </button>
            ))}
          </div>
          <FinalBattleVengeance state={state} setState={setState} playerId={outcome.playerId} />
        </>
      )}

      {outcome.stage === "divineReclamation" &&
        (player.loreDiscard.length === 0 ? (
          <>
            <p className="meta">
              Divine Reclamation — your Lore discard pile is empty, so there's nothing to reclaim.
            </p>
            <button onClick={() => attempt(() => resolveDivineReclamation(state, null))}>Continue</button>
          </>
        ) : (
          <>
            <p className="meta">
              Divine Reclamation — Attune a Lore card from your discard pile for free, or skip.
            </p>
            <div className="card-grid">
              {player.loreDiscard.map((card, i) => (
                <div className="card" key={i}>
                  <h3>{card.name}</h3>
                  {player.attunedLore.length < 3 ? (
                    <button onClick={() => attempt(() => resolveDivineReclamation(state, { discardIndex: i }))}>
                      Attune for free
                    </button>
                  ) : (
                    <div className="setup-row">
                      {player.attunedLore.map((existing, r) => (
                        <button
                          key={r}
                          onClick={() => attempt(() => resolveDivineReclamation(state, { discardIndex: i, replaceIndex: r }))}
                        >
                          Replace {existing.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button className="secondary" onClick={() => attempt(() => resolveDivineReclamation(state, null))}>
              Skip
            </button>
          </>
        ))}

      {outcome.stage === "pressTheAttack" && (
        <>
          <p className="meta">
            Press the Attack — remove 1 Lore card from your discard pile to fight again immediately, or continue.
          </p>
          {player.attunedLore.length > 0 && player.attunedLore.length + player.loreDiscard.length > 1 ? (
            <div className="setup-row">
              {player.loreDiscard.map((lore, i) => (
                <button key={i} onClick={() => attempt(() => resolvePressTheAttack(state, i))}>
                  Remove {lore.name} from the game and Press the Attack
                </button>
              ))}
            </div>
          ) : (
            <p className="meta">No spare Lore card to sacrifice — cannot Press the Attack.</p>
          )}
          <button className="secondary" onClick={() => attempt(() => resolvePressTheAttack(state, null))}>
            Continue
          </button>
        </>
      )}
    </section>
  );
}

function DeepWatersOfferPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const claim = state.pendingDeepWatersClaim!;
  const player = state.players[claim.playerId];

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <section className="panel">
      <h3>Deep Waters — {player.character.name}</h3>
      <p className="meta">
        At the start of your turn, you may place a Mana Token on a face-up Artifact card. That card costs you 1 less
        Gold and cannot be purchased by other players.
      </p>
      <div className="card-grid">
        {state.artifactRow.map((card, i) =>
          card ? (
            <div className="card" key={i}>
              <h3>{card.name}</h3>
              <p className="meta">Gold {card.goldCost}</p>
              <button onClick={() => attempt(() => resolveDeepWatersClaim(state, i))}>Claim this card</button>
            </div>
          ) : (
            <div className="card" key={i}>
              <p className="meta">(empty)</p>
            </div>
          ),
        )}
      </div>
      <button className="secondary" onClick={() => attempt(() => resolveDeepWatersClaim(state, null))}>
        Decline
      </button>
    </section>
  );
}

// Rune Stones whose ability is tied to a specific Location/moment rather than
// usable any time — surfaced inline in that Location's own panel (or, for
// Fracture, the combat panel's post-roll pause) instead of here.
const CONTEXTUAL_RUNE_STONES = new Set([
  "Rune of Barter",
  "Rune of Communion",
  "Rune of Defiance",
  "Rune of Fortune",
  "Rune of Fracture",
  "Rune of Insight",
  "Rune of Plenty",
  "Rune of Premonition",
  "Rune of Preservation",
  "Rune of Prophecy",
  "Rune of Resonance",
  "Rune of Seeking",
  "Rune of Vengeance",
]);

// Stones whose ability needs no further input beyond discarding — clicking
// fires immediately (Discovery/Excavation/Prospecting/Study/Whispers still
// pause afterward on a pendingRuneStoneChoice for the reveal).
const ZERO_ARG_RUNE_STONES: Record<string, (state: GameState, playerId: string, index: number) => GameState> = {
  "Rune of Cleansing": discardCleansingRune,
  "Rune of Discovery": discardDiscovery,
  "Rune of Excavation": discardExcavation,
  "Rune of Prospecting": discardProspecting,
  "Rune of Study": discardStudy,
  "Rune of Whispers": discardWhispers,
};

function discardPileOptions(player: EnginePlayerLike): { value: string; label: string }[] {
  return [
    ...player.artifactDiscard.map((c, i) => ({ value: `artifact:${i}`, label: `Artifact: ${c.name}` })),
    ...player.loreDiscard.map((c, i) => ({ value: `lore:${i}`, label: `Lore: ${c.name}` })),
  ];
}

function parseDiscardPileValue(value: string): { deck: "artifact" | "lore"; index: number } {
  const [deck, indexStr] = value.split(":");
  return { deck: deck as "artifact" | "lore", index: Number(indexStr) };
}

type EnginePlayerLike = { artifactDiscard: ArtifactCard[]; loreDiscard: LoreCard[] };

// Per-stone follow-up form for the "anytime" Rune Stones that need more than
// a plain discard (see ZERO_ARG_RUNE_STONES for the ones that don't).
function RuneStoneForm({
  state,
  setState,
  playerId,
  index,
  stoneName,
  onDone,
}: {
  state: GameState;
  setState: (s: GameState) => void;
  playerId: string;
  index: number;
  stoneName: string;
  onDone: () => void;
}) {
  const player = state.players[playerId];
  const [numA, setNumA] = useState(0);
  const [selA, setSelA] = useState("");
  const [selB, setSelB] = useState("");

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
      onDone();
    } catch (err) {
      console.error(err);
    }
  }

  const coreLocations = locations.filter((l) => l.hasFactionTrack && (player.factionTrack[l.id] ?? 0) < 3);
  const pileOptions = discardPileOptions(player);
  const artifactPileOptions = player.artifactDiscard.map((c, i) => ({ value: String(i), label: c.name }));
  const rowOptions = (row: (ArtifactCard | LoreCard | null)[]) =>
    row.map((c, i) => ({ value: String(i), label: c ? `Replace: ${c.name}` : "Empty slot" }));
  const ownLocations = (Object.keys(state.locationTokens) as LocationId[]).filter((loc) =>
    (state.locationTokens[loc] ?? []).includes(playerId),
  );

  switch (stoneName) {
    case "Rune of Abundance": {
      const total = 5;
      return (
        <div className="exchange-section">
          <p className="meta">Distribute {total} Mana:</p>
          <label>
            Artifact:{" "}
            <input type="number" min={0} max={total} value={numA} onChange={(e) => setNumA(Number(e.target.value))} />
          </label>
          <span> Lore: {total - numA}</span>
          <button onClick={() => attempt(() => discardAbundance(state, playerId, index, numA, total - numA))}>Confirm</button>
        </div>
      );
    }
    case "Rune of Convergence":
      return (
        <div className="exchange-section">
          <p className="meta">Remove up to 5 Withering Tokens from a single location, then remove this Rune Stone from the game:</p>
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose a target...</option>
            <option value="rot">The Rot ({state.witheringTokens} Withering Tokens)</option>
            <option value="artifact">Their Artifact Mana Pool ({player.witheringTokens.artifact} Withering Tokens)</option>
            <option value="lore">Their Lore Mana Pool ({player.witheringTokens.lore} Withering Tokens)</option>
          </select>
          <button
            disabled={!selA}
            onClick={() => attempt(() => discardConvergence(state, playerId, index, selA as "rot" | "artifact" | "lore"))}
          >
            Confirm
          </button>
        </div>
      );
    case "Rune of Corruption":
      return (
        <div className="exchange-section">
          <p className="meta">
            Remove up to 2 Withering Tokens from The Rot ({state.witheringTokens} there) and place them in a player's Artifact Mana
            Pool:
          </p>
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose a player...</option>
            {state.playerOrder.map((id) => (
              <option key={id} value={id}>
                {state.players[id].character.name}
              </option>
            ))}
          </select>
          <button disabled={!selA} onClick={() => attempt(() => discardCorruption(state, playerId, index, selA))}>
            Confirm
          </button>
        </div>
      );
    case "Rune of Community":
      return (
        <div className="exchange-section">
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose a Location...</option>
            {coreLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} (Faction {player.factionTrack[l.id] ?? 0})
              </option>
            ))}
          </select>
          <button disabled={!selA} onClick={() => attempt(() => discardCommunity(state, playerId, index, selA as LocationId))}>
            Confirm
          </button>
        </div>
      );
    case "Rune of Culling":
    case "Rune of Recall":
      return (
        <div className="exchange-section">
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose a discarded card...</option>
            {pileOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            disabled={!selA}
            onClick={() => {
              const { deck, index: discardIndex } = parseDiscardPileValue(selA);
              attempt(() =>
                stoneName === "Rune of Culling"
                  ? discardCulling(state, playerId, index, deck, discardIndex)
                  : discardRecall(state, playerId, index, deck, discardIndex),
              );
            }}
          >
            Confirm
          </button>
        </div>
      );
    case "Rune of Decay":
      return (
        <div className="exchange-section">
          <p className="meta">
            Remove up to 2 Withering Tokens from The Rot ({state.witheringTokens} there) and place them on any one location:
          </p>
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose a player...</option>
            {state.playerOrder.map((id) => (
              <option key={id} value={id}>
                {state.players[id].character.name}
              </option>
            ))}
          </select>
          <select value={selB} onChange={(e) => setSelB(e.target.value)}>
            <option value="">Choose a pool...</option>
            <option value="artifact">Artifact Mana Pool</option>
            <option value="lore">Lore Mana Pool</option>
          </select>
          <button
            disabled={!selA || !selB}
            onClick={() => attempt(() => discardDecay(state, playerId, index, selA, selB as "artifact" | "lore"))}
          >
            Confirm
          </button>
        </div>
      );
    case "Rune of Delving":
      return (
        <div className="exchange-section">
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose a Type...</option>
            {["Divine", "Primal", "Technology", "Corrupted"].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select value={selB} onChange={(e) => setSelB(e.target.value)}>
            <option value="">Choose an Artifact Row slot...</option>
            {rowOptions(state.artifactRow).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button disabled={!selA || !selB} onClick={() => attempt(() => discardDelving(state, playerId, index, selA, Number(selB)))}>
            Confirm
          </button>
        </div>
      );
    case "Rune of Echoes": {
      const runeStoneDiscardOptions = player.artifactDiscard
        .map((c, i) => ({ value: String(i), label: c.name, isRuneStone: c.slot === "Rune Stone" }))
        .filter((o) => o.isRuneStone);
      return (
        <div className="exchange-section">
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose a Rune Stone from your discard pile...</option>
            {runeStoneDiscardOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button disabled={!selA} onClick={() => attempt(() => discardEchoes(state, playerId, index, Number(selA)))}>
            Confirm
          </button>
        </div>
      );
    }
    case "Rune of Foresight":
      return (
        <div className="exchange-section">
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose a deck...</option>
            <option value="artifact">Your Artifact deck</option>
            <option value="lore">Your Lore deck</option>
          </select>
          <button disabled={!selA} onClick={() => attempt(() => discardForesightRune(state, playerId, index, selA as "artifact" | "lore"))}>
            Confirm
          </button>
        </div>
      );
    case "Rune of Renewal":
      return (
        <div className="exchange-section">
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose a discarded card to Attune for free...</option>
            {pileOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            disabled={!selA}
            onClick={() => {
              const { deck, index: discardIndex } = parseDiscardPileValue(selA);
              attempt(() => discardRenewal(state, playerId, index, deck, discardIndex));
            }}
          >
            Confirm
          </button>
          <p className="meta">A multi-slot Artifact card or a full 3 Lore Attuned may need a slot/replace choice this form doesn't offer yet — resolve those via the Artificer/Ancient Shrine flow instead.</p>
        </div>
      );
    case "Rune of Reversal":
      return (
        <div className="exchange-section">
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose a placed Action Token...</option>
            {ownLocations.map((loc) => (
              <option key={loc} value={loc}>
                {locations.find((l) => l.id === loc)?.name ?? loc}
              </option>
            ))}
          </select>
          <button disabled={!selA} onClick={() => attempt(() => discardReversal(state, playerId, index, selA as LocationId))}>
            Confirm
          </button>
        </div>
      );
    case "Rune of Revelation":
      return (
        <div className="exchange-section">
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose a Row to refresh...</option>
            <option value="artifact">Artifact Row</option>
            <option value="lore">Lore Row</option>
          </select>
          <button disabled={!selA} onClick={() => attempt(() => discardRevelation(state, playerId, index, selA as "artifact" | "lore"))}>
            Confirm
          </button>
        </div>
      );
    case "Rune of Sacrifice": {
      const chosen = selA ? player.artifactDiscard[Number(selA)] : null;
      return (
        <div className="exchange-section">
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose an Artifact card from your discard pile...</option>
            {artifactPileOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {chosen && (
            <p className="meta">
              Removes {chosen.name} from the game and removes up to 2 Withering Tokens from The Rot ({state.witheringTokens} there).
            </p>
          )}
          <button disabled={!selA} onClick={() => attempt(() => discardSacrifice(state, playerId, index, Number(selA)))}>
            Confirm
          </button>
        </div>
      );
    }
    case "Rune of Salvage":
      return (
        <div className="exchange-section">
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose an Artifact card from your discard pile...</option>
            {artifactPileOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={selB} onChange={(e) => setSelB(e.target.value)}>
            <option value="">Choose an Artifact Row slot...</option>
            {rowOptions(state.artifactRow).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button disabled={!selA || !selB} onClick={() => attempt(() => discardSalvage(state, playerId, index, Number(selA), Number(selB)))}>
            Confirm
          </button>
        </div>
      );
    case "Rune of Scavenging":
      return (
        <div className="exchange-section">
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose an Artifact Row card...</option>
            {state.artifactRow.map((c, i) => c && <option key={i} value={i}>{c.name}</option>)}
          </select>
          <button disabled={!selA} onClick={() => attempt(() => discardScavenging(state, playerId, index, Number(selA)))}>
            Confirm
          </button>
        </div>
      );
    case "Rune of Transmutation":
      return (
        <div className="exchange-section">
          <select value={selA} onChange={(e) => setSelA(e.target.value)}>
            <option value="">Choose a source pool...</option>
            <option value="artifact">Artifact ({player.manaPools.artifact})</option>
            <option value="lore">Lore ({player.manaPools.lore})</option>
          </select>
          <label>
            {" "}
            Amount: <input type="number" min={0} value={numA} onChange={(e) => setNumA(Number(e.target.value))} />
          </label>
          <button disabled={!selA} onClick={() => attempt(() => discardTransmutation(state, playerId, index, selA as "artifact" | "lore", numA))}>
            Confirm
          </button>
        </div>
      );
    default:
      return null;
  }
}

// Resolves whatever pendingRuneStoneChoice is currently open, regardless of
// which stone triggered it.
function RuneStoneChoicePanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const choice = state.pendingRuneStoneChoice as PendingRuneStoneChoice;
  const [pick, setPick] = useState<number | null>(null);
  const [rowIndex, setRowIndex] = useState<number | null>(null);
  const [order, setOrder] = useState<number[]>([]);

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  if (choice.kind === "revealForRow") {
    const rowOptions = choice.deck === "artifact" ? state.artifactRow : state.loreRow;
    return (
      <section className="panel">
        <h3>Revealed Cards</h3>
        <div className="card-grid">
          {choice.revealed.map((c, i) => (
            <div className={`card${pick === i ? " selected" : ""}`} key={i} onClick={() => setPick(i)}>
              <h3>{c.name}</h3>
              <p className="meta">Gold: {c.goldCost}</p>
            </div>
          ))}
        </div>
        {pick !== null && (
          <div className="setup-row">
            <select value={rowIndex ?? ""} onChange={(e) => setRowIndex(Number(e.target.value))}>
              <option value="">Choose a Row slot to replace...</option>
              {rowOptions.map((c, i) => (
                <option key={i} value={i}>
                  {c ? `Replace: ${c.name}` : "Empty slot"}
                </option>
              ))}
            </select>
            <button disabled={rowIndex === null} onClick={() => attempt(() => resolveRevealForRow(state, "replace", pick, rowIndex ?? undefined))}>
              Place in Row
            </button>
            {choice.canBuy && (
              <button onClick={() => attempt(() => resolveRevealForRow(state, "buy", pick))}>
                Purchase ({(choice.revealed[pick] as ArtifactCard).goldCost} Gold)
              </button>
            )}
          </div>
        )}
        <button className="secondary" onClick={() => attempt(() => resolveRevealForRow(state, "discardAll"))}>
          Discard All
        </button>
      </section>
    );
  }

  if (choice.kind === "reorderPersonalDeck") {
    return (
      <section className="panel">
        <h3>Order Cards Returning to the Top</h3>
        <p className="meta">Click cards in the order you want them returned (first click = topmost).</p>
        <div className="card-grid">
          {choice.revealed.map((c, i) => (
            <div
              className={`card${order.includes(i) ? " selected" : ""}`}
              key={i}
              onClick={() => setOrder(order.includes(i) ? order.filter((x) => x !== i) : [...order, i])}
            >
              <h3>{c.name}</h3>
              {order.includes(i) && <p className="meta">Position {order.indexOf(i) + 1}</p>}
            </div>
          ))}
        </div>
        <button disabled={order.length !== choice.revealed.length} onClick={() => attempt(() => resolveReorderPersonalDeck(state, order))}>
          Confirm Order
        </button>
      </section>
    );
  }

  if (choice.kind === "insightChoice") {
    const others = choice.revealed.filter((_, i) => i !== pick);
    return (
      <section className="panel">
        <h3>Rune of Insight</h3>
        <p className="meta">Choose 1 card to reveal (the other 2 go to the bottom, in click order).</p>
        <div className="card-grid">
          {choice.revealed.map((c, i) => (
            <div className={`card${pick === i ? " selected" : ""}`} key={i} onClick={() => { setPick(i); setOrder([]); }}>
              <h3>{c.name}</h3>
            </div>
          ))}
        </div>
        {pick !== null && (
          <>
            <p className="meta">Click the other {others.length} card(s) in the order they go to the bottom:</p>
            <div className="card-grid">
              {choice.revealed.map((c, i) =>
                i === pick ? null : (
                  <div
                    className={`card${order.includes(i) ? " selected" : ""}`}
                    key={i}
                    onClick={() => setOrder(order.includes(i) ? order.filter((x) => x !== i) : [...order, i])}
                  >
                    <h3>{c.name}</h3>
                    {order.includes(i) && <p className="meta">Bottom position {order.indexOf(i) + 1}</p>}
                  </div>
                ),
              )}
            </div>
            <button
              disabled={order.length !== others.length}
              onClick={() => {
                const otherIndices = choice.revealed.map((_, i) => i).filter((i) => i !== pick);
                const bottomOrder = order.map((i) => otherIndices.indexOf(i));
                attempt(() => resolveInsightChoice(state, pick, bottomOrder));
              }}
            >
              Confirm
            </button>
          </>
        )}
      </section>
    );
  }

  if (choice.kind === "seekChoice") {
    return (
      <section className="panel">
        <h3>Rune of Seeking</h3>
        <div className="card-grid">
          {choice.cards.map((c, i) => (
            <div className={`card${pick === i ? " selected" : ""}`} key={i} onClick={() => setPick(i)}>
              <h3>{c.name}</h3>
            </div>
          ))}
        </div>
        <button disabled={pick === null} onClick={() => attempt(() => resolveSeekChoice(state, pick ?? -1))}>
          Reveal Chosen Card
        </button>
      </section>
    );
  }

  if (choice.kind === "whispersPeek") {
    return (
      <section className="panel">
        <h3>Rune of Whispers</h3>
        <p>Top of The Rot deck: {choice.card.card.name}</p>
        <div className="setup-row">
          <button onClick={() => attempt(() => resolveWhispersPeek(state, false))}>Leave on Top</button>
          <button className="secondary" onClick={() => attempt(() => resolveWhispersPeek(state, true))}>
            Discard It
          </button>
        </div>
      </section>
    );
  }

  return null;
}

function RuneStonesPanel({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const playerId = state.playerOrder[state.activePlayerIndex];
  const player = state.players[playerId];
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (state.pendingRuneStoneChoice) {
    return <RuneStoneChoicePanel state={state} setState={setState} />;
  }
  if (player.equippedRuneStones.length === 0) return null;

  function attempt(fn: () => GameState) {
    try {
      setState(fn());
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <section className="panel">
      <h3>Rune Stones</h3>
      <div className="card-grid">
        {player.equippedRuneStones.map((stone, i) => {
          const isContextual = CONTEXTUAL_RUNE_STONES.has(stone.name);
          const zeroArgFn = ZERO_ARG_RUNE_STONES[stone.name];
          return (
            <div className="card" key={i}>
              <h3>{stone.name}</h3>
              <p className="meta">{stone.ability}</p>
              {isContextual ? (
                <p className="meta">Used at its Location/moment — see the relevant panel.</p>
              ) : zeroArgFn ? (
                <button onClick={() => attempt(() => zeroArgFn(state, playerId, i))}>Discard</button>
              ) : openIndex === i ? (
                <>
                  <RuneStoneForm state={state} setState={setState} playerId={playerId} index={i} stoneName={stone.name} onDone={() => setOpenIndex(null)} />
                  <button className="secondary" onClick={() => setOpenIndex(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button onClick={() => setOpenIndex(i)}>Discard</button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FinalRankingPanel({ state }: { state: GameState }) {
  const ranking = state.finalRanking;
  if (!ranking) return null;
  const sorted = [...ranking].sort((a, b) => a.rank - b.rank);

  return (
    <section className="panel">
      <h3>Final Ranking</h3>
      {!sorted.some((e) => e.isWinner) && (
        <p className="meta">The Rot has consumed the players — there is no winner.</p>
      )}
      <div className="card-grid">
        {sorted.map((entry) => {
          const player = state.players[entry.playerId];
          return (
            <div className={`card${entry.isWinner ? " selected" : ""}`} key={entry.playerId}>
              <h3>
                #{entry.rank} — {player.character.name}
              </h3>
              {entry.isWinner && <p className="meta">Defeated The Rot!</p>}
              <p className="meta">
                Attuned Gold Value: {entry.attunedGoldValue} · Lore Deck: {entry.loreDeckCount}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Board({ state, setState }: { state: GameState; setState: (s: GameState) => void }) {
  const activePlayerId = state.playerOrder[state.activePlayerIndex];
  const activePlayer = state.players[activePlayerId];
  const firstPlayer = state.players[state.playerOrder[state.firstPlayerIndex]];

  function handlePlace(locationId: (typeof locations)[number]["id"]) {
    try {
      setState(placeActionToken(state, activePlayerId, locationId));
    } catch (err) {
      // Buttons are disabled for invalid moves, but guard against races anyway.
      console.error(err);
    }
  }

  return (
    <section>
      <h2>
        Round {state.round} —{" "}
        {state.phase === "action"
          ? `${activePlayer.character.name}'s turn`
          : state.phase === "arenaReward"
            ? "Arena Reward"
            : state.phase === "cleanup"
              ? "Cleanup Phase"
              : state.phase === "finalBattleOffer"
                ? "Final Battle Offer"
                : state.phase === "finalBattle"
                  ? "The Final Battle"
                  : "Game Over"}
      </h2>
      <p className="meta">
        First Player: {firstPlayer.character.name} · Rot Counter: {state.rotCounter}/13 · Withering Tokens on The
        Rot: {state.witheringTokens} · Artifacts on The Rot: {state.rotArtifacts.length}/7
      </p>

      <div className="player-strip">
        {state.playerOrder.map((id) => {
          const p = state.players[id];
          const isActive = id === activePlayerId && state.phase === "action";
          return (
            <div className={`player-chip${isActive ? " active" : ""}`} key={id}>
              <strong>{p.character.name}</strong>
              <span>{p.actionTokensRemaining} tokens left</span>
              <span>
                {p.gold}g · {p.manaPools.artifact}/{p.manaPools.lore} mana
              </span>
              <span>
                {p.equippedWeapon?.name ?? "–"} / {p.equippedArmor?.name ?? "–"} / {p.equippedImplement?.name ?? "–"}
              </span>
              <span>
                Runes: {p.equippedRuneStones.length}/3 · Lore: {p.attunedLore.length}/3
              </span>
              <span>
                Withering: {p.witheringTokens.artifact}/{p.witheringTokens.lore} · Rot cards:{" "}
                {p.rotCardsInPlayerArea.filter((c) => c.kind === "combat").length} combat /{" "}
                {p.rotCardsInPlayerArea.filter((c) => c.kind === "scenario").length} scenario
              </span>
            </div>
          );
        })}
      </div>

      {state.phase === "action" && state.pendingDeepWatersClaim && (
        <DeepWatersOfferPanel state={state} setState={setState} />
      )}

      {state.phase === "action" && !state.pendingDeepWatersClaim && <RuneStonesPanel state={state} setState={setState} />}

      {state.phase === "action" && !state.pendingAction && !state.pendingDeepWatersClaim && !state.pendingRuneStoneChoice && (
        <div className="location-grid">
          {locations.map((loc) => {
            const available = isLocationAvailable(state, activePlayerId, loc.id);
            const tokensHere = state.locationTokens[loc.id] ?? [];
            const factionLevel = activePlayer.factionTrack[loc.id];
            return (
              <button
                key={loc.id}
                className="location-card"
                disabled={!available}
                onClick={() => handlePlace(loc.id)}
                title={loc.summary}
              >
                <strong>{loc.name}</strong>
                <span className="meta">{loc.summary}</span>
                {loc.hasFactionTrack && (
                  <span className="meta">
                    Your Faction: {factionLevel}
                    {factionLevel !== undefined && factionLevel > 0 && loc.factionBenefits
                      ? ` — ${loc.factionBenefits[factionLevel]}`
                      : ""}
                  </span>
                )}
                {loc.id === "exchange" && <span className="meta">Gold here: {state.exchangeGold}</span>}
                {loc.id === "arena" && (
                  <span className="meta">
                    Your Rot cards: {activePlayer.rotCardsInPlayerArea.filter((c) => c.kind === "combat").length}{" "}
                    combat / {activePlayer.rotCardsInPlayerArea.filter((c) => c.kind === "scenario").length}{" "}
                    scenario (pay 1 to enter)
                  </span>
                )}
                {tokensHere.length > 0 && (
                  <span className="meta">
                    Tokens here: {tokensHere.map((id) => state.players[id].character.name).join(", ")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {state.phase === "action" && state.pendingAction && canCancelLocationVisit(state) && (
        <button
          className="secondary"
          onClick={() => {
            try {
              setState(cancelLocationVisit(state));
            } catch (err) {
              console.error(err);
            }
          }}
        >
          ← Back to Board
        </button>
      )}

      {state.phase === "action" && state.pendingAction?.locationId === "wellspring" && (
        <WellspringPanel state={state} setState={setState} />
      )}

      {state.phase === "action" && state.pendingAction?.locationId === "market" && (
        <MarketPanel state={state} setState={setState} />
      )}

      {state.phase === "action" && state.pendingAction?.locationId === "library" && (
        <LibraryPanel state={state} setState={setState} />
      )}

      {state.phase === "action" && state.pendingAction?.locationId === "exchange" && (
        <ExchangePanel state={state} setState={setState} />
      )}

      {state.phase === "action" && state.pendingAction?.locationId === "artificer" && (
        <ArtificerPanel state={state} setState={setState} />
      )}

      {state.phase === "action" && state.pendingAction?.locationId === "ancientShrine" && (
        <AncientShrinePanel state={state} setState={setState} />
      )}

      {state.phase === "action" && state.pendingAction?.locationId === "valley" && (
        <ValleyPanel state={state} setState={setState} />
      )}

      {state.phase === "action" && state.pendingAction?.locationId === "arena" && (
        <ArenaPanel state={state} setState={setState} />
      )}

      {state.phase === "action" && state.pendingAction?.locationId === "warriorsGuild" && (
        <WarriorsGuildPanel state={state} setState={setState} />
      )}

      {state.phase === "action" && state.pendingAction?.locationId === "scholarsGuild" && (
        <ScholarsGuildPanel state={state} setState={setState} />
      )}

      {state.phase === "cleanup" && (
        <button onClick={() => setState(runCleanupPhase(state))}>Resolve Cleanup Phase</button>
      )}

      {state.phase === "arenaReward" && <ArenaRewardPanel state={state} setState={setState} />}

      {state.phase === "finalBattleOffer" && <FinalBattleOfferPanel state={state} setState={setState} />}

      {state.phase === "finalBattle" && <FinalBattlePanel state={state} setState={setState} />}

      {state.phase === "gameOver" && <FinalRankingPanel state={state} />}

      <h3>Log</h3>
      <div className="log">
        {state.log.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </section>
  );
}

function GameBoard() {
  const [state, setState] = useState<GameState | null>(null);

  if (!state) {
    return <PlayerSetup onStart={(chars) => setState(createGame(chars))} />;
  }

  return (
    <>
      <Board state={state} setState={setState} />
      <button className="secondary" onClick={() => setState(null)}>
        Reset
      </button>
    </>
  );
}

export default GameBoard;
