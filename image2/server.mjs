import http from "node:http";
import https from "node:https";
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
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const DEFAULT_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
const MAX_BODY_SIZE = 1_000_000;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL;
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.IMAGE2_UPSTREAM_TIMEOUT_MS ?? "600000", 10);

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
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

function normalizeRequest(body) {
  if (!body.prompt || typeof body.prompt !== "string" || !body.prompt.trim()) {
    throw new Error("`prompt` is required");
  }

  const payload = {
    model: typeof body.model === "string" && body.model.trim() ? body.model : DEFAULT_MODEL,
    prompt: body.prompt.trim(),
  };

  if (body.size) payload.size = body.size;
  if (body.quality) payload.quality = body.quality;
  if (body.output_format) payload.output_format = body.output_format;
  if (typeof body.output_compression === "number") payload.output_compression = body.output_compression;
  if (typeof body.background === "string") payload.background = body.background;
  if (typeof body.moderation === "string") payload.moderation = body.moderation;
  if (Number.isInteger(body.n) && body.n > 0) payload.n = body.n;

  return payload;
}

function mapOpenAiError(error) {
  const status = typeof error.status === "number" ? error.status : 500;
  return {
    status,
    body: {
      ok: false,
      error: {
        message: error.message ?? "Image generation failed",
        type: error.type ?? "unknown_error",
        code: error.code ?? null,
        request_id: error.request_id ?? null,
        moderation_details: error.moderation_details ?? null,
      },
    },
  };
}

async function generateImage(imageRequest) {
  const endpoint = new URL(`${OPENAI_BASE_URL.replace(/\/$/, "")}/images/generations`);
  const requestBody = JSON.stringify(imageRequest);
  const transport = endpoint.protocol === "http:" ? http : https;

  const response = await new Promise((resolve, reject) => {
    const req = transport.request(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
      },
    }, (res) => {
      const chunks = [];

      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 500,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("Upstream image request timed out"));
    });
    req.write(requestBody);
    req.end();
  });

  const result = response.body ? JSON.parse(response.body) : {};

  if (response.status < 200 || response.status >= 300) {
    const error = new Error(result?.error?.message ?? `Image generation failed with status ${response.status}`);
    error.status = response.status;
    error.type = result?.error?.type ?? "upstream_error";
    error.code = result?.error?.code ?? null;
    error.request_id = response.headers["x-request-id"] ?? null;
    error.moderation_details = result?.error?.moderation_details ?? null;
    throw error;
  }

  return result;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "image2",
        model: DEFAULT_MODEL,
        base_url: OPENAI_BASE_URL,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/image2/generate") {
      const body = await readJsonBody(req);
      const imageRequest = normalizeRequest(body);
      const result = await generateImage(imageRequest);

      sendJson(res, 200, {
        ok: true,
        model: imageRequest.model,
        created: result.created ?? null,
        data: (result.data ?? []).map((item, index) => ({
          index,
          b64_json: item.b64_json ?? null,
          revised_prompt: item.revised_prompt ?? null,
        })),
      });
      return;
    }

    sendJson(res, 404, {
      ok: false,
      error: {
        message: "Route not found",
      },
    });
  } catch (error) {
    if (error instanceof Error && (error.message === "`prompt` is required" || error.message === "Invalid JSON body")) {
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

    const mapped = mapOpenAiError(error);
    sendJson(res, mapped.status, mapped.body);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`image2 API listening on http://${HOST}:${PORT}`);
});
