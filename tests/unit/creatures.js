import { resolveRecord } from "../../public/js/engine/motion.js";

export const anim = (n, fps, loop, loopStart = 0) => ({
  fps,
  loop,
  loop_start: loopStart,
  frames: Array.from({ length: n }, (_, i) => [0, i, 0, 1, 1, 0, 0]),
});

// the working Mudokons' animations at the sidecar's lengths and hold counts
export const WORK_ANIMS = {
  Mudokon_StandScrubLoop: anim(10, 1, true),
  Mudokon_StandScrubLoopToPause: anim(3, 2, true),
  Mudokon_StandScrubPause: anim(6, 4, true),
  Mudokon_StandScrubPauseToLoop: anim(1, 1, false),
  Mudokon_CrouchScrub: anim(10, 1, false),
  Mudokon_CrouchIdle: anim(5, 4, true),
  Mudokon_CrouchTurn: anim(8, 1, false),
  Mudokon_CrouchToStand: anim(6, 1, false),
  Mudokon_Chisel: anim(6, 2, true),
  Mudokon_StartChisel: anim(1, 1, true),
  Mudokon_StopChisel: anim(1, 1, true),
  Mudokon_Idle: anim(6, 4, true),
  Mudokon_StandToCrouch: anim(11, 1, false),
  "Mudokon_SpeakFart@SadMud": anim(7, 2, false),
  "Mudokon_Speak3@AngryMud": anim(7, 2, true),
};

export const worker = (brain, mood = null) => ({
  anim: brain === "chisel" ? "Mudokon_Chisel" : "Mudokon_CrouchScrub",
  x: 0,
  y: 0,
  scale: 1,
  layer: 27,
  flip: false,
  frame: 0,
  rgb: [87, 103, 67],
  cycle: { kind: "brain", brain, seed: 0, emo: mood !== null, p: { sad: mood === "sad" } },
});

// what one record shows over a run of ticks, as the segments it passes through
export function segments(r, set, from, to) {
  const out = [];
  for (let t = from; t <= to; t++) {
    const name = resolveRecord(r, set, t).name.replace(/^[A-Za-z]+_/, "");
    if (out.length && out[out.length - 1].name === name) out[out.length - 1].to = t;
    else out.push({ name, from: t, to: t });
  }
  return out.map((s) => `${s.name} ${s.from}-${s.to}`);
}

export const IDLE_ANIMS = {
  ...WORK_ANIMS,
  Slog_Idle: anim(6, 2, true),
  Slog_MoveHeadUpwards: anim(7, 1, false),
  Slog_Scratch: anim(20, 1, false, 3),
  Slog_Growl: anim(7, 1, false),
  Paramite_Idle: anim(6, 4, true),
  Paramite_Turn: anim(7, 1, false),
  Paramite_GameSpeakBegin: anim(8, 1, false),
  Paramite_PreHiss: anim(2, 4, true),
  Paramite_GameSpeakEnd: anim(8, 1, false),
  MeatSaw_Idle: anim(6, 1, true),
  MeatSaw_Moving: anim(3, 1, true),
  Drill_Vertical_Off: anim(1, 1, true),
  Drill_Vertical_On: anim(4, 1, true),
};

export const creature = (animName, name, p = null, seed = 0) => ({
  anim: animName,
  x: 0,
  y: 0,
  scale: 1,
  layer: 27,
  flip: false,
  frame: 0,
  cycle: { kind: "brain", brain: name, seed, emo: false, p },
});

