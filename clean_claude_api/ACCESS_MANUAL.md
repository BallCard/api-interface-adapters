# Clean Claude API Access Manual

This manual is for using and managing the interface in practice.

## 1. What It Is

This is a local Claude chat entry with persistent history.

Upstream:

- Vendor: `Sakura Claude 4.7`
- Base URL: `https://sakura886.site`

Model mapping:

- `haiku` -> `claude-sonnet-4-6`
- `sonnet` -> `claude-sonnet-4-6`
- `opus` -> `claude-opus-4-7`
- `multimodal` -> `claude-sonnet-4-6`

## 2. Start the Service

```powershell
cd D:\Workspace\projects\api-interface-adapters\clean_claude_api

$env:UPSTREAM_BASE_URL="https://sakura886.site"
$env:UPSTREAM_API_KEY="your-real-key"
node src/server.mjs
```

Default address:

```text
http://127.0.0.1:8787
```

## 3. Environment Variables

Required:

- `UPSTREAM_BASE_URL`
- `UPSTREAM_API_KEY`

You can also store them in a local ignored file:

```text
D:\Workspace\projects\api-interface-adapters\clean_claude_api\.env.local
```

Common optional fields:

- `HOST`
- `PORT`
- `DATA_DIR`
- `DEFAULT_SESSION`
- `DEFAULT_MODEL`
- `MAX_HISTORY_MESSAGES`
- `DEFAULT_MAX_TOKENS`
- `DEFAULT_SYSTEM_PROMPT`

## 4. Data Storage

Default path:

```text
D:\Workspace\projects\api-interface-adapters\clean_claude_api\data\sessions\
```

Each session is stored as one `.json` file.

## 5. Web UI

Open:

```text
http://127.0.0.1:8787
```

Main actions:

- switch session from the left sidebar
- create a new session with `+`
- choose model from the selector
- send messages from the bottom composer
- reload current history with `History`

## 6. Probe Models

Run:

```powershell
cd D:\Workspace\projects\api-interface-adapters\clean_claude_api
npm run probe
```

This script sends real upstream test requests and reports:

- model name
- HTTP status
- elapsed time
- reply or error

Use it when the provider looks unstable or when you want to confirm which models are actually live.

## 7. HTTP Endpoints

### 6.1 Health Check

```http
GET /health
```

### 6.2 Normal Chat

```http
POST /chat
Content-Type: application/json
```

Example:

```json
{
  "session_id": "daily",
  "model": "opus",
  "messages": [
    {
      "role": "user",
      "content": "Lately I keep wondering whether people confuse efficiency with direction."
    }
  ]
}
```

Response example:

```json
{
  "session_id": "daily",
  "model": "claude-opus-4-7",
  "system": "You are a clear, thoughtful conversation partner...",
  "reply": "Yes. Efficiency solves speed, not direction.",
  "raw": {}
}
```

### 6.3 Streaming Chat

```http
POST /chat/stream
Accept: text/event-stream
Content-Type: application/json
```

The request body is the same as `/chat`.

SSE events:

- `meta`: session and model information
- `start`: upstream started
- `delta`: text delta
- `usage`: usage update
- `final`: final full reply
- `done`: end

### 6.4 Compatibility Endpoint

```http
POST /v1/messages
```

This path internally reuses `/chat`.

### 6.5 List Sessions

```http
GET /sessions
```

### 6.6 Read a Session

```http
GET /session?session_id=daily
```

### 6.7 Delete a Session

```http
DELETE /session?session_id=daily
```

## 8. Request Fields

- `session_id`: session name; same name continues history
- `model`: `opus` / `sonnet` / `haiku` / `multimodal`, or a real model name
- `messages`: input messages for this turn
- `system`: override the default system prompt
- `temperature`: optional
- `max_tokens`: optional
- `use_history`: if `false`, the request skips stored history
- `save_history`: if `false`, the request is not written to history

If an alias has multiple candidates, the service will try them in order.

Example:

```text
MODEL_OPUS=claude-opus-4-7,claude-sonnet-4-6
```

That means `model: "opus"` first tries `claude-opus-4-7`, then falls back to `claude-sonnet-4-6`.

## 9. CLI Usage

Start:

```powershell
cd D:\Workspace\projects\api-interface-adapters\clean_claude_api
npm run chat
```

Optional environment variables:

```powershell
$env:CHAT_BASE_URL="http://127.0.0.1:8787"
$env:CHAT_SESSION_ID="daily"
$env:CHAT_MODEL="opus"
```

CLI commands:

- `/session <id>`: switch session
- `/sessions`: list sessions
- `/history`: show current session history
- `/exit`: exit

## 10. PowerShell Examples

### Normal Chat

```powershell
$body = @{
  session_id = "daily"
  model = "opus"
  messages = @(
    @{
      role = "user"
      content = "If a person becomes more restrained over time, is that maturity or suppression?"
    }
  )
} | ConvertTo-Json -Depth 6

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8787/chat" `
  -ContentType "application/json" `
  -Body $body
```

### View History

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/session?session_id=daily"
```

## 11. Boundaries

It is not a bare model.

It still has a light default system prompt. The goal is not to control you, but to keep the model from sliding into project-assistant or coding-agent framing.

If you want it even more minimal, shorten `DEFAULT_SYSTEM_PROMPT` or override it per request with `system`.

## 12. FAQ

### Q1: Why not use Claude Code as the main entry?

Because `Claude Code` naturally carries agent tendencies. Your goal here is daily conversation, not project work.

### Q2: Why keep history on the server?

Because your use case is long-running conversation. Server-side sessions are easier to manage than resending full history every time.

### Q3: How do I skip history for one request?

Add:

```json
{
  "use_history": false
}
```

### Q4: How do I avoid saving one request?

Add:

```json
{
  "save_history": false
}
```

### Q5: How do I configure fallback?

Set multiple candidates in one env value, separated by commas.

Example:

```text
MODEL_OPUS=claude-opus-4-7,claude-sonnet-4-6
```

### Q6: How do I know whether fallback happened?

- `/chat` returns `fallback_attempts`
- `/chat/stream` emits `fallback` events
- `npm run probe` shows upstream availability directly
