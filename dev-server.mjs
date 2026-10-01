#!/usr/bin/env node
/**
 * Local UI preview for app_new/ — same pattern as app/dev-server.mjs.
 *
 * - Serves static files + /{school-slug} → index.html
 * - /__dev-api/school-menu and school-order-status → GET only
 * - /__dev-api/school-checkout → POST only
 *   Upstream Origin is omitted (school-menu allowlist is the production host).
 *
 * Start:  node dev-server.mjs
 * Open:   http://127.0.0.1:5174/bls
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5174;
const HOST = process.env.HOST || "127.0.0.1";
const UPSTREAM =
  process.env.SCHOOL_API_UPSTREAM ||
  "https://jmtqldgovmmhaystvpdu.supabase.co/functions/v1";

const GET_ALLOW = new Set(["school-menu", "school-order-status"]);
const POST_ALLOW = new Set(["school-checkout"]);
const ORDERS_ALLOW = new Set(["checkout", "status"]);
const SCHOOL_ORDERS_UPSTREAM =
  process.env.SCHOOL_ORDERS_UPSTREAM ||
  "https://backend.greenolasa.com/api/v1/school-orders";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function safeJoin(root, rel) {
  const resolved = path.resolve(root, rel);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

function isSchoolSlug(seg) {
  return (
    /^[a-z0-9-]{2,32}$/.test(seg) &&
    !["assets", "docs", "api", "admin", "app", "__dev-api", "__school-orders"].includes(seg)
  );
}

function resolveStatic(pathname) {
  let p = decodeURIComponent(pathname.split("?")[0] || "/");
  if (p.includes("\0") || p.includes("..")) return null;
  if (p === "/" || p === "/index.html") return "index.html";
  if (p.startsWith("/assets/")) return p.slice(1);
  const segs = p.split("/").filter(Boolean);
  if (segs.length === 1 && isSchoolSlug(segs[0].toLowerCase())) return "index.html";
  if (segs.length === 1 && segs[0] === "favicon.ico") return null;
  if (segs.length === 1 && !segs[0].startsWith(".")) return segs[0];
  return null;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function handleApiProxy(req, res, restPath) {
  const qIndex = restPath.indexOf("?");
  const fnPath = (qIndex >= 0 ? restPath.slice(0, qIndex) : restPath).replace(
    /^\/+/,
    ""
  );
  const query = qIndex >= 0 ? restPath.slice(qIndex) : "";
  const fnName = fnPath.split("/").filter(Boolean)[0] || "";

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, accept",
    });
    res.end();
    return;
  }

  const getOk = GET_ALLOW.has(fnName) && (req.method === "GET" || req.method === "HEAD");
  const postOk = POST_ALLOW.has(fnName) && req.method === "POST";
  if (!getOk && !postOk) {
    sendJson(res, 405, {
      error: `Only GET ${[...GET_ALLOW].join(", ")} and POST ${[...POST_ALLOW].join(", ")} are allowed.`,
      code: "METHOD",
    });
    return;
  }

  const headers = {
    Accept: "application/json",
    "User-Agent": "greenola-school-app-new-local-preview/1.0",
  };
  let body;
  if (req.method === "POST") {
    body = await readBody(req);
    headers["Content-Type"] = req.headers["content-type"] || "application/json";
  }

  const target = `${UPSTREAM}/${fnPath}${query}`;
  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method === "HEAD" ? "GET" : req.method,
      headers,
      body: body && body.length ? body : undefined,
      redirect: "follow",
    });
  } catch (e) {
    sendJson(res, 502, {
      error: "Upstream school API unreachable from local proxy",
      code: "PROXY_UPSTREAM",
      detail: String(e && e.message ? e.message : e),
    });
    return;
  }

  const text = await upstream.text();
  res.writeHead(upstream.status, {
    "Content-Type":
      upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Local-Proxy": fnName,
  });
  if (req.method === "HEAD") res.end();
  else res.end(text);
}

async function handleSchoolOrdersProxy(req, res, restPath) {
  const qIndex = restPath.indexOf("?");
  const fnPath = (qIndex >= 0 ? restPath.slice(0, qIndex) : restPath).replace(
    /^\/+/,
    ""
  );
  const query = qIndex >= 0 ? restPath.slice(qIndex) : "";
  const fnName = fnPath.split("/").filter(Boolean)[0] || "";

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, accept",
    });
    res.end();
    return;
  }

  if (!ORDERS_ALLOW.has(fnName)) {
    sendJson(res, 403, {
      error: `Path "${fnName}" is not allowed on school-orders proxy.`,
      code: "LOCAL_READONLY",
    });
    return;
  }
  if (fnName === "status" && req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "status is GET only", code: "METHOD" });
    return;
  }
  if (fnName === "checkout" && req.method !== "POST") {
    sendJson(res, 405, { error: "checkout is POST only", code: "METHOD" });
    return;
  }

  const headers = {
    Accept: "application/json",
    "User-Agent": "greenola-school-app-new-local-preview/1.0",
  };
  let body;
  if (req.method === "POST") {
    body = await readBody(req);
    headers["Content-Type"] = req.headers["content-type"] || "application/json";
  }

  let upstream;
  try {
    upstream = await fetch(`${SCHOOL_ORDERS_UPSTREAM}/${fnPath}${query}`, {
      method: req.method === "HEAD" ? "GET" : req.method,
      headers,
      body: body && body.length ? body : undefined,
      redirect: "follow",
    });
  } catch (e) {
    sendJson(res, 502, {
      error: "Upstream school-orders unreachable from local proxy",
      code: "PROXY_UPSTREAM",
      detail: String(e && e.message ? e.message : e),
    });
    return;
  }

  const text = await upstream.text();
  res.writeHead(upstream.status, {
    "Content-Type":
      upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Local-Proxy": "school-orders-" + fnName,
  });
  if (req.method === "HEAD") res.end();
  else res.end(text);
}

function handleStatic(req, res, pathname) {
  const rel = resolveStatic(pathname);
  if (!rel) {
    sendJson(res, 404, { error: "Not found", path: pathname });
    return;
  }
  const file = safeJoin(ROOT, rel);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    sendJson(res, 404, { error: "Not found", path: pathname });
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=60",
  });
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `${HOST}:${PORT}`;
    const u = new URL(req.url || "/", `http://${host}`);
    const pathname = u.pathname;

    if (pathname === "/__dev-api" || pathname === "/__dev-api/") {
      sendJson(res, 200, {
        ok: true,
        mode: "local-preview",
        upstream: UPSTREAM,
        get: [...GET_ALLOW],
        post: [...POST_ALLOW],
      });
      return;
    }

    if (pathname.startsWith("/__dev-api/")) {
      await handleApiProxy(req, res, pathname.slice("/__dev-api/".length) + u.search);
      return;
    }

    if (pathname === "/__school-orders" || pathname === "/__school-orders/") {
      sendJson(res, 200, {
        ok: true,
        upstream: SCHOOL_ORDERS_UPSTREAM,
        allow: [...ORDERS_ALLOW],
      });
      return;
    }

    if (pathname.startsWith("/__school-orders/")) {
      await handleSchoolOrdersProxy(
        req,
        res,
        pathname.slice("/__school-orders/".length) + u.search
      );
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end("Method Not Allowed");
      return;
    }

    handleStatic(req, res, pathname);
  } catch (e) {
    console.error("[dev-server]", e);
    sendJson(res, 500, { error: "Local server error", code: "DEV_SERVER" });
  }
});

server.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.log("");
  console.log("Greenola school app_new — local UI preview");
  console.log(`  Root:  ${base}/`);
  console.log(`  BLS:   ${base}/bls`);
  console.log(`  Menu:  ${base}/__dev-api/school-menu?list=1&lang=ar`);
  console.log(`  Orders: ${base}/__school-orders/ → ${SCHOOL_ORDERS_UPSTREAM}`);
  console.log("");
});
