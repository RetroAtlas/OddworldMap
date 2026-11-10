# 28. Readable units for raw numeric fields

**Status:** shipped 2026-08-26 · **Effort:** medium (curation plus a decomp read, one sitting) · **Where:** anywhere; no disc and no emulator, the decomp settling the rate

## What and why

Most enum fields now render as words, but bare-int numeric fields still show raw: ~40–60 timer/delay fields per game as of 2026-07 (`shoot_on_sight_delay`, `pause_time`, `panic_timeout`, `chase_delay`, …), a few percentages (`percent_say_what`, `percent_beat_mudokon`), a few distances (`noise_wake_up_distance`, `grid_spacing`). They carry **no game type**, so the type-keyed transform layer (`TRANSFORM` / `enum_labels`) can't reach them.

## Findings

**What the decomp gives (checked 2026-07):** units are *not* systematically annotated — only a handful of ADD display names carry one (`(Grids)` on `noise_wake_up_distance` and `patrol_range`, `(Seconds)` on exactly one field, `mines_alarm_countdown`); the rest are unlabelled. And there is **no fixed logic frame rate** — `Calculate_FPS_495250` *measures* elapsed time (a debug counter), not a constant. The timers are frame counts, decremented per game loop (15/30/60/90 patterns), but "how many equal one second" is not in the source.

## Sketch

**Tiers, cleanest first:**

- **Safe now:** `percent → "%"` (raw is already 0–100) and pass-through of the two decomp-annotated units. Small — may not justify a units layer on its own.
- **Middle — "N frames":** label timer/delay fields `N frames`. Accurate (they *are* frame counts), no FPS needed; costs a *reviewed* list of which untyped fields are frame-timers (name heuristics `*_delay`/`*_time`/`*_timeout` get most, but a blanket rule mislabels the `*_time` fields that are counts).
- **Full — timers → seconds:** the marquee, blocked on the real logic rate. **Disc-machine spike:** in DuckStation, watch a timer that is *also* labelled `(Seconds)` (the mine countdown) decrement and derive frames-per-second from it, then convert. A guessed factor would ship "silently wrong" seconds — the thing the exporter now fails loudly to prevent.

**Plumbing (reuses the architecture):** untyped fields get a synthetic unit type via an override table `(game, object, field) → "Frames"/"Percent"/"Grid"`, mirroring `_FIELD_TYPE_OVERRIDES`; add a `TRANSFORM` *function* per unit in [js/fields.js](../public/js/model/fields.js) (`Percent: n => `${n}%``). The `resolve` map-or-function path already supports functions (unit-tested), so the code is small — the work is the curated field→unit table and, for seconds, the measured FPS.

## Shipped

A `units` section in [glossary_fields.json](../public/glossary_fields.json), repeating the same three tiers the definitions use, and a `UNITS` table of formatters in [js/fields.js](../public/js/model/fields.js). 137 type-field pairs carry one, over 43 object types and 11,336 values on the map: 126 frames, 6 grid, 4 percent, 1 seconds. A timer reads `15 frames ≈ 0.5s`, keeping the exact count and gaining the reading, which is the shape `formatDist` already uses for the ruler.

Where the item was wrong, in the order it mattered:

- **The seconds tier was never blocked.** The Findings paragraph above is wrong: `Calculate_FPS_495250` is not where the rate lives. Exoddus' `ColourfulMeter` multiplies the one field relive_api labels `(Seconds)` by 30 to start the mine alarm, `MinesAlarm` ticks a sound every thirtieth decrement of that countdown, and both games' gas countdowns divide the global frame counter by 30 for a visible on-screen clock. That counter advances once per main-loop pass, which is the clock the delay fields are counted on. The shipped data agrees: after zero, the commonest timer values are 30, 90 and 300. `LOGIC_FPS` in [js/config.js](../public/js/config.js) sits beside `GRID_UNIT`, the other fact about the game's own units.
- **The plumbing belongs in the glossary, not the builder.** The sketch proposed a `(game, object, field)` override table mirroring `_FIELD_TYPE_OVERRIDES`. That table is per-game where a unit is game-agnostic, and it exists to supply what the decomp should have declared where a unit is curation; `field_types` is derived from the decomp alone and carries enum-typed fields only. Putting the unit beside the sentence asserting it is also what makes the two testable against each other.
- **The curated field-to-unit list mostly existed already.** [17](item-017-field-glossary.md) shipped after this item was filed, and its definitions state the units in words: 65 of the entries were transcribed from prose that already said "in frames". The other 23 were frame timers whose definitions never said so, each read in the engine before being labelled, and each definition gained the unit in the same pass.
- **The three tiers were not one small and one large.** Percent came to two field names, not a tier worth hesitating over, and `percent_beat_mudokon` is excluded outright: its own definition says it is rolled against 255 and is not a percentage, which is exactly what the per-type tier is for.

Decided while building:

- **The label layer wins.** `prettify` asks for a unit only after a game type has failed to resolve a label, so a unit can never displace an enum's words.
- **The vocabulary is closed and the renderer owns it.** A unit word `UNITS` has no formatter for leaves the value raw; the closed set is pinned by test rather than guarded in `sanitizeGlossary`, which stays a shape check.
- **`fieldHelp` states the factor** for a frames field and for no other, frames being the one unit whose reading is derived rather than stored. The hover tooltip cannot host a tooltip of its own, so the unit in the value is the only thing that reaches a hovering reader; the three surfaces that can host one carry the rate.
- **A number is bound to its unit word with a non-breaking space.** The surfaces lay field pairs out as flowing text, and `pause_time=15` breaking before `frames` reads as a second field. That makes a pair one long token, so the three surfaces let an over-long one break rather than clip, which also retires the same clipping `possessed_max_whirl_attack_duration` already had bare.
- **The coverage pin runs both ways**: a definition that declares a unit must carry it, and a unit must be stated by the definition it sits beside. The phrase table is a completeness alarm, never the source of truth, because a regex over English deciding what the app renders is the silently-wrong failure the exporter exists to prevent.

## Ruled out

**In-page FPS switcher (30/60/custom):** wrong for a reference map — it offers a choice around a value that has one true answer nobody has measured yet, and a reference should state the fact rather than ask the reader to pick. Recorded so it isn't re-proposed. The rate has one true answer and the map states it.

**Speeds as a fifth unit.** `MovingBomb.speed` and `RollingBall.speed` are 256ths of a unit per frame, `MeatSaw.speed` whole world units per frame, `x_velocity` "hundredths or so", and `Drill.speed` special-cases exactly 250 to the game's slowest crawl. Each needs its own divisor where this layer's vocabulary is one word per field, and their definitions already state the scaling. The same goes for the two lengths in world units (`MeatSaw.max_rise_time`, `PullRingRope.rope_length`), which would be a fifth family for two fields.
