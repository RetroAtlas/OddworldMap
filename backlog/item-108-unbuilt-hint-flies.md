# 108. The hint flies the PlayStation never builds

**Status:** undecided · whether the 13 hint flies the PlayStation game never constructs keep their swarms and their words on the map · **Effort:** small to medium once decided: a bit per path from the builder, a rule and a tooltip note in the viewer, one rebuild of the base messages and of every Oddysee release · **Where:** a disc machine for the rebuild, anywhere for the rest · **Filed:** 2026-11-13, from the read of the PS1 overlays that ported the hint flies' words ([94](item-094-live-map.md))

## What and why

Oddysee's path data places 28 hint flies, and the map draws a swarm for each and spells its message under the pointer. The PlayStation game builds 15 of them. Each path has its own table of object factories, in the overlay the path loads, and in the overlays `D1.OVL`, `F1.OVL` and `L1.OVL` the hint fly's entry is an empty function: those overlays carry no hint fly code, no hint messages and no alphabet, so on the ten of their sixteen paths that place one a hint fly's record constructs nothing, and nothing swarms or spells there however long Abe chants. The PC build links one executable and spells all 28, which is what the decomp describes and what the map shows.

The map draws the PlayStation's game: its screens, its sprites, its text and its brains are read off the PS1 discs wherever the PC build differs. By that rule the 13 are objects the game keeps unseen, as an open door or an electric wall that is off is, and a swarm there is a thing the game never shows. Against it: the placements are the level designers' own, every one of the 13 cameras still carries the fly's animation, the messages are in the game's table, and every hint about Elum is among them, so hiding them takes the only place those words are met on the map.

## What the disc says (2026-11-13)

Read off the base disc, the third US pressing, and not from a run of the game.

- The executable's record for a path holds a table of 116 function pointers at +0x1C of its path data, one per object type, each a function in the overlay the path loads; the loader calls the entry of each record's type as a camera's objects are built.
- Entry 92, the hint fly's, is the hint fly's factory on the 30 paths that load `D2`, `D3`, `D7`, `E1`, `E2`, `E3`, `E4`, `F2`, `F3`, `F4` or `L2.OVL`, and two instructions, a return and its delay slot, on the 44 paths that load any other overlay.
- Those 11 overlays are exactly the ones that hold the hint fly message table and the alphabet ([docs/format-gotchas.md](../docs/format-gotchas.md)); the other 18 hold neither, by a search for the first message and for the letter A's dots.
- Never built, 13 on ten paths: Scrabania `D1` P1 WALK SOFTLY, P2 QUEST FOR SPIRIT RINGS, P3 RUN ELUM RUN, P4 ELUMS LIKE HONEY BUT NOT BEES and QUEST FOR SPIRIT RINGS, P7 RUN ELUM RUN, P8 ELUM WAIT HERE and FAREWELL ELUM; Paramonia `F1` P1 STEP LIGHTLY, P2 SNEAK UP BEHIND SLIG, P5 FIND PLATFORM FOR ELUM; Monsaic Lines `L1` P2 FIND BELLSONG THEN POSSESS BELLS and TOUCH THE STONE.
- Built, 15 on ten paths: Stock Yards `E1` P1 (two), P3 (two), P4 (two), P6; Stock Yards Return `E2` P4; Paramonian Temple `F2` P1, P6 (two), P7; Monsaic Lines `L1` P5 (two); Scrabania Escape `D7` P11.
- The camera of each of the 28 holds the fly's animation, resource 62, so the art was placed with the objects and the overlays' code left them out.

Not read: any other release. The Spanish edition's one message with a comma, a code its alphabet has no letter for, is FIND BELLSONG's, placed on `L1` P2 alone.

## To decide

- **Follow the PlayStation.** The 13 stand unseen: no swarm and no words, a marker under Markers for the rest, the tooltip keeping the message with a line saying the PlayStation game never builds this one. The map then shows what the game shows, and says what it knows.
- **Keep all 28**, as the PC build has them, and say so where it is true: the same tooltip line on the 13, with the swarm and the words left in.
- **Keep all 28 and say nothing**, which is the map as it stands.

## Sketch

The builder knows the overlay each Oddysee path loads (`path_overlays`) and which overlays carry the hint fly table, so a path builds hint flies exactly where its overlay carries one. That bit belongs beside the tables in `messages_ao.json`, as the list of the paths whose overlay carries none, and in a release's overlay wherever its list differs from the base's; the viewer reads it where it reads a path's messages. The rule then returns no record for a hint fly on such a path, which the kept-unseen pass already treats as an object whose own state draws nothing, and the tooltip's line is a note of the message reader's. A test over the shipped data pins the 13 and the 15.

## Verify

- A run of the game settles what the code only implies: `tools/visit.py` writes a save that starts a path where a permalink stands ([docs/visit.md](../docs/visit.md)); chant on `D1` P3 where RUN ELUM RUN is placed, and on `E1` P1 beside SNEAK IN AND OUT OF SHADOWS for the control.
- The other releases' discs: the same table read off each, since a later build may have given the three overlays their hint flies.
