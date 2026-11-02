import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIR = path.resolve(MODULE_DIR);

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
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
}

await loadEnvFile(resolveAdapterPath(".env.local"));

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT ?? "4000", 10);
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL ?? "https://sakura886.site/v1").replace(/\/+$/, "");
const OPENAI_VIDEO_MODEL = process.env.OPENAI_VIDEO_MODEL ?? "AA-veo31fast-720p";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim() || "";
const MAX_BODY_SIZE = 2_000_000;
const DATA_DIR = resolveAdapterPath(process.env.VIDEO_DATA_DIR || "./data");
const HISTORY_DIR = path.join(DATA_DIR, "history");
const WORKSPACE_ROOT = process.cwd();

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}

async function ensureStorage() {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendBinary(res, statusCode, body, contentType) {
  res.writeHead(statusCode, {
    "Content-Type": contentType || "application/octet-stream",
    "Content-Length": body.byteLength,
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_SIZE) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sanitizeVideoId(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 160);
}

function historyFile(videoId) {
  return path.join(HISTORY_DIR, `${sanitizeVideoId(videoId)}.json`);
}

async function readHistory(videoId) {
  try {
    const raw = await fs.readFile(historyFile(videoId), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeHistory(videoId, record) {
  const safeId = sanitizeVideoId(videoId);
  const payload = {
    ...record,
    id: safeId,
    updated_at: new Date().toISOString(),
  };
  await fs.writeFile(historyFile(safeId), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

async function mergeHistory(videoId, patch) {
  const current = (await readHistory(videoId)) || {
    id: sanitizeVideoId(videoId),
    created_at: new Date().toISOString(),
  };
  return writeHistory(videoId, { ...current, ...patch });
}

async function listHistory() {
  await ensureStorage();
  const files = await fs.readdir(HISTORY_DIR, { withFileTypes: true });
  const items = [];
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(HISTORY_DIR, file.name), "utf8");
    const record = JSON.parse(raw);
    items.push({
      id: record.id,
      prompt: record.prompt || "",
      model: record.model || null,
      status: record.status || null,
      progress: record.progress ?? null,
      created_at: record.created_at || null,
      updated_at: record.updated_at || null,
      last_synced_at: record.last_synced_at || null,
      last_downloaded_at: record.last_downloaded_at || null,
      reference_input: record.reference_input || null,
    });
  }
  items.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  return items;
}

function normalizeReferenceInput(body) {
  if (typeof body.input_reference === "string" && body.input_reference.trim()) {
    return body.input_reference.trim();
  }
  if (typeof body.reference_url === "string" && body.reference_url.trim()) {
    return body.reference_url.trim();
  }
  if (body.input_reference && typeof body.input_reference === "object" && !Array.isArray(body.input_reference)) {
    if (typeof body.input_reference.image_url === "string" && body.input_reference.image_url.trim()) {
      return body.input_reference.image_url.trim();
    }
    if (typeof body.input_reference.file_id === "string" && body.input_reference.file_id.trim()) {
      return body.input_reference.file_id.trim();
    }
  }
  return null;
}

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

function resolveReferenceFile(referenceFile) {
  if (path.isAbsolute(referenceFile)) return referenceFile;
  return path.resolve(WORKSPACE_ROOT, referenceFile);
}

async function materializeReferenceInput(body) {
  const directReference = normalizeReferenceInput(body);
  if (directReference) {
    return directReference;
  }

  if (typeof body.reference_file === "string" && body.reference_file.trim()) {
    const resolved = resolveReferenceFile(body.reference_file.trim());
    const buffer = await fs.readFile(resolved);
    const mimeType = guessMimeType(resolved);
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  }

  return null;
}

async function normalizeCreateRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("JSON object body is required");
  }

  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    throw new Error("`prompt` is required");
  }

  const payload = { ...body };
  payload.prompt = body.prompt.trim();
  payload.model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : OPENAI_VIDEO_MODEL;
  delete payload.reference_url;
  delete payload.reference_file;

  const seconds = body.seconds ?? body.duration;
  if (seconds !== undefined && payload.seconds === undefined) {
    payload.seconds = String(seconds);
  }

  if (typeof payload.size === "string") {
    payload.size = payload.size.trim();
  }

  if (typeof payload.quality === "string") {
    payload.quality = payload.quality.trim();
  }

  const referenceInput = await materializeReferenceInput(body);
  if (referenceInput) {
    payload.input_reference = referenceInput;
  } else {
    delete payload.input_reference;
  }

  return payload;
}

function buildUpstreamUrl(pathname) {
  return `${OPENAI_BASE_URL}${pathname}`;
}

async function callJson(method, pathname, payload) {
  const response = await fetch(buildUpstreamUrl(pathname), {
    method,
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(body?.error?.message || body?.message || text || `Upstream request failed with status ${response.status}`);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

async function callBinary(pathname, searchParams) {
  const query = searchParams?.toString() ? `?${searchParams}` : "";
  const response = await fetch(buildUpstreamUrl(`${pathname}${query}`), {
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const text = buffer.toString("utf8");
    let details;
    try {
      details = JSON.parse(text);
    } catch {
      details = { raw: text };
    }
    const error = new Error(details?.error?.message || text || `Upstream request failed with status ${response.status}`);
    error.status = response.status;
    error.details = details;
    throw error;
  }

  return {
    body: buffer,
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

function matchVideoRoute(url) {
  if (url.pathname === "/api/video/history") {
    return { kind: "history_list" };
  }

  const historyMatch = url.pathname.match(/^\/api\/video\/history\/([^/]+)$/);
  if (historyMatch) {
    return { kind: "history_item", videoId: decodeURIComponent(historyMatch[1]) };
  }

  const contentMatch = url.pathname.match(/^\/api\/video\/([^/]+)\/content$/);
  if (contentMatch) {
    return { kind: "content", videoId: decodeURIComponent(contentMatch[1]) };
  }

  const jobMatch = url.pathname.match(/^\/api\/video\/([^/]+)$/);
  if (jobMatch) {
    return { kind: "job", videoId: decodeURIComponent(jobMatch[1]) };
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    await ensureStorage();
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "video",
        base_url: OPENAI_BASE_URL,
        model: OPENAI_VIDEO_MODEL,
        history_dir: HISTORY_DIR,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/video/generate") {
      const body = await readJsonBody(req);
      const payload = await normalizeCreateRequest(body);
      const result = await callJson("POST", "/videos", payload);
      const videoId = sanitizeVideoId(result.id || result.task_id);

      await mergeHistory(videoId, {
        created_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        prompt: payload.prompt,
        model: result.model || payload.model,
        status: result.status || null,
        progress: result.progress ?? null,
        request_payload: payload,
        upstream_video: result,
        upstream_created_at: result.created_at || null,
        task_id: result.task_id || result.id || null,
        reference_input: payload.input_reference || null,
      });

      sendJson(res, 200, {
        ok: true,
        video: result,
        history_id: videoId,
      });
      return;
    }

    const matched = matchVideoRoute(url);
    if (matched?.kind === "history_list" && req.method === "GET") {
      const items = await listHistory();
      sendJson(res, 200, {
        ok: true,
        items,
      });
      return;
    }

    if (matched?.kind === "history_item" && req.method === "GET") {
      const item = await readHistory(matched.videoId);
      if (!item) {
        sendJson(res, 404, {
          ok: false,
          error: {
            message: "History not found",
          },
        });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        item,
      });
      return;
    }

    if (matched?.kind === "job" && req.method === "GET") {
      const result = await callJson("GET", `/videos/${encodeURIComponent(matched.videoId)}`);
      await mergeHistory(matched.videoId, {
        model: result.model || null,
        status: result.status || null,
        progress: result.progress ?? null,
        last_synced_at: new Date().toISOString(),
        upstream_video: result,
        upstream_created_at: result.created_at || null,
        upstream_completed_at: result.completed_at || null,
        task_id: result.task_id || result.id || matched.videoId,
      });
      sendJson(res, 200, {
        ok: true,
        video: result,
      });
      return;
    }

    if (matched?.kind === "content" && req.method === "GET") {
      const searchParams = new URLSearchParams();
      const variant = url.searchParams.get("variant");
      if (variant) searchParams.set("variant", variant);
      const result = await callBinary(`/videos/${encodeURIComponent(matched.videoId)}/content`, searchParams);
      await mergeHistory(matched.videoId, {
        last_downloaded_at: new Date().toISOString(),
        last_content_type: result.contentType,
        last_content_length: result.body.byteLength,
        download_count: ((await readHistory(matched.videoId))?.download_count || 0) + 1,
      });
      sendBinary(res, 200, result.body, result.contentType);
      return;
    }

    sendJson(res, 404, {
      ok: false,
      error: {
        message: "Route not found",
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "`prompt` is required" ||
        error.message === "Invalid JSON body" ||
        error.message === "JSON object body is required")
    ) {
      sendJson(res, 400, {
        ok: false,
        error: {
          message: error.message,
        },
      });
      return;
    }

    if (error instanceof Error && error.message === "Request body too large") {
      sendJson(res, 413, {
        ok: false,
        error: {
          message: error.message,
        },
      });
      return;
    }

    sendJson(res, error?.status ?? 500, {
      ok: false,
      error: {
        message: error?.message ?? "Video request failed",
        details: error?.details ?? null,
      },
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`video API listening on http://${HOST}:${PORT}`);
});
