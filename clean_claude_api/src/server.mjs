import http from "node:http";
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
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    if (!err || err.code !== "ENOENT") throw err;
  }
}

await loadEnvFile(resolveAdapterPath(".env.local"));

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const UPSTREAM_BASE_URL = (process.env.UPSTREAM_BASE_URL || "").replace(/\/$/, "");
const UPSTREAM_API_KEY = process.env.UPSTREAM_API_KEY || "";
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || "2023-06-01";
const DATA_DIR = resolveAdapterPath(process.env.DATA_DIR || "./data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const DEFAULT_SESSION = process.env.DEFAULT_SESSION || "default";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "opus";
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES || 40);
const DEFAULT_MAX_TOKENS = Number(process.env.DEFAULT_MAX_TOKENS || 1024);
const DEFAULT_SYSTEM_PROMPT =
  process.env.DEFAULT_SYSTEM_PROMPT ||
  "You are a clear, thoughtful conversation partner. Be natural, intelligent, and direct. Do not add project-management, coding-agent, or tool-usage framing unless the user explicitly asks for it.";
const STATIC_DIR = resolveAdapterPath("./public");
const FALLBACK_DELIMITER = /\s*,\s*/;

async function ensureStorage() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function text(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sanitizeSessionId(input) {
  const value = String(input || DEFAULT_SESSION).trim();
  if (!value) return DEFAULT_SESSION;
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || DEFAULT_SESSION;
}

function splitCandidates(value, fallback) {
  const raw = String(value || fallback || "");
  return raw
    .split(FALLBACK_DELIMITER)
    .map((item) => item.trim())
    .filter(Boolean);
}

function modelCandidates(model) {
  const aliasMap = {
    haiku: splitCandidates(process.env.MODEL_HAIKU, "claude-sonnet-4-6"),
    sonnet: splitCandidates(process.env.MODEL_SONNET, "claude-sonnet-4-6"),
    opus: splitCandidates(process.env.MODEL_OPUS, "claude-opus-4-7,claude-sonnet-4-6"),
    multimodal: splitCandidates(process.env.MODEL_MULTIMODAL, "claude-sonnet-4-6"),
  };
  const requested = String(model || DEFAULT_MODEL || "opus").trim();
  if (aliasMap[requested]) return aliasMap[requested];
  return splitCandidates(requested, requested);
}

function primaryModel(model) {
  return modelCandidates(model)[0];
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function normalizeMessages(messages = []) {
  return messages
    .filter((m) => m && m.role)
    .map((m) => ({
      role: m.role,
      content: Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content || "") }],
    }));
}

function flattenText(content) {
  if (!Array.isArray(content)) return String(content || "");
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text") return part.text || "";
      return "";
    })
    .join("");
}

function sessionFile(sessionId) {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

async function loadSession(sessionId) {
  const file = sessionFile(sessionId);
  try {
    const raw = await fs.readFile(file, "utf8");
    const data = JSON.parse(raw);
    return {
      id: sessionId,
      system: data.system || DEFAULT_SYSTEM_PROMPT,
      messages: Array.isArray(data.messages) ? data.messages : [],
      updated_at: data.updated_at || null,
    };
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return {
        id: sessionId,
        system: DEFAULT_SYSTEM_PROMPT,
        messages: [],
        updated_at: null,
      };
    }
    throw err;
  }
}

async function saveSession(session) {
  const file = sessionFile(session.id);
  const payload = {
    id: session.id,
    system: session.system,
    messages: session.messages.slice(-MAX_HISTORY_MESSAGES),
    updated_at: new Date().toISOString(),
  };
  await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function extractAssistantText(response) {
  const parts = Array.isArray(response?.content) ? response.content : [];
  return parts
    .map((part) => {
      if (part?.type === "text") return part.text || "";
      return "";
    })
    .join("");
}

async function callUpstream({ model, messages, system, max_tokens, temperature }) {
  const upstreamRes = await fetch(`${UPSTREAM_BASE_URL}/v1/messages`, {
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
      max_tokens,
      messages,
      system,
      temperature,
      stream: false,
    }),
  });

  const raw = await upstreamRes.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (!upstreamRes.ok) {
    throw new Error(parsed?.error?.message || parsed?.error || raw || "Upstream request failed");
  }

  return parsed;
}

