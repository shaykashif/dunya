// Local mirror of the sim.shaykas.com layout: node site/serve.ts [port]
//   /       the chooser in site/
//   /squad/ squad/viewer
//   /civ/   village/viewer
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 5175);
const mounts: [string, string][] = [
  ["squad/", join(repo, "squad", "viewer")],
  ["civ/", join(repo, "village", "viewer")],
  ["", join(repo, "site")],
];
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".bin": "application/octet-stream",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = normalize(decodeURIComponent(url.pathname)).split("\\").join("/").replace(/^\/+/, "");
  if (path === "squad" || path === "civ") {
    res.writeHead(301, { location: `/${path}/` }).end();
    return;
  }
  const [prefix, root] = mounts.find(([p]) => path.startsWith(p))!;
  const file = join(root, path.slice(prefix.length) || "index.html");
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file.endsWith("/") ? file + "index.html" : file);
    const type = types[extname(file)] ?? "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && body.length > 0) {
      const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${body.length}`, "content-length": end - start + 1, "cache-control": "no-store" });
      res.end(body.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`Sim site on http://localhost:${port}`));
