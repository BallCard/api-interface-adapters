import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const WORKSPACE_ROOT = process.cwd();

function loadEnvFile(filePath) {
  const values = {};
  if (!existsSync(filePath)) return values;

  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) values[key] = value;
  }
  return values;
}

function localBaseUrl(adapterDir, defaults) {
  const env = loadEnvFile(path.join(WORKSPACE_ROOT, adapterDir, ".env.local"));
  const host = env.HOST || defaults.host;
  const port = Number.parseInt(env.PORT ?? String(defaults.port), 10);
  return `http://${host}:${port}`;
}

async function checkService(service) {
  const url = `${service.baseUrl}/health`;
  const startedAt = Date.now();

  try {
    const response = await fetch(url);
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return {
      name: service.name,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      url,
      body,
    };
  } catch (error) {
    return {
      name: service.name,
      ok: false,
      status: null,
      elapsedMs: Date.now() - startedAt,
      url,
      error: error.message,
    };
  }
}

const services = [
  {
    name: "chat",
    baseUrl: localBaseUrl("clean_claude_api", { host: "127.0.0.1", port: 8787 }),
  },
  {
    name: "image2",
    baseUrl: localBaseUrl("image2", { host: "127.0.0.1", port: 3000 }),
  },
  {
    name: "video",
    baseUrl: localBaseUrl("video", { host: "127.0.0.1", port: 4000 }),
  },
];

const results = [];
for (const service of services) {
  results.push(await checkService(service));
}

for (const result of results) {
  if (result.ok) {
    const serviceName = result.body?.service || result.name;
    console.log(`[ok] ${result.name} -> ${result.url} (${result.status}, ${result.elapsedMs}ms, service=${serviceName})`);
    continue;
  }

  const reason = result.error || result.body?.error?.message || `HTTP ${result.status}`;
  console.log(`[fail] ${result.name} -> ${result.url} (${reason})`);
}

if (results.some((result) => !result.ok)) {
  process.exitCode = 1;
}
