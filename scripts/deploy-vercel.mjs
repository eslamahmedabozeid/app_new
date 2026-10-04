#!/usr/bin/env node
/**
 * Deploy app_new to Vercel.
 * Stages a copy that calls same-origin proxies:
 *   /api/school-menu
 *   /api/school-orders/checkout  (POST)
 *   /api/school-orders/status    (GET)
 * Localhost source (index.html) stays on /__dev-api and /__school-orders.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(__dirname, "..");
const SIBLING_ASSETS = path.resolve(APP, "../app/assets");
const STAGE = path.join(os.tmpdir(), "greenola-app-new-vercel");
const TEAM = "team_yNvyhetiIpDRHbF0N5amFTFj";
const PROJECT_NAME = "greenola-school-app-new";
const ALIAS = "greenola-school-app-new.vercel.app";

function readVercelToken() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [
    home && path.join(home, "Library/Application Support/com.vercel.cli/auth.json"),
    process.env.APPDATA && path.join(process.env.APPDATA, "com.vercel.cli/auth.json"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "com.vercel.cli/auth.json"),
    home && path.join(home, ".local/share/com.vercel.cli/auth.json"),
  ].filter(Boolean);
  for (const authPath of candidates) {
    if (!fs.existsSync(authPath)) continue;
    const token = JSON.parse(fs.readFileSync(authPath, "utf8")).token;
    if (token) return token;
  }
  return "";
}
const token = readVercelToken();

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });

  let html = fs.readFileSync(path.join(APP, "index.html"), "utf8");
  const htmlReady = html.includes("ON_VERCEL") && html.includes("'/api'");
  if (!htmlReady) {
    html = html.replace(
      '<script src="assets/school-orders-api.js"></script>',
      '<script>window.SCHOOL_ORDERS_API_BASE="/api/school-orders";</script>\n<script src="assets/school-orders-api.js"></script>'
    );
    html = html.replace(
      "const API=USE_LOCAL_PROXY?API_LOCAL_PROXY:API_REMOTE;",
      "const API='/api'; /* Vercel: same-origin school-menu proxy */"
    );
    if (!html.includes('SCHOOL_ORDERS_API_BASE="/api/school-orders"') || !html.includes("const API='/api'")) {
      throw new Error("Failed to patch preview HTML for Vercel proxies");
    }
  }
  fs.writeFileSync(path.join(STAGE, "index.html"), html);

  let orders = fs.readFileSync(path.join(APP, "assets/school-orders-api.js"), "utf8");
  if (!orders.includes('"/api/school-orders"')) {
    orders = orders.replace(
      /var DEFAULT_BASE =\s*"https:\/\/backend\.greenolasa\.com\/api\/v1\/school-orders";/,
      'var DEFAULT_BASE = "/api/school-orders"; /* Vercel preview proxy */'
    );
    if (!orders.includes('DEFAULT_BASE = "/api/school-orders"')) {
      throw new Error("Failed to patch school-orders-api.js");
    }
  }
  copyFile(path.join(APP, "assets/payment.css"), path.join(STAGE, "assets/payment.css"));
  copyFile(path.join(APP, "assets/tokens.css"), path.join(STAGE, "assets/tokens.css"));
  fs.writeFileSync(path.join(STAGE, "assets/school-orders-api.js"), orders);

  for (const name of ["_headers", "_redirects", "vercel.json"]) {
    const src = path.join(APP, name);
    if (fs.existsSync(src)) copyFile(src, path.join(STAGE, name));
  }

  for (const rel of [
    "api/school-menu.js",
    "api/school-checkout.js",
    "api/school-orders/checkout.js",
    "api/school-orders/status.js",
  ]) {
    copyFile(path.join(APP, rel), path.join(STAGE, rel));
  }

  const shared = ["logos", "photos", "fonts", "dishes"];
  for (const dir of shared) {
    const from = path.join(SIBLING_ASSETS, dir);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(STAGE, "assets", dir), { recursive: true });
  }
  console.log("staged", STAGE);
}

const LIVE_ASSETS = [
  "assets/logos/wordmark-on-dark-green.png",
  "assets/logos/leaf-e-cream.png",
  "assets/logos/leaf-e-primary-green.png",
  "assets/photos/bag-hero.png",
  "assets/fonts/Cairo-Regular.woff2",
  "assets/fonts/Cairo-Bold.woff2",
  "assets/fonts/Cairo-Black.woff2",
];

function flattenDeploymentFiles(nodes, prefix = "", out = []) {
  for (const node of nodes || []) {
    const rel = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.type === "directory") {
      if (!node.children || !node.children.length) out.push({ emptyDir: rel });
      else flattenDeploymentFiles(node.children, rel, out);
    } else out.push({ file: rel });
  }
  return out;
}

