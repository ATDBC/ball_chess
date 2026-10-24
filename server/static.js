import { readFile } from "node:fs/promises";
import path from "node:path";
import { sendJson } from "./http-utils.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

export async function serveStatic(req, res, { webRoot, coreRoot, pathname }) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendJson(res, 400, { ok: false, error: { code: "INVALID_PATH", message: "Invalid URL encoding", details: {} } });
    return true;
  }
  if (decoded.includes("..") || decoded.includes("\\") || decoded.includes("\0")) {
    sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN_PATH", message: "Path is not allowed", details: {} } });
    return true;
  }

  let root;
  let name;
  if (decoded === "/") {
    root = webRoot;
    name = "index.html";
  } else if (/^\/web\/[A-Za-z0-9_-]+\.(?:js|css|html)$/.test(decoded)) {
    root = webRoot;
    name = decoded.slice("/web/".length);
  } else if (/^\/core\/[A-Za-z0-9_-]+\.js$/.test(decoded)) {
    root = coreRoot;
    name = decoded.slice("/core/".length);
  } else {
    sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Resource not found", details: {} } });
    return true;
  }

  const file = path.resolve(root, name);
  if (path.dirname(file) !== path.resolve(root)) {
    sendJson(res, 403, { ok: false, error: { code: "FORBIDDEN_PATH", message: "Path is not allowed", details: {} } });
    return true;
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": "no-cache",
      "content-length": content.length
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch {
    sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "Resource not found", details: {} } });
  }
  return true;
}
