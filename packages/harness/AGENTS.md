# Harness

Optional Node companion for HarnessAgent sessions. Tauri launches the separately installed command; never bundle a JavaScript runtime into Tauri.

- Keep the package backend-neutral.
- Persist only opaque, non-secret resume state. Pi's in-memory `just-bash` cannot recover across process restarts.
- Expose the bounded JSONL host protocol; changes to it must keep the desktop launcher and `desktop/capabilities/**` in sync (`desktop/AGENTS.md`).
- Both hosts, stdio (`stdio.ts`) and WebSocket (`serve.ts`), dispatch through `createHarnessHost` in `src/host.ts`; protocol changes land there once (`tests/server.test.ts`).
- The WebSocket host listens on loopback only and serves a connection only from an allowed origin and after the token arrives as its first message (`tests/server.test.ts`).
- The Claude Code backend runs with no built-in tools and accepts only HTTP MCP servers, because a network client chooses its configuration (`tests/claude-code.test.ts`).
- stdout carries only protocol messages: write them through the writer `reserveProtocolOutput()` returns, and let other output, including npm runs Pi starts, go to stderr (`tests/output.test.ts`).
- `bun run test:tools` runs this package's tests together with the repo tooling suites.
