---
name: testfinal
description: Run the standalone Final Battle test harness (scripts/final-battle-sim.ts) against the real game engine, starting every trial directly inside the Final Battle with configurable starting Artifacts/Lore per player, and report win/loss.
disable-model-invocation: true
argument-hint: "[player-count] [artifacts-attuned] [lore-attuned] [trials] [seed] [rot-artifacts]"
arguments: player_count, artifacts_attuned, lore_attuned, trials, seed, rot_artifacts
---

Run the Final Battle harness with:
- $player_count players (default 4)
- $artifacts_attuned Artifacts equipped per player — Weapon/Armor/Implement/Rune Stones, 0-6 (default 3)
- $lore_attuned Lore cards Attuned per player — 1-3, the Lore Attunement cap (default 1)
- $trials trials (default 30)
- $seed as the first trial's seed, incrementing by 1 per trial (default 12345)
- $rot_artifacts Artifacts equipped on The Rot Character Mat at the start of every trial (default 1)

## What this is, and how it differs from /playtest

`scripts/playtest-sim.ts` (the `/playtest` skill) plays a whole game from
Setup and only reaches the Final Battle if a bot legitimately gets there —
useful for asking "how often does anyone reach the Final Battle, and with
what," but slow to iterate on the fight itself, and every input (starting
gear, Lore count, Rot's gear) is whatever emerged from that particular game.

`scripts/final-battle-sim.ts` skips straight to the fight: every trial starts
already in the Final Battle, with every player's starting Artifacts and Lore
set directly from config (drawn from the real, non-Starter-Set card pools —
not synthetic placeholders), and The Rot given a configurable number of
starting Artifacts too. This isolates the Final Battle itself as the thing
under test — useful for answering "given these starting conditions, how does
the fight play out," independent of how a real game would arrive there.

It reuses the exact same Final Battle bot policy as `/playtest`
(`scripts/finalBattleSim.ts` — the two scripts share this module, so a rules
or bot-policy change to the Final Battle only needs to happen once) — the
same "Choose 1 or 2 Lore cards," Trophy, Divine Reclamation, Press the
Attack, and Rot Combat card exhaustion logic, just driven from a controlled
starting position instead of wherever a full game happened to land.

## Running it

```
npx tsx scripts/final-battle-sim.ts $player_count $artifacts_attuned $lore_attuned $trials $seed $rot_artifacts
```

(run from the `withering-worship/` directory). Prints one JSON object:
`config` (echoes the inputs), `roster` (the player_count characters used, in
`src/data/characters.ts` order — this harness doesn't assign per-character
strategies the way `/playtest` does, since every player runs the same Final
Battle bot policy regardless of character), `tally` (wins/losses per
character), `gamesWon`/`rotWins`, `combatsPerBattle` (min/max/median — how
many individual Final Battle combats it took to resolve, since the Final
Battle doesn't use GameState.round at all), and `trials` (per-trial seed,
winner, and combat count).

Before trusting the output, check the harness still reflects the current
engine: it imports `runFinalBattle` and the bot-policy functions from
`scripts/finalBattleSim.ts`, so if that shared module's exports or
`chooseFinalBattleLore`'s signature in `turnEngine.ts` have changed
underneath it, fix the harness first rather than reporting stale numbers.

## Config notes and gotchas

- **`rot_artifacts: 0` is a legitimate but skewed config.** With no Rot
  Artifacts to remove, the "remove the last Artifact" win condition never
  applies (there's nothing to remove — see the win branch in
  `finalBattleSim.ts`'s `runFinalBattle`), so the *only* way to win is
  exhausting the shared Rot Combat card supply. That heavily favors whoever
  goes first (they can Press the Attack indefinitely without another
  combatant ever getting a turn), which is why the harness defaults to 1
  instead of 0 — pass 0 deliberately only when that's the specific scenario
  you're testing, and expect win totals to concentrate on the first player
  in the roster.
- **`lore_attuned` can't be 0.** A player needs at least 1 Attuned Lore card
  to take a Final Battle turn at all ("each player who has not been
  defeated and has at least one Lore card Attuned takes a turn fighting The
  Rot" — docs/rules.md); the harness rejects 0 with a clear error instead of
  letting the engine throw mid-run.
- **The roster is always `characters.slice(0, player_count)`** (Shar, Cira,
  Sylva, Taza, Legos, Kael in that order) — not `/playtest`'s fixed
  strategy-diverse roster, since there's no bot strategy variation here to
  preserve. Solo (`player_count` 1) still respects the Kael/Taza
  `canPlaySolo` restriction.
- **The one-time Final Battle initiator's boon is skipped** (the harness
  sets `finalBattleBoonClaimed: true` from the start) — this tool tests the
  fight itself, not a pre-fight bonus tied to who happened to initiate.
- Every player (and The Rot) draws from one shared shuffled pool per trial,
  so no two combatants — nor The Rot — end up with the literal same card
  object in a given trial. Card attack values are real (pulled from
  `src/data/artifacts.ts`, `src/data/runeStones.ts`, `src/data/loreCards.ts`,
  Starter Set excluded), so results reflect genuine game balance rather than
  synthetic stand-ins.

## Reporting requirements

Report, at minimum:
- Win/loss by character (from `tally`), and total games won vs. Rot wins.
- `combatsPerBattle` (min/max/median) as a sense of how quickly or slowly
  the fight resolves at this config.
- If comparing multiple configs (e.g. "2 vs 3 Lore cards attuned"), run each
  as a separate invocation with the same `player_count`/`trials`/`seed` and
  present the comparison side by side — don't average across differing
  configs in one run.
- Call out when `rot_artifacts` is 0 (or otherwise very low relative to
  `artifacts_attuned`/`lore_attuned`) — flag the "first player advantage"
  gotcha above rather than reporting the skew as a character balance finding.
