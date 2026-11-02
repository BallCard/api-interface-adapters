import crypto from "node:crypto";
import { spawn } from "node:child_process";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT ?? "4100", 10);
const ENV_PATH = path.join(MODULE_DIR, ".env.local");
const CONFIG_PATH = path.resolve(MODULE_DIR, process.env.IMAGE_HUB_CONFIG_PATH || "./channels.local.json");
const EXAMPLE_CONFIG_PATH = path.join(MODULE_DIR, "channels.example.json");
const DATA_DIR = path.resolve(MODULE_DIR, process.env.IMAGE_HUB_DATA_DIR || "./data");
const ASSETS_DIR = path.join(DATA_DIR, "assets");
const DEFAULT_ASSETS_DIR = path.join(ASSETS_DIR, "files");
const ASSET_RECORDS_DIR = path.join(ASSETS_DIR, "records");
const IDEMPOTENCY_DIR = path.join(DATA_DIR, "idempotency");
const TASKS_DIR = path.join(DATA_DIR, "tasks");
const LEDGER_PATH = path.join(DATA_DIR, "ledger.jsonl");
const STATIC_DIR = path.join(MODULE_DIR, "public");
const WORKSPACE_ROOT = path.resolve(process.env.IMAGE_HUB_WORKSPACE_ROOT || path.join(MODULE_DIR, "..", "..", ".."));
const PROJECTS_ROOT = path.join(WORKSPACE_ROOT, "projects");
const MAX_BODY_SIZE = 64 * 1024;
const PROBE_TIMEOUT_MS = 15_000;
const GENERATION_TIMEOUT_MS = 180_000;
const probeResults = new Map();
const serviceProbeResults = new Map();
const ADAPTERS_ROOT = path.resolve(MODULE_DIR, "..");
const SERVICE_ENV = {
  video: { envPath: path.join(ADAPTERS_ROOT, "video", ".env.local"), baseUrlKey: "OPENAI_BASE_URL", modelKey: "OPENAI_VIDEO_MODEL", keyKey: "OPENAI_API_KEY", defaultBaseUrl: "https://api.toskaxy.xyz/v1", defaultModel: "AA-veo31fast-720p" },
  chat: { envPath: path.join(ADAPTERS_ROOT, "clean_claude_api", ".env.local"), baseUrlKey: "UPSTREAM_BASE_URL", modelKey: "MODEL_OPUS", keyKey: "UPSTREAM_API_KEY", defaultBaseUrl: "https://api.toskaxy.xyz/v1", defaultModel: "opus" },
};
const LOCAL_SERVICES = {
  image: { id: "image", label: "图像生成", port: PORT, healthPath: "/health", href: "/" },
  video: { id: "video", label: "视频生成", port: 4000, healthPath: "/health", script: "video:start" },
  chat: { id: "chat", label: "聊天", port: 8787, healthPath: "/health", script: "chat:start" },
};

function resolveKeyEnvName(channelId) {
  return `IMAGE_HUB_${channelId.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}_API_KEY`;
}

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].trim();
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

await loadEnvFile(ENV_PATH);

async function ensureStorage() {
  await Promise.all([fs.mkdir(DEFAULT_ASSETS_DIR, { recursive: true }), fs.mkdir(ASSET_RECORDS_DIR, { recursive: true }), fs.mkdir(IDEMPOTENCY_DIR, { recursive: true }), fs.mkdir(TASKS_DIR, { recursive: true })]);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  return "application/octet-stream";
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_SIZE) throw new Error("Request body too large");
  }
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object body is required");
    return value;
  } catch (error) {
    if (error.message === "JSON object body is required") throw error;
    throw new Error("Invalid JSON body");
  }
}

