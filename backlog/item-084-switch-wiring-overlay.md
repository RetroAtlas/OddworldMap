# 84. Switch wiring overlay

**Status:** shipped 2026-08-10 · **Effort:** large (viewer, product) · **Where:** anywhere · **Filed:** 2026-08-07 feature-ideation sweep

## Why

Connection arrows ([1](item-001-connection-arrows.md)) show where you can *go*; nothing shows what a lever *does*. "What does this switch open?" is the single most common question anyone has staring at a screen of these games, the answer is fully present in the shipped field archive, and no wiki carries it — walkthroughs describe wiring in prose, one puzzle at a time. Drawing it would be the map's second circulation system: travel in one overlay, causation in the other.

## The data, measured (2026-08-07, from the shipped `map_data` files)

Producers — objects whose activation writes a switch id:

- AE: 807 (Lever 332, InvisibleSwitch 124, WorkWheel 114, FootSwitch 102, SlapLock 59 via `toggle_switch_id`, GlukkonSwitch 32 with separate `ok_switch_id` / `fail_switch_id`, one lone CrawlingSligButton, and the gates below).
- AO: 233 (Switch 101, InvisibleSwitch 84, BellSongStone 17, ChimeLock 13 with `password_switch_id` / `solve_switch_id`, IdSplitter 12 via `source_switch_id`, FootSwitch 4, BellHammer 2).
- The gates: AE's `WheelSyncer` (22) and `MultiSwitchController` (21) each carry `input_switch_id_1..6` → `output_switch_id` — literal logic gates, so real puzzle circuits (the wheel rooms, the multi-lever doors) are drawable, not just single wires.

Consumers — objects that answer to an id: Door (452 AE / 137 AO), SlamDoor (268), Drill (181), TrapDoor (150 + 29), ElectricWall (106 + 29), MovingBomb (`triggered_by_alarm`), BirdPortal (135, `create_portal_switch_id` / `delete_portal_switch_id`), Fleech (`wake_up_switch_id` / `can_wake_up_switch_id`), Mudokon (`angry_switch_id`), Slurg, StatusLight (319), and more.

Noise, also measured: `switch_id = 0` means unwired — AE holds 3,096 zeros against 2,528 live values — and some carriers are not consumers in any useful sense (LightEffect 811, Hoist 528+1109, ShadowZone). The overlay starts from a curated producer/consumer key table, not from every field whose name contains `switch_id`.

## Sketch