async function callUpstreamWithFallback({ requestedModel, messages, system, max_tokens, temperature }) {
  const candidates = modelCandidates(requestedModel);
  const attempts = [];

  for (const candidate of candidates) {
    try {
      const response = await callUpstream({
        model: candidate,
        messages,
        system,
        max_tokens,
        temperature,
      });
      return {
        model: candidate,
        response,
        attempts,
      };
    } catch (err) {
      attempts.push({
        model: candidate,
        error: err?.message || "Unknown error",
      });
    }
  }

  const detail = attempts.map((item) => `${item.model}: ${item.error}`).join(" | ");
  const error = new Error(`All model candidates failed for ${requestedModel}: ${detail}`);
  error.fallbackAttempts = attempts;
  error.requestedModel = requestedModel;
  error.candidates = candidates;
  throw error;
}

async function streamUpstream({ model, messages, system, max_tokens, temperature, onEvent }) {
  const upstreamRes = await fetch(`${UPSTREAM_BASE_URL}/v1/messages`, {
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
      max_tokens,
      messages,
      system,
      temperature,
      stream: true,
    }),
  });

  if (!upstreamRes.ok || !upstreamRes.body) {
    const raw = await upstreamRes.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    throw new Error(parsed?.error?.message || parsed?.error || raw || "Upstream stream failed");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalMessage = null;

  const processBlock = async (block) => {
    const lines = block.split("\n");
    let event = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    const payloadText = dataLines.join("\n");
    if (payloadText === "[DONE]") {
      await onEvent("done", { done: true });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      await onEvent("raw", { event, raw: payloadText });
      return;
    }
    if (payload?.type === "message_stop" || event === "message_stop") {
      finalMessage = payload;
    }
    await onEvent(event, payload);
  };

  for await (const chunk of upstreamRes.body) {
    buffer += decoder.decode(chunk, { stream: true });
    while (buffer.includes("\n\n")) {
      const boundary = buffer.indexOf("\n\n");
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (block.trim()) {
        await processBlock(block.trim());
      }
    }
  }

  if (buffer.trim()) {
    await processBlock(buffer.trim());
  }

  return finalMessage;
}

async function buildChatContext(body) {
  if (!UPSTREAM_BASE_URL) {
    throw new Error("UPSTREAM_BASE_URL is not set");
  }

  const sessionId = sanitizeSessionId(body.session_id);
  const session = await loadSession(sessionId);
  const inputMessages = normalizeMessages(body.messages);

  if (!inputMessages.length) {
    throw new Error("messages is required");
  }

  if (typeof body.system === "string" && body.system.trim()) {
    session.system = body.system.trim();
  }

  const history = body.use_history === false ? [] : session.messages.slice(-MAX_HISTORY_MESSAGES);
  const currentTurn = inputMessages;
  const requestedModel = String(body.model || DEFAULT_MODEL || "opus");

  return {
    body,
    sessionId,
    session,
    history,
    currentTurn,
    requestedModel,
    upstreamMessages: [...history, ...currentTurn],
  };
}

async function handleChat(req, res) {
  const body = await readJson(req);
  const { sessionId, session, history, currentTurn, requestedModel, upstreamMessages } = await buildChatContext(body);
  const upstreamResult = await callUpstreamWithFallback({
    requestedModel,
    messages: upstreamMessages,
    system: session.system,
    max_tokens: body.max_tokens ?? DEFAULT_MAX_TOKENS,
    temperature: body.temperature,
  });
  const model = upstreamResult.model;
  const upstreamResponse = upstreamResult.response;

  const assistantMessage = {
    role: "assistant",
    content: upstreamResponse.content || [{ type: "text", text: "" }],
  };

  if (body.save_history !== false) {
    session.messages = [...history, ...currentTurn, assistantMessage].slice(-MAX_HISTORY_MESSAGES);
    await saveSession(session);
  }

  return json(res, 200, {
    session_id: sessionId,
    requested_model: requestedModel,
    model,
    system: session.system,
    reply: extractAssistantText(upstreamResponse),
    fallback_attempts: upstreamResult.attempts,
    raw: upstreamResponse,
  });
}

