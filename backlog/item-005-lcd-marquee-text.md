# 5. LCD marquee text

**Status:** shipped 2026-08-25 · **Effort:** medium (builder and viewer, one sitting) · **Where:** the spike anywhere (it reads the decomp); the extraction on the disc machine

## What and why

`LCD` / `LCDScreen` objects carry message ids. If the string tables are extractable from the discs, hovering a marquee could show its actual scrolling text ("Work hard. Die harder."). High flavour — the kind of detail that makes people share the map.

## Sketch

Find where AO/AE store LCD strings: grep the alive_reversing decomp for the LCD message loader; likely a resource chunk in the LVL or a fixed table in the EXE. Time-box it — the effort is unknown until that lands.

## Shipped

Three tables rather than one, read off the discs and resolved by [js/messages.js](../public/js/model/messages.js): AO's 90-entry LCD table, AE's 101-entry one, and AO's 36-entry HintFly table, which the sketch did not know about. The words reach the hover tooltip, the screen list and search.

Where the sketch was wrong, in the order it mattered:

- **Neither guess about storage was right.** Each table is a pointer array plus a 4-byte-aligned string blob compiled into the **level overlays** (`*.OVL`), duplicated identically into every overlay whose level needs it, and absent from `SLUS_*` entirely. The builder sweeps every overlay and requires all copies to agree, so "is the table per-level?" is re-answered on every build instead of trusted from one reading.
- **The spike was free and the extraction still needed the disc.** The decomp reproduces both LCD tables verbatim in source (`sLCDMessageTable_4C7420`, `sLCDMessageTable_555768`), which is how the tables were found at all. But those are the PC build's, and PS1 differs in wording rather than only in button glyphs: PSX AO 52 ends "while you run" where PC adds "using [Run]", PSX AO 63 stops at "at the same time" where PC offers a keyboard alternative, and PSX AE 73 spells out a two-button GameSpeak combo where PC names a dedicated key. Shipping the decomp's copy would have been quietly wrong on a map of the discs.
- **The item's Where line therefore held for the wrong reason**, and is left as written because the conclusion stands.

Decided while building:

- **The sidecar keeps the button-command code points** (0x08-0x13, the font's own) rather than any name for them. Naming is the viewer's, as the enum transforms are; renaming `Jump/Hello` costs a viewer edit rather than a rebuild. A code outside the set fails the build, and the viewer's fallback is for a stale cache, not for missing curation.
- **`objectMessages` is the single policy point**, so the three surfaces cannot disagree. It answers `null` for a type that reads no table and `[]` for a board whose ids are all blank, which is what lets a surface tell "says nothing" from "has nothing to say".
- **A dark board says so.** 20 of Oddysee's 45 boards can only ever scroll nothing, every one in Rupture Farms Return, standing where a board in Rupture Farms taught you to hoist or sneak (P15's shifted a screen along). Silence alone would have read as the map not knowing.
- **The tooltip caps at three lines**, the screen list carries the whole rotation. One AE board draws from a pool of fifteen.
- **Search blobs the messages**, which was not in the sketch. Measured before keeping it: a type-name query gains about 1% (`slig` 2443 to 2469), and `rankFor` sorts name matches first, so a board that merely mentions Sligs lands below every Slig. `press`, `hold` and `up` gain most, partly because the map writes a button as a word; that follows the existing rule that search matches whichever representation the reader is looking at.

## Ruled out

- **Shipping the messages as `enum_labels`.** A message id looks like an enum value, and the existing machinery would have rendered `message_1_id=66` as the sentence for free. But `fieldHelp` appends a field's whole value list to its glossary tooltip, which would have put seventy marquee sentences behind one dotted underline, and the generated labels are lowercased to the viewer's style, which ruins prose. The message is the object's content, not a value's label.
- **Encoding the button as a `{16}`-style token.** More readable in the committed JSON than a raw `\x10`, but it invents a format the viewer must parse and that a literal brace could break. The raw code point needs no parser; `message_json` writes it `\u00XX` so it cannot be misread as whitespace.

## Grown since filing

`LCDStatusBoard` is not part of this and never was: it composes live counters (Mudokons left, killed, rescued, and in Exoddus the zulag it stamps) rather than reading a table, so its numbers were already surfaced as fields.

The type encyclopedia had quoted these tables since [82](item-082-type-encyclopedia.md), from the decomp. Two of its claims are now checked against the shipped data instead of asserted: `LCDScreen`'s "only two of its 22 ever say anything" resolves the text rather than hard-coding the two ids, and `HintFly`'s "eleven messages are never placed, among them ABE WAS HERE and TEST THREE" gained a `CLAIMS` entry it never had.
