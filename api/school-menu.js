/**
 * Vercel preview ONLY — read-only proxy for Supabase Edge Function `school-menu`.
 *
 * Why: the parent app on Vercel calls the menu from the browser. school-menu rejects
 * Origin https://greenola-school-app.vercel.app with {"code":"ORIGIN"}.
 * Local preview already solves this via app/dev-server.mjs (omits Origin upstream).
 * greenola_b2b_landingpage solves payment CORS the same way: Next.js /api/* server routes.
 *
 * This handler:
 * - Allows GET/HEAD only
 * - Forwards query string to the public school-menu URL
 * - Does NOT send or spoof Origin / privileged keys
 * - Must never ship in the static school.greenolasa.com ZIP
 */
const UPSTREAM =
  "https://jmtqldgovmmhaystvpdu.supabase.co/functions/v1/school-menu";

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
    res.end(JSON.stringify({ error: "Menu proxy is read-only.", code: "METHOD" }));
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
    res.end(
      JSON.stringify({
        error: "Upstream school-menu unreachable from preview proxy",
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
  res.setHeader("X-Preview-Proxy", "school-menu-readonly");
  if (req.method === "HEAD") res.end();
  else res.end(text);
}
