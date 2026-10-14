# @open-pencil/harness

Optional Node companion runtime for coding-agent harness sessions. It owns the backend-neutral session lifecycle, opaque resume-state persistence, and the JSONL protocol used by host applications, over stdio for the desktop app and over WebSocket for the browser app.

## Current scope

- Backend-neutral, streaming session service.
- Atomic, bounded persistence of opaque harness resume state.
- Streaming tool input: `tool-input-start` and `tool-input-delta` events carry a tool call's JSON input while the model writes it, so the app can draw a `render` call's JSX on the canvas before the call runs.
- `openpencil-harness`: the JSONL stdio companion the desktop app starts.
- `openpencil-harness-serve`: the same protocol over WebSocket, for the browser app.

## Backends

**Pi** (`adapter: 'pi'`, `sandbox: 'just-bash'`) uses AI SDK `HarnessAgent`, Pi, and local `just-bash`. Pi runs in the Node host process; `just-bash` provides an isolated in-memory workspace and shell without requiring cloud infrastructure.

**Claude Code** (`adapter: 'claude-code'`, `sandbox: 'none'`) runs the `claude` CLI headless with the person's own sign-in, one process per session:

```sh
claude -p --input-format stream-json --output-format stream-json --include-partial-messages \
  --tools "" --strict-mcp-config --mcp-config <servers> --allowedTools mcp__<server> \
  --setting-sources "" --no-session-persistence --system-prompt <instructions>
```

The agent has no shell, files, or web access of its own: it reaches the canvas only through the MCP servers in the session configuration, and only HTTP servers are accepted. A person's Claude Code settings, hooks, and `CLAUDE.md` stay out of the session. The process stays alive between turns, so the conversation continues without CLI startup; Stop sends Claude Code's interrupt request and keeps the process. `model: 'default'` leaves the model to Claude Code, and `settings.effort` passes `--effort`. Set `OPENPENCIL_HARNESS_CLAUDE_COMMAND` to use another `claude` executable.

## WebSocket companion

`openpencil-harness-serve` lets the browser app, which cannot start programs, run Claude Code with the person's own sign-in. It listens on `127.0.0.1` only. Run on its own, it also starts OpenPencil's MCP server for the paired tab (port 7600, with its own socket and discovery file under the state directory, so it never replaces the desktop app's) and prints a pairing link:

```sh
OPENPENCIL_HARNESS_ORIGINS=https://app.openpencil.dev openpencil-harness-serve
# [Harness] Open this link to pair OpenPencil with this companion:
#   https://app.openpencil.dev/#openpencil-harness=7610.<token>.<mcp-token>
```

Opening the link stores the pairing in the app's credential store and removes it from the address bar. The link names only a port; the app always connects to `127.0.0.1`.

| Variable                       | Meaning                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENPENCIL_HARNESS_ORIGINS`   | Comma-separated browser origins allowed to connect, `https://app.openpencil.dev` by default. Other origins get 403.                                  |
| `OPENPENCIL_HARNESS_TOKEN`     | The token a connection must send first, as `{"type":"auth","token":"…"}`; anything else closes it with code 4401. Generated for each run when unset. |
| `OPENPENCIL_HARNESS_PORT`      | WebSocket port, 7610 by default.                                                                                                                     |
| `OPENPENCIL_HARNESS_MCP`       | `0` skips the MCP server, for a host that runs its own, as `bun run dev` does.                                                                       |
| `OPENPENCIL_HARNESS_MCP_PORT`  | MCP server port, 7600 by default; the browser app expects 7600.                                                                                      |
| `OPENPENCIL_HARNESS_ADAPTERS`  | Backends to offer, `claude-code` by default.                                                                                                         |
| `OPENPENCIL_HARNESS_STATE_DIR` | Sessions, MCP socket, and discovery file; `~/.open-pencil/harness` by default.                                                                       |

After authenticating, the server answers `{"type":"ready","version":"…"}`, then exchanges the stdio protocol's messages, one JSON object per frame. `GET /health` reports the version, the offered adapters, and whether the Claude Code CLI starts. Each connection owns its sessions, which stop when it closes.

`bun run dev` starts this companion beside the browser app with a fresh token and hands it to the app itself, so no pairing is needed there (`vite/harness.ts`); set `OPENPENCIL_DEV_HARNESS=0` to turn it off or `OPENPENCIL_DEV_HARNESS_PORT` to move it.

## Installing

The package is installed as an optional companion CLI. It is not bundled into every Tauri build; install `@open-pencil/harness` globally to make the `openpencil-harness` command available. It runs on Node 22.15 or later, or Bun: Pi's MCP adapter publishes TypeScript sources, which the companion strips through Node's module hooks. Credentials are supplied to the companion process at runtime and are never written to resume-state storage.

## Local sandbox limitation

`just-bash` is process-local and in-memory. Multi-turn sessions work while the sidecar remains alive, but its sandbox cannot be reattached after a process restart. A backend that reports `sessionResume: 'live-process'`, as Pi and Claude Code do, therefore starts a stopped session fresh and drops its saved state. Durable restart recovery requires a persistent sandbox provider in a later integration.
