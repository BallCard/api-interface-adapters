import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_ENDPOINT = process.env.IMAGE2_API_URL ?? "http://localhost:3000/api/image2/generate";
const DEFAULT_OUTPUT = "output/image2/generated-image.png";

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
  npm run image2:generate -- --prompt "..." --out output/image2/demo.png

Optional:
  --size 1536x864
  --quality high
  --output-format png
  --model gpt-image-2
  --endpoint http://localhost:3000/api/image2/generate
  --payload image2/example-request.json
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help === "true") {
    printUsage();
    return;
  }

  let payload;

  if (args.payload) {
    payload = JSON.parse(fs.readFileSync(path.resolve(args.payload), "utf8"));
  } else {
    if (!args.prompt) {
      throw new Error("Missing required --prompt or --payload");
    }

    payload = { prompt: args.prompt };

    if (args.size) payload.size = args.size;
    if (args.quality) payload.quality = args.quality;
    if (args["output-format"]) payload.output_format = args["output-format"];
    if (args.model) payload.model = args.model;
  }

  const endpoint = args.endpoint ?? DEFAULT_ENDPOINT;
  const outputPath = path.resolve(args.out ?? DEFAULT_OUTPUT);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(result?.error?.message ?? `Request failed with status ${response.status}`);
  }

  const image = result.data?.[0]?.b64_json;
  if (!image) {
    throw new Error("No image data returned");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(image, "base64"));

  console.log(outputPath);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
