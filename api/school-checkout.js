/**
 * Vercel only — POST proxy for Supabase Edge Function `school-checkout`.
 * Called after the bank status is paid. Omits the browser Origin (same reason as school-menu).
 * Do not ship in the static school.greenolasa.com ZIP.
 */
const UPSTREAM =
  "https://jmtqldgovmmhaystvpdu.supabase.co/functions/v1/school-checkout";

export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Only POST /school-checkout is allowed.", code: "METHOD" }));
    return;
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: "Could not read body", code: "BAD_BODY" }));
    return;
  }

  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "greenola-school-app-new-vercel/1.0",
      },
      body: raw.length ? raw : undefined,
      redirect: "follow",
    });
  } catch (e) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        error: "Upstream school-checkout unreachable",
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
  res.setHeader("X-Preview-Proxy", "school-checkout");
  res.end(text);
}
