import { useState } from "react";
import { buildAscensionRoster, runSimulation, type SimResult } from "../scripts/ascensionSim";
import {
  actionTokensForPlayerCount,
  STARTING_GOLD_BY_PLAYER_COUNT,
  STARTING_MANA_BY_PLAYER_COUNT,
} from "./engine/turnEngine";
import TestFinalPanel from "./TestFinalPanel";

// Browser UI covering all 3 phases of the game per docs/rules.md's "Ending
// the Game" framing: The Ascension alone, The Final Battle alone (delegates
// straight to TestFinalPanel — same harness as the standalone "Test Final
// Battle" tab, just reachable from here too), or The Entire Game (Ascension
// played out for real, then whatever Final Battle it produces). Runs
// entirely client-side — ascensionSim.ts and finalBattleSim.ts are both pure
// functions with no Node dependencies.
type TestMode = "ascension" | "finalBattle" | "entireGame";

export default function TestAscensionPanel() {
  const [testMode, setTestMode] = useState<TestMode>("ascension");

  return (
    <section className="panel">
      <h3>Test Ascension</h3>
      <p className="meta">
        The game unfolds in two phases: The Ascension and The Final Battle. Test either phase in isolation, or The
        Entire Game end to end.
      </p>
      <div className="mode-tabs">
        <button className={testMode === "ascension" ? "active" : ""} onClick={() => setTestMode("ascension")}>
          The Ascension
        </button>
        <button className={testMode === "finalBattle" ? "active" : ""} onClick={() => setTestMode("finalBattle")}>
          The Final Battle
        </button>
        <button className={testMode === "entireGame" ? "active" : ""} onClick={() => setTestMode("entireGame")}>
          The Entire Game
        </button>
      </div>

      {testMode === "ascension" && <AscensionHarness mode="ascensionOnly" />}
      {testMode === "finalBattle" && <TestFinalPanel />}
      {testMode === "entireGame" && <AscensionHarness mode="full" />}
    </section>
  );
}

interface SeededResult {
  seed: number;
  result: SimResult;
}

