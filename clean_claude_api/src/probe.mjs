import { performance } from "node:perf_hooks";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIR = path.resolve(MODULE_DIR, "..");

function resolveAdapterPath(targetPath) {
  if (path.isAbsolute(targetPath)) return targetPath;
  return path.resolve(ADAPTER_DIR, targetPath);
}

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) process.env[key] = value;
    }
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
}

await loadEnvFile(resolveAdapterPath(".env.local"));

const UPSTREAM_BASE_URL = (process.env.UPSTREAM_BASE_URL || "").replace(/\/$/, "");
const UPSTREAM_API_KEY = process.env.UPSTREAM_API_KEY || "";
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || "2023-06-01";

const aliases = {
  haiku: (process.env.MODEL_HAIKU || "claude-sonnet-4-6").split(/\s*,\s*/).filter(Boolean),
  sonnet: (process.env.MODEL_SONNET || "claude-sonnet-4-6").split(/\s*,\s*/).filter(Boolean),
  opus: (process.env.MODEL_OPUS || "claude-opus-4-7,claude-sonnet-4-6").split(/\s*,\s*/).filter(Boolean),
  multimodal: (process.env.MODEL_MULTIMODAL || "claude-sonnet-4-6").split(/\s*,\s*/).filter(Boolean),
};

async function probeModel(model) {
  const start = performance.now();
  try {
    const res = await fetch(`${UPSTREAM_BASE_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
        ...(UPSTREAM_API_KEY
          ? {
              authorization: `Bearer ${UPSTREAM_API_KEY}`,
              "x-api-key": UPSTREAM_API_KEY,
            }
          : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: 24,
        messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly: OK" }] }],
        stream: false,
      }),
    });

    const raw = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      return {
        ok: false,
        model,
        status: res.status,
        elapsed_ms: Math.round(performance.now() - start),
        error: parsed?.error?.message || parsed?.error || raw,
      };
    }

    return {
      ok: true,
      model,
      status: res.status,
      elapsed_ms: Math.round(performance.now() - start),
      reply: (parsed?.content || []).map((item) => item.text || "").join(""),
    };
  } catch (err) {
    return {
      ok: false,
      model,
      elapsed_ms: Math.round(performance.now() - start),
      error: err?.message || "Unknown error",
    };
  }
}

const results = [];
for (const [alias, models] of Object.entries(aliases)) {
  for (const model of models) {
    if (results.some((item) => item.model === model)) continue;
    results.push({ alias, ...(await probeModel(model)) });
  }
}

process.stdout.write(`${JSON.stringify({ upstream: UPSTREAM_BASE_URL, results }, null, 2)}\n`);
