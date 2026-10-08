# 96. A Scrab's pen on hover

**Status:** open · **Effort:** small (a pen rule beside the Slig's, a sweep, docs) · **Where:** viewer, `model.js`

**Filed:** 2026-10-08, found while moving the Slig pen onto the patrol's own pick (the *Grown since filing* note on [81](item-081-enemy-territory.md)).

## What and why

With "Enemy patrol pens" on, hovering a Slig shades the span between its bound posts, while hovering a Scrab shades nothing, even one that plainly paces between a ScrabLeftBound and a ScrabRightBound: AO D2 P2's Scrab at (479,789) walks 463..565 between posts at 429 and 579. `patrolZone` answers only for a Slig or a SligSpawner, which [81](item-081-enemy-territory.md) recorded as "Scrab bounds ship no ids, so scrabs get posts and no pen".

That reasoning holds for the Slig alone. A Slig's constructor pairs it with its bounds by id and keeps the zone, so there is a pair to shade. A Scrab keeps no zone and its bounds carry no id: its brain turns at whichever bound of the facing side its probe meets as it walks (`scrabAO` and `scrabAtBound` in [js/scrab.js](../public/js/scrab.js)). Oddysee's probe is a point at its feet, then a grid ahead once it walks; Exoddus's is a box from its feet a grid up, one grid ahead or two at a run. So a Scrab's pen is still well defined, by nearness rather than by id: the nearest ScrabLeftBound and ScrabRightBound its probe would meet on its own floor. Nearness is the pairing 81's sketch guessed for Sligs and the decomp ruled out for them; for Scrabs it is how the engine behaves.

## Findings

Measured 2026-10-08 over the shipped data. Each patrolling Scrab's posts were taken as the nearest of each side whose rectangle its own game's probe reaches at its floor (Oddysee's the floor point, Exoddus's the grid above it), and its walk was resolved over two minutes of patrol ticks:

- All 28 of Oddysee's patrolling Scrabs, and 26 of Exoddus's 35, have a left and a right post on their floor, and each of the 54 walks between its two, passing a post by no more than a stride, the overshoot a run carries.
- Exoddus's other nine, all in the Scrabanian Vaults (SV P2, P5, P6 and P13), have no Scrab post on their floor at all. Walls and slam doors turn them, and SV P2's at (53,550) also meets the end of its floor, one of the falls at a line's end that the patrol sweep in `tests/unit/sprites.test.js` lists.

## Sketch

- A pen rule for `Scrab` beside the Slig's in `patrolZone`: the band between those two posts, shaded on hover like a Slig's, and no pen where a side has no post, as a Slig with a missing side gets none.
- Take each post as the engine meets it: the nearest of its side whose rectangle the game's own probe reaches at the Scrab's floor, along the floor it walks, so a post at the same height across a gap or behind a wall does not count.
- Exoddus's Slurgs turn at Scrab bounds too, at their own point (`slurg.js`), so the same rule can pen them.
- Tests: pin AO D2 P2's Scrab (its pen between the posts at 429 and 579) and sweep every patrolling Scrab for a walk that leaves its pen by more than a stride.
- Docs: the pen bullet in [docs/viewer-geometry.md](../docs/viewer-geometry.md), which says scrabs get posts and no pen; README's pens note; a changelog entry.

## Watch out

- The band should end on the posts, which stand on each stamp's top-left x, so posts and band meet as a Slig's do. A Scrab walking left turns where its probe enters the left post's rectangle, at its right edge, so it stops up to a stamp's width inside the band; that gap is the engine's, not a misplaced band.
- Oddysee carries a walker across the void between screens, so a Scrab whose posts sit on two screens (AO D2 P7's at (407,776), AO D2 P9's at (1379,1256)) has a band spanning the slack, as a Slig's two-screen pen does.