function normalizeChannel(raw, index = 0) {
  const id = String(raw?.id || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{2,48}$/.test(id)) throw new Error("Channel id must use lowercase letters, numbers, and hyphens");
  const baseUrl = String(raw?.baseUrl || "").trim().replace(/\/+$/, "");
  if (baseUrl) {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Channel URL must use http or https");
  }
  const number = (value, fallback, min, max) => {
    const parsed = Number(value ?? fallback);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error("Invalid channel limit");
    return parsed;
  };
  return {
    id,
    label: String(raw?.label || id).trim().slice(0, 80) || id,
    baseUrl,
    model: String(raw?.model || "").trim().slice(0, 120),
    enabled: raw?.enabled === true,
    priority: number(raw?.priority, index + 1, 1, 999),
    maxImages: Math.floor(number(raw?.maxImages, 1, 1, 4)),
    estimatedImageCostCny: number(raw?.estimatedImageCostCny, 0, 0, 10_000),
    maxEstimatedCostCny: number(raw?.maxEstimatedCostCny, 0, 0, 10_000),
  };
}

function normalizeOutputDestination(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (path.isAbsolute(raw)) throw Object.assign(new Error("Output destination must be relative to the Workspace folder"), { status: 400 });
  const resolved = path.resolve(WORKSPACE_ROOT, raw);
  const projectRelative = path.relative(PROJECTS_ROOT, resolved);
  if (!projectRelative || projectRelative.startsWith("..") || path.isAbsolute(projectRelative)) {
    throw Object.assign(new Error("Output destination must be an existing project folder under Workspace/projects"), { status: 400 });
  }
  return path.relative(WORKSPACE_ROOT, resolved).split(path.sep).join("/");
}

async function resolveOutputDirectory(destination) {
  if (!destination) return { directory: DEFAULT_ASSETS_DIR, label: "默认素材库" };
  const relative = normalizeOutputDestination(destination);
  const directory = path.resolve(WORKSPACE_ROOT, relative);
  try {
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    throw Object.assign(new Error("Selected output project folder does not exist"), { status: 400 });
  }
  return { directory, label: relative };
}

async function readChannels() {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    raw = JSON.parse(await fs.readFile(EXAMPLE_CONFIG_PATH, "utf8"));
  }
  const channels = Array.isArray(raw?.channels) ? raw.channels.map(normalizeChannel) : [];
  if (!channels.length) throw new Error("At least one channel is required");
  if (new Set(channels.map((channel) => channel.id)).size !== channels.length) throw new Error("Channel ids must be unique");
  return channels.sort((a, b) => a.priority - b.priority);
}

