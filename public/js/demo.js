// Exoddus keeps copies of areas that only its title-screen demos ever play;
// they are unreachable however you play. A path is one of them exactly when it
// holds a DemoSpawnPoint. The rule alone: which of them the map lists is a
// setting's question, kept out so that asking this one imports nothing.
// Importable in bare Node: no DOM.

// path objects live as long as their dataset, so identity keys need no invalidation
const demo = new WeakMap();

export function isDemoPath(P) {
  let d = demo.get(P);
  if (d === undefined) demo.set(P, (d = P.tlvs.some((t) => t.name === "DemoSpawnPoint")));
  return d;
}
