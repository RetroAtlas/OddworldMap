import { tlvAt } from "./collide.js";
import {
  BRAINS,
  MOTIONS,
  STARTS,
  floorOf,
  follow,
  grid,
  place,
  scaleOf,
  slamDoorBlocks,
  standOn,
  stopperBlocks,
  wall,
} from "./patrolkit.js";

// ---- Fleech: an awake one on the ground turns, cries and crawls about its perch
const FLEECH_CRAWL = [3.8364, 3.3688, 4.6883, 4.9884, 2.5774, 3.3114, 2.2292];

function fleechToIdle(st) {
  st.velx = 0;
  st.cur = "Fleech_Idle";
  st.next = null;
  st.dice[st.seed2++ & 255];
}

STARTS.fleech = (st) => {
  standOn(st, st.w.spawn.x, st.w.spawn.y, 24);
  st.anger = 2 + Math.trunc((st.p.increaser - 2) / 2);
  st.target = null;
  st.centre = st.x;
  st.rndCrawl = 0;
};

BRAINS.fleech = (st, now) => {
  if (st.line === null) return;
  const own = () => st.dice[st.seed2++ & 255];
  const p = st.p;
  switch (st.sub) {
    case 0:
      st.rndCrawl = own() & 0x3f;
      st.centre = st.x;
      st.sub = st.anger > 2 || !p.goesToSleep ? 4 : 3;
      return;
    case 4: {
      if (now % 32 === 0 && st.anger > 0) st.anger--;
      if (own() % 32 === 0 && st.cur === "Fleech_Idle") {
        st.cur = "Fleech_Knockback";
        return;
      }
      if (
        st.cur === "Fleech_Crawl" &&
        st.target !== null &&
        (st.velx > 0 ? st.x >= st.target : st.x <= st.target)
      )
        st.next = "Fleech_StopMidCrawlCycle";
      if (st.cur === "Fleech_Idle" && p.range > 0 && --st.rndCrawl <= 0) {
        st.target = st.flip
          ? st.x - (own() * (st.x + p.range - st.centre)) / 255
          : st.x + (own() * (p.range + st.centre - st.x)) / 255;
        st.rndCrawl = own() & 0x3f;
        st.next = "Fleech_Crawl";
      }
      if (!p.goesToSleep || st.anger >= 2) {
        if (own() % 64 === 0 && st.cur === "Fleech_Idle") st.cur = "Fleech_PatrolCry";
      } else {
        st.anger = 0;
        st.next = "Fleech_Sleeping";
        st.sub = 1;
      }
      return;
    }
  }
};

Object.assign(MOTIONS, {
  Fleech_Idle(st) {
    if (st.next === "Fleech_Knockback") {
      st.cur = st.next;
      st.next = null;
    } else if (st.next === "Fleech_Crawl") {
      const g = grid(st);
      st.velx = (st.flip ? -g : g) / 7;
      // the fleech asks at one point: a grid ahead facing right, its own x facing left
      const px = st.x + (st.flip ? -g : g);
      const sx = st.flip ? st.x : px;
      if (
        wall(st, st.w.half ? 5 : 10, st.flip ? -g : g) ||
        stopperBlocks(st, tlvAt(st.w.tlvs, sx, st.y, sx, st.y, "EnemyStopper"), st.flip) ||
        slamDoorBlocks(st, px, st.y, px, st.y)
      )
        fleechToIdle(st);
      else st.cur = "Fleech_Crawl";
      st.next = null;
    } else if (st.next !== null) {
      st.cur = st.next;
      st.next = null;
    }
  },
  Fleech_Crawl(st, last, frame) {
    const f = frame % 7;
    const v = FLEECH_CRAWL[f] * scaleOf(st);
    st.velx = st.flip ? -v : v;
    const g = grid(st);
    if (wall(st, st.w.half ? 5 : 10, st.flip ? -g : g)) return fleechToIdle(st);
    const before = { line: st.line, x: st.x, y: st.y };
    follow(st);
    if (st.line === null) {
      Object.assign(st, before);
      fleechToIdle(st);
    } else if (!floorOf(st.w.half).includes(st.w.lines[st.line][4])) {
      // a line the fleech cannot crawl: the step is taken back and it turns
      Object.assign(st, before);
      st.cur = "Fleech_Knockback";
    }
    place(st);
    if (st.cur !== "Fleech_Crawl" || f !== 6) return;
    if (st.next === "Fleech_Idle") st.cur = "Fleech_StopMidCrawlCycle";
    else if (st.next !== null) {
      st.cur = st.next;
      st.next = null;
    }
  },
  Fleech_StopMidCrawlCycle(st, last) {
    const g = grid(st);
    if (last || wall(st, st.w.half ? 5 : 10, st.flip ? -g : g)) fleechToIdle(st);
  },
  Fleech_PatrolCry(st, last) {
    if (last) fleechToIdle(st);
  },
  Fleech_Knockback(st, last) {
    if (last) {
      st.flip = !st.flip;
      fleechToIdle(st);
    }
  },
});