async function writeChannels(channels) {
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify({ channels }, null, 2)}\n`, "utf8");
}

function keyFor(channel) {
  return process.env[resolveKeyEnvName(channel.id)]?.trim() || "";
}

function keyFingerprint(key) {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
}

function publicChannel(channel) {
  const key = keyFor(channel);
  return {
    ...channel,
    keyConfigured: Boolean(key),
    keyFingerprint: key ? keyFingerprint(key) : null,
    lastProbe: probeResults.get(channel.id) || null,
  };
}

async function updateEnvKey(keyName, value) {
  let lines = [];
  try {
    lines = (await fs.readFile(ENV_PATH, "utf8")).split(/\r?\n/);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const matcher = new RegExp(`^\\s*${keyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=`);
  let replaced = false;
  lines = lines.map((line) => {
    if (!matcher.test(line)) return line;
    replaced = true;
    return `${keyName}=${value}`;
  });
  if (!replaced) lines.push(`${keyName}=${value}`);
  await fs.writeFile(ENV_PATH, `${lines.filter((line, index) => line || index < lines.length - 1).join("\n")}\n`, "utf8");
  process.env[keyName] = value;
}

async function readEnvMap(filePath) {
  const values = {};
  try {
    const raw = await fs.readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) values[match[1]] = match[2].trim();
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return values;
}

async function writeEnvValues(filePath, updates) {
  const values = await readEnvMap(filePath);
  Object.assign(values, updates);
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

function serviceEffectiveBaseUrl(serviceId, value) {
  const baseUrl = String(value || "").replace(/\/+$/, "");
  if (serviceId === "chat") return baseUrl.replace(/\/v1$/, "");
  return baseUrl;
}

function serviceModelsUrl(serviceId, baseUrl) {
  return `${baseUrl}${serviceId === "chat" ? "/v1" : ""}/models`;
}

async function serviceConfig(serviceId) {
  const definition = SERVICE_ENV[serviceId];
  if (!definition) throw Object.assign(new Error("Unknown service"), { status: 404 });
  const env = await readEnvMap(definition.envPath);
  const configuredBaseUrl = env[definition.baseUrlKey] || definition.defaultBaseUrl;
  const displayBaseUrl = serviceId === "chat" && configuredBaseUrl && !configuredBaseUrl.endsWith("/v1") ? `${configuredBaseUrl}/v1` : configuredBaseUrl;
  const key = env[definition.keyKey] || "";
  const model = env[definition.modelKey] || definition.defaultModel;
  return {
    id: serviceId,
    label: LOCAL_SERVICES[serviceId].label,
    baseUrl: displayBaseUrl,
    model,
    keyConfigured: Boolean(key),
    keyFingerprint: key ? keyFingerprint(key) : null,
    models: serviceProbeResults.get(serviceId)?.models || [],
    lastProbe: serviceProbeResults.get(serviceId) || null,
  };
}

async function listServiceConfigs() {
  return Promise.all(Object.keys(SERVICE_ENV).map(serviceConfig));
}

async function saveServiceConfig(serviceId, body) {
  const definition = SERVICE_ENV[serviceId];
  if (!definition) throw Object.assign(new Error("Unknown service"), { status: 404 });
  const current = await serviceConfig(serviceId);
  const requestedBaseUrl = String(body.baseUrl ?? current.baseUrl).trim().replace(/\/+$/, "");
  if (requestedBaseUrl) {
    const parsed = new URL(requestedBaseUrl);
    if (!/^https?:$/.test(parsed.protocol)) throw Object.assign(new Error("Service URL must use http or https"), { status: 400 });
  }
  const requestedModel = String(body.model ?? current.model).trim().slice(0, 160) || definition.defaultModel;
  const updates = { [definition.baseUrlKey]: serviceEffectiveBaseUrl(serviceId, requestedBaseUrl), [definition.modelKey]: requestedModel };
  if (typeof body.api_key === "string" && body.api_key.trim()) updates[definition.keyKey] = body.api_key.trim();
  await writeEnvValues(definition.envPath, updates);
  if (serviceId === "video") {
    process.env.OPENAI_BASE_URL = updates[definition.baseUrlKey];
    process.env.OPENAI_VIDEO_MODEL = updates[definition.modelKey];
    if (updates[definition.keyKey]) process.env.OPENAI_API_KEY = updates[definition.keyKey];
  }
  return serviceConfig(serviceId);
}

async function probeServiceModels(serviceId) {
  const definition = SERVICE_ENV[serviceId];
  const config = await serviceConfig(serviceId);
  const key = (await readEnvMap(definition.envPath))[definition.keyKey] || "";
  const baseUrl = serviceEffectiveBaseUrl(serviceId, config.baseUrl);
  const startedAt = Date.now();
  if (!baseUrl || !key) {
    const result = { ok: false, checkedAt: new Date().toISOString(), elapsedMs: 0, models: [], message: "缺少地址或 API Key" };
    serviceProbeResults.set(serviceId, result);
    return result;
  }
  try {
    const response = await fetch(serviceModelsUrl(serviceId, baseUrl), { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const raw = await response.text();
    let parsed = {}; try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
    const models = Array.isArray(parsed?.data) ? parsed.data.map((item) => item?.id).filter(Boolean) : [];
    const result = response.ok ? { ok: true, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt, models, modelCount: models.length } : { ok: false, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt, models: [], message: parsed?.error?.message || parsed?.message || `HTTP ${response.status}` };
    serviceProbeResults.set(serviceId, result);
    return result;
  } catch (error) {
    const result = { ok: false, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt, models: [], message: error?.name === "TimeoutError" ? "检测超时" : "网络请求失败" };
    serviceProbeResults.set(serviceId, result);
    return result;
  }
}

async function parseUpstreamError(response) {
  const raw = await response.text();
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed?.error?.message || parsed?.message || raw || `HTTP ${response.status}`;
  } catch {
    return raw || `HTTP ${response.status}`;
  }
}

async function probe(channel) {
  const startedAt = Date.now();
  const key = keyFor(channel);
  if (!channel.baseUrl || !key) {
    const result = { ok: false, checkedAt: new Date().toISOString(), elapsedMs: 0, message: "Missing URL or API key" };
    probeResults.set(channel.id, result);
    return result;
  }
  try {
    const response = await fetch(`${channel.baseUrl}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const raw = await response.text();
    let parsed = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
    const models = Array.isArray(parsed?.data) ? parsed.data.map((item) => item?.id).filter(Boolean) : [];
    const result = response.ok
      ? { ok: true, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt, modelListed: models.includes(channel.model), modelCount: models.length, models }
      : { ok: false, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt, message: parsed?.error?.message || parsed?.message || `HTTP ${response.status}` };
    probeResults.set(channel.id, result);
    return result;
  } catch (error) {
    const result = { ok: false, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt, message: error?.name === "TimeoutError" ? "Probe timed out" : "Network error before a response" };
    probeResults.set(channel.id, result);
    return result;
  }
}