export const PATROL_ANIMS = {
  ...IDLE_ANIMS,
  Slig_Idle: anim(6, 4, true),
  Slig_StandToWalk: anim(3, 1, false),
  Slig_Walking: anim(18, 1, true),
  Slig_WalkToStand: anim(3, 1, false),
  Slig_TurnAroundStanding: anim(9, 1, false),
  Slig_ReloadGun: anim(9, 2, false),
  Scrab_Idle: anim(6, 4, true),
  Scrab_Walk: anim(22, 1, true),
  Scrab_Run: anim(14, 1, true),
  Scrab_Turn: anim(12, 1, false),
  Scrab_RunToStand: anim(10, 1, false),
  Scrab_StandToWalk: anim(3, 1, false),
  Scrab_StandToRun: anim(3, 1, false),
  Scrab_WalkToStand: anim(3, 1, false),
  Scrab_HowlBegin: anim(15, 2, true),
  Scrab_HowlEnd: anim(6, 1, false),
  Scrab_Shriek: anim(12, 2, false),
  Fleech_Idle: anim(9, 1, true),
  Fleech_Crawl: anim(7, 1, true),
  Fleech_PatrolCry: anim(4, 2, true),
  Fleech_Knockback: anim(1, 1, false),
  Fleech_StopMidCrawlCycle: anim(4, 2, false),
  MovingBomb: anim(15, 2, true),
};

// a flat world: one floor line, the objects given, no links
export const world = (game, lines, tlvs, spawn, half = false) => ({
  game,
  half,
  lines,
  links: null,
  tlvs,
  spawn,
});
export const tlv = (name, x1, y1, x2, y2, fields = {}) => ({ name, x1, y1, x2, y2, fields });
export const walker = (animName, name, p, w, x, y, flip = false, seed = 0) => ({
  anim: animName,
  x,
  y,
  scale: w.half ? 0.5 : 1,
  layer: 27,
  flip,
  frame: 0,
  cycle: { kind: "brain", brain: name, seed, emo: false, p, world: w, patrol: true },
});

export const ROAMER_ANIMS = {
  ...PATROL_ANIMS,
  Slurg_Move: anim(6, 2, true),
  Slurg_Turn_Around: anim(6, 2, false),
  Greeter_Moving: anim(9, 1, true),
  Greeter_Turn: anim(6, 1, false),
  Greeter_Speak: anim(8, 1, false),
  MotionDetector_Flare: anim(1, 1, true),
  MotionDetector_Laser: anim(1, 1, true),
  Bat: anim(10, 2, true),
  Bat_Unknown: anim(7, 1, false),
  Bat_Flying: anim(15, 1, true),
  Glukkon_Normal_Idle: anim(7, 4, true),
  Glukkon_Normal_BeginWalk: anim(3, 1, false),
  Glukkon_Normal_Walk: anim(18, 1, true),
  Glukkon_Normal_EndWalk: anim(3, 1, false),
  Glukkon_Normal_EndSingleStep: anim(3, 1, false),
  Glukkon_Normal_Turn: anim(10, 1, false),
  Glukkon_Normal_Speak1: anim(11, 1, false),
  Glukkon_Normal_LongLaugh: anim(22, 1, false),
  Background_Glukkon_Idle: anim(6, 4, true),
  Background_Glukkon_KillHim1: anim(11, 2, false),
  Background_Glukkon_KillHim2: anim(11, 2, false),
  FlyingSlig_Idle: anim(4, 1, true),
  FlyingSlig_IdleToHorizontal: anim(4, 1, false),
  FlyingSlig_IdleTurnAround: anim(10, 1, false),
  FlyingSlig_MoveHorizontal: anim(4, 1, true),
  FlyingSlig_MoveHorizontalEnd: anim(4, 1, false),
  FlyingSlig_TurnQuick: anim(11, 1, false),
  FlyingSlig_BeginDownMovement: anim(3, 1, false),
  FlyingSlig_MoveDown: anim(4, 1, true),
  FlyingSlig_EndDownMovement: anim(3, 1, true),
  FlyingSlig_MoveDownToHorizontal: anim(3, 1, false),
  FlyingSlig_MoveDownTurnAround: anim(6, 1, false),
  FlyingSlig_MoveUp: anim(4, 1, true),
  FlyingSlig_EndUpMovement: anim(3, 1, true),
  FlyingSlig_MoveUpToHorizontal: anim(3, 1, false),
  FlyingSlig_MoveUpTurnAround: anim(6, 1, false),
  FlyingSlig_MoveHorizontalToDown: anim(3, 1, false),
  FlyingSlig_HorizontalToUpMovement: anim(3, 1, false),
};
