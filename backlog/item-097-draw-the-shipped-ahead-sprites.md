# 97. Draw what the sheets carry ahead of their brains

**Status:** open — the falling items on the always-on switch shipped 2026-10-13 · **Effort:** medium in all, a small rule or brain each (the shadows also need a subtractive blend in the painter) · **Where:** viewer, `sprites.js` and the brain modules; no disc

**Filed:** 2026-10-09, from an audit of every animation the map could draw at a fresh start without a player that the sheets did not ship, made so that one rebuild could carry them all (*Ship the next brains' sprites in one rebuild, ahead of the brains*).

## What and why

Each sheet rebuild re-packs and re-encodes the whole PNG, every version of which history keeps, and every visitor storing artwork downloads it again, so the sheets took 37 animations in one rebuild before any code draws them: 25 for Exoddus and 12 for Oddysee. `SHIPPED_AHEAD` in `tests/unit/sprites.test.js` names them per game; the test fails a listed animation that something draws, so each group below takes its names off the list in the commit that draws them, and the list ends empty. The file, resource id and ordinal of each is in `tools/data/sprite_anims.json`.

Every behaviour below is the decomp's, read under the no-player reading [94](item-094-live-map.md) shipped: nobody in the world, a fresh game's switches (1 on, 0 and 2 to 255 off). Reach was measured 2026-10-08 over the shipped data, with the map's own patrol walk instrumented where a brain decides it.

## The work, by what draws it

**An Exoddus scrab knocking back** (`Scrab_Knockback`). `scrab.js` draws a stand where an Exoddus scrab meets a wall mid-walk or mid-run; the engine's `Scrab::KnockBack_4AA530` sets it moving back at a grid over 3.5, halved, and `M_Knockback_18` moves it on its line, standing at the last frame or falling where the line has gone. 1 of the 35 patrolling scrabs knocks back within a minute (SV P2 at (53,550), twice).

**The angry worker** (`Mudokon_LeverUse`, `Lever_Pull_Left`, `Lever_Pull_Release_Left`, `Lever_Pull_Right`, `Lever_Pull_Release_Right`, `Mudokon_TurnWheelBegin`, `Mudokon_TurnWheel`, `Work_Wheel_Turning`). Exoddus Mudokon state 2 runs `Brain_8_AngryWorker`: 30 to 45 ticks idle (90 in the Brewery Ender), then the lever a grid ahead and a grid up is pulled (`M_LeverUse`), the lever playing the pull for the side the worker stands on (`Lever_Pull_Left` for a worker on its left) and then its release, and back to idle; a worker standing on a WorkWheel's rect instead begins turning the wheel and turns it for good, the wheel turning with it. It keeps the normal palette; the angry one applies only while it speaks, which needs Abe. 15 workers: 13 in the Brewery and 1 in its Ender at levers, workers on both sides of their levers, and 1 at a wheel in PV P15. A pull also operates the lever's switch.

**A fleech climbing a hoist** (`Fleech_RaiseHead`, `Fleech_Climb`, `Fleech_SettleOnGround`; one of 94's open slices). In `Brain_Patrol_State_4` a fleech stops under a hoist whose rect covers its x 20 to 40 units above its feet (10 to 20 at half scale), facing the hoist's grab direction, then raises its head, climbs on its tongue (drawn as lines in `TongueUpdate`'s state 3, no art) and settles on the floor above. 19 of the 90 patrolling fleeches meet one within a minute of the map's walk: NE 1, PV 3, SV 15.

**A scrab falling at a line's end** (`Scrab_Landing` for Exoddus, `Scrab_AO_ToFall` for Oddysee; one of 94's open slices). The four falls the patrol test lists. Exoddus's SV P2 scrab leaves its line mid-run, so it falls in `Scrab_JumpAndRunToFall`, which ships, under 1.8 of gravity with its speed bleeding away, and lands 50 units down; only a walk leads into `Scrab_WalkToFall`, which is why that one did not ship. The three Oddysee scrabs (E1 P6 at (2551,1260), D2 P4 at (2501,299) and (4526,1242)) walk or run off into `Motion_15_ToFall` and find no floor below (E1 P6's into a death drop), so `Scrab_Landing` never comes for them and did not ship either. The pinned master's record files `Scrab_AO_ToFall` under resource 701; the beta and the disc put it in 700's twelfth table.

**A well letting a leaf go** (`Well_Leaf`, both games). A well with `emit_leaves` set and its switch 0 or the always-on 1 sends a leaf up on 10 ticks in 256, rolling against the game's random table from a cursor every well shares; the leaf rises, keeping 0.8 of its speed and gaining 0.5 of fall a tick with a rolled jitter, and dies on a floor or off its screen. It starts at `leaf_x`/`leaf_y` where they are set (in Exoddus, an offset from the path's Abe start) and at the well's own point where not. 170 Exoddus wells and 49 Oddysee ones, which is what keeps Exoddus's wells in `KEPT_UNSEEN`.

