import http from "node:http";
import process from "node:process";
import OpenAI from "openai";

const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const DEFAULT_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
const MAX_BODY_SIZE = 1_000_000;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL?.trim();

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: OPENAI_BASE_URL || undefined,
});

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

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "image2",
        model: DEFAULT_MODEL,
        base_url: OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/image2/generate") {
      const body = await readJsonBody(req);
      const imageRequest = normalizeRequest(body);
      const result = await client.images.generate(imageRequest);

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

server.listen(PORT, () => {
  console.log(`image2 API listening on http://localhost:${PORT}`);
});