- `computeWiring(path)` in [js/model.js](../public/js/model/model.js), a sibling of `computeConnections`: edges from each producer's output id to every consumer field carrying that id within the path, reading the raw `fields` bucket (ints, snake_case — the archive, not `extra`). Skip id 0.
- Phase 1: 1:1 wires for the unambiguous pairs (levers/switches → doors, trapdoors, electric walls, slam doors, drills, portals' create/delete). Phase 2: the gates — `WheelSyncer` / `MultiSwitchController` render as fan-in nodes, `IdSplitter` and `GlukkonSwitch` as one-to-many with labelled outputs.
- Its own Display toggle beside Connection arrows, its own visual voice (the arrows own curves and solid strokes; wiring wants straight dotted runs or right-angle traces, so the two systems never read as one), hover spotlight exactly like `connFocus`.
- The tooltip gains the reverse reading for free: a consumer can name the producers pointing at it.

## Watch out

- **Id scope must come from the decomp before anything ships**: whether switch ids act path-wide or leak across paths of a level (the engine's switch-state array is global to the running level — verify what that means for cross-path wires the overlay would otherwise miss or invent).
- Same-key-different-meaning traps: a Slig's `slig_spawner_switch_id` binds it to its spawner's id space, not to a lever; `triggered_by` on FootSwitch is a filter, not an output. Every key entering the table needs its meaning checked against the decomp or the glossary, one by one — this is where the effort lives, and the curated table is also exactly the shape [17](item-017-field-glossary.md)'s definitions can annotate.
- Dense paths will draw a lot of wire: the spotlight-on-hover behaviour is the release valve, and a "wires only while hovering" mode may be the right default on phones.

## Shipped

Same-path wires with the gates included — the phase split dissolved, because a gate needs no special rendering: WheelSyncer, MultiSwitchController, the timer relays (one engine object, shipped as TimerTrigger in AE and under this map's own name IdSplitter in AO) and the hub doors read correctly as ordinary objects with wires in and wires out. A Display toggle beside Connection arrows (`w`), off by default; straight dotted hairlines in the switches category's green, against the arrows' solid curves; hover spotlights one object's wires and gives them arrowheads at the consumer end; an edge hides with either endpoint (`markerShown` both ends), so a hidden category takes its wires with it — and TimerTrigger and PullRingRope sit in the Switches / levers bucket for exactly that reason, so the gates and pull rings the overlay wires are on by default.

**The id-scope answer is level-scoped.** One state array per game (`SwitchStates`, 256 slots), reset only on level change — AE Map.cpp skips the reset on force-load and restores the array from quicksaves; AO's reset loop clears only ids 0–235, 236 being the one-shot setter's "already ran" guard. Ids 0 and 1 are hardwired (`Get(0)` = 0, `Get(1)` = 1) and `Do_Operation` refuses anything below 2, so live wires are ids 2–255 and a consumer carrying 1 is "always on" rather than wired. Cross-path wires within a level are therefore engine-real; they stay off the canvas and reach the hover tooltip as text ("answers 11 — set in P2"), stated only when the partner actually exists in another non-demo path — which is exactly what the R2 P1 hub door and the P13/P14 boardroom flames needed, their feeds living in the zulag paths. The tooltip describes the drawn wires — a local partner in a hidden category is neither drawn nor named, while a cross-path note names a path rather than a marker — and a gate door's own id counts as an output alone, the gate rewriting it every frame, so no inbound feed is ever claimed that the engine would override.

The curated table (`WIRES` in config.js) came out of checking every switch-named field against the decomp's read/write sites, and that checking was most of the work:

- Not wire ends, despite the names: Teleporter's `teleporter_switch_id`/`other_teleporter_switch_id` (the `tp#` pair numbers), a placed Slig's `slig_spawner_switch_id` and FlyingSlig's `spawner_switch_id` (read only off spawner TLVs — AE's SligSpawner ships its own copy as `id`), LiftMudokon's `lift_switch_id` (a LiftPoint pairing), SlapLock's `target_tomb_id_1` (a door number — `target_tomb_id_2` is a genuine switch write, the ghost orb's), and the never-read carriers (Hoist, ShadowZone, LightEffect, Honey, BeeSwarmHole, TimedMine). The near-miss worth remembering: HandStone's `trigger_switch_id` *is* a genuine write — using the stone sets it through the very line MovieHandStone's uses — even though the stone also copies the value into a field marked unused, which reads at first sight like the whole story.
- Producers the sketch missed: PullRingRope (both games), the hand stones (both kinds — using one sets its trigger id), Mudokon's `rescue_switch_id` (set to 1 on rescue — the mud-counter circuits), MotionDetector and AO's SecurityClaw (via the Alarm object they spawn), SecurityDoor (announces itself opened), Slurg (an increment — the squash counters ColourfulMeter displays), Glukkon's help and death ids, and TimerTrigger, at 86 the biggest gate population in AE.
- Consumers it missed: StatusLight carries five more inputs (`id_1`–`id_5`) beside its `switch_id`, TorturedMudokon its two, and a long tail (gas timers, Water, LCD messages, portal create/delete, level loader).
- Excluded with a reason: a drill or saw that writes its own id back at cycle end — AE Drill's use-behaviour, AO's switch-id saws — is group timing, not wiring. As producers they mesh Brewery P10's id 62 (one lever, one electric wall, sixteen synced drills) into 273 of the path's 303 edges; as consumers only, the lever gating them fans out honestly. The cost: a self-driven group with no external producer shows no wire, and AO R2 P18's saw pair on id 39 is the only one in either game. SlogHut sat here first as unimplemented, until the read turned up (2026-08-14): AO's `ZzzSpawner::VUpdate` polls the hut's switch every update, the same read AE's ZzzSpawner already wired, so the ten huts are consumers after all. The tooltip states only partners that exist, never absence — which is why the wrong exclusion never made the map claim anything false.
- Range wipes are not wires: AE ResetSwitchRange and AO ResetPath/ContinuePoint clear id ranges as checkpointing.

Measured over the shipped data with the shipped rule (2026-08-10, pinned in `tests/unit/wiring.test.js` along with a cross-check of every table key against the data): AO 364 edges across 64 of 74 paths (re-measured 2026-08-14, the Slog huts' ten in), densest R1 P15 at 23; AE 2,380 edges across 105 of 117, densest MI P1 at 107 — one lever fanning out to twelve. The hub-door gate runs on AO `start_state` 2 (5 doors) and AE `door_type` 2/3 (43 doors); no non-gate door carries a live hub id, so the engine's guard and the shipped data agree.
