import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ADAPTER_DIR = path.resolve(process.cwd(), "video");
loadEnvFile(path.join(ADAPTER_DIR, ".env.local"));

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT ?? "4000", 10);
const DEFAULT_ENDPOINT = process.env.VIDEO_API_URL ?? `http://${HOST}:${PORT}/api/video/generate`;
const DEFAULT_OUTPUT = "output/video/generated-video.mp4";

function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
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

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;

    const key = current.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function printUsage() {
  console.log(`
Usage:
  npm run video:generate -- --prompt "..." --seconds 4 --size 1280x720

Optional:
  --model AA-veo31fast-720p
  --seconds 4
  --size 1280x720
  --quality standard
  --reference-url https://...
  --reference-file path/to/reference.png
  --wait
  --poll-ms 5000
  --timeout-ms 900000
  --endpoint http://127.0.0.1:4000/api/video/generate
  --payload video/example-request.json
  --out output/video/demo.mp4
`);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: response.ok, status: response.status, body };
}

function buildPayload(args) {
  if (args.payload) {
    const payloadPath = path.resolve(args.payload);
    const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    if (typeof payload.reference_file === "string" && payload.reference_file.trim()) {
      payload.reference_file = path.resolve(path.dirname(payloadPath), payload.reference_file);
    }
    return payload;
  }

  if (!args.prompt) {
    throw new Error("Missing required --prompt or --payload");
  }

  const payload = { prompt: args.prompt };

  if (args.model) payload.model = args.model;
  if (args.seconds) payload.seconds = args.seconds;
  if (args.duration) payload.seconds = args.duration;
  if (args.size) payload.size = args.size;
  if (args.quality) payload.quality = args.quality;
  if (args["reference-url"]) payload.reference_url = args["reference-url"];
  if (args["reference-file"]) payload.reference_file = path.resolve(args["reference-file"]);

  return payload;
}

async function waitForCompletion(baseUrl, videoId, pollMs, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await fetchJson(`${baseUrl}/${encodeURIComponent(videoId)}`);
    if (!result.ok) {
      throw new Error(result.body?.error?.message ?? `Polling failed with status ${result.status}`);
    }

    const video = result.body?.video;
    if (video?.status === "completed") {
      return video;
    }
    if (video?.status === "failed") {
      throw new Error(video?.error?.message ?? "Video generation failed");
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error("Timed out waiting for video completion");
}

async function downloadVideo(baseUrl, videoId, outputPath) {
  const response = await fetch(`${baseUrl}/${encodeURIComponent(videoId)}/content`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to download video: HTTP ${response.status}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
  return outputPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === "true") {
    printUsage();
    return;
  }

  const payload = buildPayload(args);
  const endpoint = args.endpoint ?? DEFAULT_ENDPOINT;
  const baseUrl = endpoint.replace(/\/generate$/, "");
  const outputPath = path.resolve(args.out ?? DEFAULT_OUTPUT);

  const result = await fetchJson(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!result.ok) {
    throw new Error(result.body?.error?.message ?? `Request failed with status ${result.status}`);
  }

  const video = result.body?.video;
  if (!video?.id) {
    console.log(JSON.stringify(result.body, null, 2));
    return;
  }

  if (args.wait !== "true") {
    console.log(JSON.stringify(video, null, 2));
    return;
  }

  const completed = await waitForCompletion(
    baseUrl,
    video.id,
    Number.parseInt(args["poll-ms"] ?? "5000", 10),
    Number.parseInt(args["timeout-ms"] ?? "900000", 10),
  );

  const savedPath = await downloadVideo(baseUrl, completed.id, outputPath);
  console.log(savedPath);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
