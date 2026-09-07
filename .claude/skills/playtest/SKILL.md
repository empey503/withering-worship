---
name: playtest
description: Run the real Withering Worship playtest harness (scripts/playtest-sim.ts) against the actual game engine, report attack values, artifact/Lore attunement, and Rot progression, and publish a resources-per-player-per-round dashboard. Invoke manually only — never runs automatically.
disable-model-invocation: true
argument-hint: "[player-count] [seed]"
arguments: player_count, seed
---

Run a playtest with $player_count players (default to 3 if not specified) using
$seed (default to 12345 if not specified) as the detailed run's seed.

## Use the real test harness, not a mental simulation

This is no longer a "simulate it yourself" exercise — `withering-worship/scripts/playtest-sim.ts`
is a real bot that drives `src/engine/turnEngine.ts` directly, so every result
comes from the actual game rules, not an approximation.

1. Check that the harness exists and reflects the current engine/data (e.g. it
   imports functions that still exist, its roster/strategy logic matches
   `src/data/characters.ts`). If the engine has changed underneath it in a way
   that would make it produce wrong results, fix the harness first — don't
   silently report stale numbers.
2. Run it:
   ```
   npx tsx scripts/playtest-sim.ts $player_count $seed
   ```
   (run from the `withering-worship/` directory). This prints one JSON object
   to stdout: `detailed` (one full run, round-by-round `history`, from the
   given seed) and `batch` (30 additional seeds, outcome + round only — this
   is what the turns-to-eligibility estimate comes from).
3. Type-check (`npx tsc --noEmit -p .`) and smoke-test any harness change
   before trusting its output.

## Player strategies (player_count == 3)

The default 3-player roster is fixed to Shar, Taza, and Sylva specifically
(not just "the first 3 characters") so all three tuned strategies are always
present:

- **Shar — equipment-focused**: prioritizes Market purchases, until the core
  loadout (Weapon/Armor/Implement all Attack 2+) is solid, after which Market
  purchases stop.
- **Taza — Arena-focused**: prioritizes The Arena whenever he can pay entry
  (a Rot card, or — at Arena Faction 2+ — 1 Gold instead), and Embraces
  Scenarios broadly to keep that resource flowing back in. Once Arena
  Faction 2 is reached, `runArenaVisit` pays with Gold whenever he has any,
  only falling back to a Rot card when he's out of Gold — Gold is the
  cheaper resource to spend relative to what the Victory Condition needs (3
  Rot cards in his own area), so this directly eases the "Arena spends the
  same Rot cards the Victory Condition needs" tension. On an Arena win with
  both Reward cards revealed, takes the Artifact whenever it's an upgrade
  (Arena combat totals only ever count Artifact attack, never Lore — see
  `equippedArtifactAttackTotal` in `turnEngine.ts`), falling back to Lore
  only when the Artifact wouldn't improve his gear at all. Arena is only
  prioritized once he has at least 1 attuned Lore card (the Victory
  Condition's floor) *and* 3 or fewer equipped Artifacts (Weapon/Armor/
  Implement/Rune Stones combined) — past 3, he's no longer gear-bottlenecked
  on Arena combat, so he shifts to The Valley instead rather than continuing
  to trade away the Rot cards the Victory Condition needs.
- **Sylva — adaptive**: the general "whatever's best right now" heuristic.

All three also use every reveal-ahead ability (Cira's Foresight, Valley
Faction 3's peek, Rune of Premonition) to dodge unsurvivable Combat cards, and
Rune of Teleportation/Time to ignore a Valley Loss whenever equipped. Below
Rot Counter 8, nobody is forced toward Valley; at/above it, everyone's last
Action Token each round goes to Valley, no exceptions.

## Player strategies (player_count == 4)

The 4-player roster adds Cira to the fixed 3-player one (Shar, Taza, Sylva,
Cira), so all four tuned strategies are present:

- **Cira — balanced, but Scholars Guild access first**: until Library and
  Ancient Shrine are both at Faction 3, she races those two ahead of
  everything else — a visit advances a Location's own Faction Track
  regardless of whether anything's affordable/attunable there, so this is
  guaranteed progress toward Guild access even when general "balanced"
  scoring would deprioritize a visit as unproductive. Library and Ancient
  Shrine reliably hit Faction 3 together by round 3 in testing (the two
  scored just above everything else, and the one-token-per-Location-per-round
  rule means she naturally takes one of each per round rather than dumping
  every token on Library alone). Wellspring/Valley/Market/Artificer/Arena
  keep their normal resource-gated scoring throughout this phase, so the
  race doesn't come at the total expense of Mana income or her other two
  Victory Condition legs. She also spends the Exchange Faction 1/2
  "increase your Faction by 1 at any Location" perk toward whichever of
  Library, Ancient Shrine, then Valley still needs it most, in that
  priority order (see `resolvePendingFactionPerks`) — free progress on the
  Guild-access race, then on Valley's Faction 3 peek, without spending a
  real token-visit on either.
- Once both hit Faction 3, "balanced" takes over exactly as before: spreads
  visits across every Location based on current benefit and resource
  readiness instead of fixating on whichever single Location scores
  highest, with the same visit-frequency cap (2, read off the Location's own
  Faction Track), the same hard-exclusion of Locations with nothing to gain
  from a visit, and no Warriors Guild consolidation (it has no bearing on
  her build — Market and Artificer stay individually visitable even once it
  becomes eligible, and the Guild itself is never offered as an option).
  Shares Taza's broad-Embrace Scenario policy at the Valley (see
  scenarioChoiceFor) for the same reason he has it — 3 Rot cards in her own
  player area is the remaining Victory Condition leg once Guild access and
  Lore attunement are secured.
