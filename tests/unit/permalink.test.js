import { test } from "node:test";
import assert from "node:assert/strict";
import {
  camCenter,
  centerCam,
  findTlv,
  focusZoom,
  formatHash,
  hashToDraw,
  parseHash,
  zoomAt,
} from "../../public/js/model/model.js";
import { MAX_ROUTE_PTS, ZOOM_MAX, ZOOM_MIN } from "../../public/js/config.js";
import { AO_GEOMETRY, SYNTH_GEOMETRY, at, tlv } from "./fixtures.js";

test("zoomAt keeps the world point under the anchor fixed", () => {
  const cam = { x: 100, y: 50, z: 0.5 };
  const [px, py] = [200, 120];
  const out = zoomAt(cam, 1.25, px, py);
  assert.equal(out.z, 0.625);
  assert.ok(Math.abs(cam.x + px / cam.z - (out.x + px / out.z)) < 1e-9);
  assert.ok(Math.abs(cam.y + py / cam.z - (out.y + py / out.z)) < 1e-9);
});

test("the focus zoom fits a few screens and clamps at both ends", () => {
  // screens, not cells: the 200x100 window, so FOCUS_SCREENS 2.6 -> 520x260
  const zoom = (cw, ch) => focusZoom(cw, ch, SYNTH_GEOMETRY);
  assert.equal(zoom(1040, 520), 1.6); // large canvas: clamps at FOCUS_ZOOM_MAX
  assert.equal(zoom(260, 130), 0.5); // small canvas: clamps at FOCUS_ZOOM_MIN
  assert.equal(zoom(676, 338), 1.3); // in between: exactly FOCUS_SCREENS across
  // a canvas too narrow for a few screens across, with room for one at its own
  // size: the size a path's one screen opens at there, not half of it
  assert.equal(zoom(216, 600), 1);
  assert.equal(zoom(166, 600), 0.75);
  // a jump to a point puts it at the middle of the canvas whichever zoom won
  assert.deepEqual(centerCam({ x: 500, y: 300, z: zoom(260, 130) }, 260, 130), {
    x: 240,
    y: 170,
    z: 0.5,
  });
});

test("zoomAt clamps to the manual zoom range", () => {
  assert.equal(zoomAt({ x: 0, y: 0, z: 3 }, 100, 0, 0).z, ZOOM_MAX);
  assert.equal(zoomAt({ x: 0, y: 0, z: 0.05 }, 0.001, 0, 0).z, ZOOM_MIN);
});

test("camCenter and centerCam invert each other", () => {
  const cam = { x: 100, y: 200, z: 1.25 };
  assert.deepEqual(camCenter(cam, 800, 600), { x: 420, y: 440, z: 1.25 });
  assert.deepEqual(centerCam(camCenter(cam, 800, 600), 800, 600), cam);
});

// a link read the way applyHash reads one: parsed, then resolved to draw space.
// The links here are written and read in AO's geometry, whose window offset and
// cell margins put draw space and world space far enough apart that a missing
// conversion shows
const readHash = (h) => {
  const p = parseHash(h);
  return p && { ...p, ...hashToDraw(p, AO_GEOMETRY) };
};

test("a permalinked center survives a change of viewport, a corner would not", () => {
  const desktop = [1512, 900],
    phone = [390, 700];
  const cam = { x: 0, y: 0, z: 1.29 }; // whatever the sender was looking at
  const link = formatHash(AO_GEOMETRY, "AO", "R2", 1, camCenter(cam, ...desktop));
  assert.equal(link, "#AO/R2/1/1498/709/1.29"); // the middle of the sender's window
  // holding that center costs the recipient a different corner, by half the
  // difference in window size — more than a 368-unit cell horizontally, which
  // is what a link carrying the corner would misplace them by instead
  const got = centerCam(readHash(link).view, ...phone);
  assert.equal(Math.round(got.x - cam.x), 435);
  assert.equal(Math.round(got.y - cam.y), 78);
});

test("formatHash writes world coordinates, rounded, and zoom to two decimals", () => {
  // draw (177.4, 54.6) sits in cell 0, whose window starts at world (256, 120)
  assert.equal(
    formatHash(AO_GEOMETRY, "AO", "R2", 1, { x: 177.4, y: 54.6, z: 2.234 }),
    "#AO/R2/1/433/175/2.23",
  );
});

