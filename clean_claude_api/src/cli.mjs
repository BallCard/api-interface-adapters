import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const BASE_URL = (process.env.CHAT_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const SESSION_ID = process.env.CHAT_SESSION_ID || "daily";
const MODEL = process.env.CHAT_MODEL || "opus";

function blue(text) {
  return `\u001b[34m${text}\u001b[0m`;
}

function red(text) {
  return `\u001b[31m${text}\u001b[0m`;
}

async function sendMessage(message, sessionId) {
  const res = await fetch(`${BASE_URL}/chat/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({
      session_id: sessionId,
      model: MODEL,
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    while (buffer.includes("\n\n")) {
      const boundary = buffer.indexOf("\n\n");
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = block.split("\n");
      let event = "";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!event || !data) continue;
      const payload = JSON.parse(data);
      if (event === "delta") {
        output.write(payload.text || "");
      }
      if (event === "final") {
        output.write("\n");
      }
    }
  }
}

async function main() {
  const rl = readline.createInterface({ input, output });
  let sessionId = SESSION_ID;

  output.write(`${blue("Clean Claude Chat CLI")}\n`);
  output.write(`base: ${BASE_URL}\n`);
  output.write(`session: ${sessionId}\n`);
  output.write("commands: /session <id>, /sessions, /history, /exit\n\n");

  while (true) {
    const line = (await rl.question(blue("you> "))).trim();
    if (!line) continue;

    if (line === "/exit") break;

    if (line.startsWith("/session ")) {
      sessionId = line.slice(9).trim() || sessionId;
      output.write(`switched to session: ${sessionId}\n`);
      continue;
    }

    if (line === "/sessions") {
      try {
        const res = await fetch(`${BASE_URL}/sessions`);
        const data = await res.json();
        for (const session of data.sessions || []) {
          output.write(`- ${session.session_id} (${session.message_count}) ${session.preview || ""}\n`);
        }
      } catch (err) {
        output.write(red(`${err.message}\n`));
      }
      continue;
    }

    if (line === "/history") {
      try {
        const res = await fetch(`${BASE_URL}/session?session_id=${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        for (const message of data.messages || []) {
          output.write(`${blue(message.role + "> ")}${(message.content || []).map((p) => p.text || "").join("")}\n`);
        }
      } catch (err) {
        output.write(red(`${err.message}\n`));
      }
      continue;
    }

    output.write(blue("opus> "));
    try {
      await sendMessage(line, sessionId);
    } catch (err) {
      output.write(red(`${err.message}\n`));
    }
  }

  rl.close();
}

await main();