- This closed the Guild-access gap (Scholars Guild access reliably reached
  by round 3 in testing, up from routinely never in earlier batches) but her
  eligibility rate is still the lowest of the four in testing — 3/60 across
  two 30-game batches, up from a flat 0/60 before this change. The
  remaining bottleneck is the Rot-card leg (3 needed): Valley stays gated
  behind having Lore attuned, so she doesn't accumulate them as
  aggressively as Taza does. A real, mechanically-grounded gap, not a bug —
  flag it if you want a further pass at it.
- Broad-Embrace has a shared-clock cost worth knowing about when reading
  results: Embracing adds 2 Withering Tokens to the shared Rot board
  (docs/rules.md) — indirect now rather than a guaranteed immediate +1, since
  the Rot Counter itself only moves at Cleanup Phase (`applyRotCleanupSteps`
  in `turnEngine.ts`), converting complete Withering-Token sets (one set =
  the player count). Still a real cost: every Embrace nudges that shared
  track every player loses by, so giving a second strategy (Cira) the same
  broad-Embrace policy as Taza compounds how fast it climbs across a
  4-player game, not just how many Rot cards either of them personally
  banks. Observed in testing (before this mechanic changed from a direct +1):
  adding it pushed the Rot-win rate up game-wide rather than moving Cira's
  own eligibility rate — a real tradeoff inherent to the policy, not a bug to
  fix silently; worth re-checking now that the conversion is indirect.

For player counts other than 3 or 4, the roster falls back to
`characters.slice(0, player_count)`; Taza and Cira still get their
strategies by name if they're in it, the first remaining character gets
equipment-focus, everyone else is adaptive.

If you change any of this policy, update the corresponding comment in
`scripts/playtest-sim.ts` in the same edit — the code comments there are the
source of truth for *why* each heuristic score is what it is, and they drift
out of sync with reality fast if left alone.

## Final Battle readiness gate

Reaching Victory Condition doesn't mean a bot walks straight into The Final
Battle. `resolveFinalBattleOffers` in `scripts/playtest-sim.ts` declines the
Cleanup Phase 11 offer (`declineFinalBattle`) for every eligible player,
every time, buying more rounds to build Attack Strength before ever
fighting — there's no longer an Attack-Strength threshold that accepts
early just because it "looks good enough." The only thing that forces an
accept is `rotWinsIfNobodyInitiates`.

Cleanup checks the Rot Counter *first* (step 1, using the value carried
over from the end of the previous Cleanup Phase) before this round's own +1
and Withering-Token conversion apply (steps 2 and 4: a guaranteed +1, then
converting complete token sets — one set = the player count — into further
+1s, with any remainder carried over rather than wiped; see
`applyRotCleanupSteps` in `turnEngine.ts`). Step 3 (a one-time Artifact
equip for The Rot at Rot Counter milestones 3/6/9) sits between those two
but doesn't affect the counter itself. That means `state.rotCounter` can
already sit at 13+ by the time the offer (step 11) is on the table this
same Cleanup Phase, without the game having ended yet — nothing in the
engine ever decreases `rotCounter`, so once it's >= 13 here, the *next*
Cleanup Phase's step 1 is unconditionally going to end the game.
`rotWinsIfNobodyInitiates` is just that direct check (no prediction
needed): the offered player initiates once `state.rotCounter >= 13`, and
not a moment before.

One consequence worth knowing when reading `eligiblePlayer`/`round`: they
name whoever's offer was actually accepted, which — since every accept is
now forced — is whichever eligible player the offer scan reaches first
*after* the Rot Counter has already hit 13+, not necessarily the first
player who ever met their Victory Condition. A player can sit eligible for
many rounds, building Attack Strength the whole time, before the Rot
Counter ever forces the issue.

## Outcomes

The harness plays The Final Battle out to its actual conclusion (see
`runFinalBattle` in `scripts/playtest-sim.ts`) rather than stopping the
moment someone becomes eligible for it — read `detailed.outcome`:
- `"gameWon"` — a player actually defeated The Rot (removed its last
  Artifact) in The Final Battle. `detailed.winner` names them.
