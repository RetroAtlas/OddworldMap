import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { trackErrors, settleAny } from "./helpers.js";
import { canonical } from "../../public/js/model/reliveexport.js";

const DIGESTS = JSON.parse(
  readFileSync(new URL("../fixtures/relive-digests.json", import.meta.url), "utf8"),
);

// where a game-only hash boots
const BOOTS = { AO: ["R1", 15], AE: ["MI", 1] };

const standing = (page) =>
  page.evaluate(async () => {
    const st = await import(new URL("js/data/state.js", location.href).href);
    return { game: st.state.data.id, level: st.state.lvl.short, path: st.state.path.id };
  });

// the sidecar requests the page makes, by path
function sidecarLog(page) {
  const log = [];
  page.on("request", (r) => {
    if (r.url().includes("relive_export_")) log.push(new URL(r.url()).pathname);
  });
  return log;
}

async function openExports(page) {
  await expect(page.locator("#exportJsonBtn")).toBeHidden();
  await page.click("#exportMenu > summary");
  await expect(page.locator("#exportJsonBtn")).toBeVisible();
}

async function press(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#exportJsonBtn")]);
  return dl;
}

// the sidecar with one Door property no layout supplies
function doctored(game) {
  const side = JSON.parse(
    readFileSync(
      new URL(`../../public/relive_export_${game.toLowerCase()}.json`, import.meta.url),
      "utf8",
    ),
  );
  const door = Object.values(side.schema.structures).find((s) => s.name === "Door");
  door.properties.push({
    name: "Unarchived",
    word: 99,
    size: 2,
    type: "SInt16",
    enum: false,
    visible: true,
  });
  return side;
}

// the button through the real fetch and anchor-click download
for (const [game, [level, path]] of Object.entries(BOOTS)) {
  test(`the ${game} JSON export hands over the document the builder recorded`, async ({ page }) => {
    const errors = trackErrors(page);
    const sidecar = sidecarLog(page);
    await page.goto(`/#${game}`);
    await settleAny(page);
    expect(await standing(page)).toEqual({ game, level, path });
    expect(sidecar).toEqual([]);
    await openExports(page);
    // the caveat is written twice, for the pointer and for a reader
    const { tip, help } = await page.evaluate(() => {
      const b = document.getElementById("exportJsonBtn");
      const help = document.getElementById(b.getAttribute("aria-describedby")).textContent;
      return { tip: b.dataset.tip, help };
    });
    const words = (s) => s.replace(/\s+/g, " ").trim();
    expect(words(help)).toBe(words(tip));
    await expect(page.locator("#exportJsonBtn")).toHaveAccessibleDescription(
      /drops that path's foreground masks/,
    );

    const dl = await press(page);
    const id = game.toLowerCase();
    expect(dl.suggestedFilename()).toBe(`oddworld-${id}-${level}-P${path}.json`);
    const doc = JSON.parse(readFileSync(await dl.path(), "utf8"));
    const digest = createHash("sha256").update(canonical(doc)).digest("hex");
    expect(digest).toBe(DIGESTS[game][`${level} P${path}`]);

    // the sidecar is fetched on the first press and never again
    await press(page);
    expect(sidecar).toEqual([`/relive_export_${id}.json`]);
    expect(errors).toEqual([]);
  });
}

test("the exports open from the keyboard, and stay open while one runs", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/#AO");
  await settleAny(page);
  await expect(page.locator("#exportJsonBtn")).toBeHidden();
  await page.focus("#exportMenu > summary");
  await page.keyboard.press("Enter");
  await expect(page.locator("#exportJsonBtn")).toBeVisible();
  await press(page);
  await expect(page.locator("#exportJsonBtn")).toBeVisible();
  await page.focus("#exportMenu > summary");
  await page.keyboard.press("Space");
  await expect(page.locator("#exportJsonBtn")).toBeHidden();
  expect(errors).toEqual([]);
});

test("a sidecar that failed to load is fetched again on the next press", async ({ page }) => {
  const errors = trackErrors(page);
  const sidecar = sidecarLog(page);
  const downloads = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.route("**/relive_export_ao.json", (route) =>
    route.fulfill({ contentType: "application/json", body: "not json" }),
  );
  await page.goto("/#AO");
  await settleAny(page);
  await openExports(page);
  await page.click("#exportJsonBtn");
  await expect(
    page.locator(".toast", { hasText: "export failed: the editor data did not load" }),
  ).toBeVisible();
  expect(downloads).toEqual([]);
  await page.unroute("**/relive_export_ao.json");
  await press(page);
  expect(sidecar).toEqual(["/relive_export_ao.json", "/relive_export_ao.json"]);
  expect(errors).toEqual([]);
});

test("an incomplete document is refused rather than handed over", async ({ page }) => {
  const errors = trackErrors(page);
  await page.route("**/relive_export_ao.json", (route) => route.fulfill({ json: doctored("AO") }));
  const downloads = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.goto("/#AO");
  await settleAny(page);
  await openExports(page);
  await page.click("#exportJsonBtn");
  await expect(
    page.locator(".toast", { hasText: "export failed: no archived value for Door.Unarchived" }),
  ).toBeVisible();
  expect(downloads).toEqual([]);
  await expect(page.locator("#exportJsonBtn")).toBeEnabled();
  expect(errors).toEqual([]);
});