function AscensionHarness({ mode }: { mode: "ascensionOnly" | "full" }) {
  const [playerCount, setPlayerCount] = useState(4);
  const [seed, setSeed] = useState(12345);
  const [roundCap, setRoundCap] = useState(60);

  // Starting resources default to the rulebook's own per-player-count tables
  // (STARTING_GOLD_BY_PLAYER_COUNT etc.) but are independently editable here
  // — e.g. to see how balance shifts with a richer or poorer opening hand.
  // They don't auto-follow Players so typing into them mid-tweak isn't
  // clobbered; use "Reset to rulebook defaults" to resync after changing
  // Players.
  const [gold, setGold] = useState(STARTING_GOLD_BY_PLAYER_COUNT[4]);
  const [mana, setMana] = useState(STARTING_MANA_BY_PLAYER_COUNT[4]);
  const [actionTokens, setActionTokens] = useState(actionTokensForPlayerCount(4));

  const [results, setResults] = useState<SeededResult[] | null>(null);
  const [running, setRunning] = useState(false);

  function resetResourcesToDefaults() {
    setGold(STARTING_GOLD_BY_PLAYER_COUNT[playerCount]);
    setMana(STARTING_MANA_BY_PLAYER_COUNT[playerCount]);
    setActionTokens(actionTokensForPlayerCount(playerCount));
  }

  function run(count: number) {
    setRunning(true);
    try {
      const out: SeededResult[] = [];
      const startingResources = { gold, mana, actionTokens };
      for (let i = 0; i < count; i++) {
        const trialSeed = seed + i;
        out.push({ seed: trialSeed, result: runSimulation(playerCount, trialSeed, roundCap, false, mode, startingResources) });
      }
      setResults(out);
      // Advance past the seed range just used, so clicking Run again
      // (without touching the Seed field) explores fresh trials instead of
      // silently re-running the exact same ones — see the identical comment
      // in TestFinalPanel.tsx's run().
      setSeed((s) => s + count);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <p className="meta">
        {mode === "ascensionOnly"
          ? "Plays The Ascension only — stops the moment a player becomes eligible for The Final Battle (or the Rot Counter ends the game first) without playing that battle out."
          : "Plays The Ascension for real, then whatever Final Battle it produces — the same simulation /playtest uses."}
      </p>

      <div className="config-grid">
        <div className="config-field">
          <label htmlFor="asc-players">Players (1-6)</label>
          <input
            id="asc-players"
            type="number"
            min={1}
            max={6}
            value={playerCount}
            onChange={(e) => setPlayerCount(Number(e.target.value))}
          />
        </div>
        <div className="config-field">
          <label htmlFor="asc-roundcap">Round cap</label>
          <input id="asc-roundcap" type="number" min={1} value={roundCap} onChange={(e) => setRoundCap(Number(e.target.value))} />
        </div>
        <div className="config-field">
          <label htmlFor="asc-seed">Seed</label>
          <input id="asc-seed" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
        </div>
        <div className="config-field">
          <label htmlFor="asc-gold">Starting Gold</label>
          <input id="asc-gold" type="number" min={0} value={gold} onChange={(e) => setGold(Number(e.target.value))} />
        </div>
        <div className="config-field">
          <label htmlFor="asc-mana">Starting Mana (total)</label>
          <input id="asc-mana" type="number" min={0} value={mana} onChange={(e) => setMana(Number(e.target.value))} />
        </div>
        <div className="config-field">
          <label htmlFor="asc-tokens">Action Tokens</label>
          <input
            id="asc-tokens"
            type="number"
            min={1}
            value={actionTokens}
            onChange={(e) => setActionTokens(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="setup-row">
        <button type="button" onClick={resetResourcesToDefaults}>
          Reset resources to rulebook defaults
        </button>
      </div>

      <StartingResourcesTable selectedPlayerCount={playerCount} />

      <div className="setup-row">
        <button disabled={running} onClick={() => run(1)}>
          Run 1 Game
        </button>
        <button disabled={running} onClick={() => run(100)}>
          Run 100 Games
        </button>
      </div>

      {results && results.length > 1 && <BatchReport mode={mode} playerCount={playerCount} results={results} />}
      {results && results.length === 1 && <SingleRunReport mode={mode} result={results[0].result} />}
    </>
  );
}

// Setup, "Distribute Gold, Mana, and Action Tokens based on the number of
// players" — mirrors createGame()'s own rulebook tables (turnEngine.ts) as a
// reference, so it's easy to see what the Starting Gold/Mana/Action Tokens
// fields above have been overridden away from (or reset back to).
function StartingResourcesTable({ selectedPlayerCount }: { selectedPlayerCount: number }) {
  return (
    <table className="result-table">
      <thead>
        <tr>
          <th>Players</th>
          <th>Gold</th>
          <th>Mana</th>
          <th>Action Tokens</th>
        </tr>
      </thead>
      <tbody>
        {[1, 2, 3, 4, 5, 6].map((count) => (
          <tr key={count} style={count === selectedPlayerCount ? { fontWeight: "bold" } : undefined}>
            <td>{count}</td>
            <td>{STARTING_GOLD_BY_PLAYER_COUNT[count]}</td>
            <td>{STARTING_MANA_BY_PLAYER_COUNT[count]}</td>
            <td>{actionTokensForPlayerCount(count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SingleRunReport({ mode, result }: { mode: "ascensionOnly" | "full"; result: SimResult }) {
  return (
    <>
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-value">{outcomeLabel(result)}</div>
          <div className="kpi-label">Outcome</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{result.round}</div>
          <div className="kpi-label">Round</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{result.eligiblePlayer ?? "—"}</div>
          <div className="kpi-label">First Eligible</div>
        </div>
        {mode === "full" && (
          <div className="kpi-card">
            <div className="kpi-value">{result.finalBattleLog.length}</div>
            <div className="kpi-label">Combats to Resolve</div>
          </div>
        )}
      </div>

      {mode === "full" &&
        (result.finalBattleLog.length > 0 ? (
          <table className="result-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Combatant</th>
                <th>Your Attack</th>
                <th>The Rot's Attack</th>
                <th>Won by</th>
                <th>Outcome</th>
                <th>Rot Cards</th>
              </tr>
            </thead>
            <tbody>
              {result.finalBattleLog.map((c) => {
                const margin = c.playerAttack - c.rotAttack;
                return (
                  <tr key={c.combatIndex}>
                    <td>{c.combatIndex}</td>
                    <td>{c.playerName}</td>
                    <td>{c.playerAttack}</td>
                    <td>{c.rotAttack}</td>
                    <td>{margin >= 0 ? `+${margin}` : margin}</td>
                    <td>{c.outcome === "win" ? "Win" : "Loss"}</td>
                    <td>{c.rotCards.join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="meta">The Rot Counter ended the game before anyone reached The Final Battle — no combats occurred.</p>
        ))}
    </>
  );
}

function outcomeLabel(result: SimResult): string {
  if (result.outcome === "gameWon") return result.winner ?? "Won";
  if (result.outcome === "finalBattleEligible") return "Eligible";
  if (result.outcome === "rotWins") return "The Rot";
  return "Round cap reached";
}

function BatchReport({
  mode,
  playerCount,
  results,
}: {
  mode: "ascensionOnly" | "full";
  playerCount: number;
  results: SeededResult[];
}) {
  const roster = buildAscensionRoster(playerCount).map((c) => c.name);
  const total = results.length;

  if (mode === "ascensionOnly") {
    const eligible = results.filter((r) => r.result.outcome === "finalBattleEligible");
    const rotWins = results.filter((r) => r.result.outcome === "rotWins").length;
    const roundCapReached = results.filter((r) => r.result.outcome === "roundCapReached").length;
    const medianRound = median(eligible.map((r) => r.result.round));

    const firstEligibleCount: Record<string, number> = {};
    roster.forEach((name) => (firstEligibleCount[name] = 0));
    eligible.forEach((r) => {
      const name = r.result.eligiblePlayer;
      if (name) firstEligibleCount[name] = (firstEligibleCount[name] ?? 0) + 1;
    });

    return (
      <>
        <div className="kpi-row">
          <div className="kpi-card">
            <div className="kpi-value">
              {eligible.length}/{total}
            </div>
            <div className="kpi-label">Reached Eligibility</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{rotWins}</div>
            <div className="kpi-label">Rot Wins (before eligibility)</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{roundCapReached}</div>
            <div className="kpi-label">Round Cap Reached</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{medianRound ?? "—"}</div>
            <div className="kpi-label">Median Round to Eligibility</div>
          </div>
        </div>

        <table className="result-table">
          <thead>
            <tr>
              <th>Character</th>
              <th>Became Eligible First</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((name) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{firstEligibleCount[name]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <details>
          <summary>Per-trial results ({total})</summary>
          <table className="result-table">
            <thead>
              <tr>
                <th>Seed</th>
                <th>Outcome</th>
                <th>Round</th>
                <th>Eligible Player</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.seed}>
                  <td>{r.seed}</td>
                  <td>{outcomeLabel(r.result)}</td>
                  <td>{r.result.round}</td>
                  <td>{r.result.eligiblePlayer ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </>
    );
  }

  // mode === "full" — Entire Game
  const gamesWon = results.filter((r) => r.result.outcome === "gameWon").length;
  const rotWins = total - gamesWon;
  const combatCounts = results.map((r) => r.result.finalBattleLog.length).filter((n) => n > 0);
  const tally: Record<string, { wins: number; losses: number }> = {};
  roster.forEach((name) => (tally[name] = { wins: 0, losses: 0 }));
  results.forEach((r) => {
    roster.forEach((name) => {
      if (r.result.winner === name) tally[name].wins++;
      else tally[name].losses++;
    });
  });

  return (
    <>
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-value">
            {gamesWon}/{total}
          </div>
          <div className="kpi-label">Games Won</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{rotWins}</div>
          <div className="kpi-label">Rot Wins</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{median(combatCounts) ?? "—"}</div>
          <div className="kpi-label">Median Combats/Battle</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{combatCounts.length > 0 ? `${Math.min(...combatCounts)}-${Math.max(...combatCounts)}` : "—"}</div>
          <div className="kpi-label">Combats Range</div>
        </div>
      </div>

      <table className="result-table">
        <thead>
          <tr>
            <th>Character</th>
            <th>Wins</th>
            <th>Losses</th>
            <th>Win rate</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((name) => {
            const row = tally[name];
            const rowTotal = row.wins + row.losses;
            return (
              <tr key={name}>
                <td>{name}</td>
                <td>{row.wins}</td>
                <td>{row.losses}</td>
                <td>{rowTotal > 0 ? `${Math.round((row.wins / rowTotal) * 100)}%` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <details>
        <summary>Per-trial results ({total})</summary>
        <table className="result-table">
          <thead>
            <tr>
              <th>Seed</th>
              <th>Winner</th>
              <th>Round</th>
              <th>Combats</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.seed}>
                <td>{r.seed}</td>
                <td>{r.result.winner ?? "The Rot"}</td>
                <td>{r.result.round}</td>
                <td>{r.result.finalBattleLog.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