- `"rotWins"` — either the Rot Counter forced the game to end before anyone
  reached eligibility (reached 13), *or* someone reached eligibility and
  fought The Final Battle but every combatant was defeated. Both are the
  same practical result; `detailed.eligiblePlayer` (see below) tells you
  which case it was — set means the second, null means the first.
- `"roundCapReached"` — neither happened within 60 rounds (rare; worth a
  note if it happens, since it usually means a bot policy is stuck).

`detailed.eligiblePlayer` names whoever's Final Battle offer was actually
accepted — see the readiness-gate note above for how that can now be a
different (or later) player than whoever first met their Victory Condition.
It's set whenever anyone reaches that point, regardless of whether the
battle that followed was actually won.
**Reaching eligibility and winning the game are very different things** —
observed in testing prior to the readiness gate above, eligibility rates of
~75-100% routinely produced actual win rates of only 15-20% (3-player) or
under 10% (4-player), because The Rot's board accumulates several Artifacts
over a normal game's length, pushing its Final Battle Attack (2 revealed
Combat cards' Attack + every Rot Artifact's Attack) well past what most
players can roll and equip for —
each loss permanently strips a card from the loser's own board too, so a
few straight losses can wipe out a whole board before landing a single hit
on The Rot. Taza's power (Wield the Rot: once per combat, remove 1
Withering Token from The Rot for +2 Attack — an opt-in choice the bot
always takes when a token's available, see resolveWieldTheRot in
turnEngine.ts) gives him a small, free Attack edge in every combat he
actually fights, on top of whatever else disproportionately favors him once
a battle starts — worth calling out explicitly in reporting, since
eligibility-rate alone (what every batch report before this session
covered) tells a substantially rosier story than actual win rate does.

## Reporting requirements

For each player, and for The Rot, report attack value strength as:
(sum of attack bonuses from artifacts attuned) + (average attack value of Lore cards attuned, capped at 3)

This is exactly `playerReport`'s `strength` field in the harness output — no
need to recompute it by hand. The Rot has no Lore-equivalent, so its
"strength" is just its equipped Artifacts' attack sum (`rotReport`'s
`strength`) — call this out as a modeling caveat, not a bug.

Also report:
- An estimate of how many turns it takes for a player to become eligible for
  the Final Battle — derive this from the `batch` array's `eligiblePlayer`/
  `round` distribution (e.g. median round among entries with an
  `eligiblePlayer` set, and what fraction of the 30 seeds reached it at all).
- The actual game-win rate alongside the eligibility rate, not instead of
  it — count `outcome === "gameWon"` separately from `eligiblePlayer` being
  set, and report both plus who `winner` actually is each time. These two
  numbers routinely diverge a lot (see "Outcomes" above) — reporting only
  eligibility rate overstates how winnable the game actually is.
- A round-by-round breakdown of which items (artifacts and Lore cards) each
  player and The Rot have equipped/attuned, by round — this is `detailed.history`.

## Resources-per-player-per-round dashboard

Every `/playtest` run publishes (or updates) an HTML dashboard Artifact
showing Gold, Artifact Mana, Lore Mana, and Attack Strength per player per
round, alongside the shared Rot Counter trend (with the danger-zone threshold
marked) and a full sortable round-by-round table that includes a Rot
Artifacts column (how many Artifacts the Rot currently has equipped, by
round) and a Locations Visited column (the 3 — or 2, at 5-6 players — action
tokens each player placed that round, in order). Build it from
`detailed.history` — each round's player entries already carry `gold`,
`manaPools`, `strength`, `rotCardsInPlayerArea`, `attuned.lore.length`,
`factionTrack`, and `locations` (the ordered array of Location IDs that
player visited that round, from `takeOneTurn`/`runRound` in the harness);
the Rot's entry carries `rotArtifacts.length` (from `rotReport`) for the Rot
Artifacts column.

- Before writing it, load the `artifact-design` skill (required for any
  artifact) — this is a utilitarian dashboard treatment, not an editorial
  one: real typographic hierarchy and a considered palette grounded in the
  game's own vocabulary (Rot, Mana, Gold), not a generic chart template.
- Check `Artifact action: "list"` for an existing "Withering Worship Ledger"
  artifact from a prior `/playtest` run. If one exists, read it and republish
  to that same URL (`action: "publish"` with `url` set) so the link stays
  stable across runs. Otherwise publish a new one.
- Verify any external resource (CDN script version + SRI hash, Google Fonts
  URL) actually resolves before publishing — a bad Chart.js version pin fails
  silently and leaves every chart blank with no visible error.
- Reuse the existing design language if updating rather than redesigning from
  scratch: sage/parchment neutrals, Fraunces for display type, Work Sans for
  body, IBM Plex Mono for data/labels, and per-player accent hues (Shar
  amber, Taza rust, Sylva teal, Rot dark plum) — unless the underlying data
  has changed enough (new strategies, new resources tracked) to warrant
  revisiting the plan.

Send the dashboard link to the user alongside the text report — don't just
describe the numbers in prose when a live, sortable view of the same data is
one publish away.