**A falling item on the always-on switch** (`AE_FallingRock_Waiting`, `FallingCrate_Waiting`, `Explosion_Rock`, `Explosion_Stick`, `AirExplosion`; for Oddysee `FallingMeat_Waiting`, `Meat_Gib`, `Explosion_Stick`). It waits `fall_interval` in its rumbling art, falls at up to 20 a tick (1.8 more each tick), smashes on its floor and starts over, for good: nothing can switch id 1 off, and none sets `max_falling_items`. The smash is a `ParticleBurst`, debris flung in three dimensions and scaled by depth for 91 ticks: rocks (`Explosion_Rock`), or in the Bonewerkz sticks (`Explosion_Stick`) beside a blast at three quarters scale (`AirExplosion`), and in Oddysee meat and sticks; the screen shake stays out. 23 Exoddus (6 rocks at half scale in PV P5, 17 crates in the Bonewerkz) and 3 Oddysee (R2 P7). An Exoddus item is built by the camera holding its rect's midpoint, and each one's rect's bottom point lies on that camera's screen, so none retires after a fall as one whose point lay off it would; the BW P4 crate at (611,1039), its corner in BWP04C03, is BWP04C06's. It waits no lower than that camera's top edge, the constructor keeping the smaller of the rect's top and the camera's, so that is where each fall starts.

**A slap lock shaking** (`SlapLock_Shaking`). A lock that still holds its ghost shakes once in a while: first after 25 to 32 ticks, then every 25 to 280, back to its idle art at the shake's last frame. 53 locks, 12 of which also pulse the invisibility ring every 64 ticks (polygons, no art).

**A status light on** (`Status_Light_Green`). One light, in BR P25, sits on the always-on switch with no ids to wait on, so it shows green four ticks in eight; the other 318 stay dark at a fresh start.

**The flare running down a web line** (`ChantOrb_Particle` for Exoddus). Each paramite web line runs a flare down itself at 2 units a tick (1 at half scale) after a rolled start of up to ten ticks, back to its top at the bottom: the chant orb at 0.3 scale, additive, drawn with its axes swapped. 25 lines.