async function handleChatStream(req, res) {
  const body = await readJson(req);
  const { sessionId, session, history, currentTurn, requestedModel, upstreamMessages } = await buildChatContext(body);
  const assistantParts = [];
  const candidates = modelCandidates(requestedModel);
  let chosenModel = null;
  let fallbackAttempts = [];

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  sse(res, "meta", {
    session_id: sessionId,
    requested_model: requestedModel,
    candidates,
    system: session.system,
  });

  for (const candidate of candidates) {
    try {
      chosenModel = candidate;
      sse(res, "model", { model: candidate });
      await streamUpstream({
        model: candidate,
        messages: upstreamMessages,
        system: session.system,
        max_tokens: body.max_tokens ?? DEFAULT_MAX_TOKENS,
        temperature: body.temperature,
        onEvent: async (event, payload) => {
          if (payload?.type === "content_block_delta" && payload.delta?.type === "text_delta") {
            const textDelta = payload.delta.text || "";
            assistantParts.push(textDelta);
            sse(res, "delta", { text: textDelta });
            return;
          }

          if (payload?.type === "message_start") {
            sse(res, "start", payload);
            return;
          }

          if (payload?.type === "message_delta") {
            sse(res, "usage", payload.usage || {});
            return;
          }

          if (event === "done" || payload?.type === "message_stop") {
            return;
          }
        },
      });
      break;
    } catch (err) {
      fallbackAttempts.push({
        model: candidate,
        error: err?.message || "Unknown error",
      });
      sse(res, "fallback", fallbackAttempts[fallbackAttempts.length - 1]);
      chosenModel = null;
    }
  }

  if (!chosenModel) {
    sse(res, "error", {
      error: `All model candidates failed for ${requestedModel}`,
      attempts: fallbackAttempts,
    });
    res.end();
    return;
  }

  const assistantText = assistantParts.join("");
  const assistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: assistantText }],
  };

  if (body.save_history !== false) {
    session.messages = [...history, ...currentTurn, assistantMessage].slice(-MAX_HISTORY_MESSAGES);
    await saveSession(session);
  }

  sse(res, "final", {
    session_id: sessionId,
    requested_model: requestedModel,
    model: chosenModel,
    reply: assistantText,
    fallback_attempts: fallbackAttempts,
  });
  sse(res, "done", { ok: true });
  res.end();
}

async function handleGetSession(req, res, url) {
  const sessionId = sanitizeSessionId(url.searchParams.get("session_id"));
  const session = await loadSession(sessionId);
  return json(res, 200, session);
}

async function handleDeleteSession(req, res, url) {
  const sessionId = sanitizeSessionId(url.searchParams.get("session_id"));
  await fs.rm(sessionFile(sessionId), { force: true });
  return json(res, 200, { ok: true, session_id: sessionId });
}

async function handleListSessions(req, res) {
  await ensureStorage();
  const files = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
  const sessions = [];
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    const id = file.name.replace(/\.json$/, "");
    const data = await loadSession(id);
    sessions.push({
      session_id: id,
      updated_at: data.updated_at,
      message_count: data.messages.length,
      preview: flattenText(data.messages[data.messages.length - 1]?.content).slice(0, 80),
    });
  }
  sessions.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  return json(res, 200, { sessions });
}

async function handleStatic(req, res, url) {
  let requested = url.pathname === "/" ? "/index.html" : url.pathname;
  requested = requested.replace(/\\/g, "/");
  const filePath = path.join(STATIC_DIR, requested);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(STATIC_DIR)) {
    return json(res, 403, { error: "Forbidden" });
  }
  try {
    const file = await fs.readFile(resolved);
    res.writeHead(200, { "content-type": contentType(resolved) });
    res.end(file);
    return true;
  } catch (err) {
    if (err && err.code === "ENOENT") return false;
    throw err;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    await ensureStorage();
    const url = new URL(req.url || "/", `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && (url.pathname === "/chat" || url.pathname === "/v1/messages")) {
      return await handleChat(req, res);
    }

    if (req.method === "POST" && url.pathname === "/chat/stream") {
      return await handleChatStream(req, res);
    }

    if (req.method === "GET" && url.pathname === "/sessions") {
      return await handleListSessions(req, res);
    }

    if (req.method === "GET" && url.pathname === "/session") {
      return await handleGetSession(req, res, url);
    }

    if (req.method === "DELETE" && url.pathname === "/session") {
      return await handleDeleteSession(req, res, url);
    }

    if (req.method === "GET") {
      const served = await handleStatic(req, res, url);
      if (served) return;
    }

    return json(res, 404, { error: "Not found" });
  } catch (err) {
    if (err?.fallbackAttempts) {
      return json(res, 503, {
        error: err.message || "All model candidates failed",
        requested_model: err.requestedModel,
        candidates: err.candidates,
        fallback_attempts: err.fallbackAttempts,
      });
    }
    return json(res, 500, { error: err?.message || "Internal error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`clean claude chat bridge listening on http://${HOST}:${PORT}`);
});
