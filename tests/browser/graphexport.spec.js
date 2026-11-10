import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { trackErrors, settleAny } from "./helpers.js";

async function openGraph(page) {
  await page.evaluate(async () => {
    const gv = await import(new URL("js/panels/graphview.js", location.href).href);
    gv.toggleGraph(true);
  });
  await expect(page.locator("#graphPlane .gv-node").first()).toBeVisible();
  return await page.locator("#graphPlane .gv-node").count();
}

async function saveSvg(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#graphSvgBtn")]);
  return { name: dl.suggestedFilename(), svg: readFileSync(await dl.path(), "utf8") };
}

async function parseSvg(page, svg) {
  return await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return {
      error: doc.querySelector("parsererror")?.textContent ?? null,
      nodes: doc.querySelectorAll('rect[rx="4"]').length,
    };
  }, svg);
}

// the graph's save buttons, through the real anchor-click download path
test("the world graph saves as an SVG file and a PNG twice its actual size", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/#AO");
  await settleAny(page);
  const domNodes = await openGraph(page);

  const { name, svg } = await saveSvg(page);
  expect(name).toBe("oddworld-ao-graph.svg");
  const parsed = await parseSvg(page, svg);
  expect(parsed.error).toBeNull();
  expect(parsed.nodes).toBe(domNodes);

  const [pngDl] = await Promise.all([page.waitForEvent("download"), page.click("#graphPngBtn")]);
  expect(pngDl.suggestedFilename()).toBe("oddworld-ao-graph.png");
  const png = readFileSync(await pngDl.path());
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // 2x the layout worldgraph.test.js pins, plus the 44px strip
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([6982, 1706]);
  // a blank canvas encodes to a perfectly good PNG, so read a background pixel
  const pixel = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, -10, -10);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  }, png.toString("base64"));
  expect(pixel).toEqual([20, 22, 26, 255]); // --bg, opaque

  expect(errors).toEqual([]);
});

// the other game's file too: its ender captions and demo-free node set are the
// serializer's AE-only branches, and the parse must hold for both shipped games
test("the Exoddus diagram serializes and parses whole", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/#AE");
  await settleAny(page);
  const domNodes = await openGraph(page);

  const { name, svg } = await saveSvg(page);
  expect(name).toBe("oddworld-ae-graph.svg");
  const parsed = await parseSvg(page, svg);
  expect(parsed.error).toBeNull();
  expect(parsed.nodes).toBe(domNodes);

  const [pngDl] = await Promise.all([page.waitForEvent("download"), page.click("#graphPngBtn")]);
  expect(pngDl.suggestedFilename()).toBe("oddworld-ae-graph.png");
  const png = readFileSync(await pngDl.path());
  // 2x the layout worldgraph.test.js pins, plus the 44px strip
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([5598, 1880]);

  expect(errors).toEqual([]);
});