**The drop shadow** (`ObjectShadow`, both games; one of 94's open slices). One frame stretched to the creature's frame width on the floor found within 240 units below it, narrowed to that line's ends, scaled down with the drop and drawn subtractively. The classes that cast one have 1,572 placed Exoddus objects and 455 Oddysee ones. The painter has no subtractive blend yet.

**A wired Mudokon laughing** (`Mudokon_Speak3@WiredMud`, `Mudokon_SpeakFart@WiredMud`, in `MUDPAL.BND` 532 under a flat grey of 74). A Mudokon placed wired runs `Brain_4_ListeningToAbe`: it turns to Abe, laughs, then follows him and laughs again every 22 to 30 ticks once still. With nobody in the world only the laughs remain, and when they fire depends on where Abe is, so this one waits on a reading chosen first, as the angry worker's turn to Abe was left out. 8 Mudokons.

**A sling Mudokon** (`Mudokon_Sling_Idle`, `Mudokon_Sling_Speak`, `DeathFlare_2`; Oddysee, no rule yet). `Brain_1_Spawn` holds it hidden for about ten ticks, lets off the flare by its feet, and two ticks later shows it with a magenta flash over the screen; forty ticks on, `Brain_0_GiveCode` whistles its code, a speak per note thirty ticks apart, then it waits for Abe. Its turn to face Abe on appearing is left out as the others' are. 4 Mudokons in L1.

**A honey sack and the bee hole** (`Honey_Drip`, `Bee_Swarm`; Oddysee). A hanging sack lets a drip fall every 90 ticks at the first drip target in its camera and keeps a swarm of five bees steering about it; F2 P2's swarm hole sends a swarm of 20 along the path's lines every 100 ticks unless a rolling ball fills it. 2 sacks (F1 P2, F2 P2; F2's camera has no drip target, so its drips land at the origin, off the map) and 1 hole.

**A claw carrying motion detectors** (`Security_Claw_Upper_NoRotation`; Oddysee). A claw whose camera holds motion detectors stops rotating and takes them: each detector's flare draws at the claw, a unit left and eleven up, every tick. 3 claws in E2 (P2 at (406,159), P4 at (429,186) and (3476,149)) carrying 8 detectors. The claw's bob, 8 units on a cosine and a quarter of that on a sine, two angle steps a tick, needs no art and goes with it.

**Two single objects in F1 P2** (`Mudokon_WalkBegin`, `Mudokon_Walk`, `Slig_StandToRun`, `Slig_Running`; Oddysee, shipped ahead 2026-10-13 in the rebuild that brought the Oddysee rocks' art). The lift Mudokon walks 64 units in 120 ticks after its camera loads (`ABEBSIC1.BAN` 55, ordinals 1 and 3), and the slig placed to chase and disappear runs off its screen at load and is removed (`SLIG.BND` 412, ordinals 11 and 1).

## Shipped (2026-10-13)

**The falling items on the always-on switch** (`fallingitem.js`, their debris in `effects.js`). Every placed falling item runs the decomp's brain and reads its switch through `switchGet`, so the 26 on id 1 move at a fresh start and the rest wait in their first art until something writes theirs: each rumbles `fall_interval` in its second art, falls in the engine's 16.16 gaining 1.8 a tick (0.9 at half scale), smashes where the raycast meets the floor of its plane, stands back where it waited in its first art for a tick and rumbles again. The smash throws the decomp's `ParticleBurst` from the item's own dice cursor, ported per game, and in the Bonewerkz the `AirExplosion` blast beside it; the item and all it throws show on the screen of the camera that builds it alone. `tests/unit/sprites.test.js` sweeps the 26 for a minute: each lands on a floor of its plane more than once, throws its debris there and starts over. An Oddysee rock outside Rupture Farms, none of which falls at a fresh start, rumbles in `AO_FallingRock_Waiting` and bursts into `Explosion_Rock` and sticks once an edit drops it, the sheet having taken both in the rebuild that brought the F1 P2 walk-ins.

Where the sketch was wrong:

- The speed cap is asked before the gain is added, so an item that has passed 20 falls 21.6 a tick (20.7 at half scale), not 20.
- An Oddysee item is built by the camera whose cell holds its rect's corner, where an Exoddus one's holds its midpoint (every object's camera list on both discs), and the camera matters more falling than waiting: most items land below their own screen, PV P5's rocks at 560 under a screen ending at 500, the upper two BW P1 crates two and one screens down, R2 P7's meat at 1424 in the slack under its last screen. In the game they fall out of view, and their debris flies back into it from below.
- The decomp's `ParticleBurst` is the PC build's in places, and the PS1 builds' code, disassembled, is what the map follows: every piece asked for in both games (25 rocks or 20 sticks in Exoddus, where the decomp halves them; 25 meat or rocks then 25 sticks in Oddysee), flung with the y speed negated in both, a depth speed whose sign one roll decides and a fresh roll sizes, so some pieces drift away from the eye, every piece on the screen drawn however large (the decomp's Exoddus bounds reach 640 and drop a piece past full size), and an item retired on any count but none. Beyond their art the games differ only in Exoddus scaling the depth by the burst's scale and Oddysee slowing its sticks to 0.4 and carrying pieces over the void between screens.
- A piece turned back short of the eye plays a sound the dice are rolled for, three rolls a piece (`Math_RandomRange(-64, 46)`, which the decomp comments out as unused, then the volume and the pan; an Oddysee meat chunk one, and only on its screen), so the debris spends the item's dice long after the smash.
- `DamageHitItems` is more than damage: an Exoddus item whose rect meets a drill's or a mine car's of its scale stops and smashes there, and six BW P4 crates fall through a shaft of running drills, about half their falls ending on one. The item reads each drill through a copy of the drill's brain stepped beside its own, in the order its camera's list updates the two, and both rects from their current frames' own bounds, which the sidecars now carry per frame (154 of Exoddus's 202 animations and 91 of Oddysee's 261 have frames whose bounds differ). The creatures it would hurt are never in reach: the closest any comes to an always-on item's fall is 17 units, the BW P3 Mudokon.

## Not shipped, and why

- **Never drawn without Abe**, so the test would refuse them: `Mudokon_TurnWheelEnd` (only Abe's voice stops a wheel worker), Exoddus's `Scrab_WalkToFall` and Oddysee's `Scrab_Landing` (above).
- **Waiting on Abe:** the ring-giving Mudokons, the sick Mudokons' answers, the Glukkon switches, the seven Exoddus sligs placed to chase, the Elum, the surprise-web paramites (none on switch 1), the hand stones.
- **Waiting on a switch off at a fresh start:** all 88 door flames, the security doors, the train doors, the bee nests, gas, water, the falling items on other ids, the explosion sets, the spawners.
- **Not animations:** the LCD screens and status boards (a font), the gas countdowns and the meters. Oddysee's stars are placed but the game's own render of them is empty.

## No art needed

These can land whenever their brain is written, without a rebuild:

- The tortured Mudokons' zap: `Electric_Wall`, which ships, flashes behind them at frame 6, which the dice let a loop reach one time in three.
- Oddysee's `SlogHut` objects, the decomp's Zzz spawner: all 10 breathe a Z every 60 ticks, their switches being off, which Exoddus's `zzz` brain already does.
- The two Bonewerkz P14 alarms on the always-on switch, a red flash over the screen.

## Measured (2026-10-08)

| Sheet | Before | After |
|---|---|---|
| Exoddus | 645,363 bytes, 1,458 rows | 722,343 bytes, 1,667 rows |
| Oddysee | 955,619 bytes, 1,878 rows | 972,239 bytes, 1,952 rows |

The map data came out byte for byte as before. The Oddysee sheet now has 96 rows left under the builder's 2048-row cap; the two F1 P2 walk-ins would take it to 2,037, and past the cap the sheet goes on to a second PNG, which the viewer already reads as a list.

## Measured (2026-10-13)

The rebuild that added the Oddysee rocks' waiting art (`AO_FallingRock_Waiting`, `F2ROCK.BAN` 2007 ordinal 1) and rock debris (`Explosion_Rock`, `DEBRIS00.BAN` 1105) and the two F1 P2 walk-ins took the Oddysee sheet from 972,239 bytes and 1,952 rows to two PNGs of 1,010,514 bytes and 2,043 rows and 960 bytes and 7 rows, the builder's 2048-row cap passed by seven. The map data and the Exoddus sheet came out byte for byte as before.

## Grown since filing

Since 2026-10-14 the sheets are one per family ([99](item-099-sprite-sheets-per-family.md)), so a rebuild re-packs only the sheets of the families it changes, and the cost that had these animations ship ahead is a family's sheet rather than the whole game's.
