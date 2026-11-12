import { test } from "node:test";
import assert from "node:assert/strict";

test("the key cap's listeners are registered once, on the first cap lit", async () => {
  const heard = [];
  globalThis.addEventListener = (type) => heard.push(type);
  const { lightCap } = await import("../../public/js/ui/keycap.js");
  const cap = { textContent: "g", classList: { add() {} } };
  const scope = { querySelectorAll: () => [cap] };
  lightCap(scope, { key: "x", code: "KeyX" });
  assert.deepEqual(heard, [], "a key no cap shows wires nothing");
  lightCap(scope, { key: "g", code: "KeyG" });
  lightCap(scope, { key: "g", code: "KeyG" });
  assert.deepEqual(heard, ["keyup", "blur"]);
});
