// Copyright © 2026 Steve Empey
import { useState } from "react";
import {
  buildRoster,
  runTrial,
  tallyResults,
  validateFinalBattleConfig,
  type FinalBattleTallyReport,
  type FinalBattleTrialConfig,
  type TrialResult,
} from "../scripts/finalBattleTestSetup";

// Browser UI for the /testfinal harness (see scripts/final-battle-sim.ts for
// the CLI equivalent) — every trial starts directly inside the Final
// Battle, with starting Artifacts/Lore/Rot gear set from the config fields
// below, rather than playing out a whole game to get there. Runs entirely
// client-side: the engine and this harness's setup logic (finalBattleSim.ts,
// finalBattleTestSetup.ts) are pure functions with no Node dependencies, so
// no server round-trip is needed.
export default function TestFinalPanel() {
  const [playerCount, setPlayerCount] = useState(4);
  const [artifactsAttuned, setArtifactsAttuned] = useState(3);
  const [loreAttuned, setLoreAttuned] = useState(1);
  const [rotArtifactCount, setRotArtifactCount] = useState(1);
  const [seed, setSeed] = useState(12345);

  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FinalBattleTallyReport | null>(null);
  const [trials, setTrials] = useState<TrialResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const config: FinalBattleTrialConfig = { playerCount, artifactsAttuned, loreAttuned, rotArtifactCount };

  function run(count: number) {
    const validationError = validateFinalBattleConfig(config);
    if (validationError) {
      setError(validationError);
      setReport(null);
      setTrials(null);
      return;
    }
    setError(null);
    setRunning(true);
    // Synchronous — each trial is a few hundred pure-function calls at most,
    // so even 100 trials resolve well under a frame; no need for a worker or
    // async chunking in a prototype like this.
    try {
      const roster = buildRoster(playerCount);
      const results: TrialResult[] = [];
      for (let i = 0; i < count; i++) {
        results.push(runTrial(config, seed + i));
      }
      setReport(tallyResults(roster, results));
      setTrials(results);
      // Advance past the seed range just used, so clicking Run again (without
      // touching the Seed field) explores fresh trials instead of silently
      // re-running the exact same ones — a fixed RNG seed means "same seed in
      // → same combat rolls out" is correct, reproducible behavior, but it
      // reads as "no randomness" if every click reuses the same seed.
      setSeed((s) => s + count);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setReport(null);
      setTrials(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="panel">
      <h3>Final Battle Test Harness</h3>
      <p className="meta">
        Every run starts directly inside the Final Battle — no Setup, no rounds leading up to it. Starting Artifacts,
        Lore, and Rot gear come from the fields below, drawn from the real (non-Starter-Set) card pools.
      </p>

      <div className="config-grid">
        <div className="config-field">
          <label htmlFor="tf-players">Players (1-6)</label>
          <input
            id="tf-players"
            type="number"
            min={1}
            max={6}
            value={playerCount}
            onChange={(e) => setPlayerCount(Number(e.target.value))}
          />
        </div>
        <div className="config-field">
          <label htmlFor="tf-artifacts">Artifacts Attuned per player (0-6)</label>
          <input
            id="tf-artifacts"
            type="number"
            min={0}
            max={6}
            value={artifactsAttuned}
            onChange={(e) => setArtifactsAttuned(Number(e.target.value))}
          />
        </div>
        <div className="config-field">
          <label htmlFor="tf-lore">Lore Attuned per player (1-3)</label>
          <input
            id="tf-lore"
            type="number"
            min={1}
            max={3}
            value={loreAttuned}
            onChange={(e) => setLoreAttuned(Number(e.target.value))}
          />
        </div>
        <div className="config-field">
          <label htmlFor="tf-rot-artifacts">The Rot's starting Artifacts (0-7)</label>
          <input
            id="tf-rot-artifacts"
            type="number"
            min={0}
            max={7}
            value={rotArtifactCount}
            onChange={(e) => setRotArtifactCount(Number(e.target.value))}
          />
        </div>
        <div className="config-field">
          <label htmlFor="tf-seed">Seed</label>
          <input id="tf-seed" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
        </div>
      </div>
      {rotArtifactCount === 0 && (
        <p className="config-hint">
          With 0 starting Artifacts, The Rot can only be beaten by exhausting its Combat card supply — wins will skew
          toward whichever player goes first.
        </p>
      )}

      <div className="setup-row">
        <button disabled={running} onClick={() => run(1)}>
          Run 1 Game
        </button>
        <button disabled={running} onClick={() => run(100)}>
          Run 100 Games
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {report && trials && trials.length > 1 && <Dashboard report={report} trials={trials} />}
      {report && trials && trials.length === 1 && <SingleTrialDetail trial={trials[0]} />}
    </section>
  );
}

function Dashboard({ report, trials }: { report: FinalBattleTallyReport; trials: TrialResult[] }) {
  return (
    <>
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-value">
            {report.gamesWon}/{trials.length}
          </div>
          <div className="kpi-label">Games Won</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{report.rotWins}</div>
          <div className="kpi-label">Rot Wins</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{report.combatsPerBattle.median}</div>
          <div className="kpi-label">Median Combats/Battle</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">
            {report.combatsPerBattle.min}-{report.combatsPerBattle.max}
          </div>
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
          {report.roster.map((name) => {
            const row = report.tally[name];
            const total = row.wins + row.losses;
            return (
              <tr key={name}>
                <td>{name}</td>
                <td>{row.wins}</td>
                <td>{row.losses}</td>
                <td>{total > 0 ? `${Math.round((row.wins / total) * 100)}%` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <details>
        <summary>Per-trial results ({trials.length})</summary>
        <table className="result-table">
          <thead>
            <tr>
              <th>Seed</th>
              <th>Winner</th>
              <th>Combats</th>
              <th>Won by (per round)</th>
            </tr>
          </thead>
          <tbody>
            {trials.map((t) => (
              <tr key={t.seed}>
                <td>{t.seed}</td>
                <td>{t.winner ?? "The Rot"}</td>
                <td>{t.combats}</td>
                <td>
                  {t.combatLog
                    .map((c) => {
                      const margin = c.playerAttack - c.rotAttack;
                      return margin >= 0 ? `+${margin}` : `${margin}`;
                    })
                    .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

function SingleTrialDetail({ trial }: { trial: TrialResult }) {
  return (
    <>
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-value">{trial.winner ?? "The Rot"}</div>
          <div className="kpi-label">Winner</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{trial.combats}</div>
          <div className="kpi-label">Combats to Resolve</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{trial.seed}</div>
          <div className="kpi-label">Seed</div>
        </div>
      </div>

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
          {trial.combatLog.map((c) => {
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
    </>
  );
}