test("an unreadable or non-positive zoom drops the whole view", () => {
  assert.equal(parseHash("#AO/R2/1/10/20/junk").view, null);
  assert.equal(parseHash("#AO/R2/1/10/junk/1.00").view, null);
  assert.equal(parseHash("#AO/R2/1/10/20/0").view, null);
  assert.deepEqual(parseHash("#AO/R2/1/10/20/0.50").view, { x: 10, y: 20, z: 0.5 });
});

test("parseHash round-trips a formatted hash (against the rounded values)", () => {
  const p = parseHash(formatHash(AO_GEOMETRY, "AO", "R2", 1, { x: 177.4, y: 54.6, z: 2.234 }));
  assert.deepEqual(p, {
    game: "AO",
    level: "R2",
    path: 1,
    view: { x: 433, y: 175, z: 2.23 },
    obj: null,
    route: null,
    routeLost: 0,
    graph: false,
    release: null,
  });
  // the world point the link names, back in the space the renderer works in
  assert.deepEqual(hashToDraw(p, AO_GEOMETRY).view, { x: 177, y: 55, z: 2.23 });
});

// deliberately a bare word at the tail, where an older viewer's parse ignores it
// and opens the map at the view the link names
test("the world graph rides the hash as a token of its own", () => {
  const h = formatHash(
    AO_GEOMETRY,
    "AO",
    "R2",
    1,
    { x: 177.4, y: 54.6, z: 2.234 },
    null,
    null,
    true,
  );
  assert.equal(h, "#AO/R2/1/433/175/2.23/graph");
  assert.equal(parseHash(h).graph, true);
  assert.equal(parseHash("#AO/R2/1/433/175/2.23").graph, false);
});

test("permalinks can carry an object, identified by name and origin", () => {
  const h = formatHash(
    AO_GEOMETRY,
    "AO",
    "R1",
    18,
    { x: 177.4, y: 54.6, z: 2.234 },
    { name: "Door", x1: 8746, y1: 1232 },
  );
  assert.equal(h, "#AO/R1/18/433/175/2.23/Door@8746,1232");
  assert.deepEqual(parseHash(h).obj, { name: "Door", x1: 8746, y1: 1232 });
  assert.equal(parseHash("#AO/R1/18/433/175/2.23").obj, null);
  assert.equal(parseHash("#AO/R1/18/433/175/2.23/garbage!").obj, null);
});

test("parseHash: case-insensitive, partial and garbage inputs", () => {
  assert.equal(parseHash(""), null);
  assert.equal(parseHash("#"), null);
  assert.deepEqual(parseHash("#ao/r2/1"), {
    game: "AO",
    level: "R2",
    path: 1,
    view: null,
    obj: null,
    route: null,
    routeLost: 0,
    graph: false,
    release: null,
  });
  assert.deepEqual(parseHash("#AO"), {
    game: "AO",
    level: "",
    path: NaN,
    view: null,
    obj: null,
    route: null,
    routeLost: 0,
    graph: false,
    release: null,
  });
  // x/y without z: the view is ignored as a whole
  assert.deepEqual(parseHash("#AO/R2/1/10/20"), {
    game: "AO",
    level: "R2",
    path: 1,
    view: null,
    obj: null,
    route: null,
    routeLost: 0,
    graph: false,
    release: null,
  });
  assert.ok(Number.isNaN(parseHash("#AO/R2/junk").path));
});

test("a release rides a link as its bare code, and no code is the base", () => {
  const view = { x: 177.4, y: 54.6, z: 2.234 };
  const obj = { name: "Door", x1: 8746, y1: 1232 };
  const h = formatHash(AO_GEOMETRY, "AO", "R1", 18, view, obj, null, true, "jp");
  assert.equal(h, "#AO/R1/18/433/175/2.23/Door@8746,1232/jp/graph");
  const p = parseHash(h);
  assert.equal(p.release, "jp");
  assert.deepEqual(p.obj, obj);
  assert.equal(p.graph, true);
  assert.equal(parseHash("#AO/R1/18/433/175/2.23/us-r0").release, "us-r0");
  assert.equal(parseHash("#AO/R1/18/433/175/2.23/EU").release, "eu");
  assert.equal(parseHash("#AO/R1/18/433/175/2.23").release, null);
  assert.equal(parseHash("#AO/R1/18/433/175/2.23/graph").release, null);
  assert.equal(formatHash(AO_GEOMETRY, "AO", "R1", 18, view), "#AO/R1/18/433/175/2.23");
});

