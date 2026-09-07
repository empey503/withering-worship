import { useState } from "react";
import { characters } from "./data/characters";
import { artifacts } from "./data/artifacts";
import { runeStones } from "./data/runeStones";
import { loreCards } from "./data/loreCards";
import { rotCombatCards, rotScenarioCards } from "./data/rotCards";
import GameBoard from "./GameBoard";
import TestFinalPanel from "./TestFinalPanel";
import TestAscensionPanel from "./TestAscensionPanel";

function App() {
  const [mode, setMode] = useState<"play" | "testfinal" | "testascension">("play");

  return (
    <div className="app">
      <header>
        <h1>Withering Worship</h1>
        <p className="tagline">A Deck Building Board Game — 1–6 Players</p>
      </header>

      <div className="mode-tabs">
        <button className={mode === "play" ? "active" : ""} onClick={() => setMode("play")}>
          Play Game
        </button>
        <button className={mode === "testfinal" ? "active" : ""} onClick={() => setMode("testfinal")}>
          Test Final Battle
        </button>
        <button className={mode === "testascension" ? "active" : ""} onClick={() => setMode("testascension")}>
          Test Ascension
        </button>
      </div>

      {mode === "play" && <GameBoard />}
      {mode === "testfinal" && <TestFinalPanel />}
      {mode === "testascension" && <TestAscensionPanel />}

      <details className="reference">
        <summary>Reference data ({characters.length} characters, {artifacts.length} artifacts, {runeStones.length}{" "}
          rune stones, {loreCards.length} lore cards, {rotCombatCards.length} Rot combat cards,{" "}
          {rotScenarioCards.length} Rot scenario cards)</summary>
        <div className="card-grid">
          {characters.map((c) => (
            <div className="card" key={c.name}>
              <h3>{c.name}</h3>
              <p className="meta">{c.god}</p>
              <p>{c.affinity}</p>
              <p>
                <strong>{c.powerName}:</strong> {c.powerText}
              </p>
              <p className="meta">Victory: {c.victoryCondition}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

export default App;
