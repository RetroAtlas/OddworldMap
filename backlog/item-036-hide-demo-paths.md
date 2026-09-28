# 36. Hide the paths only the demos play

**Status:** shipped 2026-07-29 · **Effort:** small (setting) · **Where:** anywhere — viewer-only, derived at runtime

## What and why

A fifth of Exoddus' path buttons led to areas the game never lets a player reach: 25 copies of real places kept for the attract-mode demos that run on the title screen. They were noise in every level's buttons and in every search.

## Decided

**Holding a `DemoSpawnPoint` is the whole rule**, derived viewer-side (`js/demo.js`, a DOM-free leaf, memoized per path) rather than emitted as a builder flag — the flag would have cost a rebuild for an answer the data already gives. AO has no such type, so the rule degrades to "no demos" there with no per-game case.

**The path in hand is always listed.** `selectPathById` reveals a hidden path for the session, which covers a permalink, a remembered location, a followed door and a search jump in one place, and is why switching the setting *off* leaves the path you are standing on visible rather than moving you.

**Not a toast.** `selectPath` re-fires on every pushed hash write, so a toast would repeat for as long as the visitor stayed. What the path is gets said where an arrival will read it: a line in the place chip's panel, and the `[Demo]` the curated names already carry.

**Search reports what it withheld** on its summary line, so a hit it drops does not read as a hit gone missing.

## Ruled out

A per-path note saying "unreachable, attract-mode only" — that is a property of the whole class, so it belongs to this flag rather than to 25 copies of one sentence. Recorded as an exclusion in [37](item-037-per-path-notes.md) as well.

Filtering the entry marks, the connection arrows or their off-path stubs. Measured over the shipped data: no destination `destTrusted` believes leads into a demo path, and the games arrive at none of them, so a filter there would have been dead code. The finding is pinned as a test rather than defended in code — and it only became true once [40](item-040-validate-destinations.md) landed, since before that two Mines demo paths wore an entry badge on a dead link alone.

**Deriving the `[Demo]` marker instead of curating it — built, reverted, and worth recording as a decision rather than a false start.** `demoLabel(P, name)` composed the marker from `isDemoPath` at the three sites a path is named, and the 25 annotation strings dropped it. Rendering was provably unchanged, replayed across all 190 paths in both games with every displayed name identical, so as *code* it was strictly better: one fact, derived once, with no test needed to hold two copies in step. It was reverted anyway, on three counts that all point the same way — **the file is the interface here**:

1. `annotations.json` is curated prose a *person* reads and edits, and `[Demo] Scrab Nest` tells that person what `Scrab Nest` cannot: that the entry naming the same room two paths away is not a duplicate. Deriving moved that fact out of the file where the names are maintained.
2. The composition had nowhere good to live. `annotations.js` is a leaf module, and reaching `isDemoPath` from it would drag `settings.js` and its imports in behind it, so all three callers ended up wrapping a general lookup in a demo-shaped one by hand.
3. `demoLabel` could not justify its own existence without naming the chip, the buttons and the place panel — a comment about consumers, which this repo's comment convention forbids outright.

So the marker stays written into the string, and the coupling test is what keeps it honest. The general lesson: a leaf module that cannot reach the fact it would need is a signal the composition belongs in the data, not that the callers should carry it. Built and reverted 2026-07-29 (*Derive a demo path's marker instead of curating it*, `6e884f1`, and its revert `cc0aad4`); the net effect on the tree is one clause in [CLAUDE.md](../CLAUDE.md), so a later session reads a decision rather than a smell.

## Findings

Measured 2026-07-29 and re-derived independently: the `DemoSpawnPoint` set and the 25 hand-curated `[Demo]` names agree **exactly**, with nothing in either that isn't in the other. Those two sets were produced months apart by completely different means — one read off disc TLVs, one written by hand against the decomp's demo table — so their agreement is the strongest available evidence that both are right.

No level *opens* on a demo path and no level is emptied by hiding the class, so the hidden state can never strand a visitor on a level with no buttons. The distribution: MI 4, NE 1, PV 2, SV 3, FD 4, BA 2, BW 2, BR 7.

Verified in the browser: `]` from `MI P7` skips the hidden P8 and P9 to reach P10; a permalink to `MI P8` reveals it in its numeric place with the panel saying what it is; turning the setting off while standing on `P11` leaves `P11` listed; and search reports "29 hidden in demo paths", which is exactly the `DemoSpawnPoint` count across the 25 paths.

## Shipped

A "Show demo paths" setting, off by default. The screen list needs no filtering because it is scoped to the path in hand, which is always one that is shown.

## Grown since filing

**The rule became a leaf, 2026-09-28.** Once `levelWiring` asked it, `js/demo.js` carried `settings.js` into `model.js` and closed an import cycle, `settings.js` reading the permalink parser there. The listing half, `pathVisible` and `revealPath`, lives in `js/pathvisible.js` instead, so `isDemoPath` imports nothing and the second count above has lost its premise: reaching the rule from `annotations.js` would drag nothing in behind it. The first and third counts decide the question on their own, and the marker stays in the file.