test("a permalinked object is found by name and origin, whatever its capitals", () => {
  const tlvs = [at(tlv("Door"), 100, 200), at(tlv("Mudokon"), 479, 1735)];
  const find = (name, x1, y1) => findTlv(tlvs, { name, x1, y1 });
  assert.equal(find("Mudokon", 479, 1735), tlvs[1]);
  assert.equal(find("mudokon", 479, 1735), tlvs[1]); // a link put through a lowercaser
  assert.equal(find("Mudokon", 479, 1736), null); // the object moved in a rebuild
  assert.equal(find("Door", 479, 1735), null); // something else stands there now
});

test("a percent-encoded fragment is read the same as a bare one", () => {
  const h = "#AO/R6/6/-329/568/1.60/Mudokon@479,1735/route=n2;sR6.6;620,411;563,472;end";
  assert.deepEqual(parseHash("#" + encodeURIComponent(h.slice(1))), parseHash(h));
  // a stray % that isn't an escape must not throw the whole link away
  assert.deepEqual(parseHash("#AO/R2/1/10/20/1.00/100%").view, { x: 10, y: 20, z: 1 });
});

test("permalinks can carry a route of waypoints, rounded like the view", () => {
  const route = [
    {
      lv: "R2",
      pa: 1,
      pts: [
        { x: 10.4, y: 21.6 },
        { x: -30, y: 40 },
      ],
    },
  ];
  const h = formatHash(AO_GEOMETRY, "AO", "R2", 1, { x: 177.4, y: 54.6, z: 2.234 }, null, route);
  assert.equal(h, "#AO/R2/1/433/175/2.23/route=n2;sR2.1;266,142;-430,160;end");
  assert.deepEqual(readHash(h).route, [
    {
      lv: "R2",
      pa: 1,
      pts: [
        { x: 10, y: 22 },
        { x: -30, y: 40 },
      ],
    },
  ]);
  assert.equal(parseHash(h).routeLost, 0);
  assert.equal(
    formatHash(AO_GEOMETRY, "AO", "R2", 1, { x: 0, y: 0, z: 1 }, null, []),
    "#AO/R2/1/256/120/1.00",
  );
});

test("object and route segments coexist, matched by shape in either order", () => {
  const obj = { name: "Door", x1: 8746, y1: 1232 };
  const one = [{ lv: "R1", pa: 18, pts: [{ x: 1, y: 2 }] }];
  const h = formatHash(AO_GEOMETRY, "AO", "R1", 18, { x: 0, y: 0, z: 1 }, obj, one);
  assert.equal(h, "#AO/R1/18/256/120/1.00/Door@8746,1232/route=n1;sR1.18;257,122;end");
  assert.deepEqual(parseHash(h).obj, obj);
  assert.deepEqual(readHash(h).route, one);
  const swapped = readHash("#AO/R1/18/256/120/1.00/route=n1;sR1.18;257,122;end/Door@8746,1232");
  assert.deepEqual(swapped.obj, obj);
  assert.deepEqual(swapped.route, one);
  // an unknown segment in between bothers neither
  const padded = readHash("#AO/R1/18/256/120/1.00/garbage!/route=n1;sR1.18;257,122;end");
  assert.equal(padded.obj, null);
  assert.deepEqual(padded.route, one);
});

