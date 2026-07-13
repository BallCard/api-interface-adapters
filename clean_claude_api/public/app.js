const state = {
  sessionId: "default",
  model: "opus",
  sessions: [],
  pendingAssistantEl: null,
};

const messageTemplate = document.getElementById("messageTemplate");
const messagesEl = document.getElementById("messages");
const sessionListEl = document.getElementById("sessionList");
const activeSessionTitleEl = document.getElementById("activeSessionTitle");
const activeSessionLabelEl = document.getElementById("activeSessionLabel");
const statusEl = document.getElementById("status");
const modelSelectEl = document.getElementById("modelSelect");
const composerEl = document.getElementById("composer");
const messageInputEl = document.getElementById("messageInput");
const historyBtnEl = document.getElementById("historyBtn");
const newSessionBtnEl = document.getElementById("newSessionBtn");

function setStatus(text) {
  statusEl.textContent = text;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderMessage(role, text) {
  const node = messageTemplate.content.firstElementChild.cloneNode(true);
  node.classList.add(role);
  node.querySelector(".message-role").textContent = role;
  node.querySelector(".message-body").innerHTML = escapeHtml(text).replaceAll("\n", "<br>");
  messagesEl.appendChild(node);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return node;
}

function updateAssistantDraft(text) {
  if (!state.pendingAssistantEl) {
    state.pendingAssistantEl = renderMessage("assistant", "");
  }
  state.pendingAssistantEl.querySelector(".message-body").innerHTML = escapeHtml(text).replaceAll("\n", "<br>");
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadSessions() {
  const data = await fetchJson("/sessions");
  state.sessions = data.sessions || [];
  sessionListEl.innerHTML = "";
  for (const session of state.sessions) {
    const btn = document.createElement("button");
    btn.className = "session-item";
    if (session.session_id === state.sessionId) btn.classList.add("active");
    btn.innerHTML = `
      <div class="session-name">${escapeHtml(session.session_id)}</div>
      <div class="session-preview">${escapeHtml(session.preview || "No messages yet")}</div>
    `;
    btn.addEventListener("click", async () => {
      state.sessionId = session.session_id;
      syncHeader();
      await loadSessions();
      await loadHistory();
    });
    sessionListEl.appendChild(btn);
  }
}

function syncHeader() {
  activeSessionLabelEl.textContent = "session";
  activeSessionTitleEl.textContent = state.sessionId;
}

async function loadHistory() {
  const data = await fetchJson(`/session?session_id=${encodeURIComponent(state.sessionId)}`);
  messagesEl.innerHTML = "";
  state.pendingAssistantEl = null;
  for (const message of data.messages || []) {
    const text = (message.content || []).map((part) => part.text || "").join("");
    renderMessage(message.role, text);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function sendMessage(text) {
  renderMessage("user", text);
  state.pendingAssistantEl = null;
  setStatus("Streaming");

  const res = await fetch("/chat/stream", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({
      session_id: state.sessionId,
      model: state.model,
      messages: [{ role: "user", content: text }],
    }),
  });

  if (!res.ok || !res.body) {
    throw new Error(await res.text());
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";

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
        assistantText += payload.text || "";
        updateAssistantDraft(assistantText);
      }
      if (event === "final") {
        assistantText = payload.reply || assistantText;
        updateAssistantDraft(assistantText);
      }
    }
  }

  state.pendingAssistantEl = null;
  setStatus("Ready");
  await loadSessions();
}

composerEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageInputEl.value.trim();
  if (!text) return;
  messageInputEl.value = "";
  try {
    await sendMessage(text);
  } catch (err) {
    setStatus("Error");
    renderMessage("assistant", `Error: ${err.message}`);
  }
});

historyBtnEl.addEventListener("click", async () => {
  await loadHistory();
});

newSessionBtnEl.addEventListener("click", async () => {
  const next = window.prompt("Session name", `session_${Date.now()}`);
  if (!next) return;
  state.sessionId = next.trim();
  syncHeader();
  messagesEl.innerHTML = "";
  await loadSessions();
});

modelSelectEl.addEventListener("change", () => {
  state.model = modelSelectEl.value;
});

syncHeader();
setStatus("Ready");
await loadSessions();
await loadHistory();