async function preservePriorAssets(projectId) {
  const list = await api(
    "GET",
    `/v6/deployments?projectId=${encodeURIComponent(projectId)}&target=production&limit=1`
  );
  const dep = (list.deployments || [])[0];
  if (!dep) return;
  const id = dep.uid || dep.id;
  const tree = await api("GET", `/v6/deployments/${id}/files`);
  const flat = flattenDeploymentFiles(Array.isArray(tree) ? tree : []);
  const empty = flat.filter((n) => n.emptyDir && n.emptyDir.startsWith("assets/"));
  if (empty.length) {
    throw new Error(`Could not list prior asset files (${empty.map((n) => n.emptyDir).join(", ")})`);
  }
  const keep = flat
    .map((n) => n.file)
    .filter((rel) => rel && /^assets\/(logos|photos|fonts|dishes)\//.test(rel));
  const host = String(dep.url || ALIAS).replace(/^https?:\/\//, "");
  console.log("keeping", keep.length, "assets from previous production deploy");
  for (const rel of keep) {
    const dest = path.join(STAGE, rel);
    if (fs.existsSync(dest)) continue;
    const res = await fetch(`https://${host}/${rel}`);
    if (!res.ok) throw new Error(`prior asset ${rel} → ${res.status}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
}

async function hydrateMissingAssets() {
  const missing = LIVE_ASSETS.filter((rel) => !fs.existsSync(path.join(STAGE, rel)));
  if (!missing.length) return;
  console.log("pulling", missing.length, "assets from", ALIAS);
  for (const rel of missing) {
    const res = await fetch(`https://${ALIAS}/${rel}`);
    if (!res.ok) throw new Error(`asset ${rel} → ${res.status}`);
    const dest = path.join(STAGE, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(" +", rel);
  }
}

function walk(dir, base = dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join("/"));
  }
  return out;
}

async function api(method, urlPath, body, isJson = true) {
  const url = new URL(urlPath, "https://api.vercel.com");
  if (!url.searchParams.has("teamId")) url.searchParams.set("teamId", TEAM);
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (body != null) {
    if (isJson) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    } else payload = body;
  }
  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Vercel API ${method} ${url.pathname} → ${res.status}`);
    err.body = json;
    throw err;
  }
  return json;
}

async function uploadFile(rel) {
  const buf = fs.readFileSync(path.join(STAGE, rel));
  const sha = createHash("sha1").update(buf).digest("hex");
  const res = await fetch(`https://api.vercel.com/v2/files?teamId=${TEAM}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "x-vercel-digest": sha,
      "Content-Length": String(buf.length),
    },
    body: buf,
  });
  if (res.status === 200 || res.status === 409) return { file: rel, sha, size: buf.length };
  throw new Error(`upload ${rel} → ${res.status} ${await res.text()}`);
}

function deployWithCli() {
  const scope = "eslamahmedabozeids-projects";
  const run = (cmd) => {
    const result = spawnSync(cmd, { cwd: STAGE, stdio: "inherit", shell: true });
    if (result.status !== 0) process.exit(result.status || 1);
  };
  run(`npx --yes vercel link --yes --project ${PROJECT_NAME} --scope ${scope}`);
  run(`npx --yes vercel deploy --prod --yes --scope ${scope}`);
}

async function main() {
  stage();
  await hydrateMissingAssets();
  if (!token) {
    console.log("Deploying with the Vercel CLI");
    deployWithCli();
    return;
  }
  const list = await api("GET", `/v9/projects?limit=100&search=${encodeURIComponent(PROJECT_NAME)}`);
  let project = (list.projects || []).find((p) => p.name === PROJECT_NAME);
  if (!project) {
    project = await api("POST", "/v10/projects", { name: PROJECT_NAME, framework: null });
    console.log("created", project.id);
  } else {
    console.log("project", project.id, project.name);
  }
  await preservePriorAssets(project.id);
  const files = walk(STAGE);
  console.log("uploading", files.length, "files");
  const uploaded = [];
  for (const rel of files) {
    uploaded.push(await uploadFile(rel));
    console.log(" +", rel);
  }
  const deployment = await api("POST", "/v13/deployments", {
    name: PROJECT_NAME,
    project: project.id,
    projectSettings: { framework: null },
    target: "production",
    files: uploaded.map((f) => ({ file: f.file, sha: f.sha, size: f.size })),
  });
  let alias = null;
  try {
    const assigned = await api("POST", `/v2/deployments/${deployment.id}/aliases`, { alias: ALIAS });
    alias = assigned.alias || ALIAS;
  } catch (e) {
    console.error("alias", e.message);
  }
  console.log("READY", JSON.stringify({
    deploymentId: deployment.id,
    url: `https://${ALIAS}`,
    deploymentUrl: deployment.url ? `https://${deployment.url}` : null,
    alias,
    projectName: PROJECT_NAME,
  }, null, 2));
}

main().catch((e) => {
  console.error("FAIL", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