test("route segment is all-or-nothing: any malformed token drops the whole route", () => {
  const at = (seg) => parseHash(`#AO/R2/1/0/0/1.00/${seg}`).route;
  assert.equal(at("route="), null);
  assert.equal(at("route=n2;sR2.1;1,2;junk;end"), null);
  assert.equal(at("route=n1;sR2.1;1.5,2;end"), null);
  assert.equal(at("route=n3;sR2.1;1,2;;3,4;end"), null);
  assert.equal(at("route=sR2.1;1,2;end"), null); // nothing leading the body
  assert.equal(at("route=2;sR2.1;1,2;end"), null); // a bare number is not the count
  assert.equal(at("route=n0;sR2.1;end"), null); // a count with nothing to count
  // a pathless body — pairs before any segment marker — reads as no route
  assert.equal(at("route=n1;1,2;end"), null);
  assert.deepEqual(at("route=n1;sR2.1;1,2;end"), [{ lv: "R2", pa: 1, pts: [{ x: 1, y: 2 }] }]);
  const pairs = (n) => Array.from({ length: n }, (_, i) => `${i},${i}`).join(";");
  assert.equal(
    at(`route=n${MAX_ROUTE_PTS};sR2.1;${pairs(MAX_ROUTE_PTS)};end`)[0].pts.length,
    MAX_ROUTE_PTS,
  );
  assert.equal(at(`route=n${MAX_ROUTE_PTS + 1};sR2.1;${pairs(MAX_ROUTE_PTS + 1)};end`), null);
});

test("a route link cut short keeps the waypoints that arrived and counts the rest", () => {
  const at = (seg) => parseHash(`#AO/R2/1/0/0/1.00/${seg}`);
  const seg1 = (pts) => [{ lv: "R2", pa: 1, pts }];
  const three = "route=n3;sR2.1;1,2;3,4;5,6";
  // only the marker lost: every pair before it is whole
  assert.deepEqual(
    at(`${three};en`).route,
    seg1([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]),
  );
  assert.equal(at(`${three};en`).routeLost, 0);
  // a cut inside the last pair leaves one that still reads as legal: unread
  assert.deepEqual(
    at(three).route,
    seg1([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]),
  );
  assert.equal(at(three).routeLost, 1);
  assert.deepEqual(
    at("route=n9;sR2.1;1,2;3,4;5,").route,
    seg1([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]),
  );
  assert.equal(at("route=n9;sR2.1;1,2;3,4;5,").routeLost, 7);
  // the marker vouches for the count, so one that disagrees is a hand edit
  assert.equal(at("route=n2;sR2.1;1,2;3,4;5,6;end").route, null);
  assert.equal(at("route=n4;sR2.1;1,2;3,4;5,6;end").route, null);
  // more pairs than the count claims, marker or not
  assert.equal(at("route=n1;sR2.1;1,2;3,4;5,6").route, null);
  // cut down to the head alone: a smaller count with nothing under it
  assert.equal(at("route=n1").route, null);
  assert.equal(at("route=n1").routeLost, 0);
});

// a link cut short by a chat client can still read as a well-formed route:
// "…;405,578" truncated to "…;405,57" is a valid pair, and "…;129,586" cut to
// "…;12" arrives after exactly twelve pairs. What the reader is shown must
// therefore be a leading stretch of what the sender plotted, never a leg they
// never clicked, and the tally must square with the count the link leads with.
test("every prefix of a route link parses as a prefix of the route, or as none", () => {
  const pts =
    "620,411;563,472;602,585;522,578;505,681;398,688;350,680;256,676;182,676;110,684;61,684;60,578;129,586;222,583;294,583;405,578"
      .split(";")
      .map((p) => ({ x: +p.split(",")[0], y: +p.split(",")[1] }));
  const route = [{ lv: "R6", pa: 6, pts }];
  const full = formatHash(AO_GEOMETRY, "AO", "R6", 6, { x: -120, y: 226, z: 1.29 }, null, route);
  assert.deepEqual(readHash(full).route, route);
  assert.equal(parseHash(full).routeLost, 0);
  for (let cut = full.indexOf("route=") + 6; cut < full.length; cut++) {
    const { route: got, routeLost: lost } = readHash(full.slice(0, cut));
    const where = `prefix of length ${cut}`;
    if (!got) {
      assert.equal(lost, 0, `${where} claims losses with nothing to show`);
      continue;
    }
    assert.equal(got.length, 1, `${where} invented a segment`);
    assert.deepEqual(got[0].pts, pts.slice(0, got[0].pts.length), `${where} altered the route`);
    assert.equal(got[0].pts.length + lost, pts.length, `${where} miscounted what it lost`);
  }
});

