# Withering Worship

Digital prototype of the Withering Worship board game. React + TypeScript + Vite.

## Source of truth

- Rules: [docs/rules.md](docs/rules.md) — mirrored from a Google Doc. If the doc changes, re-pull and update this copy; the project does not read Drive live.
- Card data: `src/data/` — transcribed from a Google Sheet, same re-pull caveat.
- Game logic lives entirely in [src/engine/turnEngine.ts](src/engine/turnEngine.ts). Treat it as the source of truth for how a rule actually behaves, not the UI.

See [README.md](README.md) for full current status (what's implemented, known gaps).

## Development

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc -b && vite build
```

## Testing / simulation

Two harnesses drive the real engine directly (not mental simulation) — invoke manually via their skills, never automatically:

- `/playtest` — full games from Setup via `scripts/playtest-sim.ts`, bot-driven, reports Final Battle eligibility vs. actual win rate and publishes a resources-per-round dashboard artifact.
- `/testfinal` — isolates the Final Battle itself via `scripts/final-battle-sim.ts`, starting every trial already in the fight with configurable gear.

Both skills (`.claude/skills/playtest/`, `.claude/skills/testfinal/`) document config gotchas and reporting requirements in detail — read them before running, not just the flags.

Before trusting either harness's output after an engine change, confirm it still imports functions/signatures that still exist in `turnEngine.ts` — fix the harness first rather than reporting stale numbers.

## Conventions

- One-time Faction-track perks (Market, Library, Exchange, Artificer, Ancient Shrine, Arena) queue onto `GameState.pendingFactionPerks` and must resolve before the triggering visit's main action — see `applyFactionMilestone` in `turnEngine.ts`.
- Cleansing (removing Withering Tokens before spending Mana from a tainted pool) gates every Mana-spending action; `cleansePool` is the prerequisite step.
- When changing bot policy in `scripts/playtest-sim.ts`, update the corresponding in-file comment in the same edit — those comments are the source of truth for *why* each heuristic score is what it is.
