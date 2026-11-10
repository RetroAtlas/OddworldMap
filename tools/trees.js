// The two trees a proof compares, the working tree's public/ from disk and a ref's straight from
// the repository, each served on a port of its own, and each tree's modules by name under js/.
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);

const TYPES = {
  html: "text/html",
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  png: "image/png",
  svg: "image/svg+xml",
  webmanifest: "application/manifest+json",
  xml: "application/xml",
  txt: "text/plain",
  ico: "image/x-icon",
};

// a tree served from one read of a path under its public/, on a port of its own
export function serve(read) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname)
      .replace(/\/$/, "/index.html")
      .slice(1);
    const body = await read(path).catch(() => null);
    if (body === null) {
      console.error(`404 ${path}`);
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.split(".").pop()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

export const fromTree = (path) => readFile(join(ROOT, "public", path));

export function fromRef(ref) {
  const blobs = new Map();
  return (path) => {
    if (!blobs.has(path))
      blobs.set(
        path,
        run("git", ["-C", ROOT, "show", `${ref}:public/${path}`], {
          encoding: "buffer",
          maxBuffer: 1 << 26,
        }).then((r) => r.stdout),
      );
    return blobs.get(path);
  };
}

export const refExists = (ref) =>
  run("git", ["-C", ROOT, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).then(
    () => true,
    () => false,
  );

// a module by its name, wherever the tree keeps it under js/, so the two trees
// need not lay their modules out alike
const modulesOf = (files) =>
  Object.fromEntries(
    files
      .filter((f) => f.endsWith(".js"))
      .map((f) => f.replaceAll("\\", "/"))
      .map((f) => [f.slice(f.lastIndexOf("/") + 1), f]),
  );
export const treeModules = async () =>
  modulesOf(await readdir(join(ROOT, "public", "js"), { recursive: true }));
export const refModules = async (ref) =>
  modulesOf(
    (await run("git", ["-C", ROOT, "ls-tree", "-r", "--name-only", ref, "--", "public/js"])).stdout
      .split("\n")
      .map((f) => f.replace(/^public\/js\//, "")),
  );