test("a multi-path route round-trips, and a seam can stand empty", () => {
  const route = [
    {
      lv: "R1",
      pa: 15,
      pts: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    },
    { lv: "R1", pa: 16, pts: [{ x: 5, y: 6 }] },
    { lv: "BA", pa: 2, pts: [] },
  ];
  const h = formatHash(AO_GEOMETRY, "AO", "R1", 16, { x: 0, y: 0, z: 1 }, null, route);
  assert.equal(
    h,
    "#AO/R1/16/256/120/1.00/route=n3;sR1.15;257,122;259,124;sR1.16;261,126;sBA.2;end",
  );
  assert.deepEqual(readHash(h).route, route);
  assert.equal(parseHash(h).routeLost, 0);
  // codes read back uppercased, the way the game and level codes do
  assert.deepEqual(readHash(h.toLowerCase()).route, route);
});

test("malformed bodies drop the route whole; cuts keep the prefix", () => {
  const at = (seg) => parseHash(`#AO/R2/1/0/0/1.00/${seg}`);
  assert.equal(at("route=n2;1,2;3,4;end").route, null); // a pair before any segment
  assert.equal(at("route=n2;sR1.15;1,2;junk;3,4;end").route, null);
  assert.equal(at("route=n1;sR1.15;1,2;3,4;end").route, null); // more than the count
  const full = "route=n3;sR1.15;1,2;3,4;sBA.2;5,6";
  assert.deepEqual(at(`${full};end`).route, [
    {
      lv: "R1",
      pa: 15,
      pts: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    },
    { lv: "BA", pa: 2, pts: [{ x: 5, y: 6 }] },
  ]);
  // the cut drops the unproven last pair; the opened segment survives, empty
  assert.deepEqual(at(full).route, [
    {
      lv: "R1",
      pa: 15,
      pts: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    },
    { lv: "BA", pa: 2, pts: [] },
  ]);
  assert.equal(at(full).routeLost, 1);
});

test("every prefix of a multi-path route link parses as a prefix of it, or as none", () => {
  const route = [
    {
      lv: "R6",
      pa: 6,
      pts: [
        { x: 620, y: 411 },
        { x: 563, y: 472 },
        { x: 602, y: 585 },
      ],
    },
    {
      lv: "R1",
      pa: 15,
      pts: [
        { x: 129, y: 586 },
        { x: 222, y: 583 },
      ],
    },
    {
      lv: "BA",
      pa: 2,
      pts: [
        { x: 405, y: 578 },
        { x: 12, y: 9 },
      ],
    },
  ];
  const total = 7;
  const full = formatHash(AO_GEOMETRY, "AO", "BA", 2, { x: -120, y: 226, z: 1.29 }, null, route);
  assert.deepEqual(readHash(full).route, route);
  for (let cut = full.indexOf("route=") + 6; cut < full.length; cut++) {
    const { route: got, routeLost: lost } = readHash(full.slice(0, cut));
    const where = `prefix of length ${cut}`;
    if (!got) {
      assert.equal(lost, 0, `${where} claims losses with nothing to show`);
      continue;
    }
    const n = got.reduce((k, s) => k + s.pts.length, 0);
    assert.equal(n + lost, total, `${where} miscounted what it lost`);
    for (let i = 0; i < got.length; i++) {
      assert.equal(
        `${got[i].lv} ${got[i].pa}`,
        `${route[i].lv} ${route[i].pa}`,
        `${where} invented a seam`,
      );
      const expect = i < got.length - 1 ? route[i].pts : route[i].pts.slice(0, got[i].pts.length);
      assert.deepEqual(got[i].pts, expect, `${where} altered segment ${i}`);
    }
  }
});

test("a segment always names its path, so undo across a seam cannot rebind it", () => {
  // undo across a seam leaves exactly this: the route on R1 P15, you on P16
  const route = [{ lv: "R1", pa: 15, pts: [{ x: 1, y: 2 }] }];
  const h = formatHash(AO_GEOMETRY, "AO", "R1", 16, { x: 0, y: 0, z: 1 }, null, route);
  assert.equal(h, "#AO/R1/16/256/120/1.00/route=n1;sR1.15;257,122;end");
  assert.deepEqual(readHash(h).route, route);
});

test("the route token refuses a marker flood", () => {
  const markers = Array.from({ length: MAX_ROUTE_PTS + 1 }, () => "sR1.1").join(";");
  assert.equal(parseHash(`#AO/R2/1/0/0/1.00/route=n1;${markers};1,2;end`).route, null);
});
