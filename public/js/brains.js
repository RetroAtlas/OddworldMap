// The brains the game runs without a player, ported from the decomp: each a
// sub-state machine over the engine's frame counter, rolling the game's own
// dice (its 256-byte table, walked from a seed), and the motions that chain one
// animation into the next at its last frame. A step is one engine tick: the
// brain, then the motion of whatever it left current, with the last-frame flag
// the previous tick's animation step left behind; the clock steps them.
// No DOM, so it stays importable in bare Node.

// the registry: every brain module, and the tables they fill
export { BRAINS, MOTIONS, SPAWN_FRAME, STARTS } from "./patrolkit.js";
export { stepEffects } from "./effects.js";
import "./idlebrains.js";
import "./slig.js";
import "./scrab.js";
import "./fleech.js";
import "./movingbomb.js";
import "./slurg.js";
import "./greeter.js";
import "./bat.js";
import "./glukkon.js";
import "./flyingslig.js";
import "./lcd.js";
