/**
 * Vercel preview ONLY — fixed proxy for school-orders GET /status.
 * Server-to-server (no browser Origin). Do not ship in the static school ZIP.
 */
const UPSTREAM =
  "https://backend.greenolasa.com/api/v1/school-orders/status";

function buildQuery(req) {
  if (req.query && typeof req.query === "object") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (value == null) continue;
      if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)));
      else params.set(key, String(value));
    }
    const q = params.toString();
    return q ? `?${q}` : "";
  }
  const raw = typeof req.url === "string" ? req.url : "";
  const i = raw.indexOf("?");
  return i >= 0 ? raw.slice(i) : "";
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Only GET /status is allowed.", code: "METHOD" }));
    return;
  }

  const target = UPSTREAM + buildQuery(req);
  let upstream;
  try {
    upstream = await fetch(target, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "greenola-school-app-new-vercel/1.0",
      },
      redirect: "follow",
    });
  } catch (e) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        error: "Upstream school-orders status unreachable",
        code: "PROXY_UPSTREAM",
        detail: String(e && e.message ? e.message : e),
      })
    );
    return;
  }

  const text = await upstream.text();
  res.statusCode = upstream.status;
  res.setHeader(
    "Content-Type",
    upstream.headers.get("content-type") || "application/json; charset=utf-8"
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Preview-Proxy", "school-orders-status");
  if (req.method === "HEAD") res.end();
  else res.end(text);
}