function extensionFor(format) {
  return format === "jpeg" || format === "jpg" ? "jpg" : format === "webp" ? "webp" : "png";
}

function mimeFor(extension) {
  if (extension === "jpg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return "image/png";
}

async function writeLedger(entry) {
  await fs.appendFile(LEDGER_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

function idempotencyPath(key) {
  return path.join(IDEMPOTENCY_DIR, `${crypto.createHash("sha256").update(key).digest("hex")}.json`);
}

async function generate(channel, request, idempotencyKey, isTest = false, taskId = null) {
  if (!channel.enabled) throw Object.assign(new Error("Selected channel is disabled"), { status: 409 });
  if (!channel.baseUrl || !channel.model || !keyFor(channel)) throw Object.assign(new Error("Selected channel is not fully configured"), { status: 409 });
  const prompt = String(request.prompt || "").trim();
  if (!prompt) throw Object.assign(new Error("`prompt` is required"), { status: 400 });
  const n = Number.isInteger(request.n) ? request.n : 1;
  if (n < 1 || n > channel.maxImages) throw Object.assign(new Error(`Image count exceeds this channel limit (${channel.maxImages})`), { status: 400 });
  const estimate = n * channel.estimatedImageCostCny;
  if (channel.maxEstimatedCostCny > 0 && estimate > channel.maxEstimatedCostCny) {
    throw Object.assign(new Error(`Estimated cost ¥${estimate} exceeds the channel cap ¥${channel.maxEstimatedCostCny}`), { status: 400 });
  }
  const outputDirectory = await resolveOutputDirectory(request.output_destination);
  const existingPath = idempotencyPath(idempotencyKey);
  try {
    const existing = JSON.parse(await fs.readFile(existingPath, "utf8"));
    return { ...existing, idempotent: true };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const upstreamPayload = { model: channel.model, prompt, n };
  for (const field of ["size", "quality", "output_format", "background", "moderation"]) {
    if (typeof request[field] === "string" && request[field].trim()) upstreamPayload[field] = request[field].trim();
  }
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(`${channel.baseUrl}/images/generations`, {
      method: "POST",
      headers: { authorization: `Bearer ${keyFor(channel)}`, "content-type": "application/json" },
      body: JSON.stringify(upstreamPayload),
      signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
    });
  } catch {
    throw Object.assign(new Error("Network failure with unknown upstream acceptance; no automatic retry was attempted"), { status: 502 });
  }
  if (!response.ok) {
    const message = await parseUpstreamError(response);
    throw Object.assign(new Error(message.slice(0, 500)), { status: response.status });
  }
  const payload = await response.json();
  const sourceItems = Array.isArray(payload?.data) ? payload.data : [];
  if (!sourceItems.length) throw Object.assign(new Error("Upstream returned no image data"), { status: 502 });
  const requestId = crypto.randomUUID();
  const assets = [];
  for (const [index, item] of sourceItems.entries()) {
    let bytes = null;
    if (typeof item?.b64_json === "string" && item.b64_json) {
      bytes = Buffer.from(item.b64_json, "base64");
    } else if (typeof item?.url === "string" && item.url) {
      const download = await fetch(item.url, { signal: AbortSignal.timeout(60_000) });
      if (!download.ok) throw Object.assign(new Error("Generated image could not be saved from its upstream URL"), { status: 502 });
      bytes = Buffer.from(await download.arrayBuffer());
    }
    if (!bytes?.byteLength) continue;
    const extension = extensionFor(upstreamPayload.output_format);
    const assetId = crypto.randomUUID();
    const fileName = `${assetId}.${extension}`;
    const absolutePath = path.join(outputDirectory.directory, fileName);
    await fs.writeFile(absolutePath, bytes);
    const record = { id: assetId, taskId, requestId, storedAt: new Date().toISOString(), fileName, absolutePath, destination: outputDirectory.label, contentType: mimeFor(extension), bytes: bytes.byteLength };
    await fs.writeFile(path.join(ASSET_RECORDS_DIR, `${assetId}.json`), `${JSON.stringify(record)}\n`, "utf8");
    assets.push({ id: assetId, url: `/api/assets/${assetId}`, fileName, destination: outputDirectory.label, contentType: record.contentType, revisedPrompt: item.revised_prompt ?? null });
  }
  if (!assets.length) throw Object.assign(new Error("Upstream returned an unsupported image payload"), { status: 502 });
  const result = {
    ok: true,
    idempotent: false,
    requestId,
    channel: { id: channel.id, label: channel.label, model: channel.model },
    assets,
    estimatedCostCny: estimate,
    elapsedMs: Date.now() - startedAt,
  };
  await fs.writeFile(existingPath, JSON.stringify(result), "utf8");
  await writeLedger({ at: new Date().toISOString(), requestId: result.requestId, taskId, channelId: channel.id, model: channel.model, test: isTest, imageCount: assets.length, estimatedCostCny: estimate, elapsedMs: result.elapsedMs, promptHash: crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16), assetIds: assets.map((asset) => asset.id).filter(Boolean), destination: outputDirectory.label });
  return result;
}

async function readLedger(limit) {
  try {
    const raw = await fs.readFile(LEDGER_PATH, "utf8");
    return raw.trim().split(/\r?\n/).filter(Boolean).slice(-limit).reverse().map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readAssetRecord(assetId) {
  if (!/^[a-f0-9-]{36}$/.test(assetId)) throw Object.assign(new Error("Asset not found"), { status: 404 });
  try {
    return JSON.parse(await fs.readFile(path.join(ASSET_RECORDS_DIR, `${assetId}.json`), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw Object.assign(new Error("Asset not found"), { status: 404 });
    throw error;
  }
}

function publicAsset(record) {
  return { id: record.id, url: `/api/assets/${record.id}`, taskId: record.taskId, storedAt: record.storedAt, fileName: record.fileName, destination: record.destination, contentType: record.contentType, bytes: record.bytes };
}

async function listAssets(limit) {
  const files = await fs.readdir(ASSET_RECORDS_DIR, { withFileTypes: true });
  const records = await Promise.all(files.filter((file) => file.isFile() && file.name.endsWith(".json")).map(async (file) => JSON.parse(await fs.readFile(path.join(ASSET_RECORDS_DIR, file.name), "utf8"))));
  return records.sort((a, b) => String(b.storedAt).localeCompare(String(a.storedAt))).slice(0, limit).map(publicAsset);
}

async function listProjectDirectories() {
  try {
    const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => ({ path: `projects/${entry.name}`, label: entry.name })).sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

function taskPath(taskId) {
  return path.join(TASKS_DIR, `${taskId}.json`);
}

function normalizeTaskRequest(body, channels) {
  const channelId = String(body.channel_id || "").trim();
  if (!channels.some((channel) => channel.id === channelId)) throw Object.assign(new Error("A valid channel_id is required"), { status: 400 });
  const prompt = String(body.prompt || "").trim();
  if (!prompt) throw Object.assign(new Error("`prompt` is required"), { status: 400 });
  const request = { channel_id: channelId, prompt: prompt.slice(0, 20_000), n: Number.isInteger(body.n) ? body.n : 1, output_destination: normalizeOutputDestination(body.output_destination) };
  for (const field of ["size", "quality", "output_format", "background", "moderation"]) {
    if (typeof body[field] === "string" && body[field].trim()) request[field] = body[field].trim().slice(0, 120);
  }
  return request;
}

async function createTask(channels, body, source = "generation") {
  const request = normalizeTaskRequest(body, channels);
  const now = new Date().toISOString();
  const task = {
    id: `task_${crypto.randomUUID().replace(/-/g, "")}`,
    source,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    request,
    runs: [],
    lastError: null,
  };
  await fs.writeFile(taskPath(task.id), `${JSON.stringify(task, null, 2)}\n`, "utf8");
  return task;
}

async function readTask(taskId) {
  if (!/^task_[a-f0-9]{32}$/.test(taskId)) throw Object.assign(new Error("Task not found"), { status: 404 });
  try {
    return JSON.parse(await fs.readFile(taskPath(taskId), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw Object.assign(new Error("Task not found"), { status: 404 });
    throw error;
  }
}

async function writeTask(task) {
  task.updatedAt = new Date().toISOString();
  await fs.writeFile(taskPath(task.id), `${JSON.stringify(task, null, 2)}\n`, "utf8");
}

function taskSummary(task) {
  const lastRun = task.runs?.at(-1) || null;
  return {
    id: task.id,
    source: task.source,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    channelId: task.request?.channel_id || null,
    promptPreview: String(task.request?.prompt || "").slice(0, 100),
    runCount: task.runs?.length || 0,
    lastRun,
    lastError: task.lastError || null,
  };
}

async function listTasks(limit) {
  const files = await fs.readdir(TASKS_DIR, { withFileTypes: true });
  const tasks = await Promise.all(files.filter((file) => file.isFile() && file.name.endsWith(".json")).map(async (file) => JSON.parse(await fs.readFile(path.join(TASKS_DIR, file.name), "utf8"))));
  return tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, limit).map(taskSummary);
}

async function runTask(task, channels, idempotencyKey) {
  if (task.status === "running") throw Object.assign(new Error("Task is already running"), { status: 409 });
  const channel = channels.find((item) => item.id === task.request.channel_id);
  if (!channel) throw Object.assign(new Error("Task channel no longer exists"), { status: 409 });
  const run = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), status: "running" };
  task.status = "running";
  task.lastError = null;
  await writeTask(task);
  try {
    const result = await generate(channel, task.request, idempotencyKey, task.source === "paid_test", task.id);
    Object.assign(run, { status: "succeeded", finishedAt: new Date().toISOString(), requestId: result.requestId, assetIds: result.assets.map((asset) => asset.id).filter(Boolean), estimatedCostCny: result.estimatedCostCny, elapsedMs: result.elapsedMs, idempotent: result.idempotent });
    task.status = "succeeded";
    task.runs.push(run);
    await writeTask(task);
    return { task, result };
  } catch (error) {
    Object.assign(run, { status: "failed", finishedAt: new Date().toISOString(), error: String(error?.message || "Generation failed").slice(0, 500) });
    task.status = "failed";
    task.lastError = run.error;
    task.runs.push(run);
    await writeTask(task);
    throw error;
  }
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(STATIC_DIR, `.${requested}`);
  if (!resolved.startsWith(STATIC_DIR)) return false;
  try {
    const body = await fs.readFile(resolved);
    res.writeHead(200, { "content-type": contentType(resolved) });
    res.end(body);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function inspectLocalService(service) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`http://127.0.0.1:${service.port}${service.healthPath}`, { signal: AbortSignal.timeout(1_500) });
    const detail = await response.json().catch(() => ({}));
    return { ...service, running: response.ok, detail, elapsedMs: Date.now() - startedAt };
  } catch {
    return { ...service, running: false, detail: null, elapsedMs: Date.now() - startedAt };
  }
}

async function inspectLocalServices() {
  return Promise.all(Object.values(LOCAL_SERVICES).map(inspectLocalService));
}

async function startLocalService(id) {
  const service = LOCAL_SERVICES[id];
  if (!service?.script) throw Object.assign(new Error("Service cannot be started from this panel"), { status: 400 });
  const before = await inspectLocalService(service);
  if (before.running) return before;
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", `npm run ${service.script}`] : ["run", service.script];
  const child = spawn(command, args, { cwd: ADAPTERS_ROOT, detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const status = await inspectLocalService(service);
    if (status.running) return status;
  }
  return { ...service, running: false, starting: true, detail: null };
}

async function proxyLocalJson(serviceId, req, res, pathname) {
  const service = LOCAL_SERVICES[serviceId];
  if (!service?.script) return false;
  const status = await inspectLocalService(service);
  if (!status.running) return json(res, 503, { error: `${service.label}服务未启动`, service: status });
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(await readJson(req));
  const response = await fetch(`http://127.0.0.1:${service.port}${pathname}`, {
    method: req.method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body,
    signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
  });
  const payload = await response.text();
  res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json; charset=utf-8" });
  res.end(payload);
  return true;
}

async function startAllServices() {
  for (const id of ["video", "chat"]) await startLocalService(id);
  return inspectLocalServices();
}

const server = http.createServer(async (req, res) => {
  try {
    await ensureStorage();
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const channels = await readChannels();
    const channelMatch = url.pathname.match(/^\/api\/channels\/([a-z0-9-]+)(?:\/(probe|test))?$/);

    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, service: "image-hub", channels: channels.map(publicChannel) });
    if (req.method === "GET" && url.pathname === "/api/services") return json(res, 200, { services: await inspectLocalServices() });
    if (req.method === "GET" && url.pathname === "/api/service-configs") return json(res, 200, { services: await listServiceConfigs() });
    const configMatch = url.pathname.match(/^\/api\/service-configs\/(video|chat)(?:\/(probe))?$/);
    if (configMatch) {
      const serviceId = configMatch[1];
      if (req.method === "GET" && !configMatch[2]) return json(res, 200, { service: await serviceConfig(serviceId) });
      if (req.method === "PUT" && !configMatch[2]) return json(res, 200, { service: await saveServiceConfig(serviceId, await readJson(req)) });
      if (req.method === "POST" && configMatch[2] === "probe") {
        const probe = await probeServiceModels(serviceId);
        return json(res, 200, { service: await serviceConfig(serviceId), probe });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/services/start-all") return json(res, 200, { services: await startAllServices() });
    const serviceMatch = url.pathname.match(/^\/api\/services\/(video|chat)\/start$/);
    if (req.method === "POST" && serviceMatch) return json(res, 200, { service: await startLocalService(serviceMatch[1]) });
    if (url.pathname === "/api/video/history" && req.method === "GET") return proxyLocalJson("video", req, res, "/api/video/history");
    if (url.pathname === "/api/video/generate" && req.method === "POST") return proxyLocalJson("video", req, res, "/api/video/generate");
    if (req.method === "GET" && url.pathname === "/api/channels") return json(res, 200, { channels: channels.map(publicChannel) });
    if (req.method === "GET" && url.pathname === "/api/ledger") return json(res, 200, { entries: await readLedger(Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 100)) });
    if (req.method === "GET" && url.pathname === "/api/projects") return json(res, 200, { workspaceRoot: WORKSPACE_ROOT, projects: await listProjectDirectories() });
    if (req.method === "GET" && url.pathname === "/api/assets") return json(res, 200, { assets: await listAssets(Math.min(Math.max(Number(url.searchParams.get("limit") || 30), 1), 100)) });
    if (req.method === "GET" && url.pathname === "/api/tasks") return json(res, 200, { tasks: await listTasks(Math.min(Math.max(Number(url.searchParams.get("limit") || 30), 1), 100)) });
    if (req.method === "POST" && url.pathname === "/api/tasks") return json(res, 201, { task: await createTask(channels, await readJson(req)) });

    const taskMatch = url.pathname.match(/^\/api\/tasks\/(task_[a-f0-9]{32})(?:\/(run))?$/);
    if (taskMatch) {
      const task = await readTask(taskMatch[1]);
      if (req.method === "GET" && !taskMatch[2]) return json(res, 200, { task });
      if (req.method === "POST" && taskMatch[2] === "run") {
        const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
        if (!idempotencyKey || idempotencyKey.length > 200) return json(res, 400, { error: "A valid Idempotency-Key header is required" });
        return json(res, 200, await runTask(task, channels, idempotencyKey));
      }
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/assets/")) {
      const assetId = path.basename(url.pathname.slice("/api/assets/".length));
      const asset = await readAssetRecord(assetId);
      try {
        const body = await fs.readFile(asset.absolutePath);
        res.writeHead(200, { "content-type": asset.contentType, "content-length": body.byteLength });
        return res.end(body);
      } catch (error) {
        if (error?.code === "ENOENT") return json(res, 404, { error: "Asset not found" });
        throw error;
      }
    }

    if (channelMatch) {
      const channel = channels.find((item) => item.id === channelMatch[1]);
      if (!channel) return json(res, 404, { error: "Channel not found" });
      const action = channelMatch[2];
      if (req.method === "POST" && action === "probe") {
        const probeResult = await probe(channel);
        return json(res, 200, { channel: publicChannel(channel), probe: probeResult });
      }
      if (req.method === "POST" && action === "test") {
        const body = await readJson(req);
        if (body.confirm !== "PAID_TEST") return json(res, 400, { error: "Paid test requires confirm: PAID_TEST" });
        const task = await createTask(channels, { channel_id: channel.id, prompt: "A single blue circle centered on a white background, flat vector style.", n: 1, output_format: "png" }, "paid_test");
        return json(res, 200, await runTask(task, channels, req.headers["idempotency-key"] || crypto.randomUUID()));
      }
      if (req.method === "PUT" && !action) {
        const body = await readJson(req);
        const replacement = normalizeChannel({ ...channel, ...body, id: channel.id });
        const next = channels.map((item) => item.id === channel.id ? replacement : item);
        if (typeof body.api_key === "string" && body.api_key.trim()) await updateEnvKey(resolveKeyEnvName(channel.id), body.api_key.trim());
        await writeChannels(next);
        return json(res, 200, { channel: publicChannel(replacement) });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/generate") return json(res, 410, { error: "Create a task with POST /api/tasks, then run it with POST /api/tasks/:id/run" });

    if (req.method === "GET" && await serveStatic(req, res, url.pathname)) return;
    return json(res, 404, { error: "Route not found" });
  } catch (error) {
    const status = error?.message === "Request body too large" ? 413 : error?.status || 500;
    return json(res, status, { error: error?.message || "Internal error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`image-hub listening on http://${HOST}:${PORT}`);
});
